import { it, expect } from "vitest";
import {
  COUNCIL_MODELS,
  councilFollowupSpec,
  councilFollowupPlan,
  COUNCIL_MAX_STEPS,
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
  expect(councilFollowupSpec(spec).mode).toBe("direct");
  for (const patch of [
    { consent: false },
    { baseRound: 8 },
    { question: "a" },
    { turnId: "wrong" },
    { judge: undefined },
    { participants: [] },
    { participants: ["openai-light", "openai-light"] },
    { mode: "debate" },
    { mode: "unknown" },
    { mode: null },
  ])
    expect(() => councilFollowupSpec({ ...spec, ...patch })).toThrow();
});
it("相互研讨至少两人，新增三阶段和可选裁判，序号接续历史且上限包含八轮完整追问", () => {
  const participants = ["openai-light", "deepseek-light"];
  const spec = councilFollowupSpec({
    id,
    turnId: id,
    question: "新条件呢？",
    participants,
    judge: "openai-light",
    baseRound: 0,
    consent: true,
    mode: "debate",
  });
  expect(spec.mode).toBe("debate");
  const plan = councilFollowupPlan(participants, spec.judge, spec.mode, 1, 7);
  expect(plan.map((s) => s.stage)).toEqual([
    "opening",
    "opening",
    "critique",
    "critique",
    "revision",
    "revision",
    "judge",
  ]);
  expect(plan.map((s) => s.seq)).toEqual([7, 8, 9, 10, 11, 12, 13]);
  expect(plan.every((s) => s.round === 1)).toBe(true);
  expect(councilFollowupPlan(participants, null, "direct", 2, 14)).toEqual([
    { seq: 14, round: 2, model_key: "openai-light", stage: "followup" },
    { seq: 15, round: 2, model_key: "deepseek-light", stage: "followup" },
  ]);
  const max = councilFollowupPlan(
    COUNCIL_MODELS.slice(0, 6).map((m) => m.key),
    "openai-light",
    "debate",
    8,
    19 * 8,
  );
  expect(max.at(-1)?.seq).toBe(COUNCIL_MAX_STEPS - 1);
});
it("追问真正交叉阅读本轮观点与质询，但不偷看同阶段或未来轮次；旧记录仍为直接回应", () => {
  const participants = ["openai-light", "deepseek-light"];
  const step = {
    status: "succeeded" as const,
    answer: "",
    error: "",
    usage: { input: 1, output: 2 },
    started_at: null,
    finished_at: null,
  };
  const run: CouncilRun = {
    id,
    question: "原始问题",
    participants,
    judge: null,
    models: COUNCIL_MODELS.filter((m) => participants.includes(m.key)),
    status: "complete",
    created_at: "2026-10-18",
    attachments: [
      {
        id,
        name: "source.txt",
        kind: "text",
        mime: "text/plain",
        content: "本场合成资料",
        note: "测试",
      },
    ],
    turns: [
      {
        id,
        question: "新增约束一",
        participants,
        judge: "openai-light",
        mode: "debate",
        created_at: "2026-10-18",
      },
      {
        id,
        question: "未来追问秘密",
        participants,
        judge: null,
        created_at: "2026-10-18",
      },
    ],
    steps: [
      ...councilPlan(participants, null).map((s) => ({
        ...step,
        ...s,
        answer: `原始${s.stage}-${s.model_key}`,
      })),
      ...councilFollowupPlan(participants, "openai-light", "debate", 1, 6).map(
        (s) => ({ ...step, ...s, answer: `本轮${s.stage}-${s.model_key}` }),
      ),
      ...councilFollowupPlan(participants, null, "direct", 2, 13).map((s) => ({
        ...step,
        ...s,
        answer: "未来回答秘密",
      })),
    ],
  };
  const prompt = (seq: number) =>
    JSON.parse(councilPrompt(run, run.steps[seq]).input);
  expect(prompt(7).responses.map((s: { text: string }) => s.text)).toEqual(
    participants.map((key) => `原始revision-${key}`),
  );
  expect(
    prompt(9)
      .responses.filter((s: { round: number }) => s.round === 1)
      .map((s: { text: string }) => s.text),
  ).toEqual(participants.map((key) => `本轮opening-${key}`));
  expect(
    prompt(11)
      .responses.filter((s: { round: number }) => s.round === 1)
      .map((s: { stage: string }) => s.stage),
  ).toEqual(["独立观点", "独立观点", "交叉质询", "交叉质询"]);
  expect(
    prompt(12).responses.filter((s: { round: number }) => s.round === 1),
  ).toHaveLength(6);
  expect(councilPrompt(run, run.steps[11]).system).toContain(
    "本轮其他观点编号",
  );
  expect(councilPrompt(run, run.steps[11]).input).not.toContain("未来");
  expect(prompt(11).attachments[0].text).toBe("本场合成资料");
  expect(prompt(13).previousQuestions).toEqual(["新增约束一"]);
  expect(
    prompt(13).responses.some(
      (s: { round: number; stage: string }) =>
        s.round === 1 && s.stage === "修订结论",
    ),
  ).toBe(true);
  expect(councilRound(run, 1)).toMatchObject({
    mode: "debate",
    firstStage: "opening",
    finalStage: "revision",
  });
  expect(councilRound(run, 2)).toMatchObject({
    mode: "direct",
    firstStage: "followup",
    finalStage: "followup",
  });
  expect(councilExport(run)).toContain("追问 1 · 相互研讨");
  expect(councilExport(run)).toContain("追问 2 · 直接回应");
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
