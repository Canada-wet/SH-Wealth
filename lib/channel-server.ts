import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ChannelSendError,
  channelReadiness,
  decryptRecipient,
  sendChannelNotice,
  type Channel,
} from "./channels";
export function channelAdmin() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  )
    throw new Error("通知数据库尚未配置。");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function dispatchChannelNotices(
  admin: SupabaseClient,
  householdId: string,
  alertId: string,
) {
  const result = { accepted: 0, failures: 0 };
  const { data, error } = await admin
    .from("wealth_notification_channels")
    .select("id,channel,destination_cipher")
    .eq("household_id", householdId)
    .eq("enabled", true);
  if (error) return { accepted: 0, failures: 1 };
  for (const row of data ?? []) {
    if (!channelReadiness(row.channel as Channel).ready) {
      result.failures++;
      continue;
    }
    const claim = await admin.rpc("claim_wealth_channel_delivery", {
      target_channel: row.id,
      target_alert: alertId,
    });
    if (claim.error) {
      result.failures++;
      continue;
    }
    if (!claim.data) continue;
    let status: "accepted" | "failed" | "uncertain" = "accepted";
    try {
      await sendChannelNotice(
        row.channel,
        decryptRecipient(row.destination_cipher),
        `wealth-${alertId}-${row.id}`,
      );
    } catch (reason) {
      status = reason instanceof ChannelSendError ? reason.status : "failed";
      result.failures++;
    }
    const saved = await admin
      .from("wealth_channel_deliveries")
      .update({ status })
      .eq("channel_id", row.id)
      .eq("alert_id", alertId);
    const channel = await admin
      .from("wealth_notification_channels")
      .update({
        last_status: status,
        last_delivery_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (saved.error || channel.error) result.failures++;
    else if (status === "accepted") result.accepted++;
  }
  return result;
}
