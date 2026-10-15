import { it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  channel: vi.fn(),
  pushReady: vi.fn(() => true),
  ready: vi.fn(() => ({ ready: true })),
  decrypt: vi.fn(() => "synthetic-recipient"),
}));
vi.mock("../lib/push", () => ({
  sendPush: mocks.send,
  pushReady: mocks.pushReady,
}));
vi.mock("../lib/channels", async (original) => ({
  ...(await original<object>()),
  sendChannelNotice: mocks.channel,
  channelReadiness: mocks.ready,
  decryptRecipient: mocks.decrypt,
}));
import { deliverDailyLearning } from "../lib/learning-server";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue({});
  mocks.channel.mockResolvedValue({});
  mocks.pushReady.mockReturnValue(true);
  mocks.ready.mockReturnValue({ ready: true });
});
function db() {
  const claims = new Set<string>(),
    status: string[] = [];
  let subscribed = true,
    allowed = true,
    failClaim = false;
  const rpc = vi.fn(async (_name: string, row: unknown) => {
    const key = JSON.stringify(row);
    if (failClaim) return { error: { message: "offline" }, data: null };
    if (!subscribed || claims.has(key)) return { data: false };
    claims.add(key);
    return { data: true };
  });
  const admin = {
    auth: {
      admin: {
        getUserById: async () => ({
          data: {
            user: {
              email: allowed ? "henrywhy233@gmail.com" : "outsider@example.com",
              email_confirmed_at: "2026-01-01",
            },
          },
        }),
      },
    },
    rpc,
    from: (table: string) => {
      if (table === "wealth_learning_deliveries")
        return {
          update: ({ status: s }: { status: string }) => ({
            match: async () => {
              status.push(s);
              return { error: null };
            },
          }),
        };
      const data =
        table === "wealth_learning_preferences"
          ? [{ household_id: "h", user_id: "u" }]
          : table === "wealth_push_subscriptions"
            ? [
                {
                  endpoint: "https://push.invalid/synthetic",
                  subscription: { fixture: true },
                },
              ]
            : [
                {
                  id: "channel",
                  channel: "telegram",
                  destination_cipher: "encrypted-fixture",
                },
              ];
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data, error: null }).then(resolve),
      };
      return chain;
    },
  };
  return {
    admin: admin as unknown as SupabaseClient,
    rpc,
    status,
    unsubscribe: () => (subscribed = false),
    deny: () => (allowed = false),
    failClaim: () => (failClaim = true),
  };
}
const day = new Date("2026-10-15T16:00:00Z");
it("每天每收件通道先原子认领，重复执行不重复投递，不影响周报 last_alert", async () => {
  const d = db();
  expect(await deliverDailyLearning(d.admin, day)).toEqual({
    accepted: 2,
    skipped: 0,
    failures: 0,
  });
  expect(await deliverDailyLearning(d.admin, day)).toEqual({
    accepted: 0,
    skipped: 2,
    failures: 0,
  });
  expect(mocks.send).toHaveBeenCalledOnce();
  expect(mocks.channel).toHaveBeenCalledOnce();
  expect(mocks.send.mock.calls[0][1]).toMatchObject({
    url: "/learn?day=2026-10-15",
    tag: "together-learning",
  });
  expect(JSON.stringify(mocks.send.mock.calls)).not.toMatch(
    /household|资产金额|password/,
  );
  expect(mocks.channel.mock.calls[0].slice(-2)).toEqual([false, "2026-10-15"]);
});
it("关闭订阅发生在初次读取之后也不发；非白名单用户也不发", async () => {
  const d = db();
  d.unsubscribe();
  expect((await deliverDailyLearning(d.admin, day)).accepted).toBe(0);
  expect(mocks.send).not.toHaveBeenCalled();
  d.deny();
  expect((await deliverDailyLearning(d.admin, day)).failures).toBe(1);
});
it("平台超时结果不确定时不自动重发，数据库认领失败不发", async () => {
  const d = db();
  mocks.send.mockRejectedValueOnce(Error("timeout"));
  expect((await deliverDailyLearning(d.admin, day)).failures).toBe(1);
  expect(d.status).toContain("uncertain");
  await deliverDailyLearning(d.admin, day);
  expect(mocks.send).toHaveBeenCalledOnce();
  const failed = db();
  failed.failClaim();
  expect((await deliverDailyLearning(failed.admin, day)).accepted).toBe(0);
  expect(mocks.send).toHaveBeenCalledOnce();
});
it("缺推送配置仍可按已启用渠道投递；上线前不生成或发送", async () => {
  const d = db();
  mocks.pushReady.mockReturnValue(false);
  expect((await deliverDailyLearning(d.admin, day)).accepted).toBe(1);
  expect(mocks.send).not.toHaveBeenCalled();
  expect(
    (await deliverDailyLearning(d.admin, new Date("2026-10-14T16:00:00Z")))
      .accepted,
  ).toBe(0);
});
