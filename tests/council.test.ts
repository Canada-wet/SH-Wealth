import { it, expect } from "vitest";
import {
  COUNCIL_MODELS,
  councilPlan,
  councilPrompt,
  councilSpec,
  councilExport,
  type CouncilRun,
} from "../lib/council";
const id = "00000000-0000-4000-8000-000000000003";
export function fixture(): CouncilRun {
  return {
    id,
    question: "How should I compare these options?",
    participants: ["deepseek-light", "openai-light"],
    judge: "openai-flagship",
    models: COUNCIL_MODELS.filter((m) =>
      ["deepseek-light", "openai-light", "openai-flagship"].includes(m.key),
    ),
    status: "active",
    created_at: "2026-10-18T12:00:00Z",
    steps: councilPlan(
      ["deepseek-light", "openai-light"],
      "openai-flagship",
    ).map((s) => ({
      ...s,
      status: "pending",
      answer: "",
      error: "",
      usage: { input: null, output: null },
      started_at: null,
      finished_at: null,
    })),
  };
}
it("完整覆盖八家服务，仅使用核实的当前型号，不虚构 Lite", () => {
  expect(new Set(COUNCIL_MODELS.map((m) => m.provider)).size).toBe(8);
  expect(new Set(COUNCIL_MODELS.map((m) => m.key)).size).toBe(
    COUNCIL_MODELS.length,
  );
  expect(COUNCIL_MODELS.find((m) => m.key === "glm-flagship")?.model).toBe(
    "glm-5.3",
  );
  expect(COUNCIL_MODELS.filter((m) => m.provider === "meta")).toHaveLength(1);
  expect(
    COUNCIL_MODELS.find((m) => m.key === "moonshot-alternative")?.tier,
  ).toBe("alternative");
});
it("验证参与者、授权、输入长度，拒绝重复模型和任意客户端 model / URL", () => {
  const spec = {
    id,
    question: "一个值得认真思考的问题",
    participants: ["deepseek-light", "openai-light"],
    judge: null,
    consent: true,
  };
  expect(councilSpec(spec).participants).toHaveLength(2);
  for (const patch of [
    { consent: false },
    { judge: undefined },
    { question: "abc" },
    { question: "a".repeat(6001) },
    { participants: ["deepseek-light", "deepseek-light"] },
    { participants: ["https://evil.test", "openai-light"] },
    { participants: ["openai-light"] },
    { id: "../private" },
  ])
    expect(() => councilSpec({ ...spec, ...patch })).toThrow();
});
it("固定三个阶段和可选裁判，不设裁判不冒充汇总", () => {
  expect(councilPlan(["a", "b"], null).map((s) => s.stage)).toEqual([
    "opening",
    "opening",
    "critique",
    "critique",
    "revision",
    "revision",
  ]);
  expect(councilPlan(["a", "b"], "c")).toHaveLength(7);
  expect(councilPlan(["a", "b"], "a").at(-1)).toMatchObject({
    seq: 6,
    stage: "judge",
    model_key: "a",
  });
});
it("同阶段不偷看先发言者；质询和修订真正读取前阶段，裁判看到分歧及失败", () => {
  const r = fixture();
  r.steps.forEach((s) => {
    s.status = "succeeded";
    s.answer = `stage-${s.seq}`;
  });
  expect(JSON.parse(councilPrompt(r, r.steps[1]).input).responses).toEqual([]);
  expect(
    JSON.parse(councilPrompt(r, r.steps[3]).input).responses.map(
      (x: { text: string }) => x.text,
    ),
  ).toEqual(["stage-0", "stage-1"]);
  expect(JSON.parse(councilPrompt(r, r.steps[5]).input).responses).toHaveLength(
    4,
  );
  r.steps[0].status = "failed";
  r.steps[0].error = "upstream failed";
  const input = JSON.parse(councilPrompt(r, r.steps[6]).input);
  expect(input.responses).toHaveLength(5);
  expect(input.missing).toHaveLength(1);
  expect(JSON.stringify(input)).not.toContain("deepseek");
  expect(JSON.parse(councilPrompt(r, r.steps[1]).input).missing).toHaveLength(
    0,
  );
  expect(councilPrompt(r, r.steps[6]).system).toContain("不按品牌或票数判真伪");
});
it("限制上下文并明确摘录，不把输出当系统指令；导出保留失败与型号", () => {
  const r = fixture();
  r.steps[0].status = "succeeded";
  r.steps[0].answer = "x".repeat(5000);
  r.steps[1].status = "failed";
  r.steps[1].error = "quota";
  const input = JSON.parse(councilPrompt(r, r.steps[3]).input);
  expect(input.responses[0].text.length).toBe(4000);
  expect(input.responses[0].excerpt).toBe(true);
  expect(councilPrompt(r, r.steps[3]).system).toContain("不可信资料");
  const md = councilExport(r);
  expect(md).toContain("quota");
  expect(md).toContain("GPT-6 Luna");
  expect(JSON.stringify(r)).not.toMatch(/household|assets|members|password/i);
});
