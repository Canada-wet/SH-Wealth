import { expect, it, vi } from "vitest";
import {
  BACKUP_MAX_BYTES,
  BACKUP_SECTIONS,
  backupBytes,
  buildBackupBundle,
  type BackupDefinition,
  type BackupReader,
  type BackupSectionId,
} from "../lib/backup-bundle";
import { emptyState } from "../lib/wealth";
const scope = {
  userId: "00000000-0000-4000-8000-000000000001",
  householdId: "00000000-0000-4000-8000-000000000002",
};
const spec = (id: BackupSectionId) => BACKUP_SECTIONS.find((s) => s.id === id)!;
const row = (
  id: BackupSectionId,
  index = 0,
  extra: Record<string, unknown> = {},
) => ({
  ...Object.fromEntries(spec(id).columns.map((c) => [c, null])),
  id: `synthetic-${id}-${index}`,
  household_id: scope.householdId,
  user_id: scope.userId,
  revision: index + 1,
  feature_id: `feature-${index}`,
  visibility: "private",
  ...extra,
});
const records = () =>
  ({ household: [row("household", 0, { document: emptyState() })] }) as Partial<
    Record<BackupSectionId, Record<string, unknown>[]>
  >;
function reader(data = records()): BackupReader {
  return vi.fn<BackupReader>(async (s, offset, limit) => {
    const rows = data[s.id] ?? [];
    return { data: rows.slice(offset, offset + limit), count: rows.length };
  });
}
it("版本化包明确共享/个人范围、排除项和人工恢复边界，不冒充全数据库备份", async () => {
  const result = await buildBackupBundle(scope, reader(), {
    now: () => new Date("2026-10-19T12:00:00Z"),
  });
  expect(result).toMatchObject({
    kind: "together-user-visible-export",
    schemaVersion: 1,
    status: "complete",
    exportedAt: "2026-10-19T12:00:00.000Z",
  });
  expect(result.scope).toMatchObject({
    ...scope,
    notDatabaseBackup: true,
    consistency: "best-effort-non-transactional",
  });
  expect(result.scope.personalSections).toEqual([
    "navigation",
    "learning",
    "council",
  ]);
  expect(Object.keys(result.sections)).toHaveLength(8);
  expect(result.sections.household.count).toBe(1);
  expect(result.sections.learning.count).toBe(0);
  expect(result.restorePlan).toMatchObject({
    automaticRestore: false,
    existingImportAcceptsBundle: false,
    drillDestination: "isolated-project-only",
  });
  expect(result.excluded.join(" ")).toContain("伴侣");
  expect(backupBytes(result)).toBeLessThan(BACKUP_MAX_BYTES);
});
it("严格选定列并移除JSON内部运行凭据，不修改原文档、附件或调用状态", async () => {
  const data = records();
  data.council = [
    row("council", 0, {
      document: {
        question: "Synthetic question",
        models: [{ key: "qwen-light" }],
        steps: [
          {
            answer: "Synthetic answer",
            claim: "SYNTHETIC_CLAIM",
            usage: { output: 20 },
          },
        ],
        attachments: [{ content: "Synthetic excerpt" }],
        access_token: "SYNTHETIC_ACCESS",
        destination_cipher: "SYNTHETIC_CIPHER",
      },
      api_key: "SYNTHETIC_TOP_SECRET",
    }),
  ];
  data.researchRuns = [
    row("researchRuns", 0, {
      token: "SYNTHETIC_FUNDA_TOKEN",
      day: "2026-10-19",
      phase: "open",
    }),
  ];
  const original = JSON.stringify(data);
  const result = await buildBackupBundle(scope, reader(data));
  const text = JSON.stringify(result);
  for (const secret of [
    "SYNTHETIC_CLAIM",
    "SYNTHETIC_ACCESS",
    "SYNTHETIC_CIPHER",
    "SYNTHETIC_TOP_SECRET",
    "SYNTHETIC_FUNDA_TOKEN",
  ])
    expect(text).not.toContain(secret);
  expect(text).toContain("Synthetic excerpt");
  expect(text).toContain("qwen-light");
  expect(result.sections.council.redactedFields).toBe(3);
  expect(JSON.stringify(data)).toBe(original);
});
it.each(["household", "navigation", "council", "learning"] as const)(
  "防御性拒绝越界 %s 行，不泄露其他家庭或伴侣内容",
  async (id) => {
    const data = records();
    data[id] = [
      row(id, 0, {
        household_id: "foreign-home",
        user_id: "partner",
        document: { question: "PRIVATE_FOREIGN_QUESTION" },
      }),
    ];
    const result = await buildBackupBundle(scope, reader(data));
    expect(result.status).toBe("partial");
    expect(result.sections[id].status).toBe("error");
    expect(result.sections[id].issues[0].code).toBe("scope_mismatch");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_FOREIGN_QUESTION");
  },
);
it("某表缺失明确partial且不输出数据库错误原文，成功部分仍保留", async () => {
  const read = reader();
  const result = await buildBackupBundle(scope, async (...args) =>
    args[0].id === "learning"
      ? { data: null, count: null, error: { message: "SYNTHETIC_DB_SECRET" } }
      : read(...args),
  );
  expect(result.status).toBe("partial");
  expect(result.sections.learning).toMatchObject({ status: "error", count: 0 });
  expect(result.sections.household.count).toBe(1);
  expect(JSON.stringify(result)).not.toContain("SYNTHETIC_DB_SECRET");
});
it("分页中断保留成功行与第一个未导出偏移，不自动重发失败页", async () => {
  const read = vi.fn<BackupReader>(async (s, offset) =>
    s.id === "cloudHistory"
      ? offset
        ? { data: null, count: null, error: true }
        : { data: [row("cloudHistory")], count: 3 }
      : reader()(s, offset, s.pageSize),
  );
  const result = await buildBackupBundle(scope, read);
  expect(result.sections.cloudHistory).toMatchObject({
    status: "partial",
    count: 1,
    totalAvailable: 3,
    continuation: { offset: 1, automatic: false },
  });
  expect(
    read.mock.calls
      .filter(([s]) => s.id === "cloudHistory")
      .map(([, offset]) => offset),
  ).toEqual([0, 1]);
});
it("恰好到行数上限不伪装截断；多出记录时显式标注不包含的历史", async () => {
  for (const count of [30, 31]) {
    const data = records();
    data.cloudHistory = Array.from({ length: count }, (_, i) =>
      row("cloudHistory", i, { document: { value: i } }),
    );
    const result = await buildBackupBundle(scope, reader(data));
    expect(result.sections.cloudHistory.count).toBe(30);
    expect(result.sections.cloudHistory.truncated).toBe(count === 31);
    expect(result.sections.cloudHistory.status).toBe(
      count === 31 ? "partial" : "complete",
    );
    if (count === 31)
      expect(result.sections.cloudHistory.continuation?.offset).toBe(30);
  }
});
it("未知总数会额外探测上限后一行，不凭页长宣称已全量导出", async () => {
  const data = records();
  data.navigation = Array.from({ length: 101 }, (_, i) => row("navigation", i));
  const base = reader(data);
  const read = vi.fn<BackupReader>(async (...args) => ({
    ...(await base(...args)),
    count: null,
  }));
  const result = await buildBackupBundle(scope, read);
  expect(result.sections.navigation).toMatchObject({
    status: "partial",
    count: 100,
    truncated: true,
    totalAvailable: null,
  });
  expect(
    read.mock.calls
      .filter(([s]) => s.id === "navigation")
      .map(([, offset, limit]) => [offset, limit]),
  ).toEqual([
    [0, 50],
    [50, 50],
    [100, 1],
  ]);
});
it("字节预算不会切坏大研讨或base64附件，UTF-8按真实字节计数", async () => {
  const data = records();
  data.council = [0, 1].map((i) =>
    row("council", i, {
      created_at: `2026-10-${19 - i}T12:00:00Z`,
      document: {
        answer: "家".repeat(180000),
        attachments: [{ content: "Synthetic attachment" }],
      },
    }),
  );
  const result = await buildBackupBundle(scope, reader(data));
  expect(result.sections.council).toMatchObject({
    status: "partial",
    count: 1,
    truncated: true,
    continuation: { offset: 1 },
  });
  expect(result.sections.council.issues[0].code).toBe("byte_limit");
  expect(
    (result.sections.council.data[0] as { document: { answer: string } })
      .document.answer,
  ).toHaveLength(180000);
  expect(backupBytes("家")).toBe(5);
  expect(backupBytes(result)).toBeLessThan(BACKUP_MAX_BYTES);
});
it("过大的主文档明确未包含，不产生损坏的v3 JSON或零余额替代品", async () => {
  const data = records();
  data.household = [
    row("household", 0, {
      document: {
        ...emptyState(),
        messages: [{ text: "x".repeat(1_300_000) }],
      },
    }),
  ];
  const result = await buildBackupBundle(scope, reader(data));
  expect(result.sections.household).toMatchObject({
    status: "error",
    count: 0,
    truncated: true,
  });
  expect(result.sections.household.issues[0].code).toBe("byte_limit");
});
it("导出期间总数变化或重复页不会冒充事务一致性快照", async () => {
  for (const kind of ["count", "duplicate"]) {
    const read: BackupReader = async (s, offset) =>
      s.id === "cloudHistory"
        ? {
            data: [row("cloudHistory", kind === "duplicate" ? 0 : offset)],
            count: kind === "count" && offset ? 3 : 2,
          }
        : reader()(s, offset, s.pageSize);
    const result = await buildBackupBundle(scope, read);
    expect(result.sections.cloudHistory.status).toBe("partial");
    expect(result.sections.cloudHistory.issues[0].code).toBe(
      "changed_during_export",
    );
    expect(result.sections.cloudHistory.count).toBe(1);
  }
});
it("缺少主文档不是已备份空账本；取消/超时不产生额外读取", async () => {
  const missing = await buildBackupBundle(scope, reader({}));
  expect(missing.sections.household.issues[0].code).toBe("missing_document");
  const abort = new AbortController();
  abort.abort();
  const read = vi.fn<BackupReader>();
  const result = await buildBackupBundle(scope, read, { signal: abort.signal });
  expect(read).not.toHaveBeenCalled();
  expect(result.status).toBe("partial");
  expect(
    Object.values(result.sections).every(
      (s) => s.issues[0].code === "deadline",
    ),
  ).toBe(true);
});
it("行动只导出安全RPC可见字段，不夹带created_by或受限原始source_ref", async () => {
  const data = records();
  data.actions = [
    row("actions", 0, {
      visibility: "household",
      sourceRef: "",
      created_by: "PRIVATE_CREATOR",
      source_ref: "PRIVATE_RAW_REF",
      endpoint: "PRIVATE_ENDPOINT",
    }),
  ];
  const result = await buildBackupBundle(scope, reader(data));
  expect(result.sections.actions.status).toBe("complete");
  const text = JSON.stringify(result.sections.actions.data);
  expect(text).not.toContain("PRIVATE_CREATOR");
  expect(text).not.toContain("PRIVATE_RAW_REF");
  expect(text).not.toContain("PRIVATE_ENDPOINT");
  expect(text).toContain('"sourceRef":""');
});
it.each(["string", "too-many", "missing-column"])(
  "异常读取格式%s明确报错而非静默清空",
  async (kind) => {
    const read: BackupReader = async (s, offset, limit) =>
      s.id === "navigation"
        ? {
            data:
              kind === "string"
                ? "invalid"
                : kind === "too-many"
                  ? Array.from({ length: limit + 1 }, (_, i) =>
                      row("navigation", i),
                    )
                  : [{}],
            count: null,
          }
        : reader()(s, offset, limit);
    const result = await buildBackupBundle(scope, read);
    expect(result.sections.navigation.status).toBe("error");
    expect(result.sections.navigation.issues.length).toBeGreaterThan(0);
  },
);
