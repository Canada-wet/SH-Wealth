/** A bounded export of the caller's visible application records, never a DB dump. */
export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_MAX_BYTES = 3_800_000;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Row = Record<string, unknown>;
export type BackupSectionId =
  | "household"
  | "cloudHistory"
  | "navigation"
  | "learning"
  | "council"
  | "researchArchive"
  | "researchRuns"
  | "actions";
export type BackupScope = { userId: string; householdId: string };
export type BackupDefinition = {
  id: BackupSectionId;
  table: string;
  visibility: "household" | "personal" | "mixed-visible";
  columns: readonly string[];
  filter: "household" | "user" | "both" | "actions-rpc";
  order: readonly { column: string; ascending: boolean }[];
  maxRows: number;
  maxBytes: number;
  pageSize: number;
};
export const BACKUP_SECTIONS: readonly BackupDefinition[] = [
  {
    id: "household",
    table: "household_documents",
    visibility: "household",
    columns: ["household_id", "revision", "document", "updated_at"],
    filter: "household",
    order: [{ column: "household_id", ascending: true }],
    maxRows: 1,
    maxBytes: 1_200_000,
    pageSize: 1,
  },
  {
    id: "cloudHistory",
    table: "household_document_history",
    visibility: "household",
    columns: ["household_id", "revision", "document", "created_at"],
    filter: "household",
    order: [{ column: "revision", ascending: false }],
    maxRows: 30,
    maxBytes: 600_000,
    pageSize: 1,
  },
  {
    id: "navigation",
    table: "wealth_navigation_preferences",
    visibility: "personal",
    columns: ["user_id", "feature_id", "pinned", "last_used_at", "pinned_at"],
    filter: "user",
    order: [{ column: "feature_id", ascending: true }],
    maxRows: 100,
    maxBytes: 30_000,
    pageSize: 50,
  },
  {
    id: "learning",
    table: "wealth_learning_preferences",
    visibility: "personal",
    columns: [
      "household_id",
      "user_id",
      "version",
      "daily",
      "favorites",
      "updated_at",
    ],
    filter: "both",
    order: [{ column: "household_id", ascending: true }],
    maxRows: 1,
    maxBytes: 30_000,
    pageSize: 1,
  },
  {
    id: "council",
    table: "wealth_council_runs",
    visibility: "personal",
    columns: ["id", "user_id", "question", "status", "document", "created_at"],
    filter: "user",
    order: [
      { column: "created_at", ascending: false },
      { column: "id", ascending: false },
    ],
    maxRows: 30,
    maxBytes: 1_000_000,
    pageSize: 1,
  },
  {
    id: "researchArchive",
    table: "wealth_research_archive",
    visibility: "household",
    columns: [
      "id",
      "household_id",
      "source",
      "source_url",
      "captured_at",
      "prompt",
      "response",
      "citations",
      "status",
      "verification",
      "content_hash",
      "created_at",
    ],
    filter: "household",
    order: [
      { column: "captured_at", ascending: false },
      { column: "id", ascending: false },
    ],
    maxRows: 90,
    maxBytes: 500_000,
    pageSize: 5,
  },
  {
    id: "researchRuns",
    table: "wealth_research_runs",
    visibility: "household",
    columns: [
      "household_id",
      "day",
      "phase",
      "started_at",
      "source_url",
      "report_id",
    ],
    filter: "household",
    order: [
      { column: "day", ascending: false },
      { column: "phase", ascending: true },
    ],
    maxRows: 180,
    maxBytes: 80_000,
    pageSize: 50,
  },
  {
    id: "actions",
    table: "wealth_action_items",
    visibility: "mixed-visible",
    columns: [
      "id",
      "title",
      "note",
      "owner",
      "status",
      "due",
      "visibility",
      "sourceFeature",
      "sourceRef",
      "version",
      "createdAt",
      "updatedAt",
    ],
    filter: "actions-rpc",
    order: [],
    maxRows: 100,
    maxBytes: 120_000,
    pageSize: 100,
  },
];

export type BackupReadResult = {
  data: unknown;
  count: number | null;
  error?: unknown;
  /** An upstream RPC window may itself omit records; it must never look complete. */
  sourceTruncated?: boolean;
};
export type BackupReader = (
  definition: BackupDefinition,
  offset: number,
  limit: number,
  signal?: AbortSignal,
) => Promise<BackupReadResult>;
export type BackupSection = {
  table: string;
  visibility: BackupDefinition["visibility"];
  status: "complete" | "partial" | "error";
  data: Json[];
  count: number;
  totalAvailable: number | null;
  bytes: number;
  truncated: boolean;
  continuation: { offset: number; automatic: false } | null;
  redactedFields: number;
  issues: { code: string; message: string }[];
  limits: { maxRows: number; maxBytes: number; pageSize: number };
};
export const backupBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

// Protect operational credentials if a JSON document contains internal fields.
// User-entered prose remains sensitive prose; this is NOT a general DLP scanner.
const SECRET_FIELDS = new Set([
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "apikey",
  "servicerolekey",
  "supabasejwtsecret",
  "supabasesecretkey",
  "password",
  "secret",
  "claim",
  "claimtoken",
  "token",
  "webhooksecret",
  "webhooktoken",
  "destinationcipher",
  "destinationhash",
  "subscription",
  "endpoint",
  "session",
  "auth",
]);
function safeJson(
  value: unknown,
  counter: { value: number },
  depth = 0,
  seen = new Set<object>(),
): Json {
  if (depth > 80) throw Error("invalid_record");
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || seen.has(value))
    throw Error("invalid_record");
  seen.add(value);
  let clean: Json;
  if (Array.isArray(value))
    clean = value.map((v) => safeJson(v, counter, depth + 1, seen));
  else {
    const entries: [string, Json][] = [];
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_FIELDS.has(key.toLowerCase().replace(/[-_]/g, ""))) {
        counter.value++;
        continue;
      }
      entries.push([key, safeJson(item, counter, depth + 1, seen)]);
    }
    clean = Object.fromEntries(entries);
  }
  seen.delete(value);
  return clean;
}
function scopedRow(raw: unknown, spec: BackupDefinition, scope: BackupScope) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("invalid_record");
  const row = raw as Row;
  if (
    (["household", "both"].includes(spec.filter) &&
      row.household_id !== scope.householdId) ||
    (["user", "both"].includes(spec.filter) && row.user_id !== scope.userId)
  )
    throw Error("scope_mismatch");
  if (spec.columns.some((column) => !(column in row)))
    throw Error("invalid_record");
  if (
    spec.filter === "actions-rpc" &&
    !["private", "household"].includes(String(row.visibility))
  )
    throw Error("invalid_record");
  return Object.fromEntries(
    spec.columns.map((column) => [column, row[column]]),
  );
}
function rowIdentity(row: Row, spec: BackupDefinition) {
  return spec.id === "actions"
    ? String(row.id)
    : JSON.stringify(spec.order.map((order) => row[order.column]));
}
async function exportSection(
  spec: BackupDefinition,
  scope: BackupScope,
  read: BackupReader,
  signal?: AbortSignal,
): Promise<BackupSection> {
  const section: BackupSection = {
    table: spec.table,
    visibility: spec.visibility,
    status: "complete",
    data: [],
    count: 0,
    totalAvailable: null,
    bytes: 2,
    truncated: false,
    continuation: null,
    redactedFields: 0,
    issues: [],
    limits: {
      maxRows: spec.maxRows,
      maxBytes: spec.maxBytes,
      pageSize: spec.pageSize,
    },
  };
  let offset = 0;
  const seen = new Set<string>();
  const issue = (code: string, message: string, truncated = false) => {
    section.issues.push({ code, message });
    section.status = section.data.length ? "partial" : "error";
    section.truncated ||= truncated;
    section.continuation = { offset, automatic: false };
  };
  try {
    for (;;) {
      if (signal?.aborted) throw Error("deadline");
      const limit = Math.min(spec.pageSize, spec.maxRows - offset);
      if (limit <= 0) {
        if (section.totalAvailable === offset) break;
        if (section.totalAvailable === null) {
          const probe = await read(spec, offset, 1, signal);
          if (probe.error || !Array.isArray(probe.data))
            throw Error("read_failed");
          if (!probe.data.length && !probe.sourceTruncated) break;
        }
        issue("row_limit", "已达到记录数上限；其他可见记录未包含。", true);
        break;
      }
      const result = await read(spec, offset, limit, signal);
      if (result.error) throw Error("read_failed");
      if (!Array.isArray(result.data) || result.data.length > limit)
        throw Error("invalid_response");
      if (result.count !== null) {
        if (!Number.isSafeInteger(result.count) || result.count < 0)
          throw Error("invalid_response");
        if (result.count < offset + result.data.length)
          throw Error("invalid_response");
        if (
          section.totalAvailable !== null &&
          section.totalAvailable !== result.count
        ) {
          issue(
            "changed_during_export",
            "导出期间记录数量变化；不是事务一致性快照。",
            true,
          );
          break;
        }
        section.totalAvailable = result.count;
      }
      if (result.sourceTruncated)
        issue(
          "upstream_window",
          "安全读取接口有固定窗口，无法确认窗口外记录完整性。",
          true,
        );
      if (!result.data.length) {
        if (section.totalAvailable !== null && section.totalAvailable > offset)
          issue(
            "incomplete_page",
            "读取未返回所有已报告记录，未假称完整。",
            true,
          );
        break;
      }
      let stopped = false;
      for (const raw of result.data) {
        const row = scopedRow(raw, spec, scope);
        const identity = rowIdentity(row, spec);
        if (seen.has(identity)) throw Error("changed_during_export");
        const redacted = { value: 0 };
        const safe = safeJson(row, redacted);
        const bytes = backupBytes(safe) + (section.data.length ? 1 : 0);
        if (section.bytes + bytes > spec.maxBytes) {
          issue(
            "byte_limit",
            "当前或下一条记录超过剩余字节预算；未切割记录或附件。",
            true,
          );
          stopped = true;
          break;
        }
        seen.add(identity);
        section.data.push(safe);
        section.bytes += bytes;
        section.redactedFields += redacted.value;
        offset++;
      }
      if (stopped) break;
      if (section.totalAvailable !== null && offset >= section.totalAvailable)
        break;
      if (result.data.length < limit && section.totalAvailable === null) break;
    }
    if (
      spec.id === "household" &&
      !section.data.length &&
      !section.issues.length
    )
      issue("missing_document", "此家庭没有可导出的主文档；不能据此恢复账本。");
  } catch (error) {
    const code = error instanceof Error ? error.message : "read_failed";
    issue(
      [
        "scope_mismatch",
        "invalid_record",
        "invalid_response",
        "changed_during_export",
        "deadline",
      ].includes(code)
        ? code
        : "read_failed",
      "此部分未能完整安全读取；请保留已有备份并另行核验，不包含服务端错误原文。",
    );
  }
  section.count = section.data.length;
  if (section.issues.length && section.data.length) section.status = "partial";
  return section;
}

export async function buildBackupBundle(
  scope: BackupScope,
  read: BackupReader,
  options: { signal?: AbortSignal; now?: () => Date } = {},
) {
  const now = options.now ?? (() => new Date());
  const readStartedAt = now().toISOString();
  const entries = await Promise.all(
    BACKUP_SECTIONS.map(
      async (spec) =>
        [
          spec.id,
          await exportSection(spec, scope, read, options.signal),
        ] as const,
    ),
  );
  const sections = Object.fromEntries(entries) as Record<
    BackupSectionId,
    BackupSection
  >;
  const bundle = {
    kind: "together-user-visible-export" as const,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: now().toISOString(),
    readStartedAt,
    status: entries.some(([, section]) => section.status !== "complete")
      ? ("partial" as const)
      : ("complete" as const),
    scope: {
      ...scope,
      kind: "current-user-visible-records" as const,
      notDatabaseBackup: true,
      consistency: "best-effort-non-transactional" as const,
      householdSections: [
        "household",
        "cloudHistory",
        "researchArchive",
        "researchRuns",
      ],
      personalSections: ["navigation", "learning", "council"],
      mixedSections: ["actions"],
    },
    sections,
    counts: Object.fromEntries(
      entries.map(([id, s]) => [
        id,
        { exported: s.count, availableAtRead: s.totalAvailable },
      ]),
    ),
    limits: {
      maxBundleBytes: BACKUP_MAX_BYTES,
      pagination: "bounded-offset",
      recordsAreNotSplit: true,
    },
    excluded: [
      "auth.users、登录会话、密码、API密钥、部署环境、数据库角色与权限",
      "通知渠道、收件地址/密文/哈希、连接码、webhook、Push订阅与端点",
      "模型/语音/通知配额、执行claim和Funda运行token；不能据此恢复正在执行的任务",
      "伴侣的个人研讨、学习收藏与导航；本机未同步数据、草稿、原始音频和原附件",
      "学习投递记录、渠道投递记录、公开市场日报、旧版规范化表、平台级备份和数据库迁移历史",
    ],
    restorePlan: {
      automaticRestore: false,
      reviewRequired: true,
      drillDestination: "isolated-project-only",
      householdDocumentPath: "sections.household.data[0].document",
      existingImportAcceptsBundle: false,
      steps: [
        "先检查各 section 的 status、issues、counts 和截断；complete 仅指本包选定可见数据。",
        "保护好此明文文件；共享家庭记录和个人记录不要混用身份或公开上传。",
        "已有财富 JSON 导入只接受核验过的 WealthState v3 主文档，不直接导入本 bundle。",
        "跨表恢复仅在隔离项目人工核验字段、身份映射、外键和权限；本轮没有通用恢复接口。",
        "不恢复 claim/token、发送队列或自动继续付费任务；渠道必须重新绑定。",
      ],
    },
  };
  if (backupBytes(bundle) > BACKUP_MAX_BYTES) throw Error("backup_capacity");
  return bundle;
}
export type BackupBundle = Awaited<ReturnType<typeof buildBackupBundle>>;
