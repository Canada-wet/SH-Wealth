import { describe, it, expect } from "vitest";
import { runBacktest, moneyWeightedReturn } from "../lib/backtest";
import {
  defaultBacktest,
  backtestToday,
  validateBacktestConfig,
  validateBacktestData,
  validBacktestLab,
  type BacktestData,
} from "../lib/backtest-schema";
import {
  importBacktestCSV,
  readBacktestStudy,
  syntheticBacktest,
} from "../lib/backtest-import";
import {
  backtestHouseholdContext,
  changeBacktestLab,
  EMPTY_BACKTEST_LAB,
} from "../lib/backtest-context";
import { emptyState, finishChange, validateState } from "../lib/wealth";
import { connectionPlan, hasSavedData, stableJSON } from "../lib/cloud-plan";
import { mergeHouseholdAggregates } from "../lib/aggregate-merge";
const c = () => ({
  ...defaultBacktest("2020-01-06"),
  start: "2020-01-02",
  initial: 1000,
  monthly: 0,
  feeBps: 0,
  holdings: [{ symbol: "ABC.US", weight: 100 }],
});
function data(
  prices = [100, 100, 100],
  dates = ["2020-01-02", "2020-01-03", "2020-01-06"],
): BacktestData {
  return {
    version: 1,
    capturedAt: "2026-10-31T00:00:00Z",
    synthetic: false,
    assets: [
      {
        symbol: "ABC.US",
        currency: "USD",
        basis: "raw",
        dividendsKnown: true,
        source: "Synthetic test fixture",
        points: prices.map((close, i) => ({
          date: dates[i],
          close,
          split: 1,
          dividend: 0,
        })),
      },
    ],
  };
}
function weekdays(start: string, end: string) {
  const out = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86400000) {
    const d = new Date(t);
    if (![0, 6].includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
describe("资金流中和与组合记账", () => {
  it("平价无费用时收益、回撤、波动均为零，Sharpe不是无穷大", () => {
    for (const r of runBacktest(c(), data()).results) {
      expect(r.metrics.final).toBeCloseTo(1000);
      expect(r.metrics.twr).toBeCloseTo(0);
      expect(r.metrics.maxDrawdown).toBeCloseTo(0);
      expect(r.metrics.volatility).toBeCloseTo(0);
      expect(r.metrics.sharpe).toBeNull();
    }
  });
  it("每月投入相同，余额增长不是投资收益，DCA储备现金没有消失", () => {
    const dates = weekdays("2020-01-02", "2020-04-30"),
      config = { ...c(), end: "2020-04-30", monthly: 200 };
    const report = runBacktest(
      config,
      data(
        dates.map(() => 100),
        dates,
      ),
    );
    for (const r of report.results) {
      expect(r.metrics.invested).toBe(1600);
      expect(r.metrics.final).toBeCloseTo(1600);
      expect(r.metrics.twr).toBeCloseTo(0);
      expect(r.metrics.gain).toBeCloseTo(0);
    }
    expect(report.results[1].points[0].cash).toBeCloseTo((1000 * 11) / 12);
  });
  it("初始买入费用计入净值而不是被基准抹掉", () => {
    const r = runBacktest({ ...c(), feeBps: 100 }, data()).results[0];
    expect(r.metrics.final).toBeCloseTo(1000 / 1.01);
    expect(r.metrics.fees).toBeCloseTo(1000 - 1000 / 1.01);
    expect(r.metrics.twr).toBeCloseTo(1 / 1.01 - 1);
    expect(r.metrics.maxDrawdown).toBeLessThan(0);
  });
  it("2:1拆股调整份额，不误报50%崩盘", () => {
    const d = data([100, 50, 50]);
    d.assets[0].points[1].split = 2;
    const r = runBacktest(c(), d).results[0];
    expect(r.metrics.final).toBeCloseTo(1000);
    expect(r.metrics.maxDrawdown).toBeCloseTo(0);
  });
  it("除息日只给已有份额分红，新买入份额不重复领取", () => {
    const d = data([100, 99, 99]);
    d.assets[0].points[1].dividend = 1;
    const r = runBacktest(c(), d).results[0];
    expect(r.metrics.dividends).toBeCloseTo(10);
    expect(r.metrics.final).toBeCloseTo(1000);
    expect(r.metrics.twr).toBeCloseTo(0);
  });
  it("现金分红保留在账户内，再投资产生后续价格敞口", () => {
    const d = data([100, 99, 198]);
    d.assets[0].points[1].dividend = 1;
    const reinvest = runBacktest(c(), d).results[0],
      cash = runBacktest({ ...c(), dividends: "cash" }, d).results[0];
    expect(reinvest.metrics.final).toBeCloseTo(2000);
    expect(cash.metrics.final).toBeCloseTo(1990);
    expect(cash.points.at(-1)!.cash).toBeCloseTo(10);
  });
  it("总回报复权不重复加分红，也不允许假装提取未提供的分红", () => {
    const d = data([100, 101, 102]);
    d.assets[0] = {
      ...d.assets[0],
      basis: "total-return",
      dividendsKnown: false,
    };
    expect(runBacktest(c(), d).results[0].metrics.dividends).toBeNull();
    expect(() => runBacktest({ ...c(), dividends: "cash" }, d)).toThrow(/复权/);
    d.assets[0].points[1].dividend = 1;
    expect(() => validateBacktestData(d)).toThrow();
  });
  it("年度再平衡可卖出赢家买入落后者，未因逐项扣现而少买", () => {
    const dates = weekdays("2019-12-30", "2020-01-06"),
      d = data(
        dates.map((_, i) => (i < 2 ? 100 : 200)),
        dates,
      );
    d.assets.push({
      ...structuredClone(d.assets[0]),
      symbol: "XYZ.US",
      points: dates.map((date) => ({
        date,
        close: 100,
        dividend: 0,
        split: 1,
      })),
    });
    const r = runBacktest(
      {
        ...c(),
        start: dates[0],
        end: dates.at(-1)!,
        holdings: [
          { symbol: "ABC.US", weight: 50 },
          { symbol: "XYZ.US", weight: 50 },
        ],
      },
      d,
    ).results[2];
    expect(r.metrics.final).toBeCloseTo(1500);
    expect(r.points.at(-1)!.cash).toBeCloseTo(0);
    expect(r.metrics.trades).toBe(4);
  });
  it("完整现金流的XIRR已知例约10%", () => {
    expect(
      moneyWeightedReturn([
        { date: "2020-01-01", amount: -1000 },
        { date: "2021-01-01", amount: 1100 },
      ]),
    ).toBeCloseTo(0.1, 3);
    expect(
      moneyWeightedReturn([{ date: "2020-01-01", amount: -1000 }]),
    ).toBeNull();
  });
  it("峰谷与恢复使用中和后的净值，结束未恢复不显示零天", () => {
    const d = data([100, 80, 90]);
    const r = runBacktest(c(), d).results[0];
    expect(r.metrics.maxDrawdown).toBeCloseTo(-0.2);
    expect(r.metrics.peakDate).toBe("2020-01-02");
    expect(r.metrics.troughDate).toBe("2020-01-03");
    expect(r.metrics.recovery).toBeNull();
    expect(r.metrics.recoveryDays).toBeNull();
  });
  it("不改变输入，输出可以重现", () => {
    const config = c(),
      d = data([100, 90, 110]),
      before = JSON.stringify([config, d]);
    expect(runBacktest(config, d)).toEqual(runBacktest(config, d));
    expect(JSON.stringify([config, d])).toBe(before);
  });
});
describe("覆盖、频率与输入保护", () => {
  it("短区间和少样本明确警告，不将数日年化当成长期预期", () => {
    const r = runBacktest(c(), data());
    expect(r.warnings.join()).toMatch(/不足一年/);
    expect(r.warnings.join()).toMatch(/少于60/);
  });
  it("日期边界使用多伦多，而非UTC跨日的未来日期", () => {
    expect(backtestToday(new Date("2026-11-01T02:00:00Z"))).toBe("2026-10-31");
  });
  it.each([0, 99, 101])("拒绝权重合计%s", (weight) => {
    expect(() =>
      validateBacktestConfig({
        ...c(),
        holdings: [{ symbol: "ABC.US", weight }],
      }),
    ).toThrow();
  });
  it("以实际历史币种拒绝混币，不以交易所后缀猜测；不接受重复日期", () => {
    const foreign = data();
    foreign.assets[0].currency = "CAD";
    expect(() => runBacktest(c(), foreign)).toThrow(/币种/);
    expect(() =>
      validateBacktestConfig({
        ...c(),
        holdings: [{ symbol: "ZSP.U.TO", weight: 100 }],
      }),
    ).not.toThrow();
    const d = data();
    d.assets[0].points[1].date = d.assets[0].points[0].date;
    expect(() => validateBacktestData(d)).toThrow();
  });
  it("IPO区间统一截短并警告，缺失年份不补价格", () => {
    const r = runBacktest({ ...c(), start: "2000-01-01" }, data());
    expect(r.start).toBe("2020-01-02");
    expect(r.warnings.join()).toMatch(/实际使用/);
    expect(r.results[0].events.find((e) => e.id === "gfc")?.coverage).toBe(
      "none",
    );
  });
  it("内部交易日不一致拒绝，不能漏掉被交集筛除的公司行动", () => {
    const dates = weekdays("2020-01-02", "2020-01-10"),
      d = data(
        dates.map(() => 100),
        dates,
      );
    d.assets.push({
      ...structuredClone(d.assets[0]),
      symbol: "XYZ.US",
      points: d.assets[0].points.filter((_, i) => i !== 2),
    });
    expect(() =>
      runBacktest(
        {
          ...c(),
          end: dates.at(-1)!,
          holdings: [
            { symbol: "ABC.US", weight: 50 },
            { symbol: "XYZ.US", weight: 50 },
          ],
        },
        d,
      ),
    ).toThrow(/日期不一致/);
  });
  it("周线不能伪装成252日日线风险", () => {
    const dates = Array.from({ length: 40 }, (_, i) =>
      new Date(Date.parse("2020-01-01") + i * 7 * 86400000)
        .toISOString()
        .slice(0, 10),
    );
    expect(() =>
      runBacktest(
        { ...c(), start: dates[0], end: dates.at(-1)! },
        data(
          dates.map(() => 100),
          dates,
        ),
      ),
    ).toThrow(/稀疏/);
  });
  it("日线长缺口拒绝而不是自动填充", () => {
    expect(() =>
      runBacktest(
        { ...c(), end: "2020-02-01" },
        data([100, 100, 100], ["2020-01-02", "2020-01-03", "2020-02-01"]),
      ),
    ).toThrow(/缺口/);
  });
  it("历史事件完整、部分与未覆盖互不混淆", () => {
    const dates = weekdays("2022-01-01", "2022-12-31");
    const r = runBacktest(
      { ...c(), start: "2022-01-01", end: "2022-12-31" },
      data(
        dates.map(() => 100),
        dates,
      ),
    );
    expect(r.results[0].events.find((e) => e.id === "2022")?.coverage).toBe(
      "complete",
    );
    const p = runBacktest(
      { ...c(), start: "2022-06-01", end: "2022-12-31" },
      data(
        dates.map(() => 100),
        dates,
      ),
    );
    expect(p.results[0].events.find((e) => e.id === "2022")?.coverage).toBe(
      "partial",
    );
  });
});
describe("CSV与研究包", () => {
  it("解析BOM、CRLF、引号，并将日期排序", () => {
    const d = importBacktestCSV(
      '\uFEFFsymbol,date,close,dividend,split\r\n"ABC.US",2020-01-03,99,0,1\r\nABC.US,2020-01-02,100,0,1\r\n',
      "raw",
    );
    expect(d.assets[0].points[0].date).toBe("2020-01-02");
  });
  it("原始价缺分红拆股拒绝，空白不被猜成零", () => {
    expect(() =>
      importBacktestCSV("symbol,date,close\nABC.US,2020-01-02,100", "raw"),
    ).toThrow(/dividend/);
    expect(() =>
      importBacktestCSV(
        "symbol,date,close,dividend,split\nABC.US,2020-01-02,100,,1",
        "raw",
      ),
    ).toThrow(/空白/);
  });
  it("单标的Adj Close可以导入，但分红明细未知", () => {
    const d = importBacktestCSV(
      "Date,Adj Close\n2020-01-02,100\n2020-01-03,101",
      "total-return",
      "fixture",
      "ABC.US",
    );
    expect(d.assets[0].basis).toBe("total-return");
    expect(d.assets[0].dividendsKnown).toBe(false);
  });
  it.each(["=WEBSERVICE(1)", "NaN", "Infinity", "-1"])(
    "拒绝公式与无效价格%s",
    (bad) =>
      expect(() =>
        importBacktestCSV(
          `symbol,date,close,dividend,split\nABC.US,2020-01-02,${bad},0,1\nABC.US,2020-01-03,100,0,1`,
          "raw",
        ),
      ).toThrow(),
  );
  it("合成演示醒目标记，无真实证券代码，完整包导入重算一致", () => {
    const p = syntheticBacktest(),
      r = runBacktest(p.config, p.data);
    expect(r.synthetic).toBe(true);
    expect(r.warnings[0]).toMatch(/合成/);
    expect(p.config.holdings.every((h) => h.symbol.startsWith("DEMO"))).toBe(
      true,
    );
    const restored = readBacktestStudy(
      JSON.stringify({ format: "together-backtest-v1", ...p }),
    );
    expect(runBacktest(restored.config, restored.data)).toEqual(r);
  });
  it("坏研究包和重复列拒绝", () => {
    expect(() => readBacktestStudy('{"format":"other"}')).toThrow();
    expect(() =>
      importBacktestCSV(
        "date,date,close\n2020-01-02,2020-01-02,100",
        "split-adjusted",
        "fixture",
        "ABC.US",
      ),
    ).toThrow(/重复/);
  });
});
describe("家庭持久化与隐私", () => {
  it("保存计划不改账本或财务历史，但可被备份校验和云端识别", () => {
    const s = emptyState(),
      lab = {
        version: 1 as const,
        saved: [{ id: "plan", at: "2026-10-31T00:00:00Z", config: c() }],
      };
    expect(validBacktestLab(lab)).toBe(true);
    const next = finishChange(
      s,
      changeBacktestLab(s, stableJSON(EMPTY_BACKTEST_LAB), lab),
      "回测",
      false,
    );
    validateState(next);
    expect(next.assets).toEqual(s.assets);
    expect(next.history).toEqual(s.history);
    expect(hasSavedData(next)).toBe(true);
    expect(connectionPlan(next, null)).toBe("upload");
    expect(
      connectionPlan(next, {
        ...s,
        assets: [
          {
            id: "a",
            name: "test",
            owner: "joint",
            category: "现金",
            value: 1,
            annualReturn: null,
          },
        ],
      }),
    ).toBe("choice");
  });
  it("旧计划写入拒绝，市场与财务独立改动可三向合并", () => {
    const s = emptyState(),
      lab = {
        version: 1 as const,
        saved: [{ id: "plan", at: "2026-10-31T00:00:00Z", config: c() }],
      },
      next = changeBacktestLab(s, stableJSON(EMPTY_BACKTEST_LAB), lab);
    expect(() =>
      changeBacktestLab(
        next,
        stableJSON(EMPTY_BACKTEST_LAB),
        EMPTY_BACKTEST_LAB,
      ),
    ).toThrow(/变化/);
    const merged = mergeHouseholdAggregates(s, next, {
      ...s,
      goal: { ...s.goal, target: 5 },
    });
    expect(merged.status).toBe("merged");
    if (merged.status === "merged") {
      expect(merged.document.preferences.backtestLab).toEqual(lab);
      expect(merged.document.goal.target).toBe(5);
    }
  });
  it("家庭AI投影不包含姓名、逐项账户或聊天，缺预算不捏造结余", () => {
    const s = emptyState();
    s.members.first = "private-name";
    s.messages = [{ id: "m", role: "user", text: "private-chat" }];
    s.assets = [
      {
        id: "a",
        name: "private-account",
        owner: "first",
        category: "现金",
        value: 100,
        annualReturn: null,
      },
    ];
    const projected = backtestHouseholdContext(s);
    expect(JSON.stringify(projected)).not.toMatch(/private-/);
    expect(projected.monthlyBudgetSurplus).toBeNull();
    expect(projected.cashReference.amount).toBe(100);
  });
});
