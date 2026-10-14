import { budgetTotals, money, totals, type WealthState } from "./wealth";

export function reviewChecks(state: WealthState, now = new Date()) {
  const balance = totals(state);
  const names = state.assets.map((row) => row.name.trim().toLowerCase());
  const duplicateNames = [
    ...new Set(names.filter((name, index) => names.indexOf(name) !== index)),
  ];
  const missingReturns = state.assets.filter(
    (row) => row.annualReturn === null,
  );
  const budget = budgetTotals(state);
  const completeBudget = Boolean(
    state.budget?.some((row) => row.kind === "income") &&
    state.budget?.some((row) => row.kind === "expense"),
  );
  const latest = state.history.at(-1);
  const previous = state.history.at(-2);
  const age = latest
    ? Math.max(
        0,
        Math.floor((now.getTime() - Date.parse(latest.at)) / 86400000),
      )
    : null;
  return {
    balance,
    budget,
    completeBudget,
    duplicateNames,
    missingReturns,
    age,
    delta: latest && previous ? latest.netWorth - previous.netWorth : null,
    prompt: `只做分析与讨论，不执行数据变更。请带我们做一次15分钟家庭财务复盘：核对估值和收支、双方与共同资产、实际出资、下一步要共同确认的事项。根据真实数据列出缺失信息，不把估值变化当投资回报。当前净资产${money(balance.netWorth)}。`,
  };
}

export function savingsScenario(
  netWorth: number,
  monthlySaving: number,
  months: number,
  oneOff: number,
  target: number,
) {
  if (
    ![netWorth, monthlySaving, months, oneOff, target].every(Number.isFinite) ||
    months < 1 ||
    months > 120 ||
    !Number.isInteger(months) ||
    oneOff < 0 ||
    target < 0
  )
    throw new Error(
      "请填写有效测算数字，期限为1–120个月，一次性支出不能为负。",
    );
  const projected =
    Math.round((netWorth + monthlySaving * months - oneOff) * 100) / 100;
  return {
    projected,
    gap: Math.max(target - projected, 0),
    requiredMonthly: Math.max((target - netWorth + oneOff) / months, 0),
  };
}
