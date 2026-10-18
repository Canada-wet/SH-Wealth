import { it, expect } from "vitest";
import {
  COUNCIL_MODELS,
  councilFollowupSpec,
  councilPlan,
  councilPrompt,
  councilExport,
  type CouncilRun,
} from "../lib/council";
import {
  councilRound,
  councilSections,
  councilExcerpt,
} from "../lib/council-results";
const id = "00000000-0000-4000-8000-000000000003";
it("追问允许一位响应者和可选裁判，但需要本轮版本、独立请求编号与费用确认", () => {
  const spec = {
    id,
    turnId: id,
    question: "如果约束变了呢？",
    participants: ["openai-light"],
    judge: null,
    baseRound: 0,
    consent: true,
  };
  expect(councilFollowupSpec(spec).participants).toHaveLength(1);
  for (const patch of [
    { consent: false },
    { baseRound: 8 },
    { question: "a" },
    { turnId: "wrong" },
    { judge: undefined },
    { participants: [] },
    { participants: ["openai-light", "openai-light"] },
  ])
    expect(() => councilFollowupSpec({ ...spec, ...patch })).toThrow();
});
it("同轮追问不偷看先发言，裁判可看当前回应；后轮保留问题演变与原始材料", () => {
  const r: CouncilRun = {
    id,
    question: "原问题",
    participants: ["openai-light", "deepseek-light"],
    judge: null,
    status: "active",
    created_at: "2026-10-18",
    models: COUNCIL_MODELS.slice(0, 2),
    turns: [
      {
        id,
        question: "补充条件一",
        participants: ["openai-light", "deepseek-light"],
        judge: "openai-light",
        created_at: "2026-10-18",
      },
    ],
    steps: councilPlan(["openai-light", "deepseek-light"], null).map((s) => ({
      ...s,
      status: "succeeded",
      answer: `初始${s.seq}`,
      error: "",
      usage: { input: 1, output: 2 },
      started_at: null,
      finished_at: null,
    })),
  };
  const steps = ["openai-light", "deepseek-light", "openai-light"].map(
    (key, i) => ({
      ...r.steps[0],
      seq: 6 + i,
      round: 1,
      model_key: key,
      stage: i < 2 ? ("followup" as const) : ("judge" as const),
      answer: `新一轮${i}`,
    }),
  );
  r.steps.push(...steps);
  const speaker = JSON.parse(councilPrompt(r, steps[1]).input);
  expect(speaker.question).toBe("补充条件一");
  expect(speaker.originalQuestion).toBe("原问题");
  expect(speaker.responses.map((v: { text: string }) => v.text)).toEqual([
    "初始4",
    "初始5",
  ]);
  const judge = JSON.parse(councilPrompt(r, steps[2]).input);
  expect(judge.responses.map((v: { text: string }) => v.text)).toContain(
    "新一轮1",
  );
  expect(JSON.parse(councilPrompt(r, r.steps[1]).input).responses).toHaveLength(
    0,
  );
  expect(councilRound(r, 1).steps).toHaveLength(3);
  expect(councilExport(r)).toContain("追问 1");
  expect(councilExport(r)).toContain("补充条件一");
});
it("可读性分区来自原文标题，不能把多个模型数量伪造为共识", () => {
  expect(
    councilSections("### 共识\n\n证据有限\n\n### 关键分歧\n\n需要试验"),
  ).toEqual([
    { title: "共识", text: "证据有限" },
    { title: "关键分歧", text: "需要试验" },
  ]);
  expect(councilSections("只有正文")).toEqual([
    { title: "简要答案", text: "只有正文" },
  ]);
  expect(councilExcerpt("**结论**：看[原文](https://example.org)")).toBe(
    "结论：看原文",
  );
});
