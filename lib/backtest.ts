import {
  STRATEGIES,
  validateBacktestConfig,
  validateBacktestData,
  type BacktestConfig,
  type BacktestData,
  type BacktestStrategy,
  type HistoricalAsset,
} from "./backtest-schema";
import { BACKTEST_EVENTS } from "./backtest-events";

export type BacktestPoint = {
  date: string;
  value: number;
  invested: number;
  nav: number;
  drawdown: number;
  cash: number;
};
export type BacktestResult = {
  strategy: BacktestStrategy;
  label: string;
  points: BacktestPoint[];
  metrics: {
    final: number;
    invested: number;
    gain: number;
    twr: number;
    cagr: number | null;
    xirr: number | null;
    maxDrawdown: number;
    volatility: number | null;
    sharpe: number | null;
    dividends: number | null;
    cashInterest: number;
    fees: number;
    trades: number;
    recovery: string | null;
    peakDate: string;
    troughDate: string;
    recoveryDays: number | null;
  };
  years: { year: string; return: number; endValue: number }[];
  events: {
    id: string;
    coverage: "complete" | "partial" | "none";
    start: string | null;
    end: string | null;
    return: number | null;
    drawdown: number | null;
  }[];
};
export type BacktestReport = {
  config: BacktestConfig;
  start: string;
  end: string;
  observations: number;
  synthetic: boolean;
  warnings: string[];
  sources: { symbol: string; source: string; basis: string }[];
  results: BacktestResult[];
};
const days = (a: string, b: string) =>
  (Date.parse(b) - Date.parse(a)) / 86400000;
export function moneyWeightedReturn(
  flows: { date: string; amount: number }[],
): number | null {
  if (
    flows.length < 2 ||
    !flows.some((f) => f.amount < 0) ||
    !flows.some((f) => f.amount > 0)
  )
    return null;
  const start = flows[0].date;
  const f = (log: number) =>
    flows.reduce(
      (s, v) => s + v.amount * Math.exp((-log * days(start, v.date)) / 365.25),
      0,
    );
  let lo = -14,
    hi = 20;
  if (
    !Number.isFinite(f(lo)) ||
    f(lo) * f(hi) > 0 ||
    days(start, flows.at(-1)!.date) <= 0
  )
    return null;
  for (let i = 0; i < 150; i++) {
    const m = (lo + hi) / 2;
    if (f(m) > 0) lo = m;
    else hi = m;
  }
  const rate = Math.expm1((lo + hi) / 2);
  return Number.isFinite(rate) ? rate : null;
}
function drawdown(values: { date: string; nav: number }[], initial?: number) {
  let peak = initial ?? values[0].nav,
    peakDate = values[0].date,
    worst = 0,
    top = peakDate,
    bottom = peakDate,
    peakAtWorst = peak;
  const curve = values.map((p) => {
    if (p.nav >= peak) {
      peak = p.nav;
      peakDate = p.date;
    }
    const loss = p.nav / peak - 1;
    if (loss < worst) {
      worst = loss;
      top = peakDate;
      bottom = p.date;
      peakAtWorst = peak;
    }
    return loss;
  });
  const recovery =
    worst < 0
      ? (values.find((p) => p.date > bottom && p.nav >= peakAtWorst)?.date ??
        null)
      : values[0].date;
  return {
    curve,
    worst,
    peakDate: top,
    troughDate: bottom,
    recovery,
    recoveryDays: recovery ? days(top, recovery) : null,
  };
}
function simulate(
  c: BacktestConfig,
  assets: HistoricalAsset[],
  dates: string[],
  strategy: BacktestStrategy,
): BacktestResult {
  const maps = assets.map((a) => new Map(a.points.map((p) => [p.date, p])));
  const shares = assets.map(() => 0),
    fee = c.feeBps / 10000;
  const weights = c.holdings.map((h) => h.weight / 100);
  let cash = c.initial,
    units = c.initial / 100,
    contributed = c.initial,
    fees = 0,
    dividends = 0,
    interest = 0,
    trades = 0,
    installment = 0;
  const points: BacktestPoint[] = [],
    returns: number[] = [];
  const flows = [{ date: dates[0], amount: -c.initial }];
  const knownDividends = assets.every((a) => a.dividendsKnown);
  if (c.dividends === "cash" && assets.some((a) => a.basis === "total-return"))
    throw Error(
      "含分红复权价格只能用于再投资口径；不能再把分红提为现金或重复相加。",
    );
  const trade = (i: number, budget: number, price: number) => {
    if (budget <= 1e-8) return;
    const gross = budget / (1 + fee);
    shares[i] += gross / price;
    cash -= budget;
    fees += budget - gross;
    trades++;
  };
  for (let t = 0; t < dates.length; t++) {
    const date = dates[t],
      prices = maps.map((m) => m.get(date)!);
    const first = t === 0,
      monthly = first || date.slice(0, 7) !== dates[t - 1].slice(0, 7);
    let received = 0;
    if (!first) {
      const earned =
        cash *
        (Math.pow(1 + c.cashRate / 100, days(dates[t - 1], date) / 365.25) - 1);
      cash += earned;
      interest += earned;
      for (let i = 0; i < assets.length; i++) {
        shares[i] *= prices[i].split;
        const d = shares[i] * prices[i].dividend;
        received += d;
        dividends += d;
      }
      cash += received;
    }
    const beforeFlow =
      cash + shares.reduce((s, q, i) => s + q * prices[i].close, 0);
    const flow = !first && monthly ? c.monthly : 0;
    if (flow) {
      if (!(beforeFlow > 0))
        throw Error("组合价值无法支持现金流中和，请核对价格数据。");
      units += flow / (beforeFlow / units);
      cash += flow;
      contributed += flow;
      flows.push({ date, amount: -flow });
    }
    let budget = flow + (c.dividends === "reinvest" ? received : 0);
    if (strategy === "dca" && monthly && installment < c.entryMonths) {
      budget += c.initial / c.entryMonths;
      installment++;
    } else if (first && strategy !== "dca") budget += c.initial;
    if (
      strategy === "rebalance" &&
      !first &&
      date.slice(0, 4) !== dates[t - 1].slice(0, 4)
    ) {
      const held = shares.reduce((s, q, i) => s + q * prices[i].close, 0),
        target = held + budget;
      let available = budget;
      for (let i = 0; i < assets.length; i++) {
        const sale = Math.max(
          0,
          shares[i] * prices[i].close - target * weights[i],
        );
        if (sale > 1e-8) {
          shares[i] -= sale / prices[i].close;
          cash += sale * (1 - fee);
          available += sale * (1 - fee);
          fees += sale * fee;
          trades++;
        }
      }
      const needs = shares.map((q, i) =>
        Math.max(0, target * weights[i] - q * prices[i].close),
      );
      const total = needs.reduce((a, b) => a + b, 0);
      const buyBudget = Math.min(available, cash);
      if (total > 0)
        needs.forEach((n, i) =>
          trade(i, (buyBudget * n) / total, prices[i].close),
        );
    } else {
      budget = Math.min(cash, budget);
      weights.forEach((w, i) => trade(i, budget * w, prices[i].close));
    }
    const value = cash + shares.reduce((s, q, i) => s + q * prices[i].close, 0),
      nav = value / units;
    if (!Number.isFinite(value) || cash < -0.001 || value <= 0)
      throw Error("回测出现无效余额，请核对输入。");
    if (t) returns.push(nav / points[t - 1].nav - 1);
    points.push({
      date,
      value,
      invested: contributed,
      nav,
      drawdown: 0,
      cash: Math.max(0, cash),
    });
  }
  const dd = drawdown(points, 100);
  points.forEach((p, i) => (p.drawdown = dd.curve[i]));
  const last = points.at(-1)!,
    years = days(dates[0], last.date) / 365.25;
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const deviation =
    returns.length > 1
      ? Math.sqrt(
          returns.reduce((s, r) => s + (r - mean) ** 2, 0) /
            (returns.length - 1),
        )
      : null;
  const finite = (n: number) => (Number.isFinite(n) ? n : null);
  const volatility =
    deviation === null ? null : finite(deviation * Math.sqrt(252));
  const dailyRf = Math.pow(1 + c.riskFree / 100, 1 / 252) - 1;
  const yearly: BacktestResult["years"] = [];
  let previous = 100;
  for (let i = 0; i < points.length; i++)
    if (
      i === points.length - 1 ||
      points[i + 1].date.slice(0, 4) !== points[i].date.slice(0, 4)
    ) {
      const p = points[i];
      yearly.push({
        year: p.date.slice(0, 4),
        return: p.nav / previous - 1,
        endValue: p.value,
      });
      previous = p.nav;
    }
  return {
    strategy,
    label: STRATEGIES[strategy],
    points,
    years: yearly,
    metrics: {
      final: last.value,
      invested: contributed,
      gain: last.value - contributed,
      twr: last.nav / 100 - 1,
      cagr: finite(Math.pow(last.nav / 100, 1 / years) - 1),
      xirr: moneyWeightedReturn([
        ...flows,
        { date: last.date, amount: last.value },
      ]),
      maxDrawdown: dd.worst,
      volatility,
      sharpe:
        deviation && deviation > 1e-12
          ? finite(((mean - dailyRf) / deviation) * Math.sqrt(252))
          : null,
      dividends: knownDividends ? dividends : null,
      cashInterest: interest,
      fees,
      trades,
      recovery: dd.recovery,
      peakDate: dd.peakDate,
      troughDate: dd.troughDate,
      recoveryDays: dd.recoveryDays,
    },
    events: BACKTEST_EVENTS.map((e) => {
      const subset = points.filter((p) => p.date >= e.start && p.date <= e.end);
      const coverage =
        last.date < e.start || dates[0] > e.end
          ? "none"
          : c.start <= e.start &&
              c.end >= e.end &&
              days(e.start, dates[0]) <= 7 &&
              days(last.date, e.end) <= 7
            ? "complete"
            : "partial";
      const before = points.filter((p) => p.date < e.start).at(-1);
      const window = before ? [before, ...subset] : subset;
      return {
        id: e.id,
        coverage,
        start: window[0]?.date ?? null,
        end: window.at(-1)?.date ?? null,
        return:
          window.length > 1 ? window.at(-1)!.nav / window[0].nav - 1 : null,
        drawdown: window.length > 1 ? drawdown(window).worst : null,
      };
    }),
  };
}
export function runBacktest(
  config: BacktestConfig,
  data: BacktestData,
): BacktestReport {
  validateBacktestConfig(config);
  validateBacktestData(data);
  const assets = config.holdings.map((h) => {
    const a = data.assets.find((a) => a.symbol === h.symbol);
    if (!a)
      throw Error(
        `尚未载入 ${h.symbol} 的历史数据，请先获取并采用当前组合行情；这不代表供应商没有这只证券。`,
      );
    if (a.currency !== config.currency)
      throw Error("价格币种与组合不一致，不能忽略汇率直接相加。");
    return a;
  });
  const dateSets = assets.map((a) => new Set(a.points.map((p) => p.date)));
  const dates = assets[0].points
    .map((p) => p.date)
    .filter(
      (d) =>
        d >= config.start && d <= config.end && dateSets.every((s) => s.has(d)),
    );
  if (dates.length < 3 || days(dates[0], dates.at(-1)!) < 2)
    throw Error(
      "共同有效日期不足，至少需要3个日线观测；不会填补上市前价格或缺失数据。",
    );
  if (dates.some((d, i) => i > 0 && days(dates[i - 1], d) > 7))
    throw Error(
      "共同价格存在超过7天的缺口；请补齐日线数据，不能按完整日频计算风险。",
    );
  const span = days(dates[0], dates.at(-1)!);
  if (span >= 90 && (dates.length / span) * 365.25 < 180)
    throw Error("数据过于稀疏，疑似周线或月线；风险指标需要日线数据。");
  const common = new Set(dates);
  if (
    assets.some((a) =>
      a.points.some(
        (p) =>
          p.date >= dates[0] && p.date <= dates.at(-1)! && !common.has(p.date),
      ),
    )
  )
    throw Error(
      "标的交易日期不一致；请补齐区间内缺失的日线，避免遗漏分红或拆股。不会默默前填。",
    );
  const warnings = [
    "历史不代表未来；当前所选证券存在幸存者偏差，事件窗口是事后标注，不作为交易信号。",
    "假定可买碎股、收盘成交；费率为单边交易费与滑点合计，不含税费、外汇点差或已含在基金价格中的管理费。",
    "月供在每月首个共同交易日收盘加入；DCA分批部署原有本金，三种策略的外部现金流完全相同。",
    "分红在除息日按已有份额记账并可当日再投资，不模拟实际支付日、预扣税、结算与融资。",
  ];
  if (data.synthetic)
    warnings.unshift(
      "合成演示数据：用于体验和验证算法，不是真实市场，不可用于投资结论。",
    );
  if (days(config.start, dates[0]) > 7 || days(dates.at(-1)!, config.end) > 7)
    warnings.push(
      `请求区间未完整覆盖；实际使用 ${dates[0]} 至 ${dates.at(-1)}，所有策略统一缩短，不回填价格。`,
    );
  if (days(dates[0], dates.at(-1)!) < 365)
    warnings.push("区间不足一年，年化指标易被放大，不宜作为长期收益预期。");
  if (dates.length < 60)
    warnings.push("样本少于60个日线，波动率、Sharpe及事件抗风险结论极不稳定。");
  if (assets.some((a) => !a.dividendsKnown))
    warnings.push(
      "部分数据未提供独立分红明细：累计分红显示未知。仅价格复权数据不含分红；总回报复权数据已含分红，均不再重复加计。",
    );
  return {
    config: structuredClone(config),
    start: dates[0],
    end: dates.at(-1)!,
    observations: dates.length,
    synthetic: data.synthetic,
    warnings,
    sources: assets.map((a) => ({
      symbol: a.symbol,
      source: a.source,
      basis: a.basis,
    })),
    results: config.strategies.map((s) => simulate(config, assets, dates, s)),
  };
}
