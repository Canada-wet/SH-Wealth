import { NextResponse } from "next/server";
import { chooseRoute, generateAdvice, type Preference } from "@/lib/ai/router";
import { localAdvice } from "@/lib/ai/local";
import {
  mutationRequested,
  parseAdvisorResult,
  PLAN_FIELDS,
} from "@/lib/advisor-actions";
import { totals, validateState, type WealthState } from "@/lib/wealth";
export async function POST(request: Request) {
  let body: { message?: string; preference?: Preference; state?: WealthState };
  try {
    body = await request.json();
    if (!body || typeof body !== "object") throw new Error("invalid body");
  } catch {
    return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
  }
  const { message, preference = "auto", state } = body;
  if (typeof message !== "string" || !message.trim() || message.length > 6000)
    return NextResponse.json(
      { error: "请输入 1–6000 字的问题。" },
      { status: 400 },
    );
  try {
    validateState(state);
  } catch {
    return NextResponse.json(
      { error: "家庭数据快照无效，请刷新后重试。" },
      { status: 400 },
    );
  }
  try {
    const route = chooseRoute(message, preference);
    if (route.provider === "local")
      return NextResponse.json({ ...localAdvice(message, state), route });
    const snapshot = {
      members: state.members,
      ...totals(state),
      assets: state.assets,
      debts: state.debts,
      contributions: state.contributions,
      budget: state.budget ?? [],
      goal: state.goal,
      plan: state.plan.values,
    };
    const instructions = `你是 Together 家庭财富助手。基于实时数据回答，金额均为 CAD。只输出 JSON：{"answer":"中文回复","actions":[]}。\n只有用户明确要求变更数据才返回 actions；假设、建议或分析题不改变数据。缺少信息先澄清，禁止猜测金额、成员或目标项目。资产名称重复时使用准确 assetId。实际投入记录为贡献，不当作投资回报；关联贡献会自动改变账户价值，不要同时发送账户估值更新以免重复计算。独立历史出资用 assetId=null。\n支持 actions：\nadd_asset(name,category,owner,value,annualReturn可选)；update_asset(existingName,assetId可选,name/category/owner/value/annualReturn均可选)，annualReturn为数字百分比或null清空；delete_asset(name,assetId可选)；add_debt(name,owner,value)；update_debt(existingName,value,owner可选)；delete_debt(name)；add_contribution(member,assetId可选,amount,kind=deposit或withdrawal,date=YYYY-MM-DD,note可选)；delete_contribution(contributionId)；set_goal(name/target/year可选)；set_plan_field(key,value)。每项 action 必须包含 type。value/target/amount 必须为数字，member/owner 优先使用first/second/joint。year使用字符串。plan key只允许：${[...PLAN_FIELDS].join(",")}。\n回复说明计划执行的变更，页面才负责实际保存；不能声称尚未完成的保存。一般财务解释需清晰务实。\n家庭实时快照：${JSON.stringify(snapshot)}`;
    const context = state.messages
      .slice(-10)
      .map((row) => `${row.role}: ${row.text}`)
      .join("\n");
    const raw = await generateAdvice(
      route,
      `${instructions}\n现金流表另支持：add_cashflow(name,owner,amount,kind=income或expense,essential=boolean)；update_cashflow(existingName,amount,essential可选)；delete_cashflow(name)。amount为税后每月CAD金额。已有现金流表时，必要开支和收入是计算结果，修改现金流项目，不修改同名plan字段。`,
      `近期对话（仅作背景）：\n${context}\n\n本次用户要求：${message}`,
    );
    return NextResponse.json({
      ...parseAdvisorResult(raw, mutationRequested(message)),
      route,
    });
  } catch (reason) {
    return NextResponse.json(
      {
        error: reason instanceof Error ? reason.message : "顾问服务暂不可用。",
      },
      { status: 503 },
    );
  }
}
