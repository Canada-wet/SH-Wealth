import { budgetTotals, round, money, type WealthState } from "./wealth";
import {
  FREEDOM_KEY,
  parseFreedomPlan,
  validFreedomPlan,
  type FreedomPlan,
} from "./freedom-schema";
import { financialFingerprint } from "./advisor-preview";
import { todayToronto } from "./household-workspace";
export {
  FREEDOM_KEY,
  parseFreedomPlan,
  type FreedomPlan,
} from "./freedom-schema";
export function defaultFreedomPlan(
  state: WealthState,
  now = new Date(),
): FreedomPlan {
  return {
    version: 1,
    spendingMode: "budget",
    monthlySpending: 0,
    extraMonthly: 0,
    annualIncome: 0,
    withdrawalRate: 2.5,
    withdrawalTax: 0,
    inflation: 2.5,
    netReturn: 4,
    years: Math.max(
      0,
      Math.min(
        60,
        Number(state.goal.year) - Number(todayToronto(now).slice(0, 4)),
      ),
    ),
    retirementYears: 40,
    reserveMonths: 6,
    monthlySaving:
      state.preferences.growthPlan?.monthlySaving ??
      Math.max(0, budgetTotals(state).surplus),
    selectedAssetIds: [],
    goals: [],
  };
}
export function freedomAnalysis(state: WealthState, p: FreedomPlan) {
  if (!validFreedomPlan(p))
    throw Error("请核对财务自由测算输入；金额不能为负，提取率须为0.5%–10%。");
  const budget = budgetTotals(state);
  const complete =
    p.spendingMode === "manual" ||
    !!state.budget?.some((x) => x.kind === "expense");
  const cashflowComplete =
    !!state.budget?.some((x) => x.kind === "income") &&
    !!state.budget?.some((x) => x.kind === "expense");
  const spending =
    p.spendingMode === "budget" ? budget.expenses : p.monthlySpending;
  const annualSpending = (spending + p.extraMonthly) * 12;
  const annualGap = Math.max(0, annualSpending - p.annualIncome);
  const grossGap = annualGap / (1 - p.withdrawalTax / 100);
  const portfolioTarget = grossGap / (p.withdrawalRate / 100);
  const reserve = (spending + p.extraMonthly) * p.reserveMonths;
  const goals = p.goals.reduce((a, g) => a + g.amount, 0);
  const protectedTarget = reserve + goals;
  const totalTarget = portfolioTarget + protectedTarget;
  const selected = state.assets.filter((a) =>
    p.selectedAssetIds.includes(a.id),
  );
  const capital = selected.reduce((a, x) => a + x.value, 0);
  const protectedFunded = Math.min(capital, protectedTarget);
  const portfolio = Math.max(0, capital - protectedTarget);
  const realReturn = (1 + p.netReturn / 100) / (1 + p.inflation / 100) - 1;
  const monthlyRate = Math.expm1(Math.log1p(realReturn) / 12);
  // Reserve and one-off goals are ring-fenced in today's purchasing power. New
  // savings first close that funding gap; only the remainder earns scenario returns.
  const simulate = (saving: number, months: number, stress = false) => {
    let invested = portfolio * (stress ? 0.8 : 1),
      protectedCash = protectedFunded;
    let reach: number | null =
      invested + protectedCash >= totalTarget ? 0 : null;
    const points = [
      {
        year: 0,
        value: round(invested + protectedCash),
        target: round(totalTarget),
      },
    ];
    for (let i = 1; i <= months; i++) {
      const fill = Math.min(
        saving,
        Math.max(0, protectedTarget - protectedCash),
      );
      protectedCash += fill;
      invested = invested * (1 + monthlyRate) + saving - fill;
      if (!Number.isFinite(invested) || invested > Number.MAX_SAFE_INTEGER)
        throw Error("情景金额超出安全计算范围，请降低金额或缩短期限。");
      if (
        reach === null &&
        invested >= portfolioTarget &&
        protectedCash >= protectedTarget
      )
        reach = i;
      if (i % 12 === 0)
        points.push({
          year: i / 12,
          value: round(invested + protectedCash),
          target: round(totalTarget),
        });
    }
    return {
      value: round(invested + protectedCash),
      invested: round(invested),
      reach,
      points,
    };
  };
  const projection = simulate(p.monthlySaving, p.years * 12);
  let requiredMonthly: number | null = null;
  if (p.years > 0) {
    let low = 0,
      high = 1e8;
    if (simulate(high, p.years * 12).value >= totalTarget) {
      for (let i = 0; i < 48; i++) {
        const mid = (low + high) / 2;
        if (simulate(mid, p.years * 12).value >= totalTarget) high = mid;
        else low = mid;
      }
      requiredMonthly = round(high);
    }
  }
  // Fixed-zero-real-return longevity check, NOT a Monte Carlo success probability.
  const drawdownCoverage = grossGap > 0 ? projection.invested / grossGap : null;
  return {
    complete,
    budget,
    cashflowComplete,
    savingAboveBudget: cashflowComplete
      ? round(Math.max(0, p.monthlySaving - Math.max(0, budget.surplus)))
      : null,
    spending,
    annualSpending: round(annualSpending),
    annualGap: round(annualGap),
    grossGap: round(grossGap),
    portfolioTarget: round(portfolioTarget),
    reserve: round(reserve),
    goals: round(goals),
    totalTarget: round(totalTarget),
    capital: round(capital),
    portfolio: round(portfolio),
    protectedFunded: round(protectedFunded),
    protectedGap: round(protectedTarget - protectedFunded),
    excluded: round(state.assets.reduce((a, x) => a + x.value, 0) - capital),
    selected,
    missingAssets: p.selectedAssetIds.filter(
      (id) => !selected.some((a) => a.id === id),
    ),
    illiquid: selected.filter(
      (a) =>
        a.liquidity === "illiquid" ||
        a.liquidity === "locked" ||
        /住房|房产|私家车|house|property|vehicle/i.test(a.category),
    ),
    realReturn,
    projection,
    requiredMonthly,
    shortfall: round(Math.max(0, totalTarget - projection.value)),
    futureNominalTarget: round(
      totalTarget * (1 + p.inflation / 100) ** p.years,
    ),
    stress: simulate(p.monthlySaving, p.years * 12, true),
    extraSaving: simulate(p.monthlySaving + 500, p.years * 12),
    spendingReduction: round(
      Math.min(annualGap, Math.min(500, spending + p.extraMonthly) * 12) /
        (1 - p.withdrawalTax / 100) /
        (p.withdrawalRate / 100) +
        Math.min(500, spending + p.extraMonthly) * p.reserveMonths,
    ),
    drawdownCoverage,
    retirementShortfallAtZeroReturn: round(
      Math.max(0, grossGap * p.retirementYears - projection.invested),
    ),
    sensitivity: [2.5, 3, 3.5, 4].map((rate) => ({
      rate,
      target: round(grossGap / (rate / 100) + protectedTarget),
    })),
  };
}
export function saveFreedomPlan(
  state: WealthState,
  p: FreedomPlan,
  expected: string,
): WealthState {
  if (financialFingerprint(state) !== expected)
    throw Error("伴侣或另一页面已更新家庭数据；草稿保留，请先重新核对。");
  if (!validFreedomPlan(p)) throw Error("财务自由计划输入无效。");
  if (p.selectedAssetIds.some((id) => !state.assets.some((a) => a.id === id)))
    throw Error("所选账户已被删除，请重新核对资金来源。");
  return {
    ...state,
    plan: {
      ...state.plan,
      values: { ...state.plan.values, [FREEDOM_KEY]: JSON.stringify(p) },
    },
  };
}
export function freedomContext(state: WealthState) {
  const p = parseFreedomPlan(state.plan.values[FREEDOM_KEY]);
  if (!p) return null;
  const a = freedomAnalysis(state, p);
  return {
    assumptions: p,
    annualSpending: a.annualSpending,
    annualAfterTaxGap: a.annualGap,
    targetToday: a.totalTarget,
    selectedCapital: a.capital,
    protectedGap: a.protectedGap,
    projectedToday: a.projection.value,
    gap: a.shortfall,
    requiredMonthly: a.requiredMonthly,
    missingAssets: a.missingAssets,
    boundary:
      "用户假设情景而非承诺。全部以今日CAD购买力计；生活费只取支出，不抵扣在职工资。税后可靠收入须从退休第一年可获得，未来CPP/OAS不可提前抵扣。自住房不自动充当提款本金，缓冲与专项资金先隔离，预算结余不等于实际储蓄；不验证提取率安全性，不含真实市场路径、税法或保险精算。",
  };
}
export function freedomSummary(state: WealthState, p: FreedomPlan) {
  const a = freedomAnalysis(state, p);
  return `财务自由假设情景（今日CAD，不是收益预测）：${a.complete ? `年支出 ${money(a.annualSpending)}，税后收入缺口 ${money(a.annualGap)}，提取率 ${p.withdrawalRate}% / 提款税负假设 ${p.withdrawalTax}%。` : "预算支出缺失，不能判定达标。"} 生活费本金 ${money(a.portfolioTarget)}，缓冲 ${money(a.reserve)}，额外专项 ${money(a.goals)}，总目标 ${money(a.totalTarget)}。已选资金 ${money(a.capital)}，先隔离缓冲和专项，${p.years}年后假设情景 ${money(a.projection.value)}，差额 ${money(a.shortfall)}。每月投入假设 ${money(p.monthlySaving)}；税费后名义回报 ${p.netReturn}% / 通胀 ${p.inflation}%。${a.illiquid.length ? "所选资金含锁定或非流动资产，尚需核实可变现条件。" : ""}可靠收入只允许填写退休第一年即可获得的税后金额；不提前抵扣未来养老金。孩子、医疗和还贷金额若已在日常支出内不能重复加总。`;
}
