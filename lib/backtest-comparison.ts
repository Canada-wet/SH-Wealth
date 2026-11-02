import { runBacktest, type BacktestReport } from "./backtest";
import {
  backtestToday,
  STRATEGIES,
  validateBacktestConfig,
  validateBacktestData,
  type BacktestConfig,
  type BacktestData,
  type BacktestStrategy,
} from "./backtest-schema";

export type PortfolioStudy = {
  id: string;
  title: string;
  at: string;
  config: BacktestConfig;
  data: BacktestData;
  origin?: { planId: string; savedAt: string; configKey: string };
};
export type PortfolioShelf = {
  version: 1;
  studies: PortfolioStudy[];
  selected: string[];
  baseline: string;
  strategy: BacktestStrategy;
  collection?: { ids: string[]; baseline: string };
};
export const EMPTY_PORTFOLIO_SHELF: PortfolioShelf = {
  version: 1,
  studies: [],
  selected: [],
  baseline: "",
  strategy: "buy-hold",
};
export function validatePortfolioShelf(
  raw: unknown,
): asserts raw is PortfolioShelf {
  const s = raw as PortfolioShelf;
  if (
    !s ||
    s.version !== 1 ||
    !Array.isArray(s.studies) ||
    s.studies.length > 4 ||
    !Array.isArray(s.selected) ||
    new Set(s.selected).size !== s.selected.length ||
    !Object.hasOwn(STRATEGIES, s.strategy)
  )
    throw Error("组合对照格式无效，最多保留4个组合快照。");
  const ids = new Set<string>();
  let observations = 0;
  for (const p of s.studies) {
    if (
      !p ||
      typeof p.id !== "string" ||
      !p.id ||
      p.id.length > 100 ||
      ids.has(p.id) ||
      typeof p.title !== "string" ||
      !p.title.trim() ||
      p.title.length > 100 ||
      typeof p.at !== "string" ||
      !Number.isFinite(Date.parse(p.at))
    )
      throw Error("请核对组合名称、唯一编号与保存时间。");
    ids.add(p.id);
    validateBacktestConfig(p.config);
    validateBacktestData(p.data);
    if (
      p.origin &&
      (typeof p.origin.planId !== "string" ||
        !p.origin.planId ||
        p.origin.planId.length > 100 ||
        typeof p.origin.savedAt !== "string" ||
        !Number.isFinite(Date.parse(p.origin.savedAt)) ||
        typeof p.origin.configKey !== "string" ||
        p.origin.configKey.length > 6000)
    )
      throw Error("组合库来源记录无效。");
    observations += p.data.assets.reduce((n, a) => n + a.points.length, 0);
  }
  if (observations > 240000)
    throw Error("对照历史过大，请缩短日期或减少快照后重试。");
  if (s.collection) {
    const c = s.collection;
    if (
      !Array.isArray(c.ids) ||
      c.ids.length > 4 ||
      new Set(c.ids).size !== c.ids.length ||
      c.ids.some((id) => typeof id !== "string" || !id || id.length > 100) ||
      (c.ids.length ? !c.ids.includes(c.baseline) : c.baseline !== "")
    )
      throw Error("请从组合库选择最多4个唯一组合，基准须在所选组合中。");
  }
  if (
    s.selected.some((id) => !ids.has(id)) ||
    (s.selected.length ? !s.selected.includes(s.baseline) : s.baseline !== "")
  )
    throw Error("基准必须是已勾选的组合。");
}
export type PortfolioComparison = {
  start: string;
  end: string;
  observations: number;
  currency: "CAD" | "USD";
  baseline: string;
  strategy: BacktestStrategy;
  synthetic: boolean;
  warnings: string[];
  items: { id: string; title: string; report: BacktestReport }[];
};
export function runPortfolioComparison(
  shelf: PortfolioShelf,
): PortfolioComparison {
  validatePortfolioShelf(shelf);
  const selected = shelf.studies.filter((p) => shelf.selected.includes(p.id));
  if (selected.length < 2) throw Error("请至少勾选两个组合，再运行对照。");
  const base = selected.find((p) => p.id === shelf.baseline)!;
  if (selected.some((p) => p.config.currency !== base.config.currency))
    throw Error(
      "组合币种不同，不能忽略历史汇率直接比较；请分别对照USD或CAD组合。",
    );
  if (new Set(selected.map((p) => p.data.synthetic)).size !== 1)
    throw Error("不能混合真实历史与合成演示，请取消勾选其中一类。");
  const assets = selected.flatMap((p) =>
    p.config.holdings.map((h) => {
      const a = p.data.assets.find((a) => a.symbol === h.symbol);
      if (!a)
        throw Error(
          `${p.title} 缺少 ${h.symbol} 的历史，请回工作台补齐后重新加入。`,
        );
      if (a.currency !== base.config.currency)
        throw Error("持仓历史币种与组合不一致。");
      return a;
    }),
  );
  const returnTypes = new Set(
    assets.map((a) =>
      a.basis === "total-return" || a.dividendsKnown ? "total" : "price",
    ),
  );
  if (returnTypes.size > 1)
    throw Error(
      "不能将不含分红的价格回报与含分红总回报直接比较，请统一数据口径。",
    );
  const cutoff = backtestToday();
  if (
    selected.some((p) => p.config.end > cutoff) ||
    assets.some((a) => a.points.some((p) => p.date > cutoff))
  )
    throw Error("对照不能包含未来日期或未来价格。");
  const start = [
    ...selected.map((p) => p.config.start),
    ...assets.map((a) => a.points[0].date),
  ]
    .sort()
    .at(-1)!;
  const end = [
    ...selected.map((p) => p.config.end),
    ...assets.map((a) => a.points.at(-1)!.date),
  ].sort()[0];
  if (start >= end)
    throw Error("这些组合没有足够的共同历史区间，不能拼接不同年份的结果。");
  const dates = assets[0].points
    .filter((p) => p.date >= start && p.date <= end)
    .map((p) => p.date);
  // Do not intersect away internal missing days: this can conceal a crash or a distribution.
  if (
    assets.some((a) => {
      const ds = a.points
        .filter((p) => p.date >= start && p.date <= end)
        .map((p) => p.date);
      return ds.length !== dates.length || ds.some((d, i) => d !== dates[i]);
    })
  )
    throw Error(
      "组合间区间内的有效交易日不一致，请补齐日线；不会静默删掉缺失日期或前填价格。",
    );
  const items = selected.map((p) => {
    const normalized: BacktestConfig = {
      ...structuredClone(p.config),
      start,
      end,
      strategies: [shelf.strategy],
      initial: base.config.initial,
      monthly: base.config.monthly,
      entryMonths: base.config.entryMonths,
      feeBps: base.config.feeBps,
      cashRate: base.config.cashRate,
      riskFree: base.config.riskFree,
      dividends: base.config.dividends,
    };
    return {
      id: p.id,
      title: p.title,
      report: runBacktest(normalized, p.data),
    };
  });
  const warnings = [
    `统一采用「${base.title}」的起始资金、月供、DCA入场月数、交易费率、现金利率、无风险利率与分红假设；原组合快照不变。`,
    "共同区间由全部所选组合和持仓的可用历史共同决定，所有组合重新计算；不是直接比较原来的独立回测。历史相对表现不是未来优胜保证。",
  ];
  if (selected.some((p) => p.config.start !== start || p.config.end !== end))
    warnings.push(`为公平对照，统一裁剪到 ${start} — ${end}，不补上市前价格。`);
  if (returnTypes.has("price"))
    warnings.push("此次仅比较价格回报，缺少分红，不是总回报比较。");
  for (const w of items[0].report.warnings.filter((w) =>
    /不足一年|少于60|历史汇率换算|共同总回报日历/.test(w),
  ))
    warnings.push(w);
  return {
    start: items[0].report.start,
    end: items[0].report.end,
    observations: items[0].report.observations,
    currency: base.config.currency,
    baseline: base.id,
    strategy: shelf.strategy,
    synthetic: base.data.synthetic,
    warnings,
    items,
  };
}
export function exportPortfolioShelf(shelf: PortfolioShelf) {
  validatePortfolioShelf(shelf);
  const text = JSON.stringify(
    { format: "together-portfolio-comparison-v1", shelf },
    null,
    2,
  );
  if (new TextEncoder().encode(text).length > 20_000_000)
    throw Error("对照包超过20MB，请减少快照或缩短历史后导出。");
  return text;
}
export function readPortfolioShelf(text: string): PortfolioShelf {
  if (text.length > 20_000_000) throw Error("对照包不能超过20MB。");
  const p = JSON.parse(text);
  if (p?.format !== "together-portfolio-comparison-v1")
    throw Error("不是有效的组合对照包。");
  validatePortfolioShelf(p.shelf);
  return p.shelf;
}
