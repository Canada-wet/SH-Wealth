import {
  validDate,
  validateBacktestData,
  type BacktestData,
} from "./backtest-schema";
export type HistoricalFx = {
  source: "Bank of Canada FXUSDCAD";
  fetchedAt: string;
  points: { date: string; cadPerUsd: number }[];
};
export function validateHistoricalFx(
  raw: unknown,
): asserts raw is HistoricalFx {
  const f = raw as HistoricalFx;
  if (
    !f ||
    f.source !== "Bank of Canada FXUSDCAD" ||
    typeof f.fetchedAt !== "string" ||
    !Number.isFinite(Date.parse(f.fetchedAt)) ||
    !Array.isArray(f.points) ||
    f.points.length < 2 ||
    f.points.length > 15000
  )
    throw Error("历史汇率响应无效。");
  let prior = "";
  for (const p of f.points) {
    if (
      !validDate(p.date) ||
      p.date <= prior ||
      typeof p.cadPerUsd !== "number" ||
      !Number.isFinite(p.cadPerUsd) ||
      p.cadPerUsd < 0.1 ||
      p.cadPerUsd > 10
    )
      throw Error("历史汇率序列无效。");
    prior = p.date;
  }
}
export function parseBankHistory(raw: unknown): HistoricalFx {
  const r = raw as {
    seriesDetail?: {
      FXUSDCAD?: { label?: unknown; metadata?: { unit?: unknown } };
    };
    observations?: unknown[];
  };
  if (
    r?.seriesDetail?.FXUSDCAD?.label !== "USD/CAD" ||
    r.seriesDetail.FXUSDCAD.metadata?.unit !==
      "Canadian dollars per US dollar" ||
    !Array.isArray(r.observations)
  )
    throw Error("汇率系列或单位不符。");
  const points = r.observations.flatMap((x) => {
    const o = x as { d?: unknown; FXUSDCAD?: { v?: unknown } };
    if (
      o?.FXUSDCAD?.v === undefined ||
      o.FXUSDCAD.v === null ||
      o.FXUSDCAD.v === ""
    )
      return [];
    return [
      {
        date: o.d as string,
        cadPerUsd:
          typeof o.FXUSDCAD.v === "string" && /^\d+(\.\d+)?$/.test(o.FXUSDCAD.v)
            ? Number(o.FXUSDCAD.v)
            : NaN,
      },
    ];
  });
  const result: HistoricalFx = {
    source: "Bank of Canada FXUSDCAD",
    fetchedAt: new Date().toISOString(),
    points,
  };
  validateHistoricalFx(result);
  return result;
}
export function convertHistoryToBase(
  data: BacktestData,
  fx: HistoricalFx,
  base: "USD" | "CAD",
): BacktestData {
  validateBacktestData(data);
  validateHistoricalFx(fx);
  if (
    !["USD", "CAD"].includes(base) ||
    data.synthetic ||
    data.conversion ||
    data.assets.some((a) => a.basis !== "total-return")
  )
    throw Error(
      "仅可换算未转换的真实复权总回报历史；其他口径请先核对分红与拆股。",
    );
  // Only shared price dates; no forward-filled securities, no future FX observations.
  const sets = data.assets.map((a) => new Set(a.points.map((p) => p.date)));
  const dates = data.assets[0].points
    .map((p) => p.date)
    .filter((d) => sets.every((s) => s.has(d)));
  let cursor = 0;
  const rates: NonNullable<BacktestData["conversion"]>["rates"] = [];
  for (const date of dates) {
    while (cursor + 1 < fx.points.length && fx.points[cursor + 1].date <= date)
      cursor++;
    const rate = fx.points[cursor];
    if (
      rate.date > date ||
      date > fx.points.at(-1)!.date ||
      (Date.parse(date) - Date.parse(rate.date)) / 86400000 > 4
    )
      continue;
    rates.push({ date, rateDate: rate.date, cadPerUsd: rate.cadPerUsd });
  }
  if (rates.length < 3)
    throw Error(
      "真实历史汇率覆盖不足；加拿大央行此系列始于2017年，未用当前汇率补齐。",
    );
  // Trimming boundaries is explicit; internal gaps must never silently disappear.
  const first = rates[0].date,
    last = rates.at(-1)!.date;
  const rateMap = new Map(rates.map((r) => [r.date, r.cadPerUsd]));
  if (dates.some((d) => d >= first && d <= last && !rateMap.has(d)))
    throw Error("区间内历史汇率缺失超过4天，未换算或补值。");
  const native = Object.fromEntries(
    data.assets.map((a) => [a.symbol, a.currency]),
  );
  const converted: BacktestData = {
    ...data,
    assets: data.assets.map((a) => ({
      ...a,
      currency: base,
      source: `${a.source.slice(0, 145)} · BoC历史FX→${base}`,
      points: a.points
        .filter((p) => rateMap.has(p.date))
        .map((p) => ({
          ...p,
          close:
            p.close *
            (a.currency === base
              ? 1
              : base === "CAD"
                ? rateMap.get(p.date)!
                : 1 / rateMap.get(p.date)!),
        })),
    })),
    conversion: {
      source: fx.source,
      fetchedAt: fx.fetchedAt,
      base,
      native,
      rates,
      omitted: data.assets.reduce(
        (sum, a) => sum + a.points.filter((p) => !rateMap.has(p.date)).length,
        0,
      ),
    },
  };
  const span = (Date.parse(last) - Date.parse(first)) / 86400000;
  if (
    rates.some(
      (r, i) =>
        i > 0 &&
        (Date.parse(r.date) - Date.parse(rates[i - 1].date)) / 86400000 > 7,
    ) ||
    (span >= 90 && (rates.length / span) * 365.25 < 180)
  )
    throw Error("共同日线存在过长缺口或过于稀疏，未换算；请补齐原始日线。");
  validateBacktestData(converted);
  return converted;
}
