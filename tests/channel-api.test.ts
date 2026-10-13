import { beforeEach, it, expect, vi, afterEach } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rpc: vi.fn(),
  adminFrom: vi.fn(),
  from: vi.fn(),
  ready: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/server-auth", () => ({ authorizeRequest: mocks.auth }));
vi.mock("@/lib/channel-server", () => ({
  channelAdmin: () => ({ from: mocks.adminFrom }),
}));
vi.mock("@/lib/channels", async (original) => ({
  ...(await original<object>()),
  channelReadiness: mocks.ready,
  sendChannelNotice: mocks.send,
}));
import { GET, POST } from "../app/api/notifications/channels/route";
import { encryptRecipient } from "../lib/channels";
const home = "10000000-0000-0000-0000-000000000001";
const request = (value: unknown) =>
  new Request("http://localhost/api/notifications/channels", {
    method: "POST",
    body: JSON.stringify(value),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv(
    "NOTIFICATION_ENCRYPTION_KEY",
    Buffer.alloc(32, 1).toString("base64"),
  );
  mocks.auth.mockResolvedValue({
    status: 200,
    user: { id: "owner", email: "henrywhy233@gmail.com" },
    client: { rpc: mocks.rpc, from: mocks.from },
  });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.ready.mockReturnValue({ ready: true });
  mocks.send.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
it("匿名、非家庭成员与缺少订阅同意都不能写渠道", async () => {
  mocks.auth.mockResolvedValueOnce({ status: 401, error: "denied" });
  expect((await POST(request({}))).status).toBe(401);
  mocks.rpc.mockResolvedValueOnce({ data: false });
  expect(
    (
      await POST(
        request({
          householdId: home,
          channel: "email",
          action: "connect",
          consent: true,
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await POST(
        request({ householdId: home, channel: "email", action: "connect" }),
      )
    ).status,
  ).toBe(400);
  expect(mocks.adminFrom).not.toHaveBeenCalled();
});
it("Email只能绑定经过验证的登录邮箱，忽略伪造user与recipient字段", async () => {
  let row: Record<string, unknown> = {};
  mocks.adminFrom.mockReturnValue({
    upsert: async (value: Record<string, unknown>) => {
      row = value;
      return { error: null };
    },
  });
  expect(
    (
      await POST(
        request({
          householdId: home,
          channel: "email",
          action: "connect",
          consent: true,
          recipient: "attacker@example.test",
          user_id: "attacker",
        }),
      )
    ).status,
  ).toBe(200);
  expect(row.user_id).toBe("owner");
  expect(row.destination_label).toBe("h•••@gmail.com");
  expect(JSON.stringify(row)).not.toContain("attacker");
  expect(row.advisor_enabled).toBe(false);
});
it("平台未配置或数据库限流失败时不调用服务，不声称连接成功", async () => {
  mocks.ready.mockReturnValueOnce({ ready: false, reason: "not configured" });
  expect(
    (
      await POST(
        request({
          householdId: home,
          channel: "telegram",
          action: "connect",
          consent: true,
        }),
      )
    ).status,
  ).toBe(503);
  mocks.rpc
    .mockResolvedValueOnce({ data: true })
    .mockResolvedValueOnce({ data: false });
  expect(
    (
      await POST(
        request({
          householdId: home,
          channel: "email",
          action: "connect",
          consent: true,
        }),
      )
    ).status,
  ).toBe(429);
  expect(mocks.adminFrom).not.toHaveBeenCalled();
});
it("GET只返回自己的遮蔽状态，不发送密文或凭证", async () => {
  const query = {
    select: vi.fn((_columns: string) => query),
    eq: vi.fn(() => query),
    then: (resolve: (value: unknown) => void) =>
      resolve({
        data: [{ id: "fixture", destination_label: "masked" }],
        error: null,
      }),
  };
  mocks.from.mockReturnValue(query);
  const result = await GET(new Request(`http://localhost?householdId=${home}`));
  expect(result.status).toBe(200);
  expect(query.eq).toHaveBeenCalledWith("user_id", "owner");
  expect(query.select.mock.calls[0][0]).not.toContain("cipher");
});
it("测试只发给已绑定收件人，平台接受不声称设备已收到", async () => {
  const update = { eq: async () => ({ error: null }) };
  mocks.adminFrom.mockReturnValue({
    select: () => ({
      match: () => ({
        single: async () => ({
          data: {
            id: "fixture",
            enabled: true,
            destination_cipher: encryptRecipient("recipient@example.test"),
          },
          error: null,
        }),
      }),
    }),
    update: () => update,
  });
  const result = await POST(
    request({
      householdId: home,
      channel: "email",
      action: "test",
      recipient: "attacker@example.test",
    }),
  );
  expect(result.status).toBe(200);
  expect(mocks.send.mock.calls[0][1]).toBe("recipient@example.test");
  expect((await result.json()).message).toContain("请到邮箱或聊天平台确认");
});
it("WhatsApp平台内对话默认关闭，不能靠用户提交字段绕过", async () => {
  vi.stubEnv("WHATSAPP_ALLOW_ADVISOR", "0");
  expect(
    (
      await POST(
        request({
          householdId: home,
          channel: "whatsapp",
          action: "connect",
          consent: true,
          advisor: true,
        }),
      )
    ).status,
  ).toBe(400);
  expect(mocks.adminFrom).not.toHaveBeenCalled();
});
