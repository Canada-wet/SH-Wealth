import type { MarketData, MarketReading, MarketInstrument } from "./market";
import { instrumentKey, normalizeWatchlist } from "./market";
export const MARKET_CACHE_KEY = "together-market-data-v1";
export const watchlistFingerprint = (rows: MarketInstrument[]) =>
  JSON.stringify(rows.map((row) => [row.exchange, row.ticker, row.name]));
export function validMarketData(raw: unknown): raw is MarketData {
  if (!raw || typeof raw !== "object") return false;
  const data = raw as MarketData;
  const reading = (row: MarketReading) =>
    !!row &&
    typeof row.id === "string" &&
    typeof row.label === "string" &&
    (row.value === null || Number.isFinite(row.value)) &&
    (row.date === null ||
      (typeof row.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.date))) &&
    typeof row.unit === "string" &&
    ["daily", "weekly", "monthly", "quarterly"].includes(row.frequency) &&
    typeof row.source === "string" &&
    /^https:\/\/(?:fred\.stlouisfed\.org|www\.bankofcanada\.ca)\//.test(
      row.source,
    ) &&
    Array.isArray(row.trend) &&
    row.trend.length <= 100 &&
    row.trend.every(
      (p) =>
        p && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.value),
    );
  return (
    typeof data.fetchedAt === "string" &&
    Number.isFinite(Date.parse(data.fetchedAt)) &&
    [data.fx, data.yields, data.macro].every(
      (rows) => Array.isArray(rows) && rows.length <= 20 && rows.every(reading),
    ) &&
    (data.indicators === undefined ||
      (Array.isArray(data.indicators) &&
        data.indicators.length <= 20 &&
        data.indicators.every(reading))) &&
    Array.isArray(data.failures) &&
    data.failures.every((item) => typeof item === "string")
  );
}
export function editWatchlist(
  rows: MarketInstrument[],
  key: string,
  next: MarketInstrument,
) {
  if (!rows.some((row) => instrumentKey(row) === key))
    throw new Error("该自选已变化，请重新选择后编辑。");
  if (
    instrumentKey(next) !== key &&
    rows.some((row) => instrumentKey(row) === instrumentKey(next))
  )
    throw new Error("同交易所的证券已在自选中，请勿重复。");
  return normalizeWatchlist(
    rows.map((row) => (instrumentKey(row) === key ? next : row)),
  );
}
export function mergeMarketData(
  previous: MarketData | null,
  incoming: MarketData,
): MarketData {
  if (!previous) return incoming;
  const failures = new Set(incoming.failures);
  const keep = (row: MarketReading) => {
    failures.add(row.label);
    return {
      ...row,
      note: row.note?.includes("保留上次有效观测")
        ? row.note
        : `${row.note ?? ""}；本次源数据不可用，保留上次有效观测，请核对源日期。`,
    };
  };
  const merge = (old: MarketReading[], next: MarketReading[]) =>
    next.length
      ? next.map((row) => {
          const saved = old.find((item) => item.id === row.id);
          return row.value === null && saved?.value != null ? keep(saved) : row;
        })
      : old.filter((row) => row.value !== null).map(keep);
  const fx = merge(previous.fx, incoming.fx),
    yields = merge(previous.yields, incoming.yields),
    macro = merge(previous.macro, incoming.macro);
  return {
    ...incoming,
    fx,
    yields,
    macro,
    ...(incoming.indicators !== undefined || previous.indicators !== undefined
      ? {
          indicators: merge(
            previous.indicators ?? [],
            incoming.indicators ?? [],
          ),
        }
      : {}),
    failures: [...failures],
  };
}
export function marketSnapshot(data: MarketData, rows: MarketInstrument[]) {
  const copy = (readings: MarketReading[]) =>
    readings.map(
      ({
        id,
        label,
        value,
        date,
        unit,
        frequency,
        source,
        trend,
        note,
        previous,
      }) => ({
        id,
        label,
        value,
        date,
        unit,
        frequency,
        source,
        trend: trend.map(({ date, value }) => ({ date, value })),
        note,
        previous,
      }),
    );
  return {
    version: 1,
    kind: "public-market-snapshot",
    exportedAt: new Date().toISOString(),
    fetchedAt: data.fetchedAt,
    fx: copy(data.fx),
    yields: copy(data.yields),
    macro: copy(data.macro),
    ...(data.indicators ? { indicators: copy(data.indicators) } : {}),
    failures: data.failures,
    watchlist: rows.map(({ ticker, exchange }) => ({ ticker, exchange })),
    note: "仅含公开官方数据与证券代码；不含第三方跨域报价、家庭账本或聊天。",
  };
}
export function instrumentFallback(row?: MarketInstrument) {
  return row?.exchange === "TSX" && row.ticker === "ZGIN"
    ? "https://www.bmoetfs.ca/etfs/zgin-bmo-global-innovators-fund-active-etf-series"
    : row
      ? `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(instrumentKey(row))}`
      : "https://www.tradingview.com/markets/";
}
