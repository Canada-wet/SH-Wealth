import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server-auth";
import { getOfficialMarket } from "@/lib/market-server";
export const maxDuration = 30;
export async function GET(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200)
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  try {
    return NextResponse.json(await getOfficialMarket(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "官方市场数据暂不可用，请稍后重试。" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
