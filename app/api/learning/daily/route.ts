import { NextResponse } from "next/server";
import { channelAdmin } from "@/lib/channel-server";
import { deliverDailyLearning } from "@/lib/learning-server";
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET)
    return NextResponse.json(
      { error: "Daily learning is not configured" },
      { status: 503 },
    );
  if (
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await deliverDailyLearning(channelAdmin());
    return NextResponse.json(
      { ok: result.failures === 0, ...result },
      {
        status: result.failures ? 502 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "Daily learning delivery unavailable" },
      { status: 503 },
    );
  }
}
