import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emptyState } from "../lib/wealth";
import { completeQuarter, updateQuarter } from "../lib/quarterly-review";
const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), admin: vi.fn() }));
vi.mock("../lib/channel-server", () => ({
  dispatchChannelNotices: mocks.dispatch,
  channelAdmin: mocks.admin,
}));
import {
  quarterAlertId,
  remindQuarterlyReviews,
} from "../lib/quarterly-server";
import { GET } from "../app/api/review/reminders/route";
const now = new Date("2026-10-16T12:00:00Z");
function database() {
  const state = emptyState();
  state.assets = [
    {
      id: "a",
      name: "合成账户",
      value: 123456,
      annualReturn: null,
      category: "现金",
      owner: "first",
    },
  ];
  const alerts = new Set<string>();
  const from = vi.fn((table: string) => {
    if (table === "household_documents")
      return {
        select: async () => ({
          data: [{ household_id: "synthetic", document: state }],
          error: null,
        }),
      };
    if (table !== "advisor_alerts")
      throw new Error(
        "Quarterly reminder must not mutate wealth or unrelated tables",
      );
    return {
      upsert: (row: { id: string; body: string }) => ({
        select: async () => {
          expect(row.body).not.toContain("123456");
          const existed = alerts.has(row.id);
          alerts.add(row.id);
          return { data: existed ? [] : [{ id: row.id }], error: null };
        },
      }),
    };
  });
  return { state, from, admin: { from } as unknown as SupabaseClient };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.dispatch.mockResolvedValue({ accepted: 0, failures: 0 });
});
afterEach(() => vi.unstubAllEnvs());
it("季度提醒按家庭/季度幂等，默认只生成站内提醒、不调用模型、不外发", async () => {
  const db = database();
  expect(await remindQuarterlyReviews(db.admin, now)).toEqual({
    created: 1,
    channelAccepted: 0,
    failures: 0,
  });
  expect(await remindQuarterlyReviews(db.admin, now)).toMatchObject({
    created: 0,
  });
  expect(mocks.dispatch).not.toHaveBeenCalled();
  expect(quarterAlertId("a", "2026-Q3")).not.toBe(
    quarterAlertId("b", "2026-Q3"),
  );
  expect(quarterAlertId("a", "2026-Q3")).not.toBe(
    quarterAlertId("a", "2026-Q4"),
  );
});
it("启用外部提醒才交给已有原子渠道发件箱；不会跳过渠道本人授权", async () => {
  const db = database();
  db.state.preferences.quarterlyReviews = {
    reminders: true,
    external: true,
    records: {},
  };
  await remindQuarterlyReviews(db.admin, now);
  expect(mocks.dispatch).toHaveBeenCalledWith(
    db.admin,
    "synthetic",
    quarterAlertId("synthetic", "2026-Q3"),
    "2026-Q3",
  );
});
it("关闭、延后或完成后不会再提醒", async () => {
  const db = database();
  db.state.preferences.proactive = false;
  expect((await remindQuarterlyReviews(db.admin, now)).created).toBe(0);
  db.state.preferences.proactive = true;
  Object.assign(
    db.state,
    updateQuarter(db.state, "2026-Q3", (r) => ({
      ...r,
      snoozeUntil: "2026-10-23",
    })),
  );
  expect((await remindQuarterlyReviews(db.admin, now)).created).toBe(0);
  Object.assign(
    db.state,
    updateQuarter(db.state, "2026-Q3", () => ({
      notes: "测试",
      checks: { balances: true, cashflow: true, risk: true, goals: true },
      actions: [
        {
          id: "a",
          title: "测试",
          owner: "joint",
          due: "2026-11-01",
          done: false,
        },
      ],
    })),
  );
  Object.assign(db.state, completeQuarter(db.state, "2026-Q3", now));
  expect((await remindQuarterlyReviews(db.admin, now)).created).toBe(0);
});
it("Cron无密钥返回503、未授权401，不触碰数据库", async () => {
  vi.stubEnv("CRON_SECRET", "");
  expect(
    (await GET(new Request("http://localhost/api/review/reminders"))).status,
  ).toBe(503);
  vi.stubEnv("CRON_SECRET", "test-secret");
  expect(
    (await GET(new Request("http://localhost/api/review/reminders"))).status,
  ).toBe(401);
  expect(mocks.admin).not.toHaveBeenCalled();
});
