import {
  budgetTotals,
  round,
  totals,
  type Snapshot,
  type WealthState,
} from "./wealth";
import {
  EMPTY_QUARTERLY,
  REVIEW_CHECKS,
  emptyReview,
  type QuarterEvidence,
  type QuarterlyReviews,
  type QuarterReview,
  type ReviewAction,
} from "./quarterly-schema";

export function torontoDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function quarterPeriod(key: string) {
  if (!/^(20\d{2}|2100)-Q[1-4]$/.test(key)) throw new Error("季度无效。");
  const year = Number(key.slice(0, 4)),
    q = Number(key.at(-1));
  const day = (y: number, m: number, d: number) =>
    new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  return {
    key,
    label: `${year} 年第 ${q} 季度`,
    start: day(year, (q - 1) * 3, 1),
    end: day(year, q * 3, 0),
    due: day(year, q * 3, 1),
    nextEnd: day(year, q * 3 + 3, 0),
    nextDue: day(year, q * 3 + 3, 1),
  };
}
export function latestCompletedQuarter(now = new Date()) {
  const day = torontoDay(now),
    year = Number(day.slice(0, 4)),
    q = Math.floor((Number(day.slice(5, 7)) - 1) / 3);
  return `${q === 0 ? year - 1 : year}-Q${q === 0 ? 4 : q}`;
}
export function quarterOptions(state: WealthState, now = new Date()) {
  const latest = latestCompletedQuarter(now),
    y = Number(latest.slice(0, 4)),
    q = Number(latest.at(-1));
  const recent = Array.from({ length: 8 }, (_, i) => {
    const n = y * 4 + q - 1 - i;
    return `${Math.floor(n / 4)}-Q${(n % 4) + 1}`;
  });
  return [
    ...new Set([
      ...recent,
      ...Object.keys(state.preferences.quarterlyReviews?.records ?? {}),
    ]),
  ]
    .filter((k) => k <= latest)
    .sort()
    .reverse();
}
export function quarterEvidence(
  state: WealthState,
  key: string,
  now = new Date(),
): QuarterEvidence {
  const p = quarterPeriod(key),
    today = torontoDay(now);
  const history = state.history
    .filter((s) => Date.parse(s.at) <= now.getTime())
    .slice()
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const opening = history
    .filter((s) => torontoDay(new Date(s.at)) < p.start)
    .at(-1);
  const closing = history
    .filter((s) => torontoDay(new Date(s.at)) <= p.end)
    .at(-1);
  const point = (s?: Snapshot) =>
    s
      ? {
          at: s.at,
          netWorth: round(totals(s).netWorth),
          assets: round(totals(s).totalAssets),
          debts: round(totals(s).totalDebts),
        }
      : null;
  const contributions = state.contributions.filter(
    (c) => c.date >= p.start && c.date <= p.end && c.date <= today,
  );
  const contributionTotals = { first: 0, second: 0, joint: 0 };
  for (const c of contributions)
    contributionTotals[c.member as "first"] +=
      c.amount * (c.kind === "deposit" ? 1 : -1);
  for (const k of ["first", "second", "joint"] as const)
    contributionTotals[k] = round(contributionTotals[k]);
  const budget = closing?.budget;
  const completeBudget =
    budget?.some((b) => b.kind === "income") &&
    budget.some((b) => b.kind === "expense");
  const b = completeBudget ? budgetTotals({ budget } as WealthState) : null;
  return {
    capturedAt: now.toISOString(),
    opening: point(opening),
    closing: point(closing),
    contributionTotals,
    contributionCount: contributions.length,
    monthlyBudget: b
      ? { income: b.income, expenses: b.expenses, surplus: b.surplus }
      : null,
    target: closing?.goal?.target ?? null,
  };
}
export function quarterlyStatus(state: WealthState, now = new Date()) {
  const key = latestCompletedQuarter(now),
    prefs = state.preferences.quarterlyReviews ?? EMPTY_QUARTERLY,
    record = prefs.records[key],
    today = torontoDay(now);
  return {
    key,
    period: quarterPeriod(key),
    prefs,
    record,
    due:
      state.preferences.proactive !== false &&
      prefs.reminders &&
      !record?.completedAt &&
      (!record?.snoozeUntil || record.snoozeUntil <= today) &&
      !!(state.assets.length || state.debts.length || state.history.length),
  };
}
export function reviewProgress(record: QuarterReview) {
  return Object.keys(REVIEW_CHECKS).filter(
    (k) => record.checks[k as keyof typeof REVIEW_CHECKS],
  ).length;
}
export function updateQuarter(
  state: WealthState,
  key: string,
  update: (r: QuarterReview) => QuarterReview,
): WealthState {
  quarterPeriod(key);
  const prefs = state.preferences.quarterlyReviews ?? EMPTY_QUARTERLY;
  const previous = prefs.records[key] ?? emptyReview();
  const next = update(structuredClone(previous));
  if (
    previous.completedAt &&
    JSON.stringify({
      ...next,
      actions: next.actions.map((a) => ({ ...a, done: false })),
    }) !==
      JSON.stringify({
        ...previous,
        actions: previous.actions.map((a) => ({ ...a, done: false })),
      })
  )
    throw new Error("已归档的复盘不可改写；仍可跟进原定行动。");
  return {
    ...state,
    preferences: {
      ...state.preferences,
      quarterlyReviews: {
        ...prefs,
        records: { ...prefs.records, [key]: next },
      },
    },
  };
}
export function setQuarterlyPreference(
  state: WealthState,
  field: "reminders" | "external",
  value: boolean,
) {
  return {
    ...state,
    preferences: {
      ...state.preferences,
      quarterlyReviews: {
        ...(state.preferences.quarterlyReviews ?? EMPTY_QUARTERLY),
        [field]: value,
      } as QuarterlyReviews,
    },
  };
}
export function completeQuarter(
  state: WealthState,
  key: string,
  now = new Date(),
) {
  if (quarterPeriod(key).end >= torontoDay(now))
    throw new Error("季度尚未结束，不能归档。");
  return updateQuarter(state, key, (r) => {
    if (r.completedAt) throw new Error("这个季度已经归档。");
    if (reviewProgress(r) !== 4 || !r.notes.trim() || !r.actions.length)
      throw new Error(
        "请完成四项核对、填写复盘结论，并至少安排一项下季度行动。",
      );
    if (
      r.actions.some(
        (a) =>
          a.due < quarterPeriod(key).due ||
          (!a.done && a.due < torontoDay(now)),
      )
    )
      throw new Error(
        "请将未完成行动的到期日设为今天或之后，所有行动日期不早于下一季度。",
      );
    return {
      ...r,
      completedAt: now.toISOString(),
      evidence: quarterEvidence(state, key, now),
    };
  });
}
export function addQuarterAction(
  state: WealthState,
  key: string,
  action: ReviewAction,
) {
  return updateQuarter(state, key, (r) => ({
    ...r,
    actions: [...r.actions, action],
  }));
}
export function quarterPrompt(
  state: WealthState,
  key: string,
  now = new Date(),
) {
  const r = state.preferences.quarterlyReviews?.records[key],
    e = r?.evidence ?? quarterEvidence(state, key, now);
  return `只做分析，不修改数据或执行交易。请带我们完成${quarterPeriod(key).label}财富复盘。以下是有明确时点的季度证据：${JSON.stringify(e)}。期初/期末点可能早于季度边界，null代表缺失，不能用当前余额补历史、不能把净值变化当收益、不能把预算乘3当实际现金流；贡献不保证穷尽转账。结合当前账户与市场关联检查集中度、已确认外币敞口和流动性，不能把自选当持仓或假定存在历史持仓。给出三条有依据的观察、需要补充的信息、夫妻双方可执行的下季度行动。我们的笔记：${r?.notes || "尚未填写"}。`;
}
