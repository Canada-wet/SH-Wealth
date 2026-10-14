import { applyAssistantActions, type AssistantAction } from "./advisor-actions";
import { money, ownerLabel, type WealthState } from "./wealth";

export function financialFingerprint(state: WealthState) {
  return JSON.stringify([
    state.assets,
    state.debts,
    state.budget,
    state.goal,
    state.plan,
    state.contributions,
    state.members,
  ]);
}

export function previewActions(state: WealthState, actions: AssistantAction[]) {
  const next = applyAssistantActions(state, actions);
  const rows: string[] = [];
  const summarize = (
    before: { id: string; name: string }[],
    after: { id: string; name: string }[],
    format: (row: { id: string; name: string }) => string,
  ) => {
    for (const row of after) {
      const previous = before.find((old) => old.id === row.id);
      if (!previous) rows.push(`新增：${format(row)}`);
      else if (JSON.stringify(previous) !== JSON.stringify(row))
        rows.push(`${format(previous)} → ${format(row)}`);
    }
    for (const row of before)
      if (!after.some((current) => current.id === row.id))
        rows.push(`删除：${format(row)}`);
  };
  summarize(state.assets, next.assets, (raw) => {
    const row = raw as WealthState["assets"][number];
    return `${row.name} · ${ownerLabel(row.owner, state.members)} · ${row.category} · ${money(row.value)} · 回报 ${row.annualReturn === null ? "未填" : `${row.annualReturn}%`}`;
  });
  summarize(state.debts, next.debts, (raw) => {
    const row = raw as WealthState["debts"][number];
    return `${row.name} · ${ownerLabel(row.owner, state.members)} · ${money(row.value)}`;
  });
  summarize(state.budget ?? [], next.budget ?? [], (raw) => {
    const row = raw as NonNullable<WealthState["budget"]>[number];
    return `${row.name} · ${row.kind === "income" ? "收入" : "支出"} ${money(row.amount)}/月 · ${row.essential ? "必要" : "非必要"}`;
  });
  for (const action of actions) {
    if (action.type === "add_contribution")
      rows.push(
        `记录${action.kind === "deposit" ? "投入" : "取出"}：${ownerLabel(action.member, state.members)} · ${money(action.amount)} · ${action.date}${action.assetId ? "（联动账户余额）" : "（不改变账户余额）"}`,
      );
    if (action.type === "delete_contribution")
      rows.push(
        `删除贡献记录：${action.contributionId}（关联账户余额同时还原）`,
      );
    if (action.type === "set_goal")
      rows.push(
        `目标：${state.goal.name} ${money(state.goal.target)} / ${state.goal.year} → ${next.goal.name} ${money(next.goal.target)} / ${next.goal.year}`,
      );
    if (action.type === "set_plan_field")
      rows.push(
        `计划 ${action.key}：${state.plan.values[action.key] || "未填"} → ${action.value}`,
      );
  }
  return rows;
}
