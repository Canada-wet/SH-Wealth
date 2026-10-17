export const REVIEW_CHECKS = {
  balances: "核对资产估值、余额与负债账单",
  cashflow: "核对收支遗漏、实际投入与取出",
  risk: "讨论集中度、流动性与保障缺口",
  goals: "确认目标进度和下一季度分工",
} as const;
export type ReviewAction = {
  id: string;
  title: string;
  owner: "first" | "second" | "joint";
  due: string;
  done: boolean;
};
export type QuarterEvidence = {
  capturedAt: string;
  opening: {
    at: string;
    netWorth: number;
    assets: number;
    debts: number;
  } | null;
  closing: {
    at: string;
    netWorth: number;
    assets: number;
    debts: number;
  } | null;
  contributionTotals: { first: number; second: number; joint: number };
  contributionCount: number;
  monthlyBudget: { income: number; expenses: number; surplus: number } | null;
  target: number | null;
};
export type QuarterReview = {
  notes: string;
  checks: Partial<Record<keyof typeof REVIEW_CHECKS, boolean>>;
  actions: ReviewAction[];
  snoozeUntil?: string;
  completedAt?: string;
  evidence?: QuarterEvidence;
};
export type QuarterlyReviews = {
  reminders: boolean;
  external: boolean;
  records: Record<string, QuarterReview>;
};
export const EMPTY_QUARTERLY: QuarterlyReviews = {
  reminders: true,
  external: false,
  records: {},
};
export const emptyReview = (): QuarterReview => ({
  notes: "",
  checks: {},
  actions: [],
});
const date = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const stamp = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T/.test(v) &&
  Number.isFinite(Date.parse(v));
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
function validEvidence(e: QuarterEvidence) {
  const point = (p: QuarterEvidence["opening"]) =>
    p === null ||
    (!!p &&
      stamp(p.at) &&
      finite(p.netWorth) &&
      finite(p.assets) &&
      p.assets >= 0 &&
      finite(p.debts) &&
      p.debts >= 0);
  return (
    !!e &&
    stamp(e.capturedAt) &&
    point(e.opening) &&
    point(e.closing) &&
    !!e.contributionTotals &&
    ["first", "second", "joint"].every((k) =>
      finite(e.contributionTotals[k as "first"]),
    ) &&
    Number.isInteger(e.contributionCount) &&
    e.contributionCount >= 0 &&
    (e.target === null || (finite(e.target) && e.target >= 0)) &&
    (e.monthlyBudget === null ||
      (!!e.monthlyBudget &&
        [
          e.monthlyBudget.income,
          e.monthlyBudget.expenses,
          e.monthlyBudget.surplus,
        ].every(finite)))
  );
}
export function validQuarterly(raw: unknown): raw is QuarterlyReviews {
  try {
    const v = raw as QuarterlyReviews;
    return (
      !!v &&
      typeof v.reminders === "boolean" &&
      typeof v.external === "boolean" &&
      !!v.records &&
      typeof v.records === "object" &&
      !Array.isArray(v.records) &&
      Object.keys(v.records).length <= 80 &&
      Object.entries(v.records).every(
        ([key, r]) =>
          /^(20\d{2}|2100)-Q[1-4]$/.test(key) &&
          !!r &&
          typeof r.notes === "string" &&
          r.notes.length <= 3000 &&
          !!r.checks &&
          typeof r.checks === "object" &&
          !Array.isArray(r.checks) &&
          Object.entries(r.checks).every(
            ([k, b]) =>
              Object.prototype.hasOwnProperty.call(REVIEW_CHECKS, k) &&
              typeof b === "boolean",
          ) &&
          Array.isArray(r.actions) &&
          r.actions.length <= 12 &&
          new Set(r.actions.map((a) => a.id)).size === r.actions.length &&
          r.actions.every(
            (a) =>
              !!a &&
              typeof a.id === "string" &&
              a.id.length > 0 &&
              a.id.length <= 100 &&
              typeof a.title === "string" &&
              !!a.title.trim() &&
              a.title.length <= 200 &&
              ["first", "second", "joint"].includes(a.owner) &&
              date(a.due) &&
              typeof a.done === "boolean",
          ) &&
          (r.snoozeUntil === undefined || date(r.snoozeUntil)) &&
          (r.completedAt === undefined
            ? r.evidence === undefined
            : stamp(r.completedAt) &&
              validEvidence(r.evidence!) &&
              r.notes.trim().length > 0 &&
              r.actions.length > 0 &&
              Object.keys(REVIEW_CHECKS).every(
                (k) => r.checks[k as keyof typeof REVIEW_CHECKS] === true,
              )),
      )
    );
  } catch {
    return false;
  }
}
