import {
  channelHash,
  encryptRecipient,
  recipientHash,
  recipientLabel,
  sendConversationReply,
} from "./channels";
import { channelAdmin } from "./channel-server";
import { prepareChannelQuestion } from "./channel-advisor";
export type ChannelEvent = {
  channel: "telegram" | "whatsapp";
  recipient: string;
  id: string;
  text: string;
};
export function telegramEvent(raw: unknown): ChannelEvent | null {
  const event = raw as {
    update_id?: number;
    message?: {
      chat?: { id?: number; type?: string };
      from?: { id?: number; is_bot?: boolean };
      text?: string;
    };
  };
  const message = event?.message;
  if (
    !Number.isSafeInteger(event?.update_id) ||
    message?.chat?.type !== "private" ||
    !Number.isSafeInteger(message.chat.id) ||
    message.chat.id !== message.from?.id ||
    message.from?.is_bot ||
    typeof message.text !== "string"
  )
    return null;
  return {
    channel: "telegram",
    recipient: String(message.chat.id),
    id: String(event.update_id),
    text: message.text,
  };
}
export function whatsappEvents(raw: unknown): ChannelEvent[] {
  const result: ChannelEvent[] = [];
  const event = raw as {
    object?: string;
    entry?: {
      changes?: {
        value?: {
          metadata?: { phone_number_id?: string };
          messages?: {
            id?: string;
            from?: string;
            type?: string;
            text?: { body?: string };
          }[];
        };
      }[];
    }[];
  };
  if (event?.object !== "whatsapp_business_account") return result;
  for (const entry of event.entry ?? [])
    for (const change of entry.changes ?? []) {
      if (
        change.value?.metadata?.phone_number_id !==
        process.env.WHATSAPP_PHONE_NUMBER_ID
      )
        continue;
      for (const message of change.value?.messages ?? [])
        if (
          message.type === "text" &&
          message.id &&
          message.id.length < 100 &&
          /^\d{7,15}$/.test(message.from || "") &&
          typeof message.text?.body === "string"
        )
          result.push({
            channel: "whatsapp",
            recipient: message.from!,
            id: message.id,
            text: message.text.body,
          });
    }
  return result.slice(0, 10);
}
export async function processChannelEvent(event: ChannelEvent) {
  const admin = channelAdmin();
  if (/^(\/stop|STOP)$/i.test(event.text.trim())) {
    const stopped = await admin.rpc("stop_wealth_channel", {
      target_channel: event.channel,
      recipient_hash: recipientHash(event.channel, event.recipient),
      source_event_id: event.id,
    });
    if (stopped.error) throw new Error("Unsubscribe failed");
    return;
  }
  const token = event.text
    .trim()
    .match(
      event.channel === "telegram"
        ? /^\/start\s+([A-Za-z0-9_-]{32})$/
        : /^CONNECT\s+([A-Za-z0-9_-]{32})$/i,
    )?.[1];
  if (token) {
    const linked = await admin.rpc("consume_wealth_channel_link", {
      link_hash: channelHash(token),
      link_channel: event.channel,
      recipient_cipher: encryptRecipient(event.recipient),
      recipient_hash: recipientHash(event.channel, event.recipient),
      recipient_label: recipientLabel(event.channel, event.recipient),
      event_id: event.id,
    });
    if (linked.error) throw new Error("Account linking failed");
    if (linked.data)
      return async () => {
        await sendConversationReply(
          event.channel,
          event.recipient,
          "通知渠道已连接。若你在 App 勾选了只读顾问对话，现在可以直接提问。发送 /stop（Telegram）或 STOP（WhatsApp）可取消通知与对话。请勿发送密码、证件或 API 密钥。",
        );
      };
    return;
  }
  return prepareChannelQuestion(
    admin,
    event.channel,
    event.recipient,
    event.id,
    event.text,
  );
}
