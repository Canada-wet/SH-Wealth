import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lessonForDay } from "./learning";
import { torontoDay } from "./market-briefing";
import { allowedEmail } from "./access";
import { pushReady, sendPush } from "./push";
import {
  channelReadiness,
  decryptRecipient,
  sendChannelNotice,
  ChannelSendError,
  type Channel,
} from "./channels";
export async function deliverDailyLearning(
  admin: SupabaseClient,
  now = new Date(),
) {
  const day = torontoDay(now),
    lesson = lessonForDay(day);
  if (!lesson) return { accepted: 0, skipped: 0, failures: 0 };
  const prefs = await admin
    .from("wealth_learning_preferences")
    .select("household_id,user_id")
    .eq("daily", true);
  if (prefs.error) throw Error("Learning preferences unavailable");
  const result = { accepted: 0, skipped: 0, failures: 0 };
  for (const pref of prefs.data ?? []) {
    const user = await admin.auth.admin.getUserById(pref.user_id);
    if (
      user.error ||
      !allowedEmail(user.data.user?.email) ||
      !user.data.user?.email_confirmed_at
    ) {
      result.failures++;
      continue;
    }
    const deliver = async (
      transport: "push" | "email" | "telegram",
      destination: string,
      send: () => Promise<unknown>,
    ) => {
      const destination_hash = createHash("sha256")
        .update(destination)
        .digest("hex");
      const key = {
        household_id: pref.household_id,
        user_id: pref.user_id,
        day,
        transport,
        destination_hash,
      };
      const claimed = await admin.rpc("claim_wealth_learning_delivery", {
        target_household: pref.household_id,
        target_user: pref.user_id,
        target_day: day,
        target_transport: transport,
        target_hash: destination_hash,
      });
      if (!claimed.error && !claimed.data) {
        result.skipped++;
        return;
      }
      if (claimed.error) {
        result.failures++;
        return;
      }
      let status = "accepted";
      try {
        await send();
        result.accepted++;
      } catch (reason) {
        status =
          reason instanceof ChannelSendError ? reason.status : "uncertain";
        result.failures++;
      }
      // A timeout/crash is NOT retried automatically: do not risk duplicate daily messages.
      const saved = await admin
        .from("wealth_learning_deliveries")
        .update({ status })
        .match(key);
      if (saved.error) result.failures++;
    };
    if (pushReady()) {
      const push = await admin
        .from("wealth_push_subscriptions")
        .select("endpoint,subscription")
        .eq("household_id", pref.household_id)
        .eq("user_id", pref.user_id);
      if (push.error) result.failures++;
      for (const row of push.data ?? [])
        await deliver("push", row.endpoint, () =>
          sendPush(row.subscription, {
            title: "每日决策心理学",
            body: `${lesson.model}：投资、工作与生活的一分钟练习。`,
            url: `/learn?day=${day}`,
            tag: "together-learning",
          }),
        );
    }
    const channels = await admin
      .from("wealth_notification_channels")
      .select("id,channel,destination_cipher")
      .eq("household_id", pref.household_id)
      .eq("user_id", pref.user_id)
      .eq("enabled", true)
      .in("channel", ["email", "telegram"]);
    if (channels.error) result.failures++;
    for (const row of channels.data ?? []) {
      if (!channelReadiness(row.channel as Channel).ready) {
        result.skipped++;
        continue;
      }
      await deliver(row.channel, row.id, () =>
        sendChannelNotice(
          row.channel,
          decryptRecipient(row.destination_cipher),
          `learning-${day}-${row.id}`,
          false,
          day,
        ),
      );
    }
  }
  return result;
}
