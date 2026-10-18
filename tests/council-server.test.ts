import { it, expect, vi, beforeEach, afterEach } from "vitest";
const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  call: vi.fn(),
  availability: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: mock.rpc }),
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
import { COUNCIL_MODELS, councilPlan, type CouncilRun } from "../lib/council";
import { councilModelSnapshot } from "../lib/council-provider";
import { CouncilProviderError } from "../lib/council-provider";
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
  mock.rpc.mockImplementation(async (_name, args) => {
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
