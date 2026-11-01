export type BacktestStrategy = "buy-hold" | "dca" | "rebalance";
export const STRATEGIES: Record<BacktestStrategy, string> = {
  "buy-hold": "买入并持有",
  dca: "分批入场 · DCA",
  rebalance: "年度再平衡",
};
export type BacktestConfig = {
  version: 1;
  name: string;
  currency: "CAD" | "USD";
  start: string;
  end: string;
  initial: number;
  monthly: number;
  entryMonths: number;
  feeBps: number;
  cashRate: number;
  riskFree: number;
  dividends: "reinvest" | "cash";
  holdings: { symbol: string; weight: number }[];
  strategies: BacktestStrategy[];
  risk: {
    horizon: number;
    maxLoss: number;
    purpose: string;
    cadPerUnit: number;
  };
};
export type PricePoint = {
  date: string;
  close: number;
  dividend: number;
  split: number;
};
export type HistoricalAsset = {
  symbol: string;
  currency: "CAD" | "USD";
  basis: "raw" | "total-return" | "split-adjusted";
  dividendsKnown: boolean;
  source: string;
  points: PricePoint[];
};
export type BacktestData = {
  version: 1;
  capturedAt: string;
  synthetic: boolean;
  assets: HistoricalAsset[];
};
export type BacktestLab = {
  version: 1;
  saved: { id: string; at: string; config: BacktestConfig }[];
};
export const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,23}\.(US|TO)$/;
export const symbolIdentity = (symbol: string) =>
  symbol.slice(0, -3).replaceAll(".", "-") + symbol.slice(-3);
export function backtestToday(now = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((k) => p.find((v) => v.type === k)!.value)
    .join("-");
}
export const validDate = (s: unknown): s is string =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const between = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
export function validateBacktestConfig(
  raw: unknown,
): asserts raw is BacktestConfig {
  const c = raw as BacktestConfig;
  if (
    !c ||
    c.version !== 1 ||
    typeof c.name !== "string" ||
    !c.name.trim() ||
    c.name.length > 100 ||
    !["CAD", "USD"].includes(c.currency) ||
    !validDate(c.start) ||
    !validDate(c.end) ||
    c.start >= c.end ||
    c.start < "1970-01-01" ||
    !between(c.initial, 1, 1e9) ||
    !between(c.monthly, 0, 1e7) ||
    !Number.isInteger(c.entryMonths) ||
    !between(c.entryMonths, 1, 60) ||
    !between(c.feeBps, 0, 500) ||
    !between(c.cashRate, 0, 25) ||
    !between(c.riskFree, 0, 25) ||
    !["reinvest", "cash"].includes(c.dividends)
  )
    throw Error("请核对名称、日期、起始资金与回测假设。");
  if (
    !Array.isArray(c.holdings) ||
    !c.holdings.length ||
    c.holdings.length > 8 ||
    c.holdings.some(
      (h) => !h || !SYMBOL.test(h.symbol) || !between(h.weight, 0.01, 100),
    ) ||
    new Set(c.holdings.map((h) => symbolIdentity(h.symbol))).size !==
      c.holdings.length ||
    Math.abs(c.holdings.reduce((s, h) => s + h.weight, 0) - 100) > 0.00001
  )
    throw Error(
      "组合需包含1–8个唯一标的，权重合计必须为100%。代码使用 NVDA.US 或 ZSP.TO 格式。",
    );
  // The actual historical asset currency is checked by runBacktest. A listing
  // suffix cannot establish trading currency (e.g. USD-denominated TSX units).
  if (
    !Array.isArray(c.strategies) ||
    !c.strategies.length ||
    new Set(c.strategies).size !== c.strategies.length ||
    c.strategies.some((s) => !Object.hasOwn(STRATEGIES, s))
  )
    throw Error("请选择1–3项不同策略。");
  if (
    !c.risk ||
    !between(c.risk.horizon, 1, 60) ||
    !between(c.risk.maxLoss, 1, 100) ||
    typeof c.risk.purpose !== "string" ||
    c.risk.purpose.length > 300 ||
    !between(c.risk.cadPerUnit, 0.01, 100)
  )
    throw Error("请核对投资期限、可承受回撤及规划换算汇率。");
}
export function validateBacktestData(
  raw: unknown,
): asserts raw is BacktestData {
  const d = raw as BacktestData;
  if (
    !d ||
    d.version !== 1 ||
    typeof d.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(d.capturedAt)) ||
    typeof d.synthetic !== "boolean" ||
    !Array.isArray(d.assets) ||
    !d.assets.length ||
    d.assets.length > 8 ||
    new Set(d.assets.map((a) => a.symbol)).size !== d.assets.length
  )
    throw Error("历史数据包格式无效。");
  for (const a of d.assets) {
    if (
      !a ||
      !SYMBOL.test(a.symbol) ||
      !["CAD", "USD"].includes(a.currency) ||
      !["raw", "total-return", "split-adjusted"].includes(a.basis) ||
      typeof a.dividendsKnown !== "boolean" ||
      typeof a.source !== "string" ||
      !a.source ||
      a.source.length > 200 ||
      !Array.isArray(a.points) ||
      a.points.length < 2 ||
      a.points.length > 15000 ||
      (a.basis === "total-return" && a.dividendsKnown)
    )
      throw Error("标的历史或复权口径无效。");
    let prior = "";
    for (const p of a.points) {
      if (
        !p ||
        !validDate(p.date) ||
        p.date <= prior ||
        !between(p.close, 0.000001, 1e9) ||
        !between(p.dividend, 0, 1e7) ||
        !between(p.split, 0.000001, 100000) ||
        (a.basis !== "raw" && p.split !== 1) ||
        (a.basis === "total-return" && p.dividend !== 0)
      )
        throw Error(
          "价格必须按唯一日期升序排列，不能含零价、坏分红或重复复权。",
        );
      prior = p.date;
    }
  }
}
export function validBacktestLab(raw: unknown): raw is BacktestLab {
  try {
    const l = raw as BacktestLab;
    if (
      !l ||
      l.version !== 1 ||
      !Array.isArray(l.saved) ||
      l.saved.length > 12 ||
      new Set(l.saved.map((s) => s.id)).size !== l.saved.length
    )
      return false;
    for (const s of l.saved) {
      if (
        !s ||
        typeof s.id !== "string" ||
        !s.id ||
        s.id.length > 100 ||
        typeof s.at !== "string" ||
        !Number.isFinite(Date.parse(s.at))
      )
        return false;
      validateBacktestConfig(s.config);
    }
    return true;
  } catch {
    return false;
  }
}
export function defaultBacktest(end: string): BacktestConfig {
  return {
    version: 1,
    name: "我的长期组合",
    currency: "USD",
    start: "2007-01-01",
    end,
    initial: 30000,
    monthly: 500,
    entryMonths: 12,
    feeBps: 5,
    cashRate: 0,
    riskFree: 0,
    dividends: "reinvest",
    holdings: [
      { symbol: "SPY.US", weight: 70 },
      { symbol: "AGG.US", weight: 30 },
    ],
    strategies: ["buy-hold", "dca", "rebalance"],
    risk: {
      horizon: 10,
      maxLoss: 25,
      purpose: "长期家庭财富增长",
      cadPerUnit: 1,
    },
  };
}
