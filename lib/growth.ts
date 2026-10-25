import {
  budgetTotals,
  cashReference,
  money,
  round,
  totals,
  type WealthState,
} from "./wealth";
import {
  goalPace,
  todayToronto,
  valuationReview,
  debtCosts,
} from "./household-workspace";
import {
  GROWTH_TASKS,
  validGrowthPlan,
  type GrowthPlan,
  type GrowthTaskId,
} from "./growth-schema";
import { financialFingerprint } from "./advisor-preview";
import { freedomContext } from "./freedom";
export type { GrowthPlan, GrowthTaskId } from "./growth-schema";

export function defaultGrowthPlan(
  state: WealthState,
  now = new Date(),
): GrowthPlan {
  const date = new Date(todayToronto(now));
  date.setUTCDate(date.getUTCDate() + 30);
  const complete =
    state.budget?.some((row) => row.kind === "income") &&
    state.budget?.some((row) => row.kind === "expense");
  return {
    monthlySaving: complete
      ? Math.min(1e9, Math.max(0, budgetTotals(state).surplus))
      : 0,
    longTermMonthly: 0,
    annualRate: 0,
    selectedAssetIds: [],
    reviewDate: date.toISOString().slice(0, 10),
    tasks: {},
  };
}
export function growthConfig(plan?: GrowthPlan) {
  if (!plan) return "not-saved";
  const { tasks: _tasks, ...config } = plan;
  return JSON.stringify(config);
}
export function growthAnalysis(
  state: WealthState,
  plan = state.preferences.growthPlan ?? defaultGrowthPlan(state),
  now = new Date(),
) {
  if (!validGrowthPlan(plan))
    throw new Error(
      "请核对留存金额、长期投入、日期和回报假设（-20% 至 20%）。",
    );
  const cashflow = budgetTotals(state),
    balance = totals(state),
    pace = goalPace(state, now);
  const complete =
    !!state.budget?.some((x) => x.kind === "income") &&
    !!state.budget?.some((x) => x.kind === "expense");
  const cash = cashReference(state.assets);
  const verifiedCash = round(cash.amount - cash.unverified);
  const months = Number(state.plan.values.emergency_months);
  const reserveTarget =
    complete && cashflow.essential > 0 && months > 0 && Number.isFinite(months)
      ? round(cashflow.essential * months)
      : null;
  const reserveGap =
    reserveTarget === null
      ? null
      : round(Math.max(0, reserveTarget - verifiedCash));
  const selected = state.assets.filter((x) =>
    plan.selectedAssetIds.includes(x.id),
  );
  const capital = round(selected.reduce((sum, x) => sum + x.value, 0));
  const missingAssets = plan.selectedAssetIds.filter(
    (id) => !selected.some((x) => x.id === id),
  );
  const today = todayToronto(now);
  const deposits = state.contributions.filter(
    (row) =>
      row.assetId &&
      selected.some((asset) => asset.id === row.assetId) &&
      row.date.startsWith(today.slice(0, 7)) &&
      row.date <= today,
  );
  const recordedContribution = selected.length
    ? round(
        deposits.reduce(
          (sum, row) =>
            sum + (row.kind === "deposit" ? row.amount : -row.amount),
          0,
        ),
      )
    : null;
  const monthlyRate = Math.expm1(Math.log1p(plan.annualRate / 100) / 12);
  const term = pace.months;
  if (term > 1200) throw new Error("测算期限不能超过 100 年。");
  let invested = capital,
    projected = balance.netWorth,
    reachMonth: number | null =
      balance.netWorth >= state.goal.target ? 0 : null;
  const points = [
    {
      month: "现在",
      offset: 0,
      baseline: balance.netWorth,
      scenario: balance.netWorth,
    },
  ];
  const [year, month] = todayToronto(now).split("-").map(Number);
  for (let i = 1; i <= term; i++) {
    invested = invested * (1 + monthlyRate) + plan.longTermMonthly;
    projected =
      balance.netWorth -
      capital +
      invested +
      (plan.monthlySaving - plan.longTermMonthly) * i;
    if (
      !Number.isFinite(projected) ||
      Math.abs(projected) > Number.MAX_SAFE_INTEGER
    )
      throw new Error("测算金额超出安全范围，请检查金额和期限。");
    if (reachMonth === null && projected >= state.goal.target) reachMonth = i;
    if (i % 12 === 0 || i === term)
      points.push({
        offset: i,
        month: new Date(Date.UTC(year, month + i - 1, 1))
          .toISOString()
          .slice(0, 7),
        baseline: round(balance.netWorth + plan.monthlySaving * i),
        scenario: round(projected),
      });
  }
  const baseline = round(balance.netWorth + plan.monthlySaving * term);
  return {
    balance,
    cashflow,
    complete,
    verifiedCash,
    unverifiedCash: cash.unverified,
    reserveTarget,
    reserveGap,
    aboveReserve:
      reserveTarget === null
        ? null
        : round(Math.max(0, verifiedCash - reserveTarget)),
    capital,
    missingAssets,
    recordedContribution,
    recordedCount: deposits.length,
    months: term,
    baseline,
    projected: round(projected),
    contribution: round(plan.monthlySaving * term),
    effect: round(projected - baseline),
    gap: round(Math.max(0, state.goal.target - projected)),
    reachMonth,
    monthlyGap:
      pace.required === null
        ? null
        : round(Math.max(0, pace.required - plan.monthlySaving)),
    budgetGap: complete
      ? round(Math.max(0, plan.monthlySaving - Math.max(0, cashflow.surplus)))
      : null,
    points,
  };
}
export type GrowthTask = {
  id: GrowthTaskId;
  title: string;
  evidence: string;
  body: string;
  next: string;
  href: string;
  priority: "attention" | "next";
  status: "todo" | "planned" | "done" | "review";
};
export function growthTasks(
  state: WealthState,
  now = new Date(),
): GrowthTask[] {
  const plan = state.preferences.growthPlan ?? defaultGrowthPlan(state, now);
  const a = growthAnalysis(state, plan, now),
    debts = debtCosts(state);
  const rows: GrowthTask[] = [];
  const add = (
    id: GrowthTaskId,
    facts: unknown,
    body: string,
    next: string,
    href: string,
    priority: GrowthTask["priority"] = "next",
  ) => {
    const evidence = JSON.stringify(facts),
      saved = plan.tasks[id];
    rows.push({
      id,
      title: GROWTH_TASKS[id],
      evidence,
      body,
      next,
      href,
      priority,
      status: !saved
        ? "todo"
        : saved.evidence !== evidence
          ? "review"
          : saved.status,
    });
  };
  if (!a.complete || a.cashflow.surplus < 0 || (a.budgetGap ?? 0) > 0)
    add(
      "budget",
      [state.budget, plan.monthlySaving],
      !a.complete
        ? "收入或支出缺失，不能判断储蓄能力。"
        : `预算月结余 ${money(a.cashflow.surplus)}；计划每月留存 ${money(plan.monthlySaving)}${a.budgetGap ? `，超过预算 ${money(a.budgetGap)}` : ""}。`,
      "补齐不定期支出，确认留存计划不会挤占必要开支。",
      "#cashflow",
      "attention",
    );
  if (
    a.reserveTarget === null ||
    (a.reserveGap ?? 0) > 0 ||
    a.unverifiedCash > 0
  )
    add(
      "buffer",
      [a.verifiedCash, a.unverifiedCash, a.reserveTarget],
      a.reserveTarget === null
        ? "尚不能计算缓冲目标：请填写必要开支及应急金月数。"
        : `按必要开支设定的缓冲为 ${money(a.reserveTarget)}；已确认可动用现金 ${money(a.verifiedCash)}，差额 ${money(a.reserveGap!)}。${a.unverifiedCash ? `另有 ${money(a.unverifiedCash)} 现金流动性待核对，未计为已确认资金。` : ""}`,
      "核对现金的可赎回条件，再决定如何逐月补齐；不要默认 GIC 随时可取。",
      "#emergency",
      (a.reserveGap ?? 0) > 0 ? "attention" : "next",
    );
  if (state.debts.some((x) => x.value > 0))
    add(
      "debt",
      state.debts.map((x) => [x.id, x.value, x.annualRate, x.monthlyPayment]),
      `已知利率部分的静态年利息约 ${money(debts.annualInterest)}；${debts.unknown} 项余额利率未填。`,
      "先核对利率、提前还款限制与费用，再比较额外还债和保留资金的取舍；不自动还款。",
      "#growth-debt-review",
    );
  add(
    "goal",
    [
      state.goal,
      a.balance.netWorth,
      plan.monthlySaving,
      plan.longTermMonthly,
      plan.annualRate,
      a.capital,
      a.missingAssets,
      a.months,
    ],
    !state.preferences.growthPlan
      ? "尚未保存增长情景。预算结余不是已实现储蓄，先共同确认能稳定留下的金额。"
      : !a.months
        ? "目标期限内已无完整月份，请核对本月安排或更新目标日期。"
        : `至 ${state.goal.year} 年末，零收益基线 ${money(a.baseline)}；自填假设情景 ${money(a.projected)}。${a.monthlyGap ? `不计收益的计划月缺口 ${money(a.monthlyGap)}。` : "仍需持续落实储蓄，不是达标保证。"}`,
    "用留存金额和期限先找可控差距，再讨论风险；不要靠提高回报假设填平缺口。",
    "#growth-plan",
  );
  if (state.preferences.growthPlan && plan.monthlySaving > 0)
    add(
      "execution",
      [
        plan.monthlySaving,
        plan.longTermMonthly,
        state.budget,
        a.recordedContribution,
        todayToronto(now).slice(0, 7),
      ],
      `计划每月留存 ${money(plan.monthlySaving)}，其中长期投入 ${money(plan.longTermMonthly)}；${a.recordedContribution === null ? "尚未指定跟踪账户。" : `所选账户本月记录净出资 ${money(a.recordedContribution)}（${a.recordedCount} 笔）。`}计划不是转账，账户间出资也不等于新增财富。`,
      "与伴侣确认执行日期及账户；资金尚未计入余额时才用关联贡献更新。估值已包含的资金用独立历史记录，不为完成进度重复加账。",
      "#contributions",
    );
  const stale = valuationReview(state, now);
  add(
    "review",
    [
      plan.reviewDate,
      plan.reviewDate <= todayToronto(now),
      stale.map((x) => [x.asset.id, x.asset.valuationDate]),
    ],
    `下次复盘 ${plan.reviewDate}${plan.reviewDate <= todayToronto(now) ? "（已到期）" : ""}；${stale.length} 项账户日期待核对。`,
    "对照真实账单检查余额、实际出资和计划执行，不把净值变动直接当作投资收益。",
    "#assets",
  );
  return rows.sort(
    (x, y) =>
      Number(x.status === "done") - Number(y.status === "done") ||
      Number(x.priority !== "attention") - Number(y.priority !== "attention"),
  );
}
export function saveGrowthPlan(
  state: WealthState,
  plan: GrowthPlan,
  expectedConfig: string,
  expectedFinancial: string,
): WealthState {
  if (
    growthConfig(state.preferences.growthPlan) !== expectedConfig ||
    financialFingerprint(state) !== expectedFinancial
  )
    throw new Error(
      "家庭数据或增长计划已更新，请载入最新版本后再保存；草稿仍保留。",
    );
  if (
    !validGrowthPlan(plan) ||
    plan.selectedAssetIds.some((id) => !state.assets.some((x) => x.id === id))
  )
    throw new Error("增长计划或所选账户无效，请重新核对。");
  growthAnalysis(state, plan);
  return {
    ...state,
    preferences: {
      ...state.preferences,
      growthPlan: { ...plan, tasks: state.preferences.growthPlan?.tasks ?? {} },
    },
  };
}
export function setGrowthTask(
  state: WealthState,
  task: GrowthTask,
  status: "planned" | "done",
  now = new Date(),
): WealthState {
  const latest = growthTasks(state, now).find((x) => x.id === task.id);
  if (!latest || latest.evidence !== task.evidence)
    throw new Error("行动依据已有变化，请核对最新数据后再标记。");
  if (latest.status !== task.status)
    throw new Error("行动进度已被更新，请核对伴侣的最新安排后再操作。");
  const plan = state.preferences.growthPlan;
  if (!plan) throw new Error("请先保存增长情景，再记录共同的行动进度。");
  return {
    ...state,
    preferences: {
      ...state.preferences,
      growthPlan: {
        ...plan,
        tasks: {
          ...plan.tasks,
          [task.id]: { status, at: now.toISOString(), evidence: task.evidence },
        },
      },
    },
  };
}
export function growthContext(state: WealthState, now = new Date()) {
  const plan = state.preferences.growthPlan;
  return {
    savedScenario: plan ? { ...plan, tasks: undefined } : null,
    financialFreedom: freedomContext(state),
    analysis: plan ? growthAnalysis(state, plan, now) : null,
    priorities: growthTasks(state, now).map(
      ({ title, body, next, status }) => ({ title, body, next, status }),
    ),
    boundary:
      "情景不是预测或已执行交易。以当前快照为基准，从下一个完整月起至目标年末；不追加本月已发生资金或计算本月余下回报。零收益基线与自填回报分开；仅选中本金和长期月投入复利，其他资产负债固定，未计税费、通胀、房贷本金变化。",
  };
}
