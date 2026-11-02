import {
  getCachedYahooHistory,
  yahooIsCoolingDown,
} from "./backtest-yahoo-server";
import { getTiingoHistory, tiingoConfigured } from "./backtest-tiingo-server";
import {
  yahooCompletedEnd,
  yahooSymbol,
  type YahooAssetResult,
  type YahooBatch,
} from "./backtest-yahoo";
import type { HistoryRequest } from "./backtest-history";
export async function getHistoricalBatch(
  request: HistoryRequest,
): Promise<YahooBatch> {
  const effectiveEnd = yahooCompletedEnd(request.end),
    results: YahooAssetResult[] = new Array(request.symbols.length),
    deadline = Date.now() + 60000;
  let cursor = 0;
  async function worker() {
    while (cursor < request.symbols.length) {
      const index = cursor++,
        symbol = request.symbols[index],
        attempts: NonNullable<YahooAssetResult["attempts"]> = [];
      let result: YahooAssetResult = {
        symbol,
        yahooSymbol: yahooSymbol(symbol),
        fetchedAt: new Date().toISOString(),
        warnings: [],
        error:
          "本批请求时间预算不足，未提交更多上游请求；可减少标的后手动重试。",
      };
      if (Date.now() < deadline && effectiveEnd > request.start) {
        const order =
          request.provider === "tiingo"
            ? ["tiingo"]
            : request.provider === "yahoo"
              ? ["yahoo"]
              : ["yahoo", "tiingo"];
        for (const source of order) {
          if (source === "yahoo") {
            if (yahooIsCoolingDown()) {
              attempts.push({
                provider: "yahoo",
                status: "skipped",
                message: "Yahoo拒绝冷却中，未再次访问。",
              });
              continue;
            }
            result = {
              ...(await getCachedYahooHistory(
                symbol,
                request.start,
                effectiveEnd,
              )),
              provider: "yahoo",
            };
          } else {
            if (!symbol.endsWith(".US") || !tiingoConfigured()) {
              attempts.push({
                provider: "tiingo",
                status: "skipped",
                message: !tiingoConfigured()
                  ? "未配置TIINGO_API_KEY"
                  : "本接入不支持TSX",
              });
              continue;
            }
            result = await getTiingoHistory(
              symbol,
              request.start,
              effectiveEnd,
            );
          }
          attempts.push({
            provider: source as "yahoo" | "tiingo",
            status: result.asset ? "ok" : "failed",
            ...(result.error ? { message: result.error } : {}),
          });
          if (result.asset) break;
        }
      }
      if (!result.asset && !attempts.some((a) => a.status === "failed"))
        result.error =
          "所选数据源尚未配置、暂时冷却或不覆盖此代码；请查看供方状态或切换来源。";
      results[index] = { ...result, attempts };
    }
  }
  await Promise.all([worker(), worker()]);
  let bytes = 0;
  for (let i = 0; i < results.length; i++)
    if (results[i].asset) {
      bytes += JSON.stringify(results[i].asset).length;
      if (bytes > 3_500_000) {
        const { asset: _asset, ...r } = results[i];
        results[i] = { ...r, error: "本批数据过大，请缩短日期或减少标的。" };
      }
    }
  const assets = results.flatMap((r) => (r.asset ? [r.asset] : []));
  return {
    providers: { tiingo: tiingoConfigured() },
    requested: request,
    effectiveEnd,
    results: results.map(({ asset: _asset, ...r }) => r),
    data: assets.length
      ? {
          version: 1,
          synthetic: false,
          capturedAt: results
            .filter((r) => r.asset)
            .map((r) => r.fetchedAt)
            .sort()[0],
          assets,
        }
      : null,
  };
}
