import { expect, it } from "vitest";
import type { MarketReading } from "../lib/market";
import { TREASURIES } from "../lib/market";
import {
  readingChange,
  alignedSpread,
  commonCurve,
  payrollAverage,
  alignedHistory,
  formatPeriod,
  previousPeriod,
} from "../lib/market-analysis";
const row = (changes: Partial<MarketReading> = {}): MarketReading => ({
  id: "CPIAUCNS",
  label: "Synthetic CPI",
  value: 3,
  date: "2026-09-01",
  unit: "%",
  frequency: "monthly",
  source: "https://fred.stlouisfed.org/series/CPIAUCNS",
  trend: [
    { date: "2026-08-01", value: 2.8 },
    { date: "2026-09-01", value: 3 },
  ],
  ...changes,
});
it("通胀与GDP变动用百分点，不当成百分比涨幅", () => {
  expect(readingChange(row())?.value).toBeCloseTo(0.2);
  expect(readingChange(row())?.unit).toBe("百分点");
  expect(
    readingChange(
      row({
        frequency: "quarterly",
        date: "2026-04-01",
        value: 2.2,
        trend: [{ date: "2026-01-01", value: 1.8 }],
      }),
    )?.value,
  ).toBeCloseTo(0.4);
});
it("月度/季度缺少相邻前期时不拿旧值充当上期", () => {
  expect(
    readingChange(
      row({ previous: 2.5, trend: [{ date: "2026-07-01", value: 2.5 }] }),
    ),
  ).toBeNull();
  expect(
    readingChange(
      row({
        frequency: "quarterly",
        date: "2026-04-01",
        trend: [{ date: "2025-10-01", value: 2 }],
      }),
    ),
  ).toBeNull();
});
it("外汇用相对百分比，日频按前一个有效观测，不把假期缺值补零", () => {
  const change = readingChange(
    row({
      unit: " / CAD",
      frequency: "daily",
      date: "2026-10-13",
      value: 5.1,
      trend: [{ date: "2026-10-09", value: 5 }],
    }),
  );
  expect(change?.value).toBeCloseTo(2);
  expect(change?.unit).toBe("%");
  expect(change?.date).toBe("2026-10-09");
});
it("期限利差只在同日值齐全时计算基点，零与倒挂均有效", () => {
  const rows = [
    row({ id: "DGS10", date: "2026-10-13", value: 4 }),
    row({ id: "DGS2", date: "2026-10-13", value: 4.2 }),
  ];
  expect(alignedSpread(rows, "DGS10", "DGS2")?.value).toBeCloseTo(-20);
  rows[1].date = "2026-10-09";
  expect(alignedSpread(rows, "DGS10", "DGS2")).toBeNull();
});
it("曲线使用六个期限共同日期，比较前20个共同观测而不是伪造一月前", () => {
  const rows = TREASURIES.map(([id, label], i) =>
    row({
      id,
      label,
      frequency: "daily",
      date: "2026-09-22",
      value: 4 + i / 10,
      trend: Array.from({ length: 22 }, (_, n) => ({
        date: `2026-09-${String(n + 1).padStart(2, "0")}`,
        value: 3 + i / 10 + n / 100,
      })),
    }),
  );
  expect(commonCurve(rows)?.date).toBe("2026-09-22");
  expect(commonCurve(rows, 20)?.date).toBe("2026-09-02");
  rows[5].trend = [];
  expect(commonCurve(rows, 20)).toBeNull();
  expect(commonCurve(rows.slice(0, 5))).toBeNull();
});
it("非农三月均值要求三个连续月份，缺月不估算", () => {
  const jobs = row({
    id: "PAYEMS",
    unit: "千人",
    value: 30,
    trend: [
      { date: "2026-07-01", value: 90 },
      { date: "2026-08-01", value: 60 },
    ],
  });
  expect(payrollAverage(jobs)).toBe(60);
  jobs.trend.pop();
  expect(payrollAverage(jobs)).toBeNull();
  expect(payrollAverage(row())).toBeNull();
});
it("通胀双线仅使用共同月份；窗口不越界、不补缺失月份", () => {
  expect(
    alignedHistory(
      [
        row(),
        row({ id: "CPILFENS", trend: [{ date: "2026-09-01", value: 3.2 }] }),
      ],
      12,
    ),
  ).toEqual([{ date: "2026-09-01", values: [3, 3.2] }]);
  expect(alignedHistory([row()], 7)).toEqual([]);
});
it("统计期间与跨年相邻月正确，未知值不伪造日期", () => {
  expect(previousPeriod("2026-01-01", 1)).toBe("2025-12-01");
  expect(previousPeriod("2026-13-01", 1)).toBeNull();
  expect(
    formatPeriod(row({ frequency: "quarterly", date: "2026-04-01" })),
  ).toBe("2026 Q2");
  expect(formatPeriod(row({ date: null }))).toBe("期间未知");
  expect(readingChange(row({ value: null }))).toBeNull();
});
