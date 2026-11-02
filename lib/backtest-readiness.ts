import {
  symbolIdentity,
  validateBacktestConfig,
  type BacktestConfig,
  type BacktestData,
} from "./backtest-schema";

export function holdingIssues(holdings: BacktestConfig["holdings"]) {
  const issues: string[] = [];
  holdings.forEach((h, i) => {
    if (!h.symbol) issues.push(`第${i + 1}项尚未选择证券。`);
    if (!Number.isFinite(h.weight) || h.weight <= 0 || h.weight > 100)
      issues.push(`第${i + 1}项权重须大于0且不超过100%。`);
  });
  if (
    new Set(holdings.map((h) => symbolIdentity(h.symbol))).size !==
    holdings.length
  )
    issues.push("组合中有重复证券，请移除重复项。");
  const total = holdings.reduce(
    (sum, h) => sum + (Number.isFinite(h.weight) ? h.weight : 0),
    0,
  );
  if (Math.abs(total - 100) > 0.00001)
    issues.push(`权重合计${total.toFixed(2)}%，需等于100%；可点「一键等权」。`);
  return issues;
}

/** Readiness is local state, not a statement that a provider lacks a security. */
export function backtestReadiness(
  config: BacktestConfig,
  data: BacktestData | null,
) {
  const rows = config.holdings.map((h) => {
    const asset = data?.assets.find((a) => a.symbol === h.symbol);
    return { symbol: h.symbol, asset };
  });
  const missing = rows
    .filter((r) => !r.asset)
    .map((r) => r.symbol)
    .filter(Boolean);
  const issues = holdingIssues(config.holdings);
  if (!issues.length) {
    try {
      validateBacktestConfig(config);
    } catch (e) {
      issues.push((e as Error).message);
    }
  }
  if (missing.length)
    issues.push(
      `尚未载入 ${missing.join("、")} 的历史数据；不代表数据源没有这些证券。请获取并采用当前组合行情。`,
    );
  if (rows.some((r) => r.asset && r.asset.currency !== config.currency))
    issues.push(
      "已载入行情的币种与组合不一致，请核对计价币种；不能直接混算加币与美元。",
    );
  if (
    config.dividends === "cash" &&
    rows.some((r) => r.asset?.basis === "total-return")
  )
    issues.push(
      "当前复权总回报数据只支持分红再投资；请修改分红设置或导入含现金分红的原价数据。",
    );
  if (!missing.length && rows.length) {
    const sets = rows.map((r) => new Set(r.asset?.points.map((p) => p.date)));
    const dates =
      rows[0].asset?.points.filter(
        (p) =>
          p.date >= config.start &&
          p.date <= config.end &&
          sets.every((s) => s.has(p.date)),
      ) ?? [];
    if (dates.length < 3)
      issues.push(
        "当前缓存与所选日期的共同日线不足3条，请重新获取所选区间，或调整回测日期。",
      );
  }
  return { rows, missing, issues, ready: issues.length === 0 };
}
