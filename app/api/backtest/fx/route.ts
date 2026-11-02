import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { authorizeRequest } from "@/lib/server-auth";
import { boundedJSON, sameOrigin } from "@/lib/backtest-http";
import { validDate, backtestToday } from "@/lib/backtest-schema";
import { parseBankHistory } from "@/lib/backtest-fx";
export const maxDuration = 30;
const history = unstable_cache(
  async (start: string, end: string) => {
    const u = new URL(
      "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json",
    );
    u.search = new URLSearchParams({
      start_date: start,
      end_date: end,
    }).toString();
    const r = await fetch(u, {
      signal: AbortSignal.timeout(12000),
      redirect: "error",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!r.ok) throw Error("历史汇率供方暂不可用。");
    return parseBankHistory(await boundedJSON(r, 3_000_000));
  },
  ["backtest-boc-fx-v1"],
  { revalidate: 86400 },
);
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200) return json({ error: auth.error }, auth.status);
  if (!sameOrigin(request)) return json({ error: "请求来源无效。" }, 403);
  const u = new URL(request.url),
    start = u.searchParams.get("start"),
    end = u.searchParams.get("end");
  if (
    !validDate(start) ||
    !validDate(end) ||
    start >= end ||
    start < "1970-01-01" ||
    end > backtestToday()
  )
    return json({ error: "历史汇率日期无效。" }, 400);
  try {
    const slot = await auth.client.rpc("take_wealth_advisor_slot");
    if (slot.error)
      return json({ error: "研究频率检查失败，未访问汇率供方。" }, 503);
    if (!slot.data) return json({ error: "获取较频繁，请稍后手动重试。" }, 429);
    const padded = new Date(
      Math.max(Date.parse("2017-01-03"), Date.parse(start) - 4 * 86400000),
    )
      .toISOString()
      .slice(0, 10);
    if (padded >= end)
      return json(
        { error: "该免费历史汇率系列始于2017年，所选区间无覆盖。" },
        400,
      );
    return json(await history(padded, end));
  } catch {
    return json(
      { error: "历史汇率未通过核对或供方暂不可用，未自动重试。原始行情保留。" },
      503,
    );
  }
}
