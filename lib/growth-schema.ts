export const GROWTH_TASKS = {
  budget: "核对每月可留存资金",
  buffer: "先守住现金缓冲",
  debt: "核对负债成本",
  goal: "确认目标增长路径",
  execution: "落实定期留存安排",
  review: "安排下一次共同复盘",
} as const;
export type GrowthTaskId = keyof typeof GROWTH_TASKS;
export type GrowthPlan = {
  monthlySaving: number;
  longTermMonthly: number;
  annualRate: number;
  selectedAssetIds: string[];
  reviewDate: string;
  tasks: Partial<
    Record<
      GrowthTaskId,
      {
        status: "planned" | "done";
        at: string;
        evidence: string;
      }
    >
  >;
};
export function validGrowthPlan(raw: unknown): raw is GrowthPlan {
  if (!raw || typeof raw !== "object") return false;
  const p = raw as GrowthPlan;
  return (
    [p.monthlySaving, p.longTermMonthly, p.annualRate].every(Number.isFinite) &&
    p.monthlySaving >= 0 &&
    p.monthlySaving <= 1e9 &&
    p.longTermMonthly >= 0 &&
    p.longTermMonthly <= p.monthlySaving &&
    p.annualRate >= -20 &&
    p.annualRate <= 20 &&
    Array.isArray(p.selectedAssetIds) &&
    p.selectedAssetIds.length <= 100 &&
    new Set(p.selectedAssetIds).size === p.selectedAssetIds.length &&
    p.selectedAssetIds.every(
      (id) => typeof id === "string" && id.length > 0 && id.length <= 200,
    ) &&
    typeof p.reviewDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(p.reviewDate) &&
    Number.isFinite(Date.parse(p.reviewDate)) &&
    new Date(p.reviewDate).toISOString().slice(0, 10) === p.reviewDate &&
    !!p.tasks &&
    typeof p.tasks === "object" &&
    !Array.isArray(p.tasks) &&
    Object.entries(p.tasks).every(
      ([key, row]) =>
        Object.prototype.hasOwnProperty.call(GROWTH_TASKS, key) &&
        !!row &&
        ["planned", "done"].includes(row.status) &&
        typeof row.at === "string" &&
        Number.isFinite(Date.parse(row.at)) &&
        typeof row.evidence === "string" &&
        row.evidence.length > 0 &&
        row.evidence.length <= 16000,
    )
  );
}
