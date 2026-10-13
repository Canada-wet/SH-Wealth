import { chooseRoute, generateAdvice, type Preference } from "./router";
import { parseAdvisorResult } from "../advisor-actions";
import { householdPulse, proactiveInsights } from "../insights";
import { money, totals, type WealthState } from "../wealth";

export function ruleReview(state: WealthState, now = new Date()) {
  const balance = totals(state);
  const pulse = householdPulse(state, now);
  const insights = proactiveInsights(state, now);
  return `**本周记录概览**\n\n净资产 ${money(balance.netWorth)}；资产 ${money(balance.totalAssets)}，负债 ${money(balance.totalDebts)}。${pulse.complete ? `账面月结余 ${money(pulse.surplus)}，未必等于实际储蓄。` : "收支尚未完整录入，暂不估算月结余。"}\n\n${
    insights
      .slice(0, 3)
      .map((row) => `- **${row.title}**：${row.body}`)
      .join("\n") || "- 一起确认账户估值、本月收支与成员贡献。"
  }\n\n数据规则复盘 · 基于记录，不是收益预测。`;
}

export async function weeklyReview(state: WealthState, now = new Date()) {
  const fallback = ruleReview(state, now);
  if (
    state.preferences.proactive === false ||
    state.preferences.model === "local"
  )
    return fallback;
  try {
    // Background reviews use the router's fast tier, not expensive deep planning.
    const preference: Preference = state.preferences.model.startsWith(
      "anthropic-",
    )
      ? "anthropic-fast"
      : state.preferences.model.startsWith("deepseek-")
        ? "deepseek-chat"
        : state.preferences.model.startsWith("openai-")
          ? "openai-fast"
          : "auto";
    const route = chooseRoute("目前家庭数据的本周简短回顾", preference);
    if (route.provider === "local") return fallback;
    const raw = await generateAdvice(
      route,
      '你是家庭财富复盘助手。只输出 JSON {"answer":"Markdown中文复盘","actions":[]}。这是主动周报，不是用户的修改指令：绝不生成数据操作或交易建议。用最多250字：一句结论、最多三个有数据依据的要点、一个下次共同确认的问题。只使用给定事实，缺失信息明确说明；不要把快照增减叫投资收益，不默认GIC可赎回，不把预算结余当实际储蓄，不保证回报。目标基线按目标年末且不计收益。',
      JSON.stringify({
        at: now.toISOString(),
        totals: totals(state),
        cashflow: householdPulse(state, now),
        goal: state.goal,
        observations: proactiveInsights(state, now).map(
          ({ title, body, source }) => ({ title, body, source }),
        ),
      }),
    );
    const { answer } = parseAdvisorResult(raw, false);
    if (!answer.trim() || answer.length > 4000) return fallback;
    return `${answer}\n\nAI 周度复盘 · ${route.provider} · ${route.model} · 基于记录，仅供共同讨论。`;
  } catch {
    // The user still receives a clearly labelled evidence-based review.
    return fallback;
  }
}
