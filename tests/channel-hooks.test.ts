import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
const mocks = vi.hoisted(() => ({
  process: vi.fn(),
  telegram: vi.fn(),
  whatsapp: vi.fn(),
  after: vi.fn(),
}));
vi.mock("@/lib/channel-webhooks", () => ({
  processChannelEvent: mocks.process,
  telegramEvent: mocks.telegram,
  whatsappEvents: mocks.whatsapp,
}));
vi.mock("next/server", async (original) => ({
  ...(await original<object>()),
  after: mocks.after,
}));
import { POST as telegram } from "../app/api/notifications/telegram/route";
import {
  GET as handshake,
  POST as whatsapp,
} from "../app/api/notifications/whatsapp/route";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "fixture");
  vi.stubEnv("WHATSAPP_APP_SECRET", "fixture");
  vi.stubEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "verify");
  mocks.telegram.mockReturnValue({ id: "event" });
  mocks.whatsapp.mockReturnValue([{ id: "event" }]);
  mocks.process.mockResolvedValue(async () => {});
});
afterEach(() => vi.unstubAllEnvs());
it("伪造Telegram和WhatsApp回调在任何数据处理前被拒绝", async () => {
  expect(
    (
      await telegram(
        new Request("http://localhost", { method: "POST", body: "{}" }),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await whatsapp(
        new Request("http://localhost", { method: "POST", body: "{}" }),
      )
    ).status,
  ).toBe(401);
  expect(mocks.process).not.toHaveBeenCalled();
});
it("Telegram先保存接收事件再后台回复，数据库错误返回503以便平台重试", async () => {
  const request = () =>
    new Request("http://localhost", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": "fixture" },
      body: "{}",
    });
  expect((await telegram(request())).status).toBe(200);
  expect(mocks.process).toHaveBeenCalledOnce();
  expect(mocks.after).toHaveBeenCalledOnce();
  mocks.process.mockRejectedValueOnce(new Error("offline"));
  expect((await telegram(request())).status).toBe(503);
});
it("WhatsApp挑战只能由正确verify-token通过，POST必须匹配原始body HMAC", async () => {
  expect(
    (
      await handshake(
        new Request(
          "http://localhost?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123",
        ),
      )
    ).status,
  ).toBe(401);
  expect(
    await (
      await handshake(
        new Request(
          "http://localhost?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=123",
        ),
      )
    ).text(),
  ).toBe("123");
  const raw = "{}",
    signature =
      "sha256=" + createHmac("sha256", "fixture").update(raw).digest("hex");
  expect(
    (
      await whatsapp(
        new Request("http://localhost", {
          method: "POST",
          headers: { "X-Hub-Signature-256": signature },
          body: raw,
        }),
      )
    ).status,
  ).toBe(200);
});
