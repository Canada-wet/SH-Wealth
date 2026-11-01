import {
  budgetTotals,
  cashReference,
  totals,
  type WealthState,
} from "./wealth";
import { validBacktestLab, type BacktestLab } from "./backtest-schema";
import { stableJSON } from "./cloud-plan";
import type { BacktestReport } from "./backtest";
export const EMPTY_BACKTEST_LAB: BacktestLab = { version: 1, saved: [] };
export function changeBacktestLab(
  state: WealthState,
  expected: string,
  next: BacktestLab,
): WealthState {
  if (
    stableJSON(state.preferences.backtestLab ?? EMPTY_BACKTEST_LAB) !== expected
  )
    throw Error(
      "回测计划已在另一窗口变化；请重新选择计划后保存，未覆盖新版本。",
    );
  if (!validBacktestLab(next)) throw Error("回测计划格式无效。");
  return { ...state, preferences: { ...state.preferences, backtestLab: next } };
}
export function backtestHouseholdContext(s: WealthState) {
  const b = budgetTotals(s),
    cash = cashReference(s.assets);
  const complete =
    !!s.budget?.some((b) => b.kind === "income") &&
    !!s.budget?.some((b) => b.kind === "expense");
  return {
    currency: "CAD",
    ...totals(s),
    monthlyIncome: complete ? b.income : null,
    monthlyExpenses: complete ? b.expenses : null,
    monthlyBudgetSurplus: complete ? b.surplus : null,
    cashReference: cash,
    goal: s.goal,
    note: "仅账面快照，预算不等于实际可投资额度，现金口径见 cashReference；不含账户名称、成员、逐项资产或聊天。",
  };
}
export function backtestEvidence(r: BacktestReport) {
  return {
    method: "together-backtest-v1",
    synthetic: r.synthetic,
    config: r.config,
    start: r.start,
    end: r.end,
    observations: r.observations,
    sources: r.sources,
    warnings: r.warnings,
    strategies: r.results.map((s) => ({
      strategy: s.label,
      metrics: s.metrics,
      events: s.events,
      years: s.years,
    })),
  };
}
