import { SYMBOL, symbolIdentity } from "./backtest-schema";
import { yahooSymbol } from "./backtest-yahoo";

export const SECURITY_EXCHANGES = [
  "NASDAQ",
  "NYSE",
  "NYSE Arca",
  "NYSE American",
  "Cboe US",
  "TSX",
] as const;
export type Security = {
  symbol: string;
  providerSymbol: string;
  name: string;
  exchange: (typeof SECURITY_EXCHANGES)[number];
  kind: "EQUITY" | "ETF";
  currency: "USD" | "CAD";
  verifiedAt: string;
  verifiedBy?: "tiingo";
};
export type SecuritySearch = {
  version: 1;
  query: string;
  options: Security[];
  checkedAt: string;
  omitted: number;
};
const exchanges: Record<string, Security["exchange"]> = {
  NMS: "NASDAQ",
  NGM: "NASDAQ",
  NCM: "NASDAQ",
  NYQ: "NYSE",
  PCX: "NYSE Arca",
  ASE: "NYSE American",
  BTS: "Cboe US",
  TOR: "TSX",
};
export function securityQuery(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 256)
    throw Error("请输入证券代码或公司名称。");
  const q = raw.trim().replace(/\s+/g, " ");
  if (
    !q ||
    q.length > 48 ||
    !/^[\p{L}\p{N} .&'-]+$/u.test(q) ||
    /^\d{5,}$/.test(q)
  )
    throw Error(
      "请输入最多48字的证券代码或名称，不支持链接、邮箱或其他私人资料。",
    );
  return q;
}
export type SecurityCandidate = Pick<
  Security,
  "symbol" | "providerSymbol" | "name" | "exchange" | "kind"
>;
export function securityCandidates(raw: unknown): SecurityCandidate[] {
  const rows = (raw as { quotes?: unknown[] })?.quotes;
  if (!Array.isArray(rows)) throw Error("证券搜索响应无效。");
  const result: SecurityCandidate[] = [];
  for (const raw of rows.slice(0, 20)) {
    const r = raw as {
      symbol?: unknown;
      exchange?: unknown;
      quoteType?: unknown;
      shortname?: unknown;
      longname?: unknown;
      isYahooFinance?: unknown;
    };
    if (
      !r ||
      typeof r.symbol !== "string" ||
      typeof r.exchange !== "string" ||
      !Object.hasOwn(exchanges, r.exchange) ||
      !["EQUITY", "ETF"].includes(String(r.quoteType)) ||
      r.isYahooFinance === false
    )
      continue;
    const exchange = exchanges[r.exchange],
      symbol = exchange === "TSX" ? r.symbol : `${r.symbol}.US`,
      name = typeof r.longname === "string" ? r.longname : r.shortname;
    if (
      !SYMBOL.test(symbol) ||
      (exchange === "TSX") !== symbol.endsWith(".TO") ||
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 200
    )
      continue;
    try {
      if (yahooSymbol(symbol) !== r.symbol) continue;
    } catch {
      continue;
    }
    if (result.some((s) => symbolIdentity(s.symbol) === symbolIdentity(symbol)))
      continue;
    result.push({
      symbol,
      providerSymbol: r.symbol,
      name: name
        .replace(/[\x00-\x1f\x7f]/g, " ")
        .trim()
        .slice(0, 100),
      exchange,
      kind: r.quoteType as Security["kind"],
    });
    if (result.length === 6) break;
  }
  return result;
}
/** Verify each search hit against exact public quote metadata, never fuzzy names. */
export function verifySecurity(
  raw: unknown,
  candidate: SecurityCandidate,
  now = new Date(),
): Security {
  const chart = (
    raw as {
      chart?: {
        error?: unknown;
        result?: { meta?: Record<string, unknown> }[];
      };
    }
  )?.chart;
  const meta = chart?.result?.[0]?.meta;
  if (
    chart?.error ||
    chart?.result?.length !== 1 ||
    !meta ||
    meta.symbol !== candidate.providerSymbol ||
    typeof meta.exchangeName !== "string" ||
    exchanges[meta.exchangeName] !== candidate.exchange ||
    meta.instrumentType !== candidate.kind ||
    !["CAD", "USD"].includes(String(meta.currency)) ||
    (candidate.exchange !== "TSX" && meta.currency !== "USD") ||
    typeof meta.regularMarketPrice !== "number" ||
    !Number.isFinite(meta.regularMarketPrice) ||
    meta.regularMarketPrice <= 0 ||
    typeof meta.regularMarketTime !== "number" ||
    !Number.isSafeInteger(meta.regularMarketTime) ||
    meta.regularMarketTime * 1000 > now.getTime() + 60000 ||
    now.getTime() - meta.regularMarketTime * 1000 > 21 * 86400000
  )
    throw Error("证券身份、类型、币种或报价未通过核对。");
  return {
    ...candidate,
    currency: meta.currency as Security["currency"],
    verifiedAt: now.toISOString(),
  };
}
export function validateSecuritySearch(
  raw: unknown,
  query: string,
): asserts raw is SecuritySearch {
  const r = raw as SecuritySearch;
  if (
    !r ||
    r.version !== 1 ||
    r.query !== query ||
    !Array.isArray(r.options) ||
    r.options.length > 6 ||
    !Number.isInteger(r.omitted) ||
    r.omitted < 0 ||
    r.omitted > 20 ||
    typeof r.checkedAt !== "string" ||
    !Number.isFinite(Date.parse(r.checkedAt))
  )
    throw Error("证券搜索响应无效，未更改当前持仓。");
  const ids = new Set<string>();
  for (const s of r.options) {
    if (
      !s ||
      typeof s.symbol !== "string" ||
      !SYMBOL.test(s.symbol) ||
      yahooSymbol(s.symbol) !== s.providerSymbol ||
      !SECURITY_EXCHANGES.includes(s.exchange) ||
      (s.exchange === "TSX") !== s.symbol.endsWith(".TO") ||
      !["EQUITY", "ETF"].includes(s.kind) ||
      !["USD", "CAD"].includes(s.currency) ||
      (s.exchange !== "TSX" && s.currency !== "USD") ||
      typeof s.name !== "string" ||
      !s.name.trim() ||
      s.name.length > 100 ||
      typeof s.verifiedAt !== "string" ||
      !Number.isFinite(Date.parse(s.verifiedAt)) ||
      Date.parse(s.verifiedAt) > Date.now() + 60000 ||
      Date.now() - Date.parse(s.verifiedAt) > 86400000 ||
      ids.has(symbolIdentity(s.symbol))
    )
      throw Error("证券搜索条目无效，未更改当前持仓。");
    ids.add(symbolIdentity(s.symbol));
  }
}
