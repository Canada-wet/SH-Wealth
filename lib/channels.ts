import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import nodemailer from "nodemailer";
export const CHANNELS = ["email", "telegram", "whatsapp"] as const;
export type Channel = (typeof CHANNELS)[number];
export class ChannelSendError extends Error {
  constructor(
    public status: "failed" | "uncertain",
    message: string,
  ) {
    super(message);
  }
}
function encryptionKey() {
  const value = process.env.NOTIFICATION_ENCRYPTION_KEY;
  const key = value ? Buffer.from(value, "base64") : null;
  if (!key || key.length !== 32) throw new Error("通知加密服务尚未配置。");
  return key;
}
export const channelHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const recipientHash = (channel: Channel, value: string) =>
  createHmac("sha256", encryptionKey())
    .update(`${channel}:${value}`)
    .digest("hex");
export function encryptRecipient(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}
export function decryptRecipient(value: string) {
  const [version, iv, tag, encrypted, extra] = value.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted || extra)
    throw new Error("通知收件人无法读取，请重新连接。");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
export function recipientLabel(channel: Channel, value: string) {
  if (channel === "email") {
    const [name, domain] = value.split("@");
    return `${name.slice(0, 1)}•••@${domain}`;
  }
  return `${channel === "telegram" ? "Telegram 私聊" : "WhatsApp"} · •••${value.slice(-4)}`;
}
export function channelReadiness(channel: Channel) {
  try {
    encryptionKey();
  } catch {
    return { ready: false, reason: "管理员需先配置通知加密服务。" };
  }
  if (channel === "email" && !process.env.RESEND_API_KEY) {
    if (
      !process.env.SMTP_HOST ||
      !["465", "587"].includes(process.env.SMTP_PORT || "") ||
      !process.env.SMTP_USER ||
      !process.env.SMTP_PASSWORD
    )
      return {
        ready: false,
        reason: "待配置 Resend，或 Gmail / 通用 SMTP 发信服务。",
      };
    return { ready: true, reason: "SMTP 已配置；启用后请测试确认收信。" };
  }
  const required =
    channel === "email"
      ? ["RESEND_API_KEY", "EMAIL_FROM"]
      : channel === "telegram"
        ? [
            "TELEGRAM_BOT_TOKEN",
            "TELEGRAM_BOT_USERNAME",
            "TELEGRAM_WEBHOOK_SECRET",
          ]
        : [
            "WHATSAPP_ACCESS_TOKEN",
            "WHATSAPP_PHONE_NUMBER_ID",
            "WHATSAPP_BUSINESS_NUMBER",
            "WHATSAPP_APP_SECRET",
            "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
            "WHATSAPP_GRAPH_VERSION",
            "WHATSAPP_TEMPLATE_NAME",
            "WHATSAPP_TEMPLATE_LANGUAGE",
          ];
  if (required.some((key) => !process.env[key]))
    return {
      ready: false,
      reason:
        channel === "email"
          ? "待配置 Resend 发信服务及已验证的发信域名。"
          : channel === "telegram"
            ? "待配置 Telegram Bot 与签名保护的回调。"
            : "待配置 WhatsApp Business 号码、回调和审核通过的周报模板。",
    };
  if (
    channel === "telegram" &&
    !/^[A-Za-z0-9_]{5,32}$/.test(process.env.TELEGRAM_BOT_USERNAME!)
  )
    return { ready: false, reason: "Telegram Bot 用户名配置无效。" };
  if (
    channel === "whatsapp" &&
    (!/^\d{7,15}$/.test(process.env.WHATSAPP_BUSINESS_NUMBER!) ||
      !/^v\d+\.\d+$/.test(process.env.WHATSAPP_GRAPH_VERSION!) ||
      !/^\d+$/.test(process.env.WHATSAPP_PHONE_NUMBER_ID!))
  )
    return { ready: false, reason: "WhatsApp 号码或 Graph API 版本配置无效。" };
  return { ready: true, reason: "服务器已配置；绑定后可测试通知。" };
}
export function newChannelLink(channel: Exclude<Channel, "email">) {
  const token = randomBytes(24).toString("base64url");
  const url =
    channel === "telegram"
      ? `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${token}`
      : `https://wa.me/${process.env.WHATSAPP_BUSINESS_NUMBER}?text=${encodeURIComponent(`CONNECT ${token}`)}`;
  return {
    token,
    hash: channelHash(token),
    url,
    expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
  };
}
export function safeEqual(actual: string, expected: string) {
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function validWhatsAppSignature(raw: string, signature: string | null) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  return (
    !!secret &&
    !!signature &&
    safeEqual(
      signature,
      "sha256=" + createHmac("sha256", secret).update(raw).digest("hex"),
    )
  );
}
export function appLink() {
  const value = process.env.APP_URL || "https://sh-wealth.vercel.app";
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("通知回跳地址需要 HTTPS。");
  return new URL("/", url.origin).toString();
}
async function providerPost(
  url: string,
  headers: Record<string, string>,
  payload: unknown,
) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new ChannelSendError(
      "uncertain",
      "发送结果无法确认，请勿反复发送；可到对应平台检查。",
    );
  }
  if (!response.ok)
    throw new ChannelSendError(
      "failed",
      "平台拒绝本次通知，请检查服务配置、订阅状态或模板权限。",
    );
  try {
    return await response.json();
  } catch {
    throw new ChannelSendError(
      "uncertain",
      "平台返回异常，无法确认通知是否接受。",
    );
  }
}
export async function sendChannelNotice(
  channel: Channel,
  recipient: string,
  key: string,
  test = false,
) {
  if (!channelReadiness(channel).ready)
    throw new ChannelSendError("failed", channelReadiness(channel).reason);
  const link = appLink();
  const text = `${test ? "Together 测试通知" : "本周家庭财富复盘已准备好"}。请登录私密家庭空间查看详情：${link}\n本消息不包含资产金额。`;
  if (channel === "email") {
    if (!process.env.RESEND_API_KEY) {
      const port = Number(process.env.SMTP_PORT);
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        requireTLS: port === 587,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
        disableFileAccess: true,
        disableUrlAccess: true,
        logger: false,
        debug: false,
      });
      try {
        const info = await transport.sendMail({
          from: process.env.EMAIL_FROM || process.env.SMTP_USER,
          to: recipient,
          subject: test
            ? "Together · 通知连接测试"
            : "Together · 本周家庭财富复盘",
          text,
          messageId: `<${channelHash(key)}@${new URL(link).hostname}>`,
        });
        if (!info.accepted?.length)
          throw new ChannelSendError(
            "failed",
            "邮件服务器未接受收件人，请检查邮箱配置。",
          );
      } catch (reason) {
        if (reason instanceof ChannelSendError) throw reason;
        const code = (reason as { code?: string }).code;
        throw new ChannelSendError(
          ["EAUTH", "EENVELOPE", "EMESSAGE", "ETLS"].includes(code || "")
            ? "failed"
            : "uncertain",
          "SMTP 发送未完成；请检查应用专用密码、TLS 和邮箱发送记录，勿立即重复发送。",
        );
      } finally {
        transport.close();
      }
      return;
    }
    const result = await providerPost(
      // Resend's provider-level idempotency supplements the database outbox.
      "https://api.resend.com/emails",
      {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Idempotency-Key": key,
      },
      {
        from: process.env.EMAIL_FROM,
        to: [recipient],
        subject: test
          ? "Together · 通知连接测试"
          : "Together · 本周家庭财富复盘",
        text,
      },
    );
    if (!result.id)
      throw new ChannelSendError(
        "uncertain",
        "发信服务未返回确认，请检查发送记录。",
      );
  } else if (channel === "telegram") {
    const result = await providerPost(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {},
      { chat_id: recipient, text, link_preview_options: { is_disabled: true } },
    );
    if (result.ok !== true)
      throw new ChannelSendError(
        "failed",
        "Telegram 未接受通知；请重新连接 Bot。",
      );
  } else {
    // No free-form weekly messages: use the approved static, zero-variable template.
    const result = await providerPost(
      `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
      {
        messaging_product: "whatsapp",
        to: recipient,
        type: "template",
        template: {
          name: process.env.WHATSAPP_TEMPLATE_NAME,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE },
        },
      },
    );
    if (!result.messages?.[0]?.id)
      throw new ChannelSendError(
        "uncertain",
        "WhatsApp 未返回确认，请检查平台发送记录。",
      );
  }
}
export async function ensureTelegramWebhook() {
  const base = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
  const me = await providerPost(`${base}/getMe`, {}, {});
  if (
    me.ok !== true ||
    me.result?.is_bot !== true ||
    me.result?.username?.toLowerCase() !==
      process.env.TELEGRAM_BOT_USERNAME?.toLowerCase()
  )
    throw new ChannelSendError(
      "failed",
      "Bot token 与配置的用户名不匹配，请检查专用 Bot。",
    );
  const current = await providerPost(`${base}/getWebhookInfo`, {}, {});
  const target = new URL("/api/notifications/telegram", appLink()).toString();
  if (current.ok !== true)
    throw new ChannelSendError("failed", "无法检查 Telegram 回调。");
  if (current.result?.url && current.result.url !== target)
    throw new ChannelSendError(
      "failed",
      "此 Bot 已被其他应用使用，未覆盖其回调。请创建专用 Bot。",
    );
  const saved = await providerPost(
    `${base}/setWebhook`,
    {},
    {
      url: target,
      secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    },
  );
  if (saved.ok !== true)
    throw new ChannelSendError(
      "failed",
      "Telegram 回调设置未完成，请检查服务器地址。",
    );
}
export async function sendConversationReply(
  channel: "telegram" | "whatsapp",
  recipient: string,
  content: string,
) {
  const plain = content
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
  const text = `${plain.slice(0, 3300)}${plain.length > 3300 ? "\n\n完整回复已保存在 App 聊天历史。" : ""}\n\n私密家庭空间：${appLink()}`;
  const result =
    channel === "telegram"
      ? await providerPost(
          `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {},
          {
            chat_id: recipient,
            text,
            link_preview_options: { is_disabled: true },
          },
        )
      : await providerPost(
          `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
          { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
          {
            messaging_product: "whatsapp",
            to: recipient,
            type: "text",
            text: { body: text, preview_url: false },
          },
        );
  if (channel === "telegram" ? result.ok !== true : !result.messages?.[0]?.id)
    throw new ChannelSendError("uncertain", "回复未返回平台确认。");
}
