import { it, expect, vi, afterEach } from "vitest";
import { historyRequest } from "../lib/backtest-history";
import {
  parseTiingoHistory,
  tiingoMetadata,
  tiingoSymbol,
} from "../lib/backtest-tiingo";
import {
  convertHistoryToBase,
  parseBankHistory,
  type HistoricalFx,
} from "../lib/backtest-fx";
import {
  defaultBacktest,
  validateBacktestData,
  type BacktestData,
} from "../lib/backtest-schema";
import { runBacktest } from "../lib/backtest";
const dates = ["2020-01-02", "2020-01-03", "2020-01-06"];
const data = (): BacktestData => ({
  version: 1,
  synthetic: false,
  capturedAt: "2026-11-01T12:00:00Z",
  assets: [
    {
      symbol: "VTV.US",
      currency: "USD",
      basis: "total-return",
      dividendsKnown: false,
      source: "Tiingo EOD test",
      points: dates.map((date, i) => ({
        date,
        close: 100 + i,
        dividend: 0,
        split: 1,
      })),
    },
    {
      symbol: "XCV.TO",
      currency: "CAD",
      basis: "total-return",
      dividendsKnown: false,
      source: "Yahoo test",
      points: dates.map((date, i) => ({
        date,
        close: 50 + i,
        dividend: 0,
        split: 1,
      })),
    },
  ],
});
const fx = (): HistoricalFx => ({
  source: "Bank of Canada FXUSDCAD",
  fetchedAt: "2026-11-01T12:00:00Z",
  points: dates.map((date, i) => ({ date, cadPerUsd: 1.3 + i * 0.01 })),
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("历史请求剥离家庭数据，拒绝未知供方而保留旧请求兼容", () => {
  const q = { symbols: ["VTV.US"], start: "2020-01-01", end: "2020-12-31" };
  expect(historyRequest({ ...q, provider: "auto", private: "no" })).toEqual({
    ...q,
    provider: "auto",
  });
  expect(historyRequest(q)).toEqual(q);
  expect(() =>
    historyRequest({ ...q, provider: "https://evil.example" }),
  ).toThrow();
});
it("Tiingo核对精确代码、美股交易所和日期；只接受完整复权总回报", () => {
  expect(tiingoSymbol("VTV.US")).toBe("vtv");
  expect(() => tiingoSymbol("XCV.TO")).toThrow();
  const m = {
    ticker: "VTV",
    name: "Vanguard Value ETF",
    exchangeCode: "NYSE ARCA",
    startDate: "2004-01-26",
    endDate: "2026-10-30",
  };
  expect(tiingoMetadata(m, "VTV.US").exchange).toBe("NYSE Arca");
  for (const bad of [
    { ...m, ticker: "AVUV" },
    { ...m, exchangeCode: "TSX" },
    { ...m, currency: "CAD" },
    { ...m, endDate: "bad" },
  ])
    expect(() => tiingoMetadata(bad, "VTV.US")).toThrow();
  const rows = dates.map((d, i) => ({
    date: `${d}T00:00:00.000Z`,
    close: 100 + i,
    adjClose: 90 + i,
    divCash: 5,
    splitFactor: 2,
  }));
  const a = parseTiingoHistory(rows, "VTV.US", dates[0], dates.at(-1)!);
  expect(a.basis).toBe("total-return");
  expect(a.points[0]).toEqual({
    date: dates[0],
    close: 90,
    dividend: 0,
    split: 1,
  });
  expect(a.dividendsKnown).toBe(false);
  for (const rowsBad of [
    [...rows, rows[0]],
    rows.map((r) => ({ ...r, adjClose: null })),
    rows.map((r) => ({ ...r, date: r.date.replace("00:00", "20:00") })),
    rows.slice(0, 1),
  ])
    expect(() =>
      parseTiingoHistory(rowsBad, "VTV.US", dates[0], dates.at(-1)!),
    ).toThrow();
});
it("BoC单位严格核对，缺测不被当零，反向或失配系列拒绝", () => {
  const raw = {
    seriesDetail: {
      FXUSDCAD: {
        label: "USD/CAD",
        metadata: { unit: "Canadian dollars per US dollar" },
      },
    },
    observations: dates.map((d) => ({ d, FXUSDCAD: { v: "1.35" } })),
  };
  expect(parseBankHistory(raw).points[0].cadPerUsd).toBe(1.35);
  expect(() =>
    parseBankHistory({
      ...raw,
      seriesDetail: { FXUSDCAD: { label: "CAD/USD" } },
    }),
  ).toThrow();
  expect(() =>
    parseBankHistory({
      ...raw,
      observations: raw.observations.map((x) => ({
        ...x,
        FXUSDCAD: { v: "bad" },
      })),
    }),
  ).toThrow();
});
it("混币真实总回报按逐日汇率换算，原数据不变，CAD/USD双向正确且可运行", () => {
  const d = data(),
    f = fx(),
    original = structuredClone(d);
  const cad = convertHistoryToBase(d, f, "CAD"),
    usd = convertHistoryToBase(d, f, "USD");
  expect(cad.assets[0].points[0].close).toBeCloseTo(130);
  expect(cad.assets[1].points[0].close).toBe(50);
  expect(usd.assets[1].points[0].close).toBeCloseTo(50 / 1.3);
  expect(usd.assets[0].points[0].close).toBe(100);
  expect(d).toEqual(original);
  const c = {
    ...defaultBacktest(dates.at(-1)!),
    currency: "CAD" as const,
    start: dates[0],
    holdings: [
      { symbol: "VTV.US", weight: 50 },
      { symbol: "XCV.TO", weight: 50 },
    ],
  };
  const r = runBacktest(c, cad);
  expect(r.results).toHaveLength(3);
  expect(r.warnings.join()).toContain("日均参考价");
  expect(cad.conversion?.native).toEqual({ "VTV.US": "USD", "XCV.TO": "CAD" });
  validateBacktestData(JSON.parse(JSON.stringify(cad)));
  expect(() => convertHistoryToBase(cad, f, "USD")).toThrow();
});
it("历史FX不使用未来观测、不用当前价补历史、拒绝raw/合成和无效汇率", () => {
  const d = data(),
    f = fx();
  f.points = [
    { date: "2020-01-01", cadPerUsd: 1.25 },
    { date: "2020-01-06", cadPerUsd: 1.4 },
  ];
  const c = convertHistoryToBase(d, f, "CAD");
  expect(c.assets[0].points[0].close).toBe(125);
  expect(c.conversion?.rates[0].rateDate).toBe("2020-01-01");
  for (const b of [
    { ...d, synthetic: true },
    { ...d, assets: d.assets.map((a) => ({ ...a, basis: "raw" as const })) },
  ])
    expect(() => convertHistoryToBase(b, f, "CAD")).toThrow();
  expect(() =>
    convertHistoryToBase(
      d,
      {
        ...f,
        points: [
          { date: "2026-10-29", cadPerUsd: 1.3 },
          { date: "2026-10-30", cadPerUsd: 1.3 },
        ],
      },
      "CAD",
    ),
  ).toThrow();
  const bad = structuredClone(c);
  bad.conversion!.rates[0].rateDate = "2099-01-01";
  expect(() => validateBacktestData(bad)).toThrow();
});
it("仅共同复权价格日对齐，边界缩短留痕，内部缺口不默默消失", () => {
  const d = data();
  d.assets[0].points.unshift({
    date: "2016-12-30",
    close: 90,
    dividend: 0,
    split: 1,
  });
  d.assets[0].points.splice(3, 0, {
    date: "2020-01-04",
    close: 101,
    dividend: 0,
    split: 1,
  });
  const c = convertHistoryToBase(d, fx(), "CAD");
  expect(c.conversion?.omitted).toBe(2);
  expect(c.assets[0].points.map((p) => p.date)).toEqual(dates);
  const f = fx();
  f.points = [
    { date: "2020-01-02", cadPerUsd: 1.3 },
    { date: "2020-01-13", cadPerUsd: 1.3 },
  ];
  const long = data();
  long.assets = long.assets.map((a) => ({
    ...a,
    points: [
      ...a.points,
      { date: "2020-01-10", close: 100, dividend: 0, split: 1 },
      { date: "2020-01-13", close: 100, dividend: 0, split: 1 },
    ],
  }));
  expect(() => convertHistoryToBase(long, f, "CAD")).toThrow(/缺失/);
});
