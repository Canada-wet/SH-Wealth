import { NextResponse } from "next/server";
import { chooseRoute, generateAdvice, type Preference } from "@/lib/ai/router";
import { localAdvice } from "@/lib/ai/local";
import {
  mutationRequested,
  parseAdvisorResult,
  PLAN_FIELDS,
} from "@/lib/advisor-actions";
import { totals, validateState, type WealthState } from "@/lib/wealth";
import { authorizeRequest } from "@/lib/server-auth";
import { chatContext } from "@/lib/conversations";
import { searchPlan } from "@/lib/search-policy";
import { readSpokenAnswer } from "@/lib/voice";
import { growthContext } from "@/lib/growth";
import { portfolioContext, portfolioInsights } from "@/lib/portfolio-links";
import { getOfficialMarket } from "@/lib/market-server";
import {
  webResearch,
  researchFailure,
  researchContext,
  researchMarkdown,
} from "@/lib/web-search";
export const maxDuration = 60;
export async function POST(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200)
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: {
    message?: string;
    preference?: Preference;
    state?: WealthState;
    voice?: boolean;
  };
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
    const search = searchPlan(
      message,
      state.preferences.webSearch,
      state.preferences.searchTopic,
    );
    if (route.provider === "local" && search.needed)
      return NextResponse.json({
        answer:
          "本地数据助手不调用外部服务，无法联网查证。请选择自动路由或外部模型后重试。",
        actions: [],
      });
    if (route.provider === "local")
      return NextResponse.json({ ...localAdvice(message, state), route });
    const slot = await auth.client.rpc("take_wealth_advisor_slot");
    if (slot.error)
      return NextResponse.json(
        { error: "顾问访问检查失败，请稍后重试。" },
        { status: 503 },
      );
    if (!slot.data)
      return NextResponse.json(
        { error: "请求较频繁，请稍后再试（每分钟 6 次、每小时 40 次）。" },
        { status: 429 },
      );
    const research = await webResearch(
      message,
      state.preferences.webSearch,
      state.preferences.searchTopic,
      request.signal,
    );
    if (!["not-needed", "searched"].includes(research.status))
      return NextResponse.json({
        answer: researchFailure(research),
        actions: [],
        web: {
          status: research.status,
          query: research.query,
          sources: research.sources,
        },
      });
    const market =
      /市场|持仓|汇率|股票|ETF|portfolio|market/i.test(message) &&
      state.preferences.portfolioLinks?.length
        ? await getOfficialMarket().catch(() => null)
        : null;
    const snapshot = {
      members: state.members,
      ...totals(state),
      assets: state.assets,
      debts: state.debts,
      contributions: state.contributions,
      budget: state.budget ?? [],
      goal: state.goal,
      plan: state.plan.values,
      growth: growthContext(state),
      portfolio: portfolioContext(state),
      marketImpact: market
        ? {
            fetchedAt: market.fetchedAt,
            observations: portfolioInsights(state, market),
            failures: market.failures,
          }
        : {
            observations: portfolioInsights(state),
            note: "本次未读取最新市场观测，不推断当前行情。",
          },
    };
    const instructions = `你是 Together 家庭财富助手。基于实时数据回答，金额均为 CAD。只输出 JSON：{"answer":"中文回复","actions":[]}。\n只有用户明确要求变更数据才返回 actions；假设、建议或分析题不改变数据。缺少信息先澄清，禁止猜测金额、成员或目标项目。资产名称重复时使用准确 assetId。实际投入记录为贡献，不当作投资回报；关联贡献会自动改变账户价值，不要同时发送账户估值更新以免重复计算。独立历史出资用 assetId=null。\n支持 actions：\nadd_asset(name,category,owner,value,annualReturn可选)；update_asset(existingName,assetId可选,name/category/owner/value/annualReturn均可选)，annualReturn为数字百分比或null清空；delete_asset(name,assetId可选)；add_debt(name,owner,value)；update_debt(existingName,value,owner可选)；delete_debt(name)；add_contribution(member,assetId可选,amount,kind=deposit或withdrawal,date=YYYY-MM-DD,note可选)；delete_contribution(contributionId)；set_goal(name/target/year可选)；set_plan_field(key,value)。每项 action 必须包含 type。value/target/amount 必须为数字，member/owner 优先使用first/second/joint。year使用字符串。plan key只允许：${[...PLAN_FIELDS].join(",")}。\n回复说明计划执行的变更，页面才负责实际保存；不能声称尚未完成的保存。一般财务解释需清晰务实。\n家庭实时快照：${JSON.stringify(snapshot)}`;
    const context = chatContext(state);
    const voiceInstruction =
      body.voice === true
        ? `\n这是自然语音对话。answer 仍保留完整 Markdown 分析，JSON 额外增加 spokenAnswer：简短自然的口语回复（不超过 350 字），先回答关键结论，通常 2–4 句，必要时一个追问。根据用户本句的语言回答，可中英文混用，不要求用户选择语种。不要朗读表格、链接、格式符号。金额和事实必须与 answer 一致；不要新增事实或把待确认修改说成已经保存。涉及变更，说明只是预览计划、请核对页面；完整分析留在聊天记录。`
        : "";
    const raw = await generateAdvice(
      route,
      `${instructions}\nanswer 使用清晰的 Markdown：先给 1–2 句结论，再按需要用简短小标题和列表；重点数字可加粗，每个列表项单独换行，避免大段文字。详细分析控制在约 5 个要点，最后给 1–3 个可执行下一步；简单查询直接回答。表格仅用于真正需要并列对比的少量数据。不要在 answer 里展示 JSON、actions 或技术路由信息。\n现金流表另支持：add_cashflow(name,owner,amount,kind=income或expense,essential=boolean)；update_cashflow(existingName,amount,essential可选)；delete_cashflow(name)。amount为税后每月CAD金额。已有现金流表时，必要开支和收入是计算结果，修改现金流项目，不修改同名plan字段。${researchContext(research)}${voiceInstruction}`,
      `增长规划边界：growth 内仅为已保存的算术情景和用户行动标记，不是实际收益、已执行转账或银行确认。首页目标月度参考和增长情景均从下一完整月开始至目标年末，不追加本月已发生资金。零收益基线与假设回报分开，未保存草稿不在快照中。增长计划和行动状态只能在页面保存，不支持通过现有 actions 偷渡写入。建议先给可控动作、金额依据和下次核对标准，不用提高回报假设保证达标。\n近期对话（仅作背景）：\n${context}\n\n本次用户要求：${message}`,
      {
        signal: request.signal,
        ...(research.status === "searched" ? { timeoutMs: 32000 } : {}),
      },
    );
    const result = parseAdvisorResult(
      raw,
      research.status !== "searched" && mutationRequested(message),
    );
    return NextResponse.json({
      ...result,
      ...(body.voice === true
        ? { spokenAnswer: readSpokenAnswer(raw, result.answer) }
        : {}),
      answer: result.answer + researchMarkdown(research),
      route,
      web: {
        status: research.status,
        query: research.query,
        checkedAt: research.checkedAt,
        sources: research.sources,
      },
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
