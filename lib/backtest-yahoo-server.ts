import { unstable_cache } from "next/cache";
import { boundedJSON } from "./backtest-http";
import {
  parseYahooHistory,
  yahooSymbol,
  yahooCompletedEnd,
  type YahooRequest,
  type YahooBatch,
  type YahooAssetResult,
} from "./backtest-yahoo";

// Fixed public host, no cookies, crumb extraction, proxy rotation or automatic retry.
let blockedUntil = 0;
export async function fetchYahooHistory(
  symbol: string,
  start: string,
  end: string,
): Promise<YahooAssetResult> {
  const mapped = yahooSymbol(symbol),
    fetchedAt = new Date().toISOString();
  const base = { symbol, yahooSymbol: mapped, fetchedAt, warnings: [] };
  if (Date.now() < blockedUntil)
    return {
      ...base,
      blocked: true,
      error: "Yahoo 暂时拒绝或限流，本实例已冷却；未再次请求。",
    };
  try {
    const url = new URL(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(mapped)}`,
    );
    url.search = new URLSearchParams({
      period1: String(Date.parse(start) / 1000),
      period2: String(Date.parse(end) / 1000 + 86400),
      interval: "1d",
      events: "div,splits,capitalGains",
      includeAdjustedClose: "true",
    }).toString();
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if ([401, 403, 429].includes(response.status)) {
      blockedUntil = Date.now() + 15 * 60_000;
      return {
        ...base,
        blocked: true,
        error: `Yahoo 拒绝访问或限流（${response.status}）；已停止，不绕过登录或限制。`,
      };
    }
    if (!response.ok)
      return {
        ...base,
        error: `Yahoo 未返回可用历史（${response.status}）；请检查代码或使用CSV。`,
      };
    const parsed = parseYahooHistory(
      await boundedJSON(response, 6_000_000),
      symbol,
      start,
      end,
    );
    return { ...base, ...parsed };
  } catch {
    return {
      ...base,
      error:
        "Yahoo 超时、断线或数据口径无效；未重试、未补示例价格，请使用CSV或稍后手动获取。",
    };
  }
}
// Cache only public symbol/date history (including failures to avoid hammering).
const cachedYahoo = unstable_cache(fetchYahooHistory, ["backtest-yahoo-v1"], {
  revalidate: 3600,
});
export async function getYahooBatch(
  request: YahooRequest,
): Promise<YahooBatch> {
  const effectiveEnd = yahooCompletedEnd(request.end),
    results: YahooAssetResult[] = [];
  let stopped = false,
    bytes = 0;
  for (const symbol of request.symbols) {
    if (stopped || effectiveEnd <= request.start) {
      results.push({
        symbol,
        yahooSymbol: yahooSymbol(symbol),
        fetchedAt: new Date().toISOString(),
        warnings: [],
        error: stopped
          ? "前一个请求被拒绝，本批后续请求已停止。"
          : "完整日线区间太短，请将起始日期提前。",
      });
      continue;
    }
    const result = await cachedYahoo(symbol, request.start, effectiveEnd);
    const size = result.asset ? JSON.stringify(result.asset).length : 0;
    if (bytes + size > 3_500_000) {
      results.push({
        symbol,
        yahooSymbol: yahooSymbol(symbol),
        fetchedAt: result.fetchedAt,
        warnings: [],
        error: "本批历史体积较大，请减少标的或缩短日期后分批获取。",
      });
    } else {
      results.push(result);
      bytes += size;
    }
    stopped = result.blocked === true;
  }
  const assets = results.flatMap((r) => (r.asset ? [r.asset] : []));
  return {
    requested: request,
    effectiveEnd,
    results: results.map(({ asset: _asset, ...r }) => r),
    data: assets.length
      ? {
          version: 1,
          capturedAt: results
            .filter((r) => r.asset)
            .map((r) => r.fetchedAt)
            .sort()[0],
          synthetic: false,
          assets,
        }
      : null,
  };
}
