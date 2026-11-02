import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server-auth";
import { sameOrigin } from "@/lib/backtest-http";
import { tiingoConfigured } from "@/lib/backtest-tiingo-server";
export async function GET(request: Request) {
  const auth = await authorizeRequest(request);
  const options = { headers: { "Cache-Control": "private, no-store" } };
  if (auth.status !== 200)
    return NextResponse.json(
      { error: auth.error },
      { ...options, status: auth.status },
    );
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "请求来源无效。" },
      { ...options, status: 403 },
    );
  return NextResponse.json({ tiingo: tiingoConfigured() }, options);
}
