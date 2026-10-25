import type { CouncilRun } from "./council";
import type { CouncilUsage } from "./council-cost";
export type CouncilResearch = {
  depth: "standard" | "deep";
  tools: boolean;
  publicQueries: string[];
  webConsent: boolean;
};
export const STANDARD_RESEARCH: CouncilResearch = {
  depth: "standard",
  tools: false,
  publicQueries: [],
  webConsent: false,
};
export const DEEP_RESEARCH: CouncilResearch = {
  depth: "deep",
  tools: true,
  publicQueries: [],
  webConsent: false,
};
export function validateCouncilResearch(
  raw: unknown,
): CouncilResearch | undefined {
  if (raw === undefined) return undefined; // Legacy clients never silently opt into extra calls.
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("研讨深度与工具设置无效。");
  const r = raw as CouncilResearch;
  if (
    !["standard", "deep"].includes(r.depth) ||
    typeof r.tools !== "boolean" ||
    typeof r.webConsent !== "boolean" ||
    !Array.isArray(r.publicQueries) ||
    r.publicQueries.length > 2 ||
    r.publicQueries.some(
      (q) =>
        typeof q !== "string" ||
        q.trim().length < 3 ||
        q.length > 200 ||
        /[\r\n\0]|\S+@\S+|\b(?:sk-|Bearer\s|password|api[_ -]?key)/i.test(q),
    ) ||
    new Set(r.publicQueries.map((q) => q.trim())).size !==
      r.publicQueries.length ||
    (r.depth !== "deep" && r.tools) ||
    (r.publicQueries.length > 0 && (!r.tools || !r.webConsent))
  )
    throw Error(
      "深入研讨才可启用工具；最多确认 2 条各 3–200 字的公开检索词，不含邮箱、密码或密钥。",
    );
  return {
    depth: r.depth,
    tools: r.tools,
    publicQueries: r.publicQueries.map((q) => q.trim()),
    webConsent: r.webConsent,
  };
}
export function councilResearchFor(run: CouncilRun, round = 0) {
  return (
    (round ? run.turns?.[round - 1]?.research : run.research) ??
    STANDARD_RESEARCH
  );
}
export type CouncilToolRequest =
  | { tool: "calculate"; expression: string }
  | { tool: "search_documents"; query: string }
  | { tool: "search_public"; queryId: number };
export type CouncilToolReceipt = {
  id: string;
  tool: CouncilToolRequest["tool"];
  status: "running" | "succeeded" | "failed" | "unknown";
  input: string;
  output: string;
  checkedAt: string;
  queryId?: number;
  reusedFrom?: string;
  requested?: boolean;
  sources?: { title: string; url: string }[];
  billing?: {
    version: 1;
    model: string;
    usage: CouncilUsage;
    searchCalls: number | null;
    perSearchUSD: number;
    source: string;
    checkedAt: string;
  };
};
export const INVESTIGATION_PROTOCOL = `本阶段只输出一个 JSON 对象，不输出 Markdown 或私有思维链：
{"focus":"针对哪些具体观点编号的哪项可证伪主张核查，为什么会改变决策（最多800字）","requests":[...]}。
最多2个 requests；允许为空，不为了调用而调用。工具仅包括：
{"tool":"calculate","expression":"100000*(1+0.05)^10"}：只含数字、小数、括号、+ - * / ^，无代码/变量/函数；这是基于输入假设的计算，不是事实证明。
{"tool":"search_documents","query":"要定位的关键词"}：只在本场已上传的文字附件中找片段，无全盘文件/账本权限。
{"tool":"search_public","queryId":0}：仅可选 approvedPublicQueries 中已明确授权的编号，最多一次；无授权词就不可请求。不能自造查询、URL、凭证或执行指令。
工具结果在下一阶段由应用提供，本阶段不能声称已完成核查。无需工具时说明为什么以及证据缺口。`;
export function parseInvestigation(answer: string, settings: CouncilResearch) {
  const raw = JSON.parse(
    answer
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, ""),
  );
  if (
    !raw ||
    typeof raw.focus !== "string" ||
    !raw.focus.trim() ||
    raw.focus.length > 2400 ||
    !Array.isArray(raw.requests) ||
    raw.requests.length > 2
  )
    throw Error("工具计划格式无效；未执行工具。");
  const requests: CouncilToolRequest[] = raw.requests.map(
    (r: Record<string, unknown>) => {
      if (!r || typeof r !== "object" || !settings.tools)
        throw Error("未授权工具请求。");
      if (
        r.tool === "calculate" &&
        typeof r.expression === "string" &&
        r.expression.length <= 300 &&
        /^[\d\s.eE()+*/^\-]+$/.test(r.expression)
      )
        return { tool: r.tool, expression: r.expression };
      if (
        r.tool === "search_documents" &&
        typeof r.query === "string" &&
        r.query.trim().length >= 2 &&
        r.query.length <= 120 &&
        !r.query.includes("\0")
      )
        return { tool: r.tool, query: r.query.trim() };
      if (
        r.tool === "search_public" &&
        settings.webConsent &&
        Number.isInteger(r.queryId) &&
        Number(r.queryId) >= 0 &&
        Number(r.queryId) < settings.publicQueries.length
      )
        return { tool: r.tool, queryId: Number(r.queryId) };
      throw Error("工具名称、参数或公开检索授权无效；未执行工具。");
    },
  );
  if (
    requests.filter((r) => r.tool === "search_public").length > 1 ||
    new Set(requests.map((r) => JSON.stringify(r))).size !== requests.length
  )
    throw Error("不允许重复或多次联网请求。");
  return { focus: raw.focus.trim() as string, requests };
}
export function councilReceiptExport(receipts: CouncilToolReceipt[]) {
  return receipts
    .map(
      (r) =>
        `### 工具回执 ${r.id} · ${r.tool}\n\n状态：${r.status}${r.reusedFrom ? ` · 复用 ${r.reusedFrom}（未再次联网）` : ""}\n\n输入：${r.input}\n\n${r.output || "请求结果待确认，不视为已完成核验。"}\n\n${(r.sources ?? []).map((s) => `[${s.title}](<${s.url}>)`).join(" · ")}\n\n核查时间：${r.checkedAt}`,
    )
    .join("\n\n");
}
