import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { validateState } from "@/lib/wealth";
import { ruleReview, weeklyReview } from "@/lib/ai/review";
import { dispatchChannelNotices } from "@/lib/channel-server";
export const maxDuration = 60;
import { pushReady, sendPush } from "@/lib/push";
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET)
    return NextResponse.json(
      { error: "Cron secret is not configured" },
      { status: 503 },
    );
  if (
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    return NextResponse.json(
      { error: "Supabase is not configured" },
      { status: 503 },
    );
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data: documents, error } = await admin
    .from("household_documents")
    .select("household_id,document");
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  const now = new Date();
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  const week = monday.toISOString().slice(0, 10);
  let processed = 0;
  let pushed = 0;
  let failures = 0;
  let channelAccepted = 0;
  for (const row of documents ?? []) {
    try {
      validateState(row.document);
    } catch {
      continue;
    }
    if (row.document.preferences.proactive === false) continue;
    const title = "本周家庭财富回顾";
    const body = ruleReview(row.document, now);
    const hash = createHash("sha256")
      .update(`${row.household_id}-${week}`)
      .digest("hex")
      .slice(0, 32);
    const alertId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
    const alert = await admin
      .from("advisor_alerts")
      .upsert(
        {
          id: alertId,
          household_id: row.household_id,
          title,
          body,
          kind: "weekly_review",
        },
        { onConflict: "id", ignoreDuplicates: true },
      )
      .select("id");
    if (alert.error) {
      failures++;
      continue;
    }
    if (alert.data?.length) {
      processed++;
      const review = await weeklyReview(row.document, now);
      if (review !== body) {
        const saved = await admin
          .from("advisor_alerts")
          .update({ body: review })
          .eq("id", alertId);
        if (saved.error) failures++;
      }
    }
    const channelResult = await dispatchChannelNotices(
      admin,
      row.household_id,
      alertId,
    );
    channelAccepted += channelResult.accepted;
    failures += channelResult.failures;
    if (pushReady()) {
      const subscriptions = await admin
        .from("wealth_push_subscriptions")
        .select("endpoint,subscription,user_id,last_alert_id")
        .eq("household_id", row.household_id);
      if (subscriptions.error) {
        failures++;
        continue;
      }
      for (const entry of subscriptions.data ?? []) {
        if (entry.last_alert_id === alertId) continue;
        try {
          // Keep lock-screen notifications brief; the full review stays private in-app.
          await sendPush(entry.subscription, {
            title,
            body: "已根据最新家庭记录准备好本周复盘。打开私密家庭空间查看。",
          });
          const saved = await admin
            .from("wealth_push_subscriptions")
            .update({ last_alert_id: alertId })
            .eq("endpoint", entry.endpoint)
            .eq("user_id", entry.user_id);
          if (saved.error) failures++;
          else pushed++;
        } catch (reason) {
          const status = (reason as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410)
            await admin
              .from("wealth_push_subscriptions")
              .delete()
              .eq("endpoint", entry.endpoint)
              .eq("user_id", entry.user_id);
          else failures++;
        }
      }
    }
  }
  return NextResponse.json(
    { ok: failures === 0, processed, pushed, channelAccepted, failures },
    { status: failures ? 502 : 200 },
  );
}
