import { it, expect } from "vitest";
import { defaultBacktest, type BacktestData } from "../lib/backtest-schema";
import {
  EMPTY_PORTFOLIO_SHELF,
  exportPortfolioShelf,
  readPortfolioShelf,
  runPortfolioComparison,
  validatePortfolioShelf,
  type PortfolioShelf,
} from "../lib/backtest-comparison";
function fixture(): PortfolioShelf {
  const points = [];
  for (
    let ms = Date.parse("2020-01-02"), i = 0;
    ms <= Date.parse("2020-04-01");
    ms += 86400000
  ) {
    const d = new Date(ms);
    if ([0, 6].includes(d.getUTCDay())) continue;
    points.push({
      date: d.toISOString().slice(0, 10),
      close: 100 + i++,
      dividend: 0,
      split: 1,
    });
  }
  const data: BacktestData = {
    version: 1,
    capturedAt: "2026-11-01T00:00:00Z",
    synthetic: true,
    assets: [
      {
        symbol: "TEST.US",
        currency: "USD",
        basis: "raw",
        dividendsKnown: true,
        source: "合成夹具",
        points,
      },
    ],
  };
  const c = {
    ...defaultBacktest("2020-04-01"),
    start: "2020-01-01",
    initial: 1000,
    monthly: 100,
    holdings: [{ symbol: "TEST.US", weight: 100 }],
  };
  const studies = [0, 1].map((i) => ({
    id: `s${i}`,
    title: `组合${i}`,
    at: "2026-11-01T00:00:00Z",
    config: { ...structuredClone(c), name: `方案${i}` },
    data: structuredClone(data),
  }));
  return {
    version: 1,
    studies,
    selected: ["s0", "s1"],
    baseline: "s0",
    strategy: "buy-hold",
  };
}
it("不同组合以同一策略和基准假设重算，原始快照不改写", () => {
  const s = fixture();
  Object.assign(s.studies[1].config, {
    initial: 90000,
    monthly: 900,
    feeBps: 200,
    cashRate: 12,
    riskFree: 10,
    entryMonths: 3,
  });
  const original = JSON.stringify(s);
  const r = runPortfolioComparison(s);
  expect(r.items).toHaveLength(2);
  expect(r.start).toBe("2020-01-02");
  const a = r.items[0].report,
    b = r.items[1].report;
  for (const key of [
    "initial",
    "monthly",
    "feeBps",
    "cashRate",
    "riskFree",
    "entryMonths",
  ] as const)
    expect(b.config[key]).toBe(a.config[key]);
  expect(b.results[0].metrics).toEqual(a.results[0].metrics);
  expect(a.results[0].metrics.invested).toBe(1300);
  expect(JSON.stringify(s)).toBe(original);
});
it("可以切换基准和DCA，且每组投入、日期和策略一致", () => {
  const s = fixture();
  s.baseline = "s1";
  s.strategy = "dca";
  s.studies[1].config.initial = 5000;
  s.studies[1].config.monthly = 250;
  const r = runPortfolioComparison(s);
  expect(
    r.items.every(
      (p) =>
        p.report.config.initial === 5000 &&
        p.report.config.monthly === 250 &&
        p.report.results[0].strategy === "dca",
    ),
  ).toBe(true);
  expect(r.items[0].report.results[0].points.map((p) => p.invested)).toEqual(
    r.items[1].report.results[0].points.map((p) => p.invested),
  );
});
it("共同窗口由最晚上市和最早结束共同决定，不能拿不同区间的旧回报直接比", () => {
  const s = fixture();
  s.studies[1].config.start = "2020-02-01";
  s.studies[1].data.assets[0].points =
    s.studies[1].data.assets[0].points.filter(
      (p) => p.date >= "2020-02-10" && p.date <= "2020-03-25",
    );
  const r = runPortfolioComparison(s);
  expect([r.start, r.end]).toEqual(["2020-02-10", "2020-03-25"]);
  expect(r.items[0].report.start).toBe(r.items[1].report.start);
  expect(r.warnings.join()).toMatch(/裁剪/);
});
it("区间内部少一个交易日也不能静默取交集掩盖缺价", () => {
  const s = fixture();
  s.studies[1].data.assets[0].points.splice(8, 1);
  expect(() => runPortfolioComparison(s)).toThrow(/交易日不一致/);
});
it("无重叠历史、未来价格与不足3日不制造结果", () => {
  const s = fixture();
  s.studies[1].config.start = "2021-01-01";
  s.studies[1].config.end = "2021-12-31";
  expect(() => runPortfolioComparison(s)).toThrow(/共同历史/);
  const future = fixture();
  future.studies[0].config.end = "2099-01-01";
  expect(() => runPortfolioComparison(future)).toThrow(/未来/);
  const short = fixture();
  short.studies.forEach(
    (p) => (p.data.assets[0].points = p.data.assets[0].points.slice(0, 2)),
  );
  expect(() => runPortfolioComparison(short)).toThrow(/至少需要3/);
});
it("不同币种和合成/真实混合拒绝，未勾选组合不参与运算", () => {
  const s = fixture();
  s.studies[1].data.synthetic = false;
  expect(() => runPortfolioComparison(s)).toThrow(/合成/);
  const mixed = fixture();
  mixed.studies[1].config.currency = "CAD";
  mixed.studies[1].config.holdings[0].symbol = "TEST.TO";
  mixed.studies[1].data.assets[0].symbol = "TEST.TO";
  mixed.studies[1].data.assets[0].currency = "CAD";
  expect(() => runPortfolioComparison(mixed)).toThrow(/币种/);
  const chosen = fixture();
  chosen.studies.push({
    ...structuredClone(chosen.studies[0]),
    id: "ignored",
    title: "not selected",
    data: { ...structuredClone(chosen.studies[0].data), synthetic: false },
  });
  expect(runPortfolioComparison(chosen).items).toHaveLength(2);
});
it("缺标的明确拒绝，不能从另一组合借价格掩盖来源", () => {
  const s = fixture();
  s.studies[1].config.holdings = [{ symbol: "MISSING.US", weight: 100 }];
  expect(() => runPortfolioComparison(s)).toThrow(/MISSING/);
});
it("含分红与不含分红不能混比，全部价格回报时明确标注", () => {
  const s = fixture();
  s.studies[0].data.assets[0].basis = "split-adjusted";
  s.studies[0].data.assets[0].dividendsKnown = false;
  expect(() => runPortfolioComparison(s)).toThrow(/数据口径/);
  s.studies[1].data.assets[0].basis = "split-adjusted";
  s.studies[1].data.assets[0].dividendsKnown = false;
  expect(runPortfolioComparison(s).warnings.join()).toMatch(/仅比较价格回报/);
});
it("完整原价与总回报复权可比，但复权不得用于现金分红模式", () => {
  const s = fixture();
  s.studies[1].data.assets[0].basis = "total-return";
  s.studies[1].data.assets[0].dividendsKnown = false;
  expect(
    runPortfolioComparison(s).items[1].report.results[0].metrics.dividends,
  ).toBeNull();
  s.studies[0].config.dividends = "cash";
  expect(() => runPortfolioComparison(s)).toThrow(/再投资/);
});
it("持仓差异确实改变指标，而不只是给同一条曲线换标签", () => {
  const s = fixture();
  s.studies[1].data.assets[0].points.forEach((p, i) => (p.close = 200 - i));
  const r = runPortfolioComparison(s);
  expect(r.items[0].report.results[0].metrics.cagr).toBeGreaterThan(0);
  expect(r.items[1].report.results[0].metrics.cagr).toBeLessThan(0);
  expect(r.items[1].report.results[0].metrics.maxDrawdown).toBeLessThan(
    r.items[0].report.results[0].metrics.maxDrawdown,
  );
});
it("选择至少两个、基准须参与、ID唯一、快照数量有界", () => {
  expect(() => validatePortfolioShelf(EMPTY_PORTFOLIO_SHELF)).not.toThrow();
  const s = fixture();
  s.selected = ["s0"];
  expect(() => runPortfolioComparison(s)).toThrow(/至少/);
  s.baseline = "s1";
  expect(() => validatePortfolioShelf(s)).toThrow(/基准/);
  const duplicate = fixture();
  duplicate.studies[1].id = "s0";
  expect(() => validatePortfolioShelf(duplicate)).toThrow(/唯一/);
  const many = fixture();
  many.studies.push(
    ...[2, 3, 4].map((i) => ({
      ...structuredClone(many.studies[0]),
      id: `x${i}`,
    })),
  );
  expect(() => validatePortfolioShelf(many)).toThrow(/最多/);
});
it("对照包导出/导入往返保留选择和历史，假指标不被信任", () => {
  const s = fixture(),
    text = exportPortfolioShelf(s);
  expect(readPortfolioShelf(text)).toEqual(s);
  const pack = JSON.parse(text);
  pack.results = { cagr: 999999 };
  const parsed = readPortfolioShelf(JSON.stringify(pack));
  expect(
    runPortfolioComparison(parsed).items[0].report.results[0].metrics.cagr,
  ).not.toBe(999999);
  expect(() => readPortfolioShelf('{"format":"other"}')).toThrow();
});
