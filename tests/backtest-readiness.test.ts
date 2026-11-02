import { expect, it } from "vitest";
import { backtestReadiness, holdingIssues } from "../lib/backtest-readiness";
import { defaultBacktest, type BacktestData } from "../lib/backtest-schema";
const config = {
  ...defaultBacktest("2020-01-06"),
  start: "2020-01-02",
  holdings: [{ symbol: "XCV.TO", weight: 100 }],
  currency: "CAD" as const,
};
const data: BacktestData = {
  version: 1,
  capturedAt: new Date().toISOString(),
  synthetic: false,
  assets: [
    {
      symbol: "XCV.TO",
      currency: "CAD",
      basis: "total-return",
      dividendsKnown: false,
      source: "Fixture",
      points: ["2020-01-02", "2020-01-03", "2020-01-06"].map((date) => ({
        date,
        close: 100,
        dividend: 0,
        split: 1,
      })),
    },
  ],
};
it("明确区分未载入与供应商没有数据，不允许旧行情用于新持仓", () => {
  expect(backtestReadiness(config, null)).toMatchObject({
    ready: false,
    missing: ["XCV.TO"],
  });
  expect(backtestReadiness(config, null).issues.join()).toMatch(
    /不代表数据源没有/,
  );
  expect(backtestReadiness(config, data).ready).toBe(true);
  expect(
    backtestReadiness(
      { ...config, holdings: [{ symbol: "VTV.US", weight: 100 }] },
      data,
    ),
  ).toMatchObject({ ready: false, missing: ["VTV.US"] });
});
it("币种、分红口径和共同区间不合适时不能运行", () => {
  expect(
    backtestReadiness({ ...config, currency: "USD" }, data).issues.join(),
  ).toMatch(/币种/);
  expect(
    backtestReadiness({ ...config, dividends: "cash" }, data).issues.join(),
  ).toMatch(/再投资/);
  expect(
    backtestReadiness(
      { ...config, start: "2021-01-01", end: "2021-12-31" },
      data,
    ).issues.join(),
  ).toMatch(/共同日线不足/);
});
it("构建时空代码、空权重、NaN、重复别名和权重和都有清晰提示", () => {
  expect(holdingIssues([{ symbol: "", weight: NaN }]).join()).toMatch(
    /尚未选择.*权重须.*100%/,
  );
  expect(
    holdingIssues([
      { symbol: "BRK.B.US", weight: 50 },
      { symbol: "BRK-B.US", weight: 50 },
    ]).join(),
  ).toMatch(/重复/);
  expect(holdingIssues([{ symbol: "XCV.TO", weight: 100 }])).toEqual([]);
});
