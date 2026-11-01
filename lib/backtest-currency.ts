import {
  backtestToday,
  validDate,
  type BacktestConfig,
  type BacktestData,
} from "./backtest-schema";

/** Exchange suffixes are hints only: TSX also lists USD-denominated units. */
export function portfolioCurrencies(
  holdings: BacktestConfig["holdings"],
  data: BacktestData | null,
) {
  const rows = holdings.map((h) => {
    const asset = data?.assets.find((a) => a.symbol === h.symbol);
    return { symbol: h.symbol, currency: asset?.currency ?? null };
  });
  const currencies = [
    ...new Set(rows.flatMap((r) => (r.currency ? [r.currency] : []))),
  ];
  return {
    rows,
    mixed: currencies.length > 1,
    complete: !!rows.length && rows.every((r) => !!r.currency),
    currency:
      currencies.length === 1 && rows.every((r) => !!r.currency)
        ? currencies[0]
        : null,
  };
}

export type CadReference = {
  rate: number;
  date: string;
  fetchedAt: string;
  source: string;
};
export function cadReference(raw: unknown, now = new Date()): CadReference {
  const body = raw as {
    fetchedAt?: string;
    fx?: {
      id?: string;
      value?: number;
      date?: string;
      unit?: string;
      source?: string;
    }[];
  };
  const row = body?.fx?.find((r) => r.id === "FXUSDCAD");
  const source =
    "https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/";
  if (
    !row ||
    row.source !== source ||
    row.unit !== " / CAD" ||
    typeof row.value !== "number" ||
    !Number.isFinite(row.value) ||
    row.value <= 0 ||
    !validDate(row.date) ||
    row.date > backtestToday(now) ||
    now.getTime() - Date.parse(row.date) > 14 * 86400000 ||
    typeof body.fetchedAt !== "string" ||
    !Number.isFinite(Date.parse(body.fetchedAt)) ||
    Date.parse(body.fetchedAt) > now.getTime() + 60000
  )
    throw Error("缺少近14天有效的加拿大央行汇率，保留原规划汇率；可手动填写。");
  const rate = 1 / row.value;
  if (!Number.isFinite(rate) || rate < 0.01 || rate > 100)
    throw Error("官方汇率口径无效，未采用。");
  return {
    rate: Math.round(rate * 1e6) / 1e6,
    date: row.date,
    fetchedAt: body.fetchedAt,
    source,
  };
}
