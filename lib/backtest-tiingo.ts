import {
  validateBacktestData,
  validDate,
  type HistoricalAsset,
} from "./backtest-schema";
import { yahooSymbol } from "./backtest-yahoo";
export function tiingoSymbol(symbol: string) {
  if (!symbol.endsWith(".US"))
    throw Error("Tiingo补充接入目前仅支持美股股票/ETF，TSX仍使用Yahoo。");
  return yahooSymbol(symbol).toLowerCase();
}
const exchanges: Record<string, string> = {
  NASDAQ: "NASDAQ",
  NYSE: "NYSE",
  NYSEARCA: "NYSE Arca",
  AMEX: "NYSE American",
  NYSEAMERICAN: "NYSE American",
  NYSEMKT: "NYSE American",
  BATS: "Cboe US",
  CBOE: "Cboe US",
};
export function tiingoMetadata(raw: unknown, symbol: string) {
  const r = raw as Record<string, unknown>;
  const exchange =
    typeof r?.exchangeCode === "string"
      ? exchanges[r.exchangeCode.toUpperCase().replaceAll(/[^A-Z]/g, "")]
      : undefined;
  if (
    !r ||
    typeof r.ticker !== "string" ||
    r.ticker.toLowerCase() !== tiingoSymbol(symbol) ||
    !exchange ||
    typeof r.name !== "string" ||
    !r.name.trim() ||
    r.name.length > 300 ||
    !validDate(r.startDate) ||
    !validDate(r.endDate) ||
    r.startDate > r.endDate ||
    (r.currency !== undefined && r.currency !== "USD")
  )
    throw Error("Tiingo精确证券身份、交易所或覆盖日期未通过核对。");
  return {
    ticker: r.ticker.toLowerCase(),
    name: r.name.slice(0, 100),
    exchange,
    start: r.startDate,
    end: r.endDate,
  };
}
export function parseTiingoHistory(
  raw: unknown,
  symbol: string,
  start: string,
  end: string,
): HistoricalAsset {
  tiingoSymbol(symbol);
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 15000)
    throw Error("Tiingo未返回足够的日线数据。");
  const points = raw
    .map((r) => {
      if (
        !r ||
        typeof r.date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}(T00:00:00(?:\.000)?Z)?$/.test(r.date) ||
        !validDate(r.date.slice(0, 10)) ||
        typeof r.adjClose !== "number" ||
        !Number.isFinite(r.adjClose) ||
        r.adjClose <= 0 ||
        typeof r.close !== "number" ||
        !Number.isFinite(r.close) ||
        r.close <= 0
      )
        throw Error("Tiingo缺少有效复权日线；不退回原价或补造价格。");
      return {
        date: r.date.slice(0, 10),
        close: r.adjClose,
        dividend: 0,
        split: 1,
      };
    })
    .filter((p) => p.date >= start && p.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
  const asset: HistoricalAsset = {
    symbol,
    currency: "USD",
    basis: "total-return",
    dividendsKnown: false,
    source: `Tiingo EOD · ${tiingoSymbol(symbol).toUpperCase()} · Adj Close · 含分红拆股`,
    points,
  };
  validateBacktestData({
    version: 1,
    capturedAt: new Date().toISOString(),
    synthetic: false,
    assets: [asset],
  });
  return asset;
}
