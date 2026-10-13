import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  channelReadiness,
  channelHash,
  encryptRecipient,
  decryptRecipient,
  newChannelLink,
  recipientHash,
  recipientLabel,
  sendChannelNotice,
  sendConversationReply,
  ensureTelegramWebhook,
  validWhatsAppSignature,
} from "../lib/channels";
const router = vi.hoisted(() => ({ choose: vi.fn(), generate: vi.fn() }));
vi.mock("../lib/ai/router", () => ({
  chooseRoute: router.choose,
  generateAdvice: router.generate,
}));
import { telegramEvent, whatsappEvents } from "../lib/channel-webhooks";
import { channelAdvice, prepareChannelQuestion } from "../lib/channel-advisor";
import { emptyState, saveAsset } from "../lib/wealth";
const fetchMock = vi.fn();
const smtp = vi.hoisted(() => ({
  create: vi.fn(),
  send: vi.fn(),
  close: vi.fn(),
}));
vi.mock("nodemailer", () => ({ default: { createTransport: smtp.create } }));
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.clearAllMocks();
  smtp.create.mockReturnValue({ sendMail: smtp.send, close: smtp.close });
  smtp.send.mockResolvedValue({ accepted: ["member@example.test"] });
  for (const [key, value] of Object.entries({
    NOTIFICATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    RESEND_API_KEY: "fixture",
    EMAIL_FROM: "test@example.test",
    TELEGRAM_BOT_TOKEN: "fixture",
    TELEGRAM_BOT_USERNAME: "fixture_bot",
    TELEGRAM_WEBHOOK_SECRET: "fixture_secret",
    WHATSAPP_ACCESS_TOKEN: "fixture",
    WHATSAPP_PHONE_NUMBER_ID: "123",
    WHATSAPP_BUSINESS_NUMBER: "15550000000",
    WHATSAPP_APP_SECRET: "fixture-secret",
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: "fixture",
    WHATSAPP_GRAPH_VERSION: "v99.0",
    WHATSAPP_TEMPLATE_NAME: "fixture_notice",
    WHATSAPP_TEMPLATE_LANGUAGE: "en_US",
    APP_URL: "https://example.test",
  }))
    vi.stubEnv(key, value);
  router.choose.mockReturnValue({ provider: "local" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("私密消息渠道", () => {
  it("绑定渠道的消息先保存，再读取本渠道上下文；重复回调不重复生成回复", async () => {
    const state = saveAsset(emptyState(), {
      id: "a",
      name: "现金",
      owner: "joint",
      category: "现金",
      value: 500,
      annualReturn: null,
    });
    state.messages = [
      { id: "private-other", role: "user", text: "OTHER THREAD SENTINEL" },
    ];
    state.chatArchives = [
      {
        id: "channel-fixture",
        title: "Telegram",
        messages: [{ id: "q", role: "user", text: "目前净资产多少" }],
      },
    ];
    router.choose.mockReturnValue({ provider: "openai", model: "fixture" });
    router.generate.mockResolvedValue('{"answer":"当前为500。","actions":[]}');
    fetchMock.mockResolvedValue(new Response('{"ok":true}'));
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: state })
      .mockResolvedValueOnce({ data: true })
      .mockResolvedValueOnce({ data: state })
      .mockResolvedValueOnce({ data: null });
    const query = {
      eq: () => query,
      maybeSingle: async () => ({
        data: { id: "fixture", user_id: "u", household_id: "home" },
      }),
    };
    const admin = {
      from: () => ({ select: () => query }),
      rpc,
    } as unknown as Parameters<typeof prepareChannelQuestion>[0];
    const job = await prepareChannelQuestion(
      admin,
      "telegram",
      "123",
      "1",
      "目前净资产多少",
    );
    expect(job).toBeTypeOf("function");
    expect(router.generate).not.toHaveBeenCalled();
    await job!();
    expect(router.generate.mock.calls[0][2]).not.toContain(
      "OTHER THREAD SENTINEL",
    );
    expect(rpc.mock.calls[2][1].message_role).toBe("assistant");
    expect(
      await prepareChannelQuestion(
        admin,
        "telegram",
        "123",
        "1",
        "目前净资产多少",
      ),
    ).toBeUndefined();
    expect(router.generate).toHaveBeenCalledOnce();
  });
  it("SMTP替代Resend时强制TLS，只使用服务器凭证且关闭日志和外部内容加载", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("SMTP_HOST", "smtp.example.test");
    vi.stubEnv("SMTP_PORT", "587");
    vi.stubEnv("SMTP_USER", "sender@example.test");
    vi.stubEnv("SMTP_PASSWORD", "fixture-app-password");
    expect(channelReadiness("email").ready).toBe(true);
    await sendChannelNotice("email", "member@example.test", "fixture");
    expect(smtp.create.mock.calls[0][0]).toMatchObject({
      secure: false,
      requireTLS: true,
      debug: false,
      logger: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    expect(smtp.send.mock.calls[0][0]).toMatchObject({
      to: "member@example.test",
    });
    expect(smtp.close).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("Telegram注册先校验Bot身份，保留已有其他应用回调和待处理消息", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          '{"ok":true,"result":{"is_bot":true,"username":"fixture_bot"}}',
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '{"ok":true,"result":{"url":"https://other.example.test/hook"}}',
        ),
      );
    await expect(ensureTelegramWebhook()).rejects.toThrow("其他应用");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          '{"ok":true,"result":{"is_bot":true,"username":"fixture_bot"}}',
        ),
      )
      .mockResolvedValueOnce(new Response('{"ok":true,"result":{"url":""}}'))
      .mockResolvedValueOnce(new Response('{"ok":true,"result":true}'));
    await ensureTelegramWebhook();
    const payload = JSON.parse(fetchMock.mock.calls.at(-1)![1].body);
    expect(payload).toMatchObject({
      url: "https://example.test/api/notifications/telegram",
      secret_token: "fixture_secret",
      drop_pending_updates: false,
    });
  });
  it("收件人随机IV加密且可还原，篡改密文被拒绝", () => {
    const cipher = encryptRecipient("recipient@example.test");
    expect(cipher).not.toContain("recipient");
    expect(encryptRecipient("recipient@example.test")).not.toBe(cipher);
    expect(decryptRecipient(cipher)).toBe("recipient@example.test");
    expect(() => decryptRecipient(cipher.replace("v1:", "v2:"))).toThrow();
    const parts = cipher.split(":");
    parts[2] = Buffer.alloc(16).toString("base64url");
    expect(() => decryptRecipient(parts.join(":"))).toThrow();
  });
  it("渠道未配置不伪装就绪，缺少加密key失败关闭", () => {
    expect(channelReadiness("telegram").ready).toBe(true);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect(channelReadiness("telegram").ready).toBe(false);
    vi.stubEnv("NOTIFICATION_ENCRYPTION_KEY", "");
    expect(channelReadiness("email").ready).toBe(false);
    expect(() => encryptRecipient("123")).toThrow();
  });
  it("一次性链接短且可深链，数据库只需hash，收件人标签遮蔽", () => {
    const link = newChannelLink("telegram");
    expect(link.token).toHaveLength(32);
    expect(link.hash).toBe(channelHash(link.token));
    expect(link.url).toContain("https://t.me/fixture_bot?start=");
    expect(newChannelLink("whatsapp").url).toContain(
      "https://wa.me/15550000000?text=CONNECT",
    );
    expect(recipientLabel("email", "member@example.test")).toBe(
      "m•••@example.test",
    );
    expect(recipientHash("email", "123")).not.toBe(
      recipientHash("telegram", "123"),
    );
  });
  it("Email通知只发送中性提醒，不含财务数据，并使用幂等key", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"id":"fixture"}', { status: 200 }),
    );
    await sendChannelNotice("email", "member@example.test", "once");
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers["Idempotency-Key"]).toBe("once");
    expect(JSON.parse(init.body)).toMatchObject({
      to: ["member@example.test"],
    });
    expect(init.body).toContain("https://example.test/");
    expect(init.body).not.toContain("netWorth");
  });
  it("WhatsApp周报始终使用审核模板，不偷用24小时窗口自由文本", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"messages":[{"id":"fixture"}]}', { status: 200 }),
    );
    await sendChannelNotice("whatsapp", "15550000001", "once");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      type: "template",
      template: { name: "fixture_notice" },
    });
  });
  it("平台拒绝与网络结果不明确分开，不暴露返回的token或完整错误", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("sensitive-provider-error", { status: 403 }),
    );
    await expect(
      sendChannelNotice("telegram", "123", "x"),
    ).rejects.toMatchObject({ status: "failed" });
    fetchMock.mockRejectedValueOnce(new Error("sensitive-network-url"));
    await expect(
      sendChannelNotice("telegram", "123", "x"),
    ).rejects.toMatchObject({ status: "uncertain" });
  });
  it("外部聊天的Markdown转成可读文本，长回复有长度限制", async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    await sendConversationReply(
      "telegram",
      "123",
      "## 结论\n**500**\n" + "x".repeat(5000),
    );
    const text = JSON.parse(fetchMock.mock.calls[0][1].body).text;
    expect(text).not.toContain("**");
    expect(text).not.toContain("##");
    expect(text.length).toBeLessThan(4096);
    expect(text).toContain("完整回复已保存在 App");
  });
  it("Telegram仅接受与发送人一致的私人聊天，不绑定群组", () => {
    const event = {
      update_id: 1,
      message: {
        chat: { id: 123, type: "private" },
        from: { id: 123 },
        text: "hi",
      },
    };
    expect(telegramEvent(event)?.recipient).toBe("123");
    expect(
      telegramEvent({
        ...event,
        message: { ...event.message, chat: { id: -1, type: "group" } },
      }),
    ).toBeNull();
    expect(
      telegramEvent({
        ...event,
        message: { ...event.message, from: { id: 456 } },
      }),
    ).toBeNull();
  });
  it("WhatsApp只取已配置号码的文本事件并验证原始body签名", () => {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "123" },
                messages: [
                  {
                    id: "m1",
                    from: "15550000001",
                    type: "text",
                    text: { body: "hello" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const signature =
      "sha256=" +
      createHmac("sha256", "fixture-secret").update(raw).digest("hex");
    expect(validWhatsAppSignature(raw, signature)).toBe(true);
    expect(validWhatsAppSignature(raw + " ", signature)).toBe(false);
    expect(whatsappEvents(JSON.parse(raw))).toHaveLength(1);
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "other");
    expect(whatsappEvents(JSON.parse(raw))).toEqual([]);
  });
  it("外部只读顾问拒绝真实写请求，不调用模型；查询使用当前数据", async () => {
    const state = saveAsset(emptyState(), {
      id: "a",
      name: "现金",
      owner: "joint",
      category: "现金",
      value: 500,
      annualReturn: null,
    });
    expect(await channelAdvice("把现金余额改为1000", state)).toContain(
      "不会直接修改",
    );
    expect(router.choose).not.toHaveBeenCalled();
    expect(await channelAdvice("目前净资产多少", state)).toContain("$500.00");
    expect(state.assets[0].value).toBe(500);
  });
  it("模型输出actions一律忽略，快照与选定上下文只作为分析", async () => {
    router.choose.mockReturnValue({ provider: "openai", model: "fixture" });
    router.generate.mockResolvedValue(
      '{"answer":"这是只读分析。","actions":[{"type":"delete_asset","name":"现金"}]}',
    );
    const state = emptyState();
    const before = JSON.stringify(state);
    expect(await channelAdvice("解释净资产", state)).toContain("只读顾问");
    expect(JSON.stringify(state)).toBe(before);
  });
});
