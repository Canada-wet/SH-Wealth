import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { channelAdmin } from "./channel-server";
import { getOfficialMarket } from "./market-server";
import { chooseRoute, generateAdvice } from "./ai/router";
import {
  parseMarketNarrative,
  ruleMarketBrief,
  torontoDay,
  type MarketBrief,
} from "./market-briefing";
import { observationAge, volatilityTerm } from "./market-indicators";
import { readingChange } from "./market-analysis";

export async function readMarketBriefs(admin: SupabaseClient = channelAdmin()) {
  const result = await admin
    .from("market_daily_briefings")
    .select("day,report")
    .eq("status", "ready")
    .order("day", { ascending: false })
    .limit(7);
  if (result.error) throw new Error("每日简报存储暂不可用，请稍后重试。");
  return (result.data ?? []).map((row) => row.report as MarketBrief);
}
export async function ensureMarketBrief(
  admin: SupabaseClient = channelAdmin(),
  now = new Date(),
) {
  const day = torontoDay(now),
    token = randomUUID();
  const claim = await admin.rpc("claim_market_briefing", {
    target_day: day,
    token,
  });
  if (claim.error) throw new Error("每日简报存储尚未就绪，未调用模型。");
  if (!claim.data)
    return { created: false, reports: await readMarketBriefs(admin) };
  const data = await getOfficialMarket();
  let report = ruleMarketBrief(data, now);
  const usable = report.facts.filter((row) => row.value !== null && row.date);
  if (usable.length >= 3 && report.points.length >= 1) {
    try {
      const route = chooseRoute("目前市场数据的每日简短回顾", "auto");
      if (route.provider !== "local") {
        const raw = await generateAdvice(
          route,
          '你是严谨的市场研究编辑。仅依据输入写约250至400字的中文简报。只输出JSON {"summary":"一句概括","points":[{"title":"情绪与波动","text":"短分析","evidence":["VIXCLS"]},{"title":"经济前瞻","text":"短分析","evidence":["ICSA"]},{"title":"AI 产业代理","text":"短分析","evidence":["A34SNO"]}],"watchNext":"下一步核对","limitations":"局限"}。这三个标题必须原样使用且各出现一次；若某类完全没有有效输入则省略该项。每项至少引该类已有非空序列：情绪VIXCLS/VXVCLS；前瞻ICSA/PERMIT；AI A34SNO/IPG3344S/CAPUTLG3344S。不要把篇幅用在其他主题。本简报未提供外汇数据，禁止评论汇率、加元或加币。区分事实与推断；只用输入数值日期，不虚构股票涨跌、新闻、财报、预期差、实时行情、确定因果或供需缺口。VIX为日收盘隐含波动，不预测涨跌；同日VIX/VIX3M不是期货曲线。不用固定阈值给买卖建议。周月季数据不是今日变化；dataAge.days是观测日或统计期起点距今，绝不是距发布日期；不要写“发布滞后X天”，用统计期间和频率描述时效。A34SNO不含半导体新订单；美国行业产出与利用率不能代表全球GPU、HBM或封装供给，不得判定缺货率、真实订单强弱或供需均衡。不得给交易指令、仓位、保证收益或链接。',
          JSON.stringify({
            briefingDay: day,
            dataFetchedAt: data.fetchedAt,
            facts: usable.map((row) => ({
              id: row.id,
              label: row.label,
              value: row.value,
              date: row.date,
              unit: row.unit,
              frequency: row.frequency,
              note: row.note,
              change: readingChange(row),
              dataAge: observationAge(row, now),
            })),
            volatilityTerm: volatilityTerm(report.facts),
            failures: data.failures,
          }),
          { timeoutMs: 25000 },
        );
        report = {
          ...report,
          ...parseMarketNarrative(raw, report.facts),
          generatedAt: new Date().toISOString(),
          mode: "ai",
          provider: route.provider,
          model: route.model,
        };
      }
    } catch {
      report = {
        ...report,
        limitations:
          "AI 模型暂不可用或输出无法验证，已降级为规则摘要；未重新调用高价模型。" +
          report.limitations,
      };
    }
  }
  const save = await admin
    .from("market_daily_briefings")
    .update({ status: "ready", report })
    .eq("day", day)
    .eq("claim_token", token)
    .eq("status", "processing")
    .select("day");
  if (save.error || !save.data?.length)
    throw new Error("简报未能确认保存；已有历史不会被覆盖。");
  return { created: true, reports: await readMarketBriefs(admin) };
}
