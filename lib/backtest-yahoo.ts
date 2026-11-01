import {
  backtestToday,
  SYMBOL,
  validDate,
  validateBacktestData,
  type BacktestData,
  type HistoricalAsset,
} from "./backtest-schema";

export type YahooRequest = { symbols: string[]; start: string; end: string };
export type YahooAssetResult = {
  symbol: string;
  yahooSymbol: string;
  asset?: HistoricalAsset;
  fetchedAt: string;
  error?: string;
  warnings: string[];
  blocked?: boolean;
};
export type YahooBatch = {
  requested: YahooRequest;
  effectiveEnd: string;
  results: Omit<YahooAssetResult, "asset">[];
  data: BacktestData | null;
};
export function yahooSymbol(symbol: string) {
  if (!SYMBOL.test(symbol) || symbol.includes("_") || symbol.startsWith("DEMO"))
    throw Error(
      "请输入真实证券代码，例如 SPY.US、NVDA.US 或 ZSP.TO；演示代码不能抓取。",
    );
  const tsx = symbol.endsWith(".TO");
  const base = symbol.slice(0, -3).replaceAll(".", "-");
  return base + (tsx ? ".TO" : "");
}
export function yahooRequest(raw: unknown, now = new Date()): YahooRequest {
  const r = raw as YahooRequest;
  if (
    !r ||
    !Array.isArray(r.symbols) ||
    !r.symbols.length ||
    r.symbols.length > 8 ||
    new Set(r.symbols).size !== r.symbols.length ||
    r.symbols.some((s) => typeof s !== "string") ||
    !validDate(r.start) ||
    !validDate(r.end) ||
    r.start < "1970-01-01" ||
    r.start >= r.end ||
    r.end > backtestToday(now)
  )
    throw Error("请选择1–8个唯一证券代码和有效历史日期，不支持未来日期。");
  r.symbols.forEach(yahooSymbol);
  return { symbols: [...r.symbols], start: r.start, end: r.end };
}
export function yahooCompletedEnd(end: string, now = new Date()) {
  const yesterday = new Date(Date.parse(backtestToday(now)) - 86400000)
    .toISOString()
    .slice(0, 10);
  return end < yesterday ? end : yesterday;
}
export function parseYahooHistory(
  raw: unknown,
  symbol: string,
  start: string,
  end: string,
): { asset: HistoricalAsset; warnings: string[] } {
  const chart = (raw as { chart?: { error?: unknown; result?: unknown[] } })
    ?.chart;
  if (
    !chart ||
    chart.error ||
    !Array.isArray(chart.result) ||
    chart.result.length !== 1
  )
    throw Error("Yahoo 未提供这只证券的有效历史；不自动替换成相似代码。");
  const r = chart.result[0] as {
    meta?: {
      symbol?: string;
      currency?: string;
      instrumentType?: string;
      exchangeTimezoneName?: string;
      dataGranularity?: string;
    };
    timestamp?: number[];
    indicators?: {
      quote?: { close?: (number | null)[] }[];
      adjclose?: { adjclose?: (number | null)[] }[];
    };
  };
  const currency = r?.meta?.currency;
  if (
    r?.meta?.symbol !== yahooSymbol(symbol) ||
    !["CAD", "USD"].includes(currency ?? "") ||
    (symbol.endsWith(".US") && currency !== "USD") ||
    !["EQUITY", "ETF"].includes(r.meta.instrumentType ?? "") ||
    r.meta.dataGranularity !== "1d" ||
    !r.meta.exchangeTimezoneName
  )
    throw Error(
      "Yahoo 证券身份、成交币种或日线口径不匹配，请核对精确代码；未导入。",
    );
  const dates = new Intl.DateTimeFormat("en-CA", {
    timeZone: r.meta.exchangeTimezoneName,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const times = r.timestamp,
    close = r.indicators?.quote?.[0]?.close,
    adjusted = r.indicators?.adjclose?.[0]?.adjclose;
  if (
    !Array.isArray(times) ||
    times.length > 15000 ||
    !Array.isArray(close) ||
    !Array.isArray(adjusted) ||
    times.length !== close.length ||
    times.length !== adjusted.length
  )
    throw Error("Yahoo 缺少完整复权价格；不会混用原价或猜测分红。");
  const points: HistoricalAsset["points"] = [];
  let skipped = 0;
  for (let i = 0; i < times.length; i++) {
    if (!Number.isSafeInteger(times[i]) || times[i] <= 0)
      throw Error("Yahoo 日线时间无效。");
    const parts = dates.formatToParts(new Date(times[i] * 1000));
    const date = ["year", "month", "day"]
      .map((k) => parts.find((p) => p.type === k)!.value)
      .join("-");
    if (date < start || date > end) continue;
    if (close[i] === null && adjusted[i] === null) {
      skipped++;
      continue;
    }
    if (
      typeof close[i] !== "number" ||
      !Number.isFinite(close[i]) ||
      close[i]! <= 0 ||
      typeof adjusted[i] !== "number" ||
      !Number.isFinite(adjusted[i]) ||
      adjusted[i]! <= 0
    )
      throw Error("Yahoo 存在坏价或缺失复权值；未用零价或原价补齐。");
    points.push({ date, close: adjusted[i]!, dividend: 0, split: 1 });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  const asset: HistoricalAsset = {
    symbol,
    currency: currency as "CAD" | "USD",
    basis: "total-return",
    dividendsKnown: false,
    source: `Yahoo Finance · ${yahooSymbol(symbol)} · Adj Close · 非官方日线`,
    points,
  };
  validateBacktestData({
    version: 1,
    capturedAt: new Date().toISOString(),
    synthetic: false,
    assets: [asset],
  });
  const warnings = [
    "使用含分红与拆股的复权总回报，仅支持分红再投资；现金分红金额不单列。",
  ];
  if (skipped)
    warnings.push(
      `${skipped}条全空日线已排除，未补价；回测仍会检查内部日期缺口。`,
    );
  if (points[0].date > start)
    warnings.push(
      "源数据起点晚于请求日期（可能未上市或休市）；不填造上市前价格。",
    );
  return { asset, warnings };
}
