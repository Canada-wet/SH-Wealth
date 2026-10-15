import { NextResponse } from "next/server";
import { ensureMarketBrief } from "@/lib/market-briefing-server";
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET)
    return NextResponse.json(
      { error: "Scheduled briefing is not configured" },
      { status: 503 },
    );
  if (
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await ensureMarketBrief();
    return NextResponse.json(
      { ok: true, created: result.created },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Daily market briefing failed" },
      { status: 503 },
    );
  }
}
