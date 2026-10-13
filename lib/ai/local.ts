import { mutationRequested, type AssistantAction } from "../advisor-actions";
import {
  contributionSummary,
  money,
  totals,
  type WealthState,
} from "../wealth";
export function localAdvice(message: string, state: WealthState) {
  const balance = totals(state);
  const actions: AssistantAction[] = [];
  if (mutationRequested(message)) {
    const found = state.assets.filter((asset) => message.includes(asset.name));
    const amountMatch = message.match(
      /(?:改为|改成|设为|为|至|投入|取出)\s*[$￥]?\s*([+-]?\d+(?:\.\d+)?)\s*(万|k|K)?/,
    );
    const amount = amountMatch
      ? Number(amountMatch[1]) *
        (amountMatch[2] === "万" ? 10000 : amountMatch[2] ? 1000 : 1)
      : null;
    if (found.length === 1) {
      const asset = found[0];
      if (/删除|移除/.test(message))
        actions.push({
          type: "delete_asset",
          name: asset.name,
          assetId: asset.id,
        });
      else if (
        /回报/.test(message) &&
        (/清空/.test(message) || amount !== null)
      )
        actions.push({
          type: "update_asset",
          existingName: asset.name,
          assetId: asset.id,
          annualReturn: /清空/.test(message) ? null : amount,
        });
      else if (/投入|取出/.test(message) && amount !== null) {
        const member = message.includes(state.members.first)
          ? "first"
          : message.includes(state.members.second)
            ? "second"
            : message.includes("共同")
              ? "joint"
              : null;
        if (member)
          actions.push({
            type: "add_contribution",
            member,
            assetId: asset.id,
            amount,
            kind: /取出/.test(message) ? "withdrawal" : "deposit",
            date: new Date().toISOString().slice(0, 10),
            note: "通过本地助手记录",
          });
      } else if (
        /估值|价值|余额/.test(message) &&
        amount !== null &&
        amount >= 0
      )
        actions.push({
          type: "update_asset",
          existingName: asset.name,
          assetId: asset.id,
          value: amount,
        });
    }
    if (actions.length)
      return {
        answer: "已识别你的数据修改要求。页面成功保存后会显示变更结果。",
        actions,
      };
    return {
      answer:
        "本地助手可执行明确的账户修改，例如「把共同储蓄的价值改为 50000」「把共同储蓄本年回报改为 -2.5%」「记录 Lin 向共同储蓄投入 1000」。请使用已有账户的准确名称，或通过表格录入。复杂规划请在模型选项连接外部 AI。",
      actions,
    };
  }
  if (/贡献|contribution/i.test(message))
    return {
      answer: contributionSummary(state)
        .map(
          (row) =>
            `${row.name}：净贡献 ${money(row.net)}，累计投入占比 ${row.percent.toFixed(1)}%`,
        )
        .join("\n"),
      actions,
    };
  return {
    answer: `家庭总资产 ${money(balance.totalAssets)}，负债 ${money(balance.totalDebts)}，净资产 ${money(balance.netWorth)}。\n距 ${state.goal.year} 年「${state.goal.name}」目标还差 ${money(Math.max(state.goal.target - balance.netWorth, 0))}。\n${state.assets.length ? "可以先核对账户估值、贡献与必要开支，再安排下一步。" : "先添加实际资产和负债，便能开始追踪。"}\n当前是本地数据助手；连接外部模型后可进行更完整的规划对话。`,
    actions,
  };
}
