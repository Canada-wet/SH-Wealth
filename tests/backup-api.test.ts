import { beforeEach, expect, it, vi } from "vitest";
import { emptyState } from "../lib/wealth";
import { BACKUP_SECTIONS } from "../lib/backup-bundle";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../lib/server-auth", () => ({ authorizeRequest: mocks.auth }));
import { GET, POST } from "../app/api/backup/route";
const home = "00000000-0000-4000-8000-000000000002";
const user = "00000000-0000-4000-8000-000000000001";
type Query = {
  table: string;
  columns: string;
  filters: [string, unknown][];
  order: string[];
  offset: number;
  end: number;
};
let rows: Record<string, Record<string, unknown>[]>,
  calls: Query[],
  failTables: Set<string>,
  actions: unknown[];
beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  failTables = new Set();
  actions = [];
  rows = {
    household_documents: [
      {
        household_id: home,
        revision: 3,
        document: emptyState(),
        updated_at: "2026-10-19T12:00:00Z",
      },
    ],
    wealth_navigation_preferences: [
      {
        user_id: user,
        feature_id: "space",
        pinned: true,
        last_used_at: null,
        pinned_at: "2026-10-19T12:00:00Z",
      },
      {
        user_id: "partner",
        feature_id: "council",
        pinned: true,
        last_used_at: null,
        pinned_at: null,
      },
    ],
  };
  mocks.rpc.mockImplementation((name: string) =>
    name === "is_wealth_member"
      ? Promise.resolve({ data: true, error: null })
      : { abortSignal: async () => ({ data: actions, error: null }) },
  );
  mocks.from.mockImplementation((table: string) => {
    const query: Query = {
      table,
      columns: "",
      filters: [],
      order: [],
      offset: 0,
      end: 0,
    };
    const builder = {
      select: vi.fn((columns: string) => {
        query.columns = columns;
        return builder;
      }),
      eq: vi.fn((column: string, value: unknown) => {
        query.filters.push([column, value]);
        return builder;
      }),
      order: vi.fn((column: string) => {
        query.order.push(column);
        return builder;
      }),
      range: vi.fn((offset: number, end: number) => {
        query.offset = offset;
        query.end = end;
        return builder;
      }),
      abortSignal: vi.fn(async () => {
        calls.push(query);
        if (failTables.has(table))
          return {
            data: null,
            count: null,
            error: { message: "SYNTHETIC_SECRET_DATABASE_DETAILS" },
          };
        const visible = (rows[table] ?? []).filter((row) =>
          query.filters.every(([column, value]) => row[column] === value),
        );
        return {
          data: visible.slice(query.offset, query.end + 1),
          count: visible.length,
          error: null,
        };
      }),
    };
    return builder;
  });
  mocks.auth.mockResolvedValue({
    status: 200,
    user: { id: user, email: "do-not-use-in-download-name@example.test" },
    client: { from: mocks.from, rpc: mocks.rpc },
  });
});
const post = (
  body: unknown = { householdId: home, confirm: true },
  origin: string | null = "https://app.test",
) =>
  POST(
    new Request("https://app.test/api/backup", {
      method: "POST",
      headers: {
        ...(origin ? { origin } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
it("只允许已认证白名单成员显式POST，下载名不含邮箱，响应不缓存", async () => {
  expect((await GET()).status).toBe(405);
  mocks.auth.mockResolvedValueOnce({ status: 401, error: "请先登录" });
  expect((await post()).status).toBe(401);
  mocks.auth.mockResolvedValueOnce({ status: 403, error: "没有权限" });
  expect((await post()).status).toBe(403);
  expect(mocks.from).not.toHaveBeenCalled();
  const result = await post();
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(result.headers.get("content-disposition")).toMatch(
    /^attachment; filename="together-visible-backup-[\dTZ]+\.json"$/,
  );
  expect(result.headers.get("content-disposition")).not.toContain("@");
  expect(result.headers.get("x-backup-status")).toBe("complete");
  const bundle = await result.json();
  expect(bundle.scope.userId).toBe(user);
  expect(bundle.sections.navigation.count).toBe(1);
});
it("拒绝跨源、无Origin、未确认、冒充userId、任意表与过大请求，读取之前拦截", async () => {
  expect((await post({}, "https://evil.test")).status).toBe(403);
  expect((await post({}, null)).status).toBe(403);
  for (const body of [
    null,
    [],
    {},
    { householdId: home },
    { householdId: home, confirm: false },
    { householdId: home, confirm: true, userId: "partner" },
    { householdId: home, confirm: true, table: "auth.users" },
    { householdId: "wrong", confirm: true },
    { householdId: home, confirm: true, padding: "x".repeat(2000) },
  ])
    expect((await post(body)).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.from).not.toHaveBeenCalled();
});
it("未加入目标家庭或成员核验失败不查询资料、不自动创建或加入家庭", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
  expect((await post()).status).toBe(403);
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "SYNTHETIC_SECRET" },
  });
  const response = await post();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("SYNTHETIC_SECRET");
  expect(mocks.from).not.toHaveBeenCalled();
  expect(
    mocks.rpc.mock.calls.every(([name]) => name === "is_wealth_member"),
  ).toBe(true);
});
it("查询全都使用固定列、本人/家庭过滤、稳定分页和安全行动RPC，绝不select星号或敏感表", async () => {
  const response = await post();
  expect(response.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("is_wealth_member", {
    target_household: home,
  });
  expect(mocks.rpc).toHaveBeenCalledWith("list_wealth_actions", {
    target_household: home,
  });
  expect(
    mocks.from.mock.calls.some(([table]) =>
      /auth|channel|push|invite|quota|request|action_items/.test(table),
    ),
  ).toBe(false);
  for (const query of calls) {
    const definition = BACKUP_SECTIONS.find((s) => s.table === query.table)!;
    expect(query.columns).toBe(definition.columns.join(","));
    expect(query.columns).not.toContain("*");
    expect(query.columns).not.toMatch(
      /token|destination|subscription|endpoint/,
    );
    if (["household", "both"].includes(definition.filter))
      expect(query.filters).toContainEqual(["household_id", home]);
    if (["user", "both"].includes(definition.filter))
      expect(query.filters).toContainEqual(["user_id", user]);
    expect(query.end - query.offset + 1).toBeLessThanOrEqual(
      definition.pageSize,
    );
    expect(query.order).toEqual(definition.order.map((o) => o.column));
  }
  const body = await response.text();
  expect(body).not.toContain('"user_id":"partner"');
  expect(
    mocks.rpc.mock.calls.every(([name]) =>
      ["is_wealth_member", "list_wealth_actions"].includes(name),
    ),
  ).toBe(true);
});
it("缺表/错误逐段显式partial，不丢失其他可见资料也不泄露底层错误", async () => {
  failTables.add("wealth_council_runs");
  const result = await post();
  expect(result.status).toBe(200);
  expect(result.headers.get("x-backup-status")).toBe("partial");
  const body = await result.json();
  expect(body.status).toBe("partial");
  expect(body.sections.council).toMatchObject({ status: "error", count: 0 });
  expect(body.sections.household.count).toBe(1);
  expect(JSON.stringify(body)).not.toContain(
    "SYNTHETIC_SECRET_DATABASE_DETAILS",
  );
});
it("行动使用RPC全部可见集合计数，但本包按100条有界导出并明确截断", async () => {
  actions = Array.from({ length: 101 }, (_, i) => ({
    id: `a-${i}`,
    title: "Synthetic action",
    note: "",
    owner: "joint",
    status: "planned",
    due: "",
    visibility: "household",
    sourceFeature: "space",
    sourceRef: "",
    version: 1,
    createdAt: "2026-10-19T12:00:00Z",
    updatedAt: "2026-10-19T12:00:00Z",
    created_by: "PRIVATE_CREATOR",
    source_ref: "PRIVATE_SOURCE_REF",
  }));
  const response = await post();
  const body = await response.json();
  expect(body.sections.actions).toMatchObject({
    status: "partial",
    count: 100,
    totalAvailable: 101,
    truncated: true,
  });
  expect(JSON.stringify(body)).not.toContain("PRIVATE_CREATOR");
  expect(JSON.stringify(body)).not.toContain("PRIVATE_SOURCE_REF");
  expect(
    mocks.rpc.mock.calls.filter(([name]) => name === "list_wealth_actions"),
  ).toHaveLength(1);
});
