import type { MarketData, MarketReading } from "./market";
import { readingChange, signed } from "./market-analysis";
import { observationAge, volatilityTerm } from "./market-indicators";
const REQUIRED_TOPICS = [
  { title: "情绪与波动", ids: ["VIXCLS", "VXVCLS"] },
  { title: "经济前瞻", ids: ["ICSA", "PERMIT"] },
  { title: "AI 产业代理", ids: ["A34SNO", "IPG3344S", "CAPUTLG3344S"] },
];
export type MarketBrief = {
  day: string;
  generatedAt: string;
  dataAt: string;
  mode: "ai" | "rules";
  provider: string;
  model: string;
  summary: string;
  points: { title: string; text: string; evidence: string[] }[];
  watchNext: string;
  limitations: string;
  facts: MarketReading[];
};
export function torontoDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function briefingFacts(data: MarketData) {
  // Fixed public series only: no household, watchlist names, positions or conversations.
  return [...data.yields, ...data.macro, ...(data.indicators ?? [])].map(
    ({ id, label, value, date, unit, frequency, source, trend, note }) => ({
      id,
      label,
      value,
      date,
      unit,
      frequency,
      source,
      trend: trend.slice(-24),
      note,
    }),
  );
}
export function ruleMarketBrief(
  data: MarketData,
  now = new Date(),
): MarketBrief {
  const facts = briefingFacts(data);
  const describe = (row: MarketReading) => {
    const change = readingChange(row);
    return `${row.label} ${new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 }).format(row.value!)}${row.unit}（${row.date}）${change ? `，${change.label}${signed(change.value)}${change.unit}` : "，暂无可比前期"}${observationAge(row, now).delayed ? "；统计期间较旧，请核对发布状态" : ""}。`;
  };
  const groups = [
    {
      title: "情绪与波动",
      ids: ["VIXCLS", "VXVCLS"],
      end: "隐含波动不是涨跌方向预测。",
    },
    {
      title: "经济前瞻",
      ids: ["ICSA", "PERMIT"],
      end: "周频与月频不混为同一天的经济变化。",
    },
    {
      title: "AI 产业代理",
      ids: ["A34SNO", "IPG3344S", "CAPUTLG3344S"],
      end: "行业代理不能确认 AI 或 GPU 供需缺口；订单口径不含半导体新订单。",
    },
  ];
  const points = groups.flatMap((group) => {
    const rows = facts.filter(
      (row) => group.ids.includes(row.id) && row.value !== null && row.date,
    );
    return rows.length
      ? [
          {
            title: group.title,
            text: rows.slice(0, 2).map(describe).join("") + group.end,
            evidence: rows.map((row) => row.id),
          },
        ]
      : [];
  });
  const term = volatilityTerm(facts);
  if (term && points[0]?.title === "情绪与波动")
    points[0].text += `同日 VIX/VIX3M ${term.ratio.toFixed(2)}，${term.description}；不是期货升贴水。`;
  return {
    day: torontoDay(now),
    generatedAt: now.toISOString(),
    dataAt: data.fetchedAt,
    mode: "rules",
    provider: "local",
    model: "数据规则摘要",
    summary: points.length
      ? "根据最新可用观测整理；不同指标更新频率不同，以下不是全部发生在今天的变化。"
      : "当前市场数据不足，暂不形成市场判断。",
    points,
    watchNext:
      "核对下次官方数据发布与修订；AI 供需还需结合企业披露的订单、资本开支和交付情况。",
    limitations:
      "规则摘要，未使用 AI 模型。VIX 是日收盘；产业数据有滞后且不是 AI 专属。仅供研究，不构成交易指令。",
    facts,
  };
}
export function parseMarketNarrative(raw: string, facts: MarketReading[]) {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = JSON.parse(text);
  const bounded = (value: unknown, max: number) =>
    typeof value === "string" && value.trim().length > 0 && value.length <= max;
  const allowed = new Set(
    facts.filter((row) => row.value !== null && row.date).map((row) => row.id),
  );
  const topicOf = (point: { evidence?: string[] }) => {
    if (!Array.isArray(point?.evidence)) return undefined;
    const matches = REQUIRED_TOPICS.filter((topic) =>
      topic.ids.some((id) => point.evidence!.includes(id) && allowed.has(id)),
    );
    return matches.length === 1 ? matches[0] : undefined;
  };
  if (
    !parsed ||
    !bounded(parsed.summary, 240) ||
    !bounded(parsed.watchNext, 350) ||
    !bounded(parsed.limitations, 350) ||
    !Array.isArray(parsed.points) ||
    parsed.points.length < 1 ||
    parsed.points.length > 3 ||
    !parsed.points.every(
      (point: { title: string; text: string; evidence: string[] }) =>
        point &&
        bounded(point.title, 60) &&
        !!topicOf(point) &&
        bounded(point.text, 500) &&
        Array.isArray(point.evidence) &&
        point.evidence.length >= 1 &&
        point.evidence.length <= 6 &&
        point.evidence.every((id) => allowed.has(id)),
    ) ||
    REQUIRED_TOPICS.some(
      (topic) =>
        topic.ids.some((id) => allowed.has(id)) &&
        !parsed.points.some(
          (point: { evidence: string[] }) =>
            topicOf(point)?.title === topic.title,
        ),
    ) ||
    new Set(
      parsed.points.map(
        (point: { evidence: string[] }) => topicOf(point)?.title,
      ),
    ).size !== parsed.points.length ||
    /汇率|加元|加币|\bCAD\b/i.test(
      JSON.stringify({ summary: parsed.summary, points: parsed.points }),
    )
  )
    throw new Error("简报内容无法验证");
  return {
    summary: parsed.summary as string,
    watchNext: parsed.watchNext as string,
    limitations: parsed.limitations as string,
    points: parsed.points.map(
      (point: { title: string; text: string; evidence: string[] }) => ({
        title: topicOf(point)!.title,
        text: point.text,
        evidence: [...new Set(point.evidence)],
      }),
    ),
  };
}
