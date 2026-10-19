import { it, expect, vi, afterEach } from "vitest";
import {
  DEEP_RESEARCH,
  STANDARD_RESEARCH,
  validateCouncilResearch,
  parseInvestigation,
} from "../lib/council-research";
import {
  councilCalculate,
  councilDocumentSearch,
  councilPublicSearch,
} from "../lib/council-tools";
import {
  councilPlan,
  councilPrompt,
  councilSpec,
  councilFollowupSpec,
  type CouncilRun,
} from "../lib/council";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const id = "00000000-0000-4000-8000-000000000003";
it("新模式显式授权，旧客户端不静默升级；拒绝无授权联网及敏感查询", () => {
  expect(validateCouncilResearch(undefined)).toBeUndefined();
  expect(validateCouncilResearch(DEEP_RESEARCH)).toEqual(DEEP_RESEARCH);
  for (const r of [
    null,
    {},
    { ...STANDARD_RESEARCH, tools: true },
    { ...DEEP_RESEARCH, publicQueries: ["official study"] },
    { ...DEEP_RESEARCH, publicQueries: ["test@example.com"], webConsent: true },
    { ...DEEP_RESEARCH, publicQueries: ["sk-secret"], webConsent: true },
    { ...DEEP_RESEARCH, publicQueries: ["same", "same"], webConsent: true },
    { ...DEEP_RESEARCH, publicQueries: [7], webConsent: true },
  ])
    expect(() => validateCouncilResearch(r)).toThrow();
  const spec = {
    id,
    question: "Synthetic decision question",
    participants: ["openai-light", "deepseek-light"],
    judge: null,
    consent: true,
  };
  expect(councilSpec(spec)).not.toHaveProperty("research");
  expect(
    councilSpec({ ...spec, research: DEEP_RESEARCH }).research?.depth,
  ).toBe("deep");
  expect(() =>
    councilFollowupSpec({
      ...spec,
      turnId: id,
      baseRound: 0,
      mode: "direct",
      research: DEEP_RESEARCH,
    }),
  ).toThrow("直接回应");
});
it.each([
  ["2+3*4", 14],
  ["(2+3)*4", 20],
  ["100000*(1+0.05)^10", 162889.4626777442],
  ["-2^2", -4],
  ["2^-3", 0.125],
  ["1e3/2", 500],
])("计算器真实执行纯算式 %s", (input, expected) =>
  expect(councilCalculate(String(input))).toBeCloseTo(Number(expected), 7),
);
it.each([
  "process.env",
  "fetch('secret')",
  "1/0",
  "1e999",
  "2^9999",
  "1 2",
  "2**3",
  "()",
  "a=2",
  "(".repeat(30) + "1" + ")".repeat(30),
])("拒绝代码、超界与坏算式 %s", (input) =>
  expect(() => councilCalculate(input)).toThrow(),
);
it("工具协议严格校验整份计划；不接受未知工具、自造查询或多次联网", () => {
  const r = {
    ...DEEP_RESEARCH,
    publicQueries: ["Bank of Canada policy rate"],
    webConsent: true,
  };
  const p = {
    focus: "核验观点2的C1",
    requests: [
      { tool: "calculate", expression: "2+2" },
      { tool: "search_public", queryId: 0 },
    ],
  };
  expect(parseInvestigation(JSON.stringify(p), r).requests).toHaveLength(2);
  for (const requests of [
    [{ tool: "shell", command: "whoami" }],
    [{ tool: "search_public", query: "PRIVATE SECRET" }],
    [{ tool: "search_public", queryId: 1 }],
    [{ tool: "calculate", expression: "process.env" }],
    [
      { tool: "search_public", queryId: 0 },
      { tool: "search_public", queryId: 0 },
    ],
  ])
    expect(() =>
      parseInvestigation(JSON.stringify({ ...p, requests }), r),
    ).toThrow();
  expect(() => parseInvestigation(JSON.stringify(p), DEEP_RESEARCH)).toThrow();
  expect(() =>
    parseInvestigation(JSON.stringify(p), STANDARD_RESEARCH),
  ).toThrow();
});
it("本场附件检索只返回实际命中文字片段，不读取电脑或图片", () => {
  const a = {
    id,
    name: "evidence.txt",
    kind: "text" as const,
    mime: "text/plain" as const,
    content: "[第2页] Sample sensitivity threshold is 12 percent.",
    note: "文字提取",
  };
  expect(councilDocumentSearch("threshold", [a])[0]).toMatchObject({
    name: "evidence.txt",
    excerpt: a.content,
  });
  expect(councilDocumentSearch("不存在", [a])).toEqual([]);
});
it("深入五阶段固定快照：核查不偷看同阶段，答辩真实读取工具回执，最终读取答辩", () => {
  const keys = ["openai-light", "deepseek-light"];
  const run: CouncilRun = {
    id,
    question: "Synthetic choice",
    participants: keys,
    judge: null,
    models: [],
    research: DEEP_RESEARCH,
    status: "complete",
    created_at: "2026-10-18",
    steps: councilPlan(keys, null, "deep").map((s) => ({
      ...s,
      status: "succeeded",
      answer: `phase-${s.stage}`,
      error: "",
      usage: { input: 1, output: 1 },
      started_at: null,
      finished_at: null,
    })),
  };
  run.steps[4].tool_receipts = [
    {
      id: "T5.1",
      tool: "calculate",
      input: "2+2",
      output: "4",
      status: "succeeded",
      checkedAt: "2026-10-18",
    },
  ];
  const p = (seq: number) =>
    JSON.parse(councilPrompt(run, run.steps[seq]).input);
  expect(run.steps.map((s) => s.stage)).toEqual([
    "opening",
    "opening",
    "critique",
    "critique",
    "investigation",
    "investigation",
    "rebuttal",
    "rebuttal",
    "revision",
    "revision",
  ]);
  expect(p(5).responses).toHaveLength(4);
  expect(
    p(6).responses.find((s: { toolResults?: unknown }) => s.toolResults)
      ?.toolResults[0].id,
  ).toBe("T5.1");
  expect(p(7).responses).toHaveLength(6);
  expect(
    p(8).responses.some((s: { stage: string }) => s.stage === "逐项答辩"),
  ).toBe(true);
  expect(councilPrompt(run, run.steps[8]).system).toContain("改变结论的阈值");
  expect(p(0).researchLens).not.toBe(p(1).researchLens);
});
it("公开搜索仅发确认词，不附对话；必须实际联网并提供真实引用，未知/失败不自动重试", async () => {
  vi.stubEnv("OPENAI_API_KEY", "private-test-key");
  const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    expect(body.input).toBe("approved public study");
    expect(body).not.toHaveProperty("attachments");
    expect(body.max_tool_calls).toBe(1);
    return Response.json({
      status: "completed",
      output: [
        { type: "web_search_call", status: "completed" },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "A study supports this limited claim.",
              annotations: [
                {
                  type: "url_citation",
                  title: "Original study",
                  url: "https://www.nature.com/articles/study",
                },
              ],
            },
          ],
        },
      ],
    });
  });
  vi.stubGlobal("fetch", fetcher);
  expect(
    (await councilPublicSearch("approved public study")).sources[0].url,
  ).toContain("nature.com");
  fetcher.mockResolvedValueOnce(
    Response.json({ status: "completed", output: [] }),
  );
  await expect(councilPublicSearch("approved public study")).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
