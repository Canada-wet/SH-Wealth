import { unstable_cache } from "next/cache";
import { boundedJSON } from "./backtest-http";
import {
  tiingoSymbol,
  tiingoMetadata,
  parseTiingoHistory,
} from "./backtest-tiingo";
import type { YahooAssetResult } from "./backtest-yahoo";
import type { Security } from "./security-search";
let blockedUntil = 0;
let requests: number[] = [];
export const tiingoConfigured = () =>
  Boolean(process.env.TIINGO_API_KEY?.trim());
async function publicJSON(path: string, params?: Record<string, string>) {
  const key = process.env.TIINGO_API_KEY?.trim();
  if (!key) throw Error("Tiingo尚未配置TIINGO_API_KEY；未发送请求。");
  const now = Date.now();
  requests = requests.filter((t) => now - t < 3600000);
  if (now < blockedUntil || requests.length >= 50)
    throw Error("Tiingo免费档保护/供方冷却中，请稍后手动重试。");
  const url = new URL(path, "https://api.tiingo.com");
  if (params) url.search = new URLSearchParams(params).toString();
  requests.push(now);
  const r = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    redirect: "error",
    cache: "no-store",
    headers: { Accept: "application/json", Authorization: `Token ${key}` },
  });
  if ([401, 403, 429].includes(r.status)) {
    blockedUntil = now + 3600000;
    throw Error(
      `Tiingo凭证/访问权限被拒绝或限流（${r.status}），已停止本供方新请求。`,
    );
  }
  if (!r.ok) throw Error(`Tiingo未返回有效历史（${r.status}），未自动重发。`);
  return boundedJSON(r, 6_000_000);
}
const metadata = unstable_cache(
  async (symbol: string) =>
    tiingoMetadata(
      await publicJSON(
        `/tiingo/daily/${encodeURIComponent(tiingoSymbol(symbol))}`,
      ),
      symbol,
    ),
  ["tiingo-meta-v1"],
  { revalidate: 86400 },
);
// Known fund identities, not fuzzy or beta search. The exact current listing
// must still be verified with the provider before appearing as an option.
const knownEtfs = new Set([
  "VTV",
  "AVUV",
  "SPY",
  "AGG",
  "VOO",
  "VTI",
  "VXUS",
  "QQQ",
  "BND",
  "VT",
  "SCHD",
  "IWM",
  "IVV",
]);
export async function getTiingoSecurity(
  query: string,
): Promise<Security | null> {
  const ticker = query.toUpperCase().replace(/\.US$/, "");
  if (!tiingoConfigured() || !knownEtfs.has(ticker)) return null;
  const symbol = `${ticker}.US`,
    m = await metadata(symbol);
  if (Date.now() - Date.parse(m.end) > 14 * 86400000)
    throw Error("Tiingo证券最新覆盖过旧，未提供为有效选项。");
  return {
    symbol,
    providerSymbol: ticker,
    name: m.name,
    exchange: m.exchange as Security["exchange"],
    kind: "ETF",
    currency: "USD",
    verifiedAt: new Date().toISOString(),
    verifiedBy: "tiingo",
  };
}
const history = unstable_cache(
  async (symbol: string, start: string, end: string) => {
    await metadata(symbol);
    const asset = parseTiingoHistory(
      await publicJSON(
        `/tiingo/daily/${encodeURIComponent(tiingoSymbol(symbol))}/prices`,
        {
          startDate: start,
          endDate: end,
          resampleFreq: "daily",
          format: "json",
        },
      ),
      symbol,
      start,
      end,
    );
    return { asset, fetchedAt: new Date().toISOString() };
  },
  ["tiingo-eod-v1"],
  { revalidate: 3600 },
);
const pending = new Map<string, Promise<YahooAssetResult>>();
export async function getTiingoHistory(
  symbol: string,
  start: string,
  end: string,
): Promise<YahooAssetResult> {
  const base = {
    symbol,
    yahooSymbol: symbol.replace(/\.US$/, ""),
    provider: "tiingo" as const,
    fetchedAt: new Date().toISOString(),
    warnings: [
      "Tiingo复权总回报已含分红拆股，不重复加现金分红。免费档额度与家庭使用许可需按账户确认。",
    ],
  };
  if (!tiingoConfigured())
    return { ...base, error: "Tiingo尚未配置TIINGO_API_KEY；未发送请求。" };
  try {
    tiingoSymbol(symbol);
  } catch {
    return {
      ...base,
      error: "Tiingo补充接入目前仅支持美股；加拿大证券仍走Yahoo。",
    };
  }
  const id = `${symbol}:${start}:${end}`;
  if (pending.has(id)) return pending.get(id)!;
  if (pending.size >= 100)
    return { ...base, error: "Tiingo核对繁忙，请稍后重试。" };
  const work = history(symbol, start, end)
    .then(({ asset, fetchedAt }) => ({ ...base, asset, fetchedAt }))
    .catch(() => ({
      ...base,
      error:
        "Tiingo超时、凭证/额度/权限受限或数据未通过核对；未重发，未用示例价格补齐。",
    }))
    .finally(() => pending.delete(id));
  pending.set(id, work);
  return work;
}
