import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { emptyState, saveAsset } from "../lib/wealth";
const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  send: vi.fn(),
  ready: vi.fn(() => true),
  review: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: mocks.from,
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user: {
            id: "u",
            email: "henrywhy233@gmail.com",
            email_confirmed_at: "2026-01-01",
          },
        },
      })),
    },
  }),
}));
vi.mock("@/lib/push", () => ({ pushReady: mocks.ready, sendPush: mocks.send }));
vi.mock("@/lib/channel-server", () => ({
  dispatchChannelNotices: vi.fn(async () => ({ accepted: 0, failures: 0 })),
}));
vi.mock("@/lib/ai/review", async (original) => ({
  ...(await original<object>()),
  weeklyReview: mocks.review,
}));
import { GET } from "../app/api/advisor/digest/route";
import { POST } from "../app/api/notifications/subscribe/route";
beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test");
  mocks.send.mockResolvedValue({});
  mocks.review.mockResolvedValue("AI 合成复盘");
  mocks.review.mockClear();
});
afterEach(() => vi.unstubAllEnvs());
describe("主动提醒与Web Push", () => {
  it("Cron未配置或无授权不会执行数据库操作", async () => {
    expect(
      (await GET(new Request("http://localhost/api/advisor/digest"))).status,
    ).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect(
      (await GET(new Request("http://localhost/api/advisor/digest"))).status,
    ).toBe(503);
  });
  it("订阅需要登录且拒绝不完整数据", async () => {
    expect(
      (
        await POST(
          new Request("http://localhost/api/notifications/subscribe", {
            method: "POST",
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await POST(
          new Request("http://localhost/api/notifications/subscribe", {
            method: "POST",
            headers: { authorization: "Bearer test" },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("周报从统一数据扣除负债，按订阅去重，已发送不重复投递", async () => {
    const state = saveAsset(emptyState(), {
      id: "a",
      name: "账户",
      category: "现金",
      owner: "joint",
      value: 1000,
      annualReturn: null,
    });
    state.debts = [{ id: "d", name: "贷款", owner: "joint", value: 100 }];
    let lastAlert: string | null = null;
    let inserted = false;
    mocks.from.mockImplementation((table) => {
      if (table === "household_documents")
        return {
          select: async () => ({
            data: [{ household_id: "h", document: state }],
            error: null,
          }),
        };
      if (table === "advisor_alerts")
        return {
          update: () => ({ eq: async () => ({ error: null }) }),
          upsert: (row: { id: string; body: string }) => {
            expect(row.body).toContain("$900.00");
            return {
              select: async () => {
                const data = inserted ? [] : [{ id: row.id }];
                inserted = true;
                return { data, error: null };
              },
            };
          },
        };
      if (table === "wealth_push_subscriptions")
        return {
          select: () => ({
            eq: async () => ({
              data: [
                {
                  endpoint: "fixture",
                  user_id: "u",
                  subscription: {},
                  last_alert_id: lastAlert,
                },
              ],
              error: null,
            }),
          }),
          update: (row: { last_alert_id: string }) => ({
            eq: () => ({
              eq: async () => {
                lastAlert = row.last_alert_id;
                return { error: null };
              },
            }),
          }),
        };
      throw new Error("unknown table");
    });
    const req = () =>
      new Request("http://localhost/api/advisor/digest", {
        headers: { authorization: "Bearer test-secret" },
      });
    expect(await (await GET(req())).json()).toMatchObject({
      processed: 1,
      pushed: 1,
      failures: 0,
    });
    expect(await (await GET(req())).json()).toMatchObject({
      processed: 0,
      pushed: 0,
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.review).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls.at(-1)?.[1].body).not.toContain("900");
  });
  it("关闭主动复盘后定时任务不生成或推送", async () => {
    const state = emptyState();
    state.preferences.proactive = false;
    mocks.from.mockImplementation((table) => {
      if (table !== "household_documents") throw new Error("Unexpected write");
      return {
        select: async () => ({
          data: [{ household_id: "fixture", document: state }],
          error: null,
        }),
      };
    });
    const response = await GET(
      new Request("http://localhost/api/advisor/digest", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    expect(await response.json()).toMatchObject({ processed: 0, pushed: 0 });
    expect(mocks.review).not.toHaveBeenCalled();
  });
});
