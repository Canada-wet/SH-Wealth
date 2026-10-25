export const FREEDOM_KEY = "financial_freedom_v1";
export type FreedomPlan = {
  version: 1;
  spendingMode: "budget" | "manual";
  monthlySpending: number;
  extraMonthly: number;
  annualIncome: number;
  withdrawalRate: number;
  withdrawalTax: number;
  inflation: number;
  netReturn: number;
  years: number;
  retirementYears: number;
  reserveMonths: number;
  monthlySaving: number;
  selectedAssetIds: string[];
  goals: { id: string; name: string; amount: number }[];
};
export function validFreedomPlan(raw: unknown): raw is FreedomPlan {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const p = raw as FreedomPlan;
  const range = (v: unknown, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  return (
    p.version === 1 &&
    ["budget", "manual"].includes(p.spendingMode) &&
    range(p.monthlySpending, 0, 1e8) &&
    range(p.extraMonthly, 0, 1e8) &&
    range(p.annualIncome, 0, 1e9) &&
    range(p.withdrawalRate, 0.5, 10) &&
    range(p.withdrawalTax, 0, 60) &&
    range(p.inflation, 0, 15) &&
    range(p.netReturn, -20, 20) &&
    range(p.years, 0, 60) &&
    Number.isInteger(p.years) &&
    range(p.retirementYears, 1, 70) &&
    Number.isInteger(p.retirementYears) &&
    range(p.reserveMonths, 0, 60) &&
    range(p.monthlySaving, 0, 1e8) &&
    Array.isArray(p.selectedAssetIds) &&
    p.selectedAssetIds.length <= 200 &&
    p.selectedAssetIds.every(
      (x) => typeof x === "string" && x.length > 0 && x.length <= 100,
    ) &&
    new Set(p.selectedAssetIds).size === p.selectedAssetIds.length &&
    Array.isArray(p.goals) &&
    p.goals.length <= 10 &&
    new Set(p.goals.map((g) => g?.id)).size === p.goals.length &&
    p.goals.every(
      (g) =>
        g &&
        typeof g.id === "string" &&
        g.id.length > 0 &&
        g.id.length <= 100 &&
        typeof g.name === "string" &&
        g.name.trim().length > 0 &&
        g.name.length <= 80 &&
        range(g.amount, 0, 1e9),
    )
  );
}
export function parseFreedomPlan(raw?: string): FreedomPlan | undefined {
  if (raw === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw Error("财务自由计划格式损坏，请从备份恢复或核对原记录。");
  }
  if (!validFreedomPlan(value))
    throw Error("请核对财务自由计划金额、期限、回报与提取率假设。");
  return value;
}
