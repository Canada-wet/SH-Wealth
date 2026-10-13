import {
  breakdown,
  budgetTotals,
  money,
  totals,
  type WealthState,
} from "./wealth";

export type Insight = {
  id: string;
  title: string;
  body: string;
  prompt: string;
  priority: "attention" | "next" | "update";
  source: string;
  href: string;
};

export function householdPulse(state: WealthState, now = new Date()) {
  const cashflow = budgetTotals(state);
  const budget = state.budget ?? [];
  const hasIncome = budget.some((row) => row.kind === "income");
  const hasExpenses = budget.some((row) => row.kind === "expense");
  const cash = state.assets
    .filter((row) => /现金|储蓄|cash|hisa/i.test(row.category))
    .reduce((sum, row) => sum + row.value, 0);
  const months = Math.max(
    0,
    (Number(state.goal.year) - now.getFullYear()) * 12 + 12 - now.getMonth(),
  );
  const gap = Math.max(0, state.goal.target - totals(state).netWorth);
  return {
    ...cashflow,
    cash,
    hasIncome,
    hasExpenses,
    complete: hasIncome && hasExpenses,
    coverage:
      hasExpenses && cashflow.essential > 0 ? cash / cashflow.essential : null,
    monthlyGoal: months > 0 ? gap / months : null,
    months,
  };
}

// Evidence-based prompts, not market forecasts or an invented AI response.
export function proactiveInsights(
  state: WealthState,
  now = new Date(),
): Insight[] {
  const rows: Insight[] = [];
  const pulse = householdPulse(state, now);
  const total = totals(state);
  const month = `${now.getFullYear()}-${now.getMonth() + 1}`;
  const add = (key: string, row: Omit<Insight, "id">) =>
    rows.push({ id: `pulse-${key}-${month}`, ...row });
  if (!state.assets.length)
    add("inventory", {
      title: "从第一份家庭清单开始",
      body: "先录入真实资产和负债，所有图表、成员占比和目标会同步建立。",
      prompt: "帮我们整理首次资产盘点的录入清单，不要猜测任何金额。",
      priority: "next",
      source: "账户清单",
      href: "#assets",
    });
  if (!pulse.complete)
    add("budget", {
      title: "补齐收支，才知道每月能留下多少",
      body: "目前收入或支出尚未完整录入；不会把缺失的项目当成零来估算储蓄。",
      prompt:
        "帮我们检查现金流有哪些未记录的项目，并区分固定开支和不定期开支。",
      priority: "next",
      source: "现金流表",
      href: "#cashflow",
    });
  else if (pulse.surplus < 0)
    add("deficit", {
      title: "已记录的月支出超过收入",
      body: `账面每月缺口 ${money(-pulse.surplus)}。先核对金额和支出周期，再讨论调整。`,
      prompt:
        "根据最新收支，帮我们核对月度缺口，并提出需要共同讨论的下一步。不要自动修改数据。",
      priority: "attention",
      source: "收入 − 支出",
      href: "#cashflow",
    });
  const targetMonths = Number(state.plan.values.emergency_months) || 0;
  if (
    pulse.coverage !== null &&
    targetMonths > 0 &&
    pulse.coverage < targetMonths
  )
    add("buffer", {
      title: "现金缓冲低于你们设置的目标",
      body: `现金类账户约覆盖 ${pulse.coverage.toFixed(1)} 个月必要开支，目标 ${targetMonths} 个月。需另核对 GIC 的可赎回条件。`,
      prompt:
        "根据现金账户、必要开支和我们设置的应急金月数，梳理缺口与流动性限制，不要默认 GIC 可随时赎回。",
      priority: "attention",
      source: "现金类别 / 必要开支",
      href: "#emergency",
    });
  const latest = state.history.at(-1);
  if (latest && now.getTime() - Date.parse(latest.at) > 30 * 86400000)
    add("stale", {
      title: "到一次家庭数据复盘的时间了",
      body: "最近一份财务快照已超过 30 天。聊天和浏览不算财务更新，可先核对账户余额。",
      prompt:
        "帮我们准备月度数据复盘清单，重点是账户估值、负债和收支是否仍准确。",
      priority: "next",
      source: "财务快照日期",
      href: "#assets",
    });
  if (state.goal.target > 0 && total.netWorth >= state.goal.target)
    add("goal-reached", {
      title: "账面净资产已达到家庭目标",
      body: "可以一起复核估值、资金可动用程度，以及下一阶段目标。",
      prompt:
        "我们账面已达到目标，帮我们整理下一阶段需要确认的问题，不要自动改变目标。",
      priority: "update",
      source: "净资产 / 目标",
      href: "#overview",
    });
  else if (
    pulse.complete &&
    pulse.monthlyGoal !== null &&
    pulse.monthlyGoal > pulse.surplus &&
    total.totalAssets > 0
  )
    add("goal-gap", {
      title: "目标节奏值得一起确认",
      body: `不计收益、按目标年末平摊，月度参考 ${money(pulse.monthlyGoal)}；当前账面结余 ${money(pulse.surplus)}。这是核对基线，不是预测。`,
      prompt:
        "比较我们的目标年末、净资产差额和当前月结余，解释不计收益的基线与不确定性，提出可讨论的选项。",
      priority: "next",
      source: "目标差额 / 剩余月数",
      href: "#overview",
    });
  const largest = breakdown(state, "category").sort(
    (a, b) => b.percent - a.percent,
  )[0];
  if (largest && largest.percent >= 60 && state.assets.length > 1)
    add(`mix-${largest.key}`, {
      title: `${largest.name}占总资产 ${largest.percent.toFixed(1)}%`,
      body: "先了解这一类别的流动性和用途。类别占比不能替代投资组合风险评估。",
      prompt: `解释当前${largest.name}类别的集中度，先询问流动性、用途和风险承受能力，不要直接推荐交易。`,
      priority: "next",
      source: "实际账户 / 总资产",
      href: "#assets",
    });
  if (
    !state.contributions.length &&
    state.assets.some((row) => row.owner === "first") &&
    state.assets.some((row) => row.owner === "second")
  )
    add("contributions", {
      title: "持有归属不等于实际贡献",
      body: "两位成员都有资产，但贡献记录尚空。可独立补记已计入估值的历史出资，避免重复加账。",
      prompt:
        "解释资产归属和成员贡献的区别，并帮我们确定哪些历史出资需要独立记录，不要重复增加账户余额。",
      priority: "next",
      source: "归属与贡献记录",
      href: "#contributions",
    });
  if (
    latest &&
    now.getTime() >= Date.parse(latest.at) &&
    now.getTime() - Date.parse(latest.at) < 7 * 86400000
  ) {
    const previous = state.history.at(-2);
    if (previous && previous.netWorth !== latest.netWorth)
      add(`change-${latest.id}`, {
        title: "最近一次记录改变了家庭净资产",
        body: `${latest.reason}；与上一快照相比${latest.netWorth > previous.netWorth ? "增加" : "减少"} ${money(Math.abs(latest.netWorth - previous.netWorth))}。记录变动不代表投资收益。`,
        prompt:
          "解释最近两份财务快照的净资产变化，区分录入、出资、估值与投资收益，不要将记录变化当成业绩。",
        priority: "update",
        source: "相邻财务快照",
        href: "#assets",
      });
  }
  const order = { attention: 0, next: 1, update: 2 };
  return rows.sort((a, b) => order[a.priority] - order[b.priority]);
}
