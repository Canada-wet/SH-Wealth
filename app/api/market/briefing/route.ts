import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server-auth";
import {
  ensureMarketBrief,
  readMarketBriefs,
} from "@/lib/market-briefing-server";
import { torontoDay } from "@/lib/market-briefing";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200)
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers },
    );
  try {
    return NextResponse.json(
      {
        today: torontoDay(),
        reports: await readMarketBriefs(),
        canGenerate: true,
      },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: "每日简报暂不可用；已有行情和家庭数据不受影响。" },
      { status: 503, headers },
    );
  }
}
export async function POST(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200)
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers },
    );
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== new URL(request.url).origin) ||
    request.headers.get("content-type") !== "application/json"
  )
    return NextResponse.json(
      { error: "请在应用内生成简报。" },
      { status: 403, headers },
    );
  try {
    return NextResponse.json(
      { today: torontoDay(), ...(await ensureMarketBrief()) },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: "简报生成或保存暂未完成，请稍后重试；不会清空历史简报。" },
      { status: 503, headers },
    );
  }
}
