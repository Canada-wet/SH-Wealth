import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server-auth";
import { channelAdmin } from "@/lib/channel-server";
import {
  CHANNELS,
  ChannelSendError,
  channelReadiness,
  decryptRecipient,
  encryptRecipient,
  ensureTelegramWebhook,
  newChannelLink,
  recipientHash,
  recipientLabel,
  sendChannelNotice,
  type Channel,
} from "@/lib/channels";
const response = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
const validHome = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
export async function GET(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200) return response({ error: auth.error }, auth.status);
  const home = new URL(request.url).searchParams.get("householdId");
  if (!validHome(home)) return response({ error: "请先连接家庭空间。" }, 400);
  const member = await auth.client.rpc("is_wealth_member", {
    target_household: home,
  });
  if (member.error || !member.data)
    return response({ error: "没有此家庭的访问权限。" }, 403);
  const rows = await auth.client
    .from("wealth_notification_channels")
    .select(
      "id,channel,destination_label,enabled,advisor_enabled,last_status,last_test_at,last_delivery_at",
    )
    .eq("household_id", home)
    .eq("user_id", auth.user.id);
  if (rows.error)
    return response(
      { error: "通知渠道数据库尚未就绪，请联系管理员完成配置。" },
      503,
    );
  return response({
    channels: rows.data,
    configuration: Object.fromEntries(
      CHANNELS.map((channel) => [channel, channelReadiness(channel)]),
    ),
    whatsappAdvisor: process.env.WHATSAPP_ALLOW_ADVISOR === "1",
  });
}
export async function POST(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200) return response({ error: auth.error }, auth.status);
  let body: {
    householdId?: string;
    channel?: Channel;
    action?: string;
    consent?: boolean;
    advisor?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return response({ error: "请求格式无效。" }, 400);
  }
  if (
    !validHome(body?.householdId) ||
    !CHANNELS.includes(body.channel as Channel) ||
    !["connect", "disconnect", "test"].includes(body.action || "")
  )
    return response({ error: "请求参数无效。" }, 400);
  const member = await auth.client.rpc("is_wealth_member", {
    target_household: body.householdId,
  });
  if (member.error || !member.data)
    return response({ error: "没有此家庭的访问权限。" }, 403);
  const channel = body.channel!;
  if (body.action !== "disconnect" && !channelReadiness(channel).ready)
    return response({ error: channelReadiness(channel).reason }, 503);
  if (body.action === "connect" && body.consent !== true)
    return response({ error: "请先同意接收此渠道通知。" }, 400);
  if (
    body.advisor === true &&
    (channel === "email" ||
      (channel === "whatsapp" && process.env.WHATSAPP_ALLOW_ADVISOR !== "1"))
  )
    return response({ error: "此渠道暂未启用平台内顾问对话。" }, 400);
  const slot = await auth.client.rpc("take_wealth_channel_slot");
  if (slot.error)
    return response({ error: "通知访问检查失败，请稍后重试。" }, 503);
  if (!slot.data) return response({ error: "操作较频繁，请稍后再试。" }, 429);
  try {
    const admin = channelAdmin();
    const scope = {
      household_id: body.householdId,
      user_id: auth.user.id,
      channel,
    };
    if (body.action === "disconnect") {
      const off = await admin
        .from("wealth_notification_channels")
        .update({ enabled: false, advisor_enabled: false })
        .match(scope);
      const cancelled = await admin
        .from("wealth_channel_links")
        .update({ used_at: new Date().toISOString() })
        .match(scope)
        .is("used_at", null);
      if (off.error || cancelled.error) throw new Error("save");
      return response({
        ok: true,
        message: "此账号的渠道已断开，待验证链接也已失效。",
      });
    }
    if (body.action === "connect" && channel !== "email") {
      if (channel === "telegram") await ensureTelegramWebhook();
      const link = newChannelLink(channel);
      const cancelled = await admin
        .from("wealth_channel_links")
        .update({ used_at: new Date().toISOString() })
        .match(scope)
        .is("used_at", null);
      if (cancelled.error) throw new Error("save");
      const saved = await admin.from("wealth_channel_links").insert({
        ...scope,
        token_hash: link.hash,
        expires_at: link.expiresAt,
        advisor_enabled: body.advisor === true,
      });
      if (saved.error) throw new Error("save");
      return response({
        ok: true,
        url: link.url,
        expiresAt: link.expiresAt,
        message: "请打开平台并发送连接码；15 分钟内有效，请勿分享链接。",
      });
    }
    if (body.action === "connect") {
      const email = auth.user.email!.toLowerCase();
      const saved = await admin.from("wealth_notification_channels").upsert(
        {
          ...scope,
          destination_cipher: encryptRecipient(email),
          destination_hash: recipientHash(channel, email),
          destination_label: recipientLabel(channel, email),
          enabled: true,
          advisor_enabled: false,
          verified_at: new Date().toISOString(),
          last_status: null,
        },
        { onConflict: "household_id,user_id,channel" },
      );
      if (saved.error) throw new Error("save");
      return response({
        ok: true,
        message: "已启用已验证登录邮箱的周报通知；可发送测试确认收信。",
      });
    }
    const connection = await admin
      .from("wealth_notification_channels")
      .select("id,destination_cipher,enabled")
      .match(scope)
      .single();
    if (connection.error || !connection.data?.enabled)
      return response({ error: "请先绑定并启用此渠道。" }, 400);
    const now = new Date().toISOString();
    try {
      await sendChannelNotice(
        channel,
        decryptRecipient(connection.data.destination_cipher),
        `test-${connection.data.id}-${crypto.randomUUID()}`,
        true,
      );
      const saved = await admin
        .from("wealth_notification_channels")
        .update({ last_status: "accepted", last_test_at: now })
        .eq("id", connection.data.id);
      if (saved.error)
        return response(
          { error: "平台已接受测试，但状态未保存；请检查平台，不要立即重发。" },
          503,
        );
      return response({
        ok: true,
        message: "平台已接受测试通知；请到邮箱或聊天平台确认是否收到。",
      });
    } catch (reason) {
      const status =
        reason instanceof ChannelSendError ? reason.status : "failed";
      await admin
        .from("wealth_notification_channels")
        .update({ last_status: status, last_test_at: now })
        .eq("id", connection.data.id);
      return response(
        {
          error:
            reason instanceof ChannelSendError
              ? reason.message
              : "通知发送失败，请检查配置。",
        },
        502,
      );
    }
  } catch (reason) {
    if (reason instanceof ChannelSendError)
      return response({ error: reason.message }, 503);
    return response({ error: "渠道操作未完成，请检查数据库配置后重试。" }, 503);
  }
}
