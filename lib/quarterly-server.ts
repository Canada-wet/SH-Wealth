import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateState } from "./wealth";
import { quarterlyStatus } from "./quarterly-review";
import { dispatchChannelNotices } from "./channel-server";

export function quarterAlertId(household: string, quarter: string) {
  const hash = createHash("sha256")
    .update(`quarterly-review:${household}:${quarter}`)
    .digest("hex")
    .slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
}
export async function remindQuarterlyReviews(
  admin: SupabaseClient,
  now = new Date(),
) {
  const result = { created: 0, channelAccepted: 0, failures: 0 };
  const { data, error } = await admin
    .from("household_documents")
    .select("household_id,document");
  if (error) throw new Error("季度复盘记录暂时不可读取。");
  for (const row of data ?? []) {
    try {
      validateState(row.document);
    } catch {
      continue;
    }
    const status = quarterlyStatus(row.document, now);
    if (!status.due) continue;
    const id = quarterAlertId(row.household_id, status.key);
    const alert = await admin
      .from("advisor_alerts")
      .upsert(
        {
          id,
          household_id: row.household_id,
          title: `${status.period.label} · 一起复盘`,
          body: `本季度已结束。请到家庭空间的「季度复盘」，核对账户与负债、收支和实际贡献，讨论风险与目标，并为下一季度安排有负责人和日期的行动。历史缺失会明确标记，不以当前余额回填。`,
          kind: "quarterly_review",
        },
        { onConflict: "id", ignoreDuplicates: true },
      )
      .select("id");
    if (alert.error) {
      result.failures++;
      continue;
    }
    result.created += alert.data?.length ?? 0;
    if (status.prefs.external) {
      // Per-channel atomic claim prevents a daily cron from sending again.
      // Existing owner consent and household membership are rechecked by the RPC.
      const delivery = await dispatchChannelNotices(
        admin,
        row.household_id,
        id,
        status.key,
      );
      result.channelAccepted += delivery.accepted;
      result.failures += delivery.failures;
    }
  }
  return result;
}
