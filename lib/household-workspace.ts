import {
  budgetTotals,
  round,
  totals,
  validDate,
  type Asset,
  type WealthState,
  type Snapshot,
} from "./wealth";
import { financialFingerprint } from "./advisor-preview";
export const todayToronto = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
export const LIQUIDITY = {
  unknown: "待核对",
  available: "可动用",
  locked: "有期限 / 锁定",
  illiquid: "不易变现",
};
export function valuationReview(state: WealthState, now = new Date()) {
  const today = Date.parse(todayToronto(now));
  return state.assets
    .map((asset) => ({
      asset,
      age:
        asset.valuationDate && validDate(asset.valuationDate)
          ? Math.floor((today - Date.parse(asset.valuationDate)) / 86400000)
          : null,
    }))
    .filter((row) => row.age === null || row.age >= 30 || row.age < 0);
}
export function goalPace(state: WealthState, now = new Date()) {
  const [year, month] = todayToronto(now).split("-").map(Number);
  const months = Math.max(
    0,
    // Start with the next complete month; the current snapshot may already
    // include this month's income, contributions and valuation changes.
    (Number(state.goal.year) - year) * 12 + 12 - month,
  );
  const gap = Math.max(0, round(state.goal.target - totals(state).netWorth));
  const complete = Boolean(
    state.budget?.some((row) => row.kind === "income") &&
    state.budget.some((row) => row.kind === "expense"),
  );
  const surplus = complete ? budgetTotals(state).surplus : null;
  const required = months ? round(gap / months) : null;
  return {
    gap,
    months,
    required,
    surplus,
    shortfall:
      required !== null && surplus !== null
        ? round(Math.max(0, required - surplus))
        : null,
  };
}
export function costSharing(state: WealthState, method: "equal" | "income") {
  const budget = state.budget ?? [];
  const joint = round(
    budget
      .filter((row) => row.kind === "expense" && row.owner === "joint")
      .reduce((sum, row) => sum + row.amount, 0),
  );
  const income = (owner: string) =>
    budget
      .filter((row) => row.kind === "income" && row.owner === owner)
      .reduce((sum, row) => sum + row.amount, 0);
  const a = income("first"),
    b = income("second");
  if (
    method === "income" &&
    (a + b <= 0 ||
      !["first", "second"].every((owner) =>
        budget.some((row) => row.kind === "income" && row.owner === owner),
      ))
  )
    return { joint, first: null, second: null };
  const first = round(joint * (method === "equal" ? 0.5 : a / (a + b)));
  return { joint, first, second: round(joint - first) };
}
export function debtCosts(state: WealthState) {
  const known = state.debts.filter((row) => row.annualRate != null);
  return {
    annualInterest: round(
      known.reduce((sum, row) => sum + (row.value * row.annualRate!) / 100, 0),
    ),
    unknown: state.debts.filter(
      (row) => row.value > 0 && row.annualRate == null,
    ).length,
    payments: round(
      state.debts.reduce((sum, row) => sum + (row.monthlyPayment ?? 0), 0),
    ),
    missingPayments: state.debts.filter(
      (row) => row.value > 0 && row.monthlyPayment == null,
    ).length,
  };
}
export type ValuationEdit = Pick<Asset, "id" | "value" | "annualReturn"> & {
  valuationDate: string;
};
export function updateValuations(
  state: WealthState,
  edits: ValuationEdit[],
  expected: string,
) {
  if (expected !== financialFingerprint(state))
    throw new Error("家庭数据已更新，请重新打开批量表格。");
  if (
    !edits.length ||
    new Set(edits.map((row) => row.id)).size !== edits.length
  )
    throw new Error("请选择不同的资产项目。");
  for (const row of edits) {
    if (
      !state.assets.some((asset) => asset.id === row.id) ||
      !Number.isFinite(row.value) ||
      row.value < 0 ||
      (row.annualReturn !== null && !Number.isFinite(row.annualReturn)) ||
      !validDate(row.valuationDate)
    )
      throw new Error("请检查估值、回报和核对日期。");
  }
  return {
    ...state,
    assets: state.assets.map((asset) => {
      const edit = edits.find((row) => row.id === asset.id);
      return edit ? { ...asset, ...edit } : asset;
    }),
  };
}
const fields = [
  "assets",
  "debts",
  "contributions",
  "budget",
  "goal",
  "members",
  "plan",
] as const;
export type FinancialUndo = {
  before: Pick<WealthState, (typeof fields)[number]>;
  expected: string;
  reason: string;
};
export function undoPoint(
  before: WealthState,
  after: WealthState,
  reason: string,
): FinancialUndo {
  return {
    before: structuredClone(
      Object.fromEntries(fields.map((key) => [key, before[key]])),
    ) as FinancialUndo["before"],
    expected: financialFingerprint(after),
    reason,
  };
}
export function undoFinancial(
  current: WealthState,
  point: FinancialUndo,
): WealthState {
  if (financialFingerprint(current) !== point.expected)
    throw new Error(
      "财务数据后来已有变动，不能撤销覆盖。请从历史核对后单独编辑。",
    );
  return { ...current, ...structuredClone(point.before) };
}
export function snapshotChanges(before: Snapshot, after: Snapshot) {
  const changes: {
    label: string;
    before: number | null;
    after: number | null;
    delta: number;
  }[] = [];
  for (const kind of ["assets", "debts"] as const) {
    const ids = new Set([...before[kind], ...after[kind]].map((row) => row.id));
    for (const id of ids) {
      const a = before[kind].find((row) => row.id === id),
        b = after[kind].find((row) => row.id === id);
      if (!a || !b || a.value !== b.value)
        changes.push({
          label: `${kind === "assets" ? "资产" : "负债"} · ${b?.name ?? a?.name}`,
          before: a?.value ?? null,
          after: b?.value ?? null,
          delta: round((b?.value ?? 0) - (a?.value ?? 0)),
        });
    }
  }
  return { changes, netDelta: round(after.netWorth - before.netWorth) };
}
