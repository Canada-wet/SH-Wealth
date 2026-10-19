import { budgetTotals, totals, type WealthState } from "./wealth";
import { proactiveInsights } from "./insights";
import { quarterlyStatus } from "./quarterly-review";

export type HomeAction = {
  id: string;
  title: string;
  detail: string;
  href: string;
  source: string;
  attention: boolean;
};

// Derived, not another stored dashboard. Never writes data or requests an AI opinion.
export function homeSnapshot(state: WealthState, now = new Date()) {
  const financial = totals(state);
  const budget = state.budget ?? [];
  const completeBudget =
    budget.some((r) => r.kind === "income") &&
    budget.some((r) => r.kind === "expense");
  const quarter = quarterlyStatus(state, now);
  const actions: HomeAction[] = [];
  if (state.preferences.proactive !== false) {
    if (quarter.due)
      actions.push({
        id: "quarter",
        title: `${quarter.period.label}，一起做一次复盘`,
        detail: "核对变化、听听彼此的想法，再约定下一步。",
        href: "/#quarterly-review",
        source: "已保存的季度复盘状态",
        attention: false,
      });
    const insights = proactiveInsights(state, now).sort(
      (a, b) =>
        Number(b.priority === "attention") - Number(a.priority === "attention"),
    );
    for (const row of insights) {
      // The emergency detail lives inside the plan; only stable, mounted roots
      // can be reached reliably after loading another page.
      const href =
        row.href === "#emergency"
          ? "/#framework"
          : row.href.startsWith("#")
            ? `/${row.href}`
            : row.href;
      if (actions.some((a) => a.href === href)) continue;
      actions.push({
        id: row.id,
        title: row.title,
        detail: row.body,
        href,
        source: row.source,
        attention: row.priority === "attention",
      });
    }
  }
  // An actual cashflow deficit precedes a routine quarterly reminder.
  actions.sort((a, b) => Number(b.attention) - Number(a.attention));
  const lifestyle = state.preferences.lifestyle;
  return {
    ...financial,
    hasLedger: !!(state.assets.length || state.debts.length),
    monthlySurplus: completeBudget ? budgetTotals(state).surplus : null,
    financialAt: state.history.at(-1)?.at ?? null,
    actions: actions.slice(0, 3),
    tracks: lifestyle?.tracks.length ?? 0,
    sets: lifestyle?.sets.length ?? 0,
    practices: lifestyle?.practices.length ?? 0,
    practiceMinutes:
      lifestyle?.practices.reduce((sum, p) => sum + p.minutes, 0) ?? 0,
  };
}
