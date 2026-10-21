import { it, expect, vi, beforeEach, afterEach } from "vitest";
const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  call: vi.fn(),
  availability: vi.fn(),
  search: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: mock.rpc }),
}));
vi.mock("../lib/council-tools", async () => ({
  ...(await vi.importActual<typeof import("../lib/council-tools")>(
    "../lib/council-tools",
  )),
  councilPublicSearch: mock.search,
}));
vi.mock("../lib/council-provider", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/council-provider")
  >("../lib/council-provider");
  return {
    ...actual,
    callCouncilModel: mock.call,
    councilAvailability: mock.availability,
  };
});
import {
  createCouncil,
  advanceCouncil,
  councilCommand,
} from "../lib/council-server";
import {
  COUNCIL_MODELS,
  councilPlan,
  councilFollowupPlan,
  type CouncilRun,
} from "../lib/council";
import { councilModelSnapshot } from "../lib/council-provider";
import { CouncilProviderError } from "../lib/council-provider";
import { defaultCouncilWorkflow } from "../lib/council-workflow";
const id = "00000000-0000-4000-8000-000000000003";
let doc: CouncilRun;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "private-server-test-key");
  vi.stubEnv("OPENAI_API_KEY", "test-openai");
  vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek");
  doc = {
    id,
    question: "Explain opportunity costs",
    participants: ["deepseek-light", "openai-light"],
    judge: "openai-light",
    models: COUNCIL_MODELS.filter((m) =>
      ["deepseek-light", "openai-light"].includes(m.key),
    ),
    status: "active",
    created_at: "2026-10-18",
    steps: councilPlan(["deepseek-light", "openai-light"], "openai-light").map(
      (s) => ({
        ...s,
        status: "pending",
        answer: "",
        error: "",
        usage: { input: null, output: null },
        started_at: null,
        finished_at: null,
      }),
    ),
  };
  mock.availability.mockReturnValue(
    COUNCIL_MODELS.map((m) => ({ key: m.key, ready: true })),
  );
  mock.call.mockResolvedValue({
    answer: "A visible conclusion",
    usage: { input: 10, output: 20 },
  });
  mock.search.mockResolvedValue({
    output: "合成公开证据",
    sources: [
      {
        title: "Synthetic original source",
        url: "https://www.bankofcanada.ca/",
      },
    ],
  });
  mock.rpc.mockImplementation(async (_name, args) => {
    if (_name === "wealth_council_workflow_version")
      return { data: 1, error: null };
    if (args.action === "tool-start" && doc.status === "active") {
      const step = doc.steps[args.payload.seq];
      const existing = doc.steps
        .flatMap((s) => s.tool_receipts ?? [])
        .find(
          (r) =>
            r.tool === "search_public" && r.queryId === args.payload.queryId,
        );
      if (!existing)
        step.tool_receipts = [
          {
            id: args.payload.receiptId,
            tool: "search_public",
            status: "running",
            input: doc.research!.publicQueries[args.payload.queryId],
            output: "",
            queryId: args.payload.queryId,
            checkedAt: "2026-10-18",
          },
        ];
    }
    if (
      args.action === "claim" &&
      doc.status === "active" &&
      !doc.steps.some((s) => s.status === "running")
    ) {
      const step = doc.steps.find((s) => s.status === "pending");
      if (step) {
        step.status = "running";
        Object.assign(step, { claim: args.payload.claim });
      }
    }
    if (args.action === "finish") {
      const step = doc.steps[args.payload.seq];
      Object.assign(step, args.payload, {
        status: args.payload.answer ? "succeeded" : "failed",
      });
      delete (step as unknown as Record<string, unknown>).claim;
      if (
        doc.steps.every(
          (s) => s.status === "succeeded" || s.status === "failed",
        )
      )
        doc.status = "complete";
    }
    return { data: structuredClone(doc), error: null };
  });
});
it("自定义创建先核对数据库能力，保存规范化执行计划；旧数据库不启动付费调用", async () => {
  const workflow = defaultCouncilWorkflow(doc.participants, "standard");
  await createCouncil("owner", {
    id,
    question: doc.question,
    participants: doc.participants,
    judge: doc.judge,
    workflow,
  });
  expect(mock.rpc.mock.calls[0][0]).toBe("wealth_council_workflow_version");
  expect(mock.rpc.mock.calls[1][1].payload.steps).toHaveLength(7);
  expect(mock.rpc.mock.calls[1][1].payload.steps[2].phase_id).toBe("critique");
  expect(mock.call).not.toHaveBeenCalled();
  mock.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "missing function" },
  });
  await expect(
    createCouncil("owner", {
      id,
      question: doc.question,
      participants: doc.participants,
      judge: null,
      workflow,
    }),
  ).rejects.toThrow("council-workflows.sql");
  expect(mock.rpc).toHaveBeenCalledTimes(3);
});
it("自定义流程可没有质询；足够开场后允许继续，计划不匹配则阻止付费", async () => {
  const w = defaultCouncilWorkflow(doc.participants, "standard");
  w.stages.splice(1, 1);
  doc.workflow = w;
  doc.research = {
    depth: "deep",
    tools: false,
    publicQueries: [],
    webConsent: false,
  };
  doc.judge = null;
  doc.steps = councilPlan(doc.participants, null, "deep", w).map((s) => ({
    ...s,
    status: s.stage === "opening" ? "succeeded" : "pending",
    answer: s.stage === "opening" ? "Visible opening" : "",
    error: "",
    usage: { input: null, output: null },
    started_at: null,
    finished_at: null,
  }));
  await advanceCouncil("owner", id);
  expect(mock.call).toHaveBeenCalledTimes(1);
  expect(doc.steps[2].status).toBe("succeeded");
  doc.steps[3].phase_id = "injected";
  await advanceCouncil("owner", id);
  expect(mock.call).toHaveBeenCalledTimes(1);
  expect(doc.steps[3].error).toContain("不一致");
});
function researchFixture() {
  doc.research = {
    depth: "deep",
    tools: true,
    publicQueries: ["Bank of Canada official rate"],
    webConsent: true,
  };
  doc.steps = councilPlan(doc.participants, doc.judge, "deep").map((s, i) => ({
    ...s,
    status: i < 4 ? "succeeded" : "pending",
    answer: i < 4 ? "合成开场与质询" : "",
    error: "",
    usage: { input: 1, output: 2 },
    started_at: null,
    finished_at: null,
  }));
  mock.call.mockResolvedValue({
    answer: JSON.stringify({
      focus: "核查观点1的C1",
      requests: [
        { tool: "calculate", expression: "2+2" },
        { tool: "search_public", queryId: 0 },
      ],
    }),
    usage: { input: 20, output: 40 },
  });
}
it("深入核查真实运行工具，联网前持久化意图，同轮复用只搜索一次，答辩收到回执", async () => {
  researchFixture();
  mock.search.mockImplementationOnce(async () => {
    expect(doc.steps[4].tool_receipts?.[0].status).toBe("running");
    return { output: "实际合成工具输出", sources: [] };
  });
  await advanceCouncil("owner", id);
  expect(doc.steps[4].tool_receipts?.map((r) => r.tool)).toEqual([
    "calculate",
    "search_public",
  ]);
  expect(doc.steps[4].tool_receipts?.[0].output).toContain("= 4");
  expect(mock.call.mock.calls[0][5]).toBe("deep");
  await advanceCouncil("owner", id);
  expect(mock.search).toHaveBeenCalledTimes(1);
  expect(doc.steps[5].tool_receipts?.[1]).toMatchObject({
    id: "T6.2",
    reusedFrom: "T5.2",
    status: "succeeded",
  });
  mock.call.mockResolvedValueOnce({
    answer: "按回执逐项答辩",
    usage: { input: 1, output: 2 },
  });
  await advanceCouncil("owner", id);
  const context = JSON.parse(mock.call.mock.calls[2][2]);
  expect(JSON.stringify(context.responses)).toContain("实际合成工具输出");
  expect(JSON.stringify(context.responses)).toContain("T5.2");
});
it("联网意图保存失败不接触搜索服务；计划格式错误或未经授权也不执行工具", async () => {
  researchFixture();
  const rpc = mock.rpc.getMockImplementation()!;
  mock.rpc.mockImplementation(async (name, args) =>
    args.action === "tool-start"
      ? { error: { message: "storage unavailable" } }
      : rpc(name, args),
  );
  await expect(advanceCouncil("owner", id)).rejects.toThrow("存储暂不可用");
  expect(mock.search).not.toHaveBeenCalled();
  expect(doc.steps[4].status).toBe("running");
  doc.steps[4].status = "failed";
  mock.call.mockResolvedValueOnce({
    answer: "```json\n{broken}\n```",
    usage: { input: 1, output: 2 },
  });
  await advanceCouncil("owner", id);
  expect(doc.steps[5].answer).toContain("未执行任何工具");
  expect(mock.search).not.toHaveBeenCalled();
});
it("联网已提交但归档失败后，下一模型复用未知状态，不再收费重查", async () => {
  researchFixture();
  const rpc = mock.rpc.getMockImplementation()!;
  mock.rpc.mockImplementation(async (name, args) =>
    args.action === "finish" && args.payload.seq === 4
      ? { error: { message: "storage unavailable" } }
      : rpc(name, args),
  );
  await expect(advanceCouncil("owner", id)).rejects.toThrow();
  expect(mock.search).toHaveBeenCalledTimes(1);
  doc.steps[4].status = "failed"; // Explicit abandon, not an automatic retry.
  await advanceCouncil("owner", id);
  expect(mock.search).toHaveBeenCalledTimes(1);
  expect(doc.steps[5].tool_receipts?.[1]).toMatchObject({
    status: "unknown",
    reusedFrom: "T5.2",
  });
});
afterEach(() => vi.unstubAllEnvs());
it("两标签并发只认领一次；持久化先于调用，返回后归档", async () => {
  let finish!: (v: unknown) => void;
  mock.call.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = advanceCouncil("owner", id);
  await vi.waitFor(() => expect(mock.call).toHaveBeenCalledTimes(1));
  await advanceCouncil("owner", id);
  expect(mock.call).toHaveBeenCalledTimes(1);
  finish({ answer: "first answer", usage: { input: 1, output: 2 } });
  await first;
  expect(doc.steps[0].answer).toBe("first answer");
  expect(mock.rpc.mock.calls[0][1]).toMatchObject({
    action: "claim",
    target_user: "owner",
    run_id: id,
  });
});
it("完整阶段真正互相读取发言；可用参与模型兼任裁判", async () => {
  doc.attachments = [
    {
      id,
      name: "evidence.txt",
      kind: "text",
      mime: "text/plain",
      content: "Synthetic source material",
      note: "本机提取文字",
    },
  ];
  for (let i = 0; i < 7; i++) await advanceCouncil("owner", id);
  expect(doc.status).toBe("complete");
  expect(mock.call).toHaveBeenCalledTimes(7);
  expect(JSON.parse(mock.call.mock.calls[1][2]).responses).toHaveLength(0);
  expect(JSON.parse(mock.call.mock.calls[2][2]).responses).toHaveLength(2);
  expect(JSON.parse(mock.call.mock.calls[4][2]).responses).toHaveLength(4);
  expect(mock.call.mock.calls[6][1]).toContain("作独立裁判");
  expect(
    mock.call.mock.calls.every((call) =>
      call[2].includes("Synthetic source material"),
    ),
  ).toBe(true);
});
it("开场不足两份就跳过后续付费请求，不伪造完整研讨", async () => {
  mock.call.mockRejectedValueOnce(Error("internal-secret"));
  for (let i = 0; i < 7; i++) await advanceCouncil("owner", id);
  expect(mock.call).toHaveBeenCalledTimes(2);
  expect(doc.status).toBe("complete");
  expect(doc.steps[2].error).toContain("不足两份");
  expect(JSON.stringify(doc)).not.toContain("internal-secret");
});
it("追问只需一个响应者，读取历史后原子归档；当前轮全部失败时不付费让裁判猜测", async () => {
  doc.steps.forEach((s) => {
    s.status = "failed";
    s.error = "initial unavailable";
  });
  doc.steps[0].status = "succeeded";
  doc.steps[0].answer = "One useful initial view";
  doc.turns = [
    {
      id,
      question: "现在新条件呢？",
      participants: ["openai-light"],
      judge: "openai-light",
      created_at: "2026-10-18",
    },
  ];
  doc.steps.push(
    {
      ...doc.steps[0],
      seq: 7,
      round: 1,
      model_key: "openai-light",
      stage: "followup",
      status: "pending",
      answer: "",
      error: "",
    },
    {
      ...doc.steps[0],
      seq: 8,
      round: 1,
      model_key: "openai-light",
      stage: "judge",
      status: "pending",
      answer: "",
      error: "",
    },
  );
  await advanceCouncil("owner", id);
  expect(mock.call).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mock.call.mock.calls[0][2]).question).toBe(
    "现在新条件呢？",
  );
  doc.steps[7].status = "failed";
  await advanceCouncil("owner", id);
  expect(mock.call).toHaveBeenCalledTimes(1);
  expect(doc.steps[8].error).toContain("本轮没有成功回应");
});
function appendDebate() {
  doc.steps.forEach((s) => {
    s.status = "succeeded";
    s.answer = "旧轮有效结论";
  });
  doc.turns = [
    {
      id,
      question: "新增约束后再研讨",
      participants: doc.participants,
      judge: doc.judge,
      mode: "debate",
      created_at: "2026-10-18",
    },
  ];
  doc.steps.push(
    ...councilFollowupPlan(
      doc.participants,
      doc.judge,
      "debate",
      1,
      doc.steps.length,
    ).map((s) => ({
      ...s,
      status: "pending" as const,
      answer: "",
      error: "",
      usage: { input: null, output: null },
      started_at: null,
      finished_at: null,
    })),
  );
}
it("追问完整三阶段只运行新步骤；质询读取本轮独立观点，修订读取本轮质询", async () => {
  appendDebate();
  for (let i = 0; i < 7; i++) await advanceCouncil("owner", id);
  expect(doc.status).toBe("complete");
  expect(mock.call).toHaveBeenCalledTimes(7);
  const context = (i: number) => JSON.parse(mock.call.mock.calls[i][2]);
  expect(
    context(1).responses.every((s: { round: number }) => s.round === 0),
  ).toBe(true);
  expect(
    context(2).responses.filter((s: { round: number }) => s.round === 1),
  ).toHaveLength(2);
  expect(
    context(4).responses.filter(
      (s: { round: number; stage: string }) =>
        s.round === 1 && s.stage === "交叉质询",
    ),
  ).toHaveLength(2);
  expect(
    context(6).responses.filter(
      (s: { round: number; stage: string }) =>
        s.round === 1 && s.stage === "修订结论",
    ),
  ).toHaveLength(2);
  expect(doc.steps.slice(0, 7).every((s) => s.answer === "旧轮有效结论")).toBe(
    true,
  );
});
it("旧轮成功不能替代本轮观点；本轮不足两份完整开场不调用交锋和裁判", async () => {
  appendDebate();
  mock.call.mockResolvedValueOnce({
    answer: "不完整的开场",
    usage: { input: 1, output: 2, interrupted: true },
  });
  for (let i = 0; i < 7; i++) await advanceCouncil("owner", id);
  expect(mock.call).toHaveBeenCalledTimes(2);
  expect(doc.status).toBe("complete");
  expect(doc.steps.slice(9).every((s) => s.error.includes("不足两份"))).toBe(
    true,
  );
});
it("本轮修订全部失败时不让裁判用旧结论冒充新汇总", async () => {
  appendDebate();
  for (let i = 0; i < 4; i++) await advanceCouncil("owner", id);
  mock.call.mockRejectedValueOnce(new CouncilProviderError("响应失败"));
  mock.call.mockRejectedValueOnce(new CouncilProviderError("响应失败"));
  for (let i = 0; i < 3; i++) await advanceCouncil("owner", id);
  expect(mock.call).toHaveBeenCalledTimes(6);
  expect(doc.steps.at(-1)?.error).toContain("本轮没有成功回应");
});
it("同轮已确认权限拒绝的型号跳过后续请求，其他模型继续，不自动换渠道", async () => {
  doc.participants = ["deepseek-light", "openai-light", "openai-flagship"];
  doc.models = COUNCIL_MODELS.filter((m) => doc.participants.includes(m.key));
  doc.judge = null;
  doc.steps = councilPlan(doc.participants, null).map((s) => ({
    ...s,
    status: "pending",
    answer: "",
    error: "",
    usage: { input: null, output: null },
    started_at: null,
    finished_at: null,
  }));
  mock.call.mockRejectedValueOnce(
    new CouncilProviderError("需要开通模型权限", "access"),
  );
  for (let i = 0; i < 9; i++) await advanceCouncil("owner", id);
  expect(mock.call).toHaveBeenCalledTimes(7);
  expect(doc.steps[3].error).toContain("未再次调用");
  expect(doc.steps[6].error_kind).toBe("access");
});
it("未配置或已暂停不调用；错误保留成明确状态", async () => {
  doc.status = "paused";
  await advanceCouncil("owner", id);
  expect(mock.call).not.toHaveBeenCalled();
  mock.availability.mockReturnValue([]);
  await expect(
    createCouncil("owner", {
      id,
      question: doc.question,
      participants: doc.participants,
      judge: null,
    }),
  ).rejects.toThrow("尚未配置");
  mock.rpc.mockResolvedValueOnce({ error: { message: "council_quota" } });
  await expect(councilCommand("create", "owner", id)).rejects.toMatchObject({
    status: 429,
  });
  mock.rpc.mockResolvedValueOnce({
    error: { message: "secret database detail" },
  });
  await expect(councilCommand("claim", "owner", id)).rejects.toThrow(
    "未自动重发",
  );
});
it("存储失败后不重发模型，认领状态保留供用户处理", async () => {
  mock.rpc.mockImplementationOnce(async (_name, args) => {
    Object.assign(doc.steps[0], {
      status: "running",
      claim: args.payload.claim,
    });
    return { data: structuredClone(doc), error: null };
  });
  mock.rpc.mockResolvedValueOnce({ error: { message: "connection-lost" } });
  await expect(advanceCouncil("owner", id)).rejects.toThrow("存储暂不可用");
  await advanceCouncil("owner", id);
  expect(mock.call).toHaveBeenCalledTimes(1);
});
it("新研讨保存实际渠道和API型号，忽略客户端自行提供的快照", async () => {
  await createCouncil("owner", {
    id,
    question: doc.question,
    participants: doc.participants,
    judge: null,
  });
  const payload = mock.rpc.mock.calls[0][1].payload;
  expect(
    payload.models.find((m: { key: string }) => m.key === "openai-light")
      .connection,
  ).toEqual({ channel: "direct", model: "gpt-6-luna" });
  expect(JSON.stringify(payload)).not.toContain("test-openai");
});
it("开场前渠道变化要求重新确认，不把旧客户端的问题静默转发至百炼", async () => {
  vi.stubEnv("QWEN_API_KEY", "test-bailian");
  vi.stubEnv(
    "QWEN_BASE_URL",
    "https://example.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
  );
  vi.stubEnv("ZAI_API_KEY", "");
  const spec = {
    id,
    question: "SYNTHETIC public question",
    participants: ["openai-light", "glm-flagship"],
    judge: null,
  };
  await expect(createCouncil("owner", spec)).rejects.toMatchObject({
    status: 409,
  });
  expect(mock.rpc).not.toHaveBeenCalled();
  const expectedConnections = Object.fromEntries(
    COUNCIL_MODELS.filter((m) => spec.participants.includes(m.key)).map((m) => [
      m.key,
      councilModelSnapshot(m).connection!,
    ]),
  );
  await createCouncil("owner", { ...spec, expectedConnections });
  expect(mock.rpc).toHaveBeenCalledTimes(1);
  expect(mock.rpc.mock.calls[0][1].payload).not.toHaveProperty(
    "expectedConnections",
  );
});
