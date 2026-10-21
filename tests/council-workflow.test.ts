import { expect, it } from "vitest";
import {
  COUNCIL_MODELS,
  councilSpec,
  councilFollowupSpec,
  councilPlan,
  councilFollowupPlan,
  councilPrompt,
  councilExport,
  type CouncilRun,
} from "../lib/council";
import {
  defaultCouncilWorkflow,
  validateCouncilWorkflow,
  syncCouncilWorkflow,
  councilPhaseKey,
  councilWorkflowSearches,
  type CouncilWorkflow,
} from "../lib/council-workflow";
import { councilRound } from "../lib/council-results";
const keys = ["openai-light", "deepseek-light"];
const id = "00000000-0000-4000-8000-000000000003";
const spec = {
  id,
  question: "比较两个合成方案的边界条件",
  participants: keys,
  judge: null,
  consent: true,
};
const base = () => defaultCouncilWorkflow(keys, "standard");
it("旧请求不静默升级，自定义任务规范化后才保存并计费", () => {
  expect(validateCouncilWorkflow(undefined, keys, null)).toBeUndefined();
  expect(councilSpec(spec)).not.toHaveProperty("workflow");
  const w = base();
  w.stages[1].title = "  检查反例  ";
  w.stages[1].instructions = "  请列出三个反例  ";
  const parsed = councilSpec({ ...spec, workflow: w }).workflow!;
  expect(parsed.stages[1]).toMatchObject({
    title: "检查反例",
    instructions: "请列出三个反例",
  });
  expect(councilPlan(keys, null, "deep", parsed)).toHaveLength(6);
  expect(councilPlan(keys, null)).toHaveLength(6);
  const minimal = {
    version: 1,
    stages: [w.stages[0], w.stages[2]],
  } as CouncilWorkflow;
  expect(councilPlan(keys, null, "deep", minimal)).toHaveLength(4);
});
it.each([
  null,
  {},
  [],
  { version: 2, stages: [] },
  { ...base(), tools: true },
  { ...base(), stages: [] },
  { ...base(), stages: Array(9).fill(base().stages[1]) },
])("拒绝坏流程与额外权限 %j", (w) => {
  expect(() => validateCouncilWorkflow(w, keys, null)).toThrow();
});
it.each([
  (w: CouncilWorkflow) => {
    w.stages[1].id = w.stages[0].id;
  },
  (w: CouncilWorkflow) => {
    w.stages[1].id = "judge";
  },
  (w: CouncilWorkflow) => {
    w.stages[1].type = "judge" as never;
  },
  (w: CouncilWorkflow) => {
    w.stages[1].type = "toString" as never;
  },
  (w: CouncilWorkflow) => {
    w.stages[1].title = "\n";
  },
  (w: CouncilWorkflow) => {
    w.stages[1].title = "a".repeat(61);
  },
  (w: CouncilWorkflow) => {
    w.stages[1].instructions = "a".repeat(1201);
  },
  (w: CouncilWorkflow) => {
    w.stages[1].instructions = "\0secret";
  },
  (w: CouncilWorkflow) => {
    w.stages[1].participants = [];
  },
  (w: CouncilWorkflow) => {
    w.stages[1].participants = [keys[0], keys[0]];
  },
  (w: CouncilWorkflow) => {
    w.stages[1].participants = ["glm-flagship"];
  },
  (w: CouncilWorkflow) => {
    w.stages[1].type = "custom";
    w.stages[1].instructions = "短";
  },
  (w: CouncilWorkflow) => {
    w.stages[1].type = "opening";
  },
  (w: CouncilWorkflow) => {
    w.stages[2].type = "custom";
  },
  (w: CouncilWorkflow) => {
    w.stages[0].participants = [keys[0]];
  },
  (w: CouncilWorkflow) => {
    Object.assign(w.stages[1], { tools: ["shell"] });
  },
])("拒绝越界环节、私有型号、伪裁判和非法任务 %#", (mutate) => {
  const w = base();
  mutate(w);
  expect(() => validateCouncilWorkflow(w, keys, null)).toThrow();
});
it("费用与工具上界按每个环节实际参与者计算，而非假定全员参加", () => {
  const w = defaultCouncilWorkflow(keys, "deep");
  w.stages[2].participants = [keys[0]];
  expect(councilPlan(keys, keys[1], "deep", w)).toHaveLength(10);
  expect(councilWorkflowSearches(w, keys, "deep", 2)).toBe(1);
  expect(councilWorkflowSearches(base(), keys, "deep", 2)).toBe(0);
  w.stages.splice(3, 0, { ...w.stages[2], id: "another-investigation" });
  expect(() => validateCouncilWorkflow(w, keys, null)).toThrow("最多一个");
  const six = COUNCIL_MODELS.slice(0, 6).map((m) => m.key);
  const full = defaultCouncilWorkflow(six, "deep");
  expect(councilPlan(six, six[0], "deep", full)).toHaveLength(31);
  full.stages.splice(1, 0, { ...full.stages[1], id: "extra" });
  expect(() => validateCouncilWorkflow(full, six, six[0])).toThrow("31");
});
function fixture() {
  const w = base();
  w.stages.splice(
    2,
    0,
    { ...w.stages[1], id: "critique-again", title: "第二次质询" },
    {
      id: "scenario",
      type: "custom",
      title: "极端情景",
      instructions: "比较成本和停止条件",
      participants: [keys[0]],
    },
  );
  const run: CouncilRun = {
    ...spec,
    workflow: w,
    models: COUNCIL_MODELS.filter((m) => keys.includes(m.key)),
    status: "complete",
    created_at: "2026-10-20",
    steps: councilPlan(keys, null, "standard", w).map((s) => ({
      ...s,
      status: "succeeded",
      answer: `source-${s.seq}`,
      error: "",
      usage: { input: 1, output: 1 },
      started_at: null,
      finished_at: null,
    })),
  };
  return run;
}
it("重复类型按独立环节形成快照屏障，不偷看同环节或未来答案", () => {
  const run = fixture();
  const p = (seq: number) =>
    JSON.parse(councilPrompt(run, run.steps[seq]).input);
  expect(p(3).responses.map((r: { text: string }) => r.text)).toEqual([
    "source-0",
    "source-1",
  ]);
  expect(p(5).responses.map((r: { text: string }) => r.text)).toEqual([
    "source-0",
    "source-1",
    "source-2",
    "source-3",
  ]);
  expect(p(6).responses.map((r: { phaseId: string }) => r.phaseId)).toEqual([
    "opening",
    "opening",
    "critique",
    "critique",
    "critique-again",
    "critique-again",
  ]);
  expect(p(6).userStage).toMatchObject({
    title: "极端情景",
    instructions: "比较成本和停止条件",
  });
  expect(p(6).availableTools).toEqual([]);
  expect(p(7).responses.at(-1).text).toBe("source-6");
  expect(councilPrompt(run, run.steps[6]).system).toContain("不能扩大工具");
});
it("自定义追问独立冻结、接续旧最终结论，拒绝直接回应附带流程", () => {
  const run = fixture(),
    workflow = run.workflow!;
  const turn = {
    turnId: id,
    id,
    baseRound: 0,
    question: "根据新条件再验证一次",
    participants: keys,
    judge: null,
    mode: "debate",
    workflow,
    consent: true,
  };
  expect(councilFollowupSpec(turn).workflow).toEqual(workflow);
  expect(() => councilFollowupSpec({ ...turn, mode: "direct" })).toThrow(
    "自定义环节",
  );
  const additions = councilFollowupPlan(
    keys,
    null,
    "debate",
    1,
    run.steps.length,
    "standard",
    workflow,
  );
  expect(additions[0]).toMatchObject({
    seq: run.steps.length,
    round: 1,
    phase_id: "opening",
  });
  run.turns = [
    {
      id,
      question: turn.question,
      participants: keys,
      judge: null,
      mode: "debate",
      workflow,
      created_at: "2026-10-20",
    },
  ];
  run.steps.push(
    ...additions.map((s) => ({
      ...s,
      status: "pending" as const,
      answer: "",
      error: "",
      usage: { input: null, output: null },
      started_at: null,
      finished_at: null,
    })),
  );
  const prompt = JSON.parse(councilPrompt(run, run.steps[9]).input);
  expect(prompt.question).toBe(turn.question);
  expect(
    prompt.responses.every(
      (s: { round: number; stage: string }) =>
        s.round === 0 && s.stage === "最终结论",
    ),
  ).toBe(true);
});
it("专职模型被移除时不偷偷换人；历史保留流程任务并导出", () => {
  const w = base();
  w.stages[1].participants = [keys[0]];
  const changed = syncCouncilWorkflow(w, keys, [keys[1], "glm-flagship"])!;
  expect(changed.stages[0].participants).toEqual([keys[1], "glm-flagship"]);
  expect(changed.stages[1].participants).toEqual([]);
  expect(() =>
    validateCouncilWorkflow(changed, [keys[1], "glm-flagship"], null),
  ).toThrow();
  const run = fixture();
  expect(councilPhaseKey(run.steps[4])).toBe("critique-again");
  expect(councilRound(run, 0).finalPhase).toBe("revision");
  expect(councilExport(run)).toContain("比较成本和停止条件");
  expect(councilExport(run)).toContain("第二次质询");
});
