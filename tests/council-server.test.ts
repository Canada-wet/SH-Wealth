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
const id = "00000000-0000-4000-8000-000000000003";
let doc: CouncilRun;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "private-server-test-key");
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
  for (let i = 0; i < 7; i++) await advanceCouncil("owner", id);
  expect(doc.status).toBe("complete");
  expect(mock.call).toHaveBeenCalledTimes(7);
  expect(JSON.parse(mock.call.mock.calls[1][2]).responses).toHaveLength(0);
  expect(JSON.parse(mock.call.mock.calls[2][2]).responses).toHaveLength(2);
  expect(JSON.parse(mock.call.mock.calls[4][2]).responses).toHaveLength(4);
  expect(mock.call.mock.calls[6][1]).toContain("作独立裁判");
});
it("开场不足两份就跳过后续付费请求，不伪造完整研讨", async () => {
  mock.call.mockRejectedValueOnce(Error("internal-secret"));
  for (let i = 0; i < 7; i++) await advanceCouncil("owner", id);
  expect(mock.call).toHaveBeenCalledTimes(2);
  expect(doc.status).toBe("complete");
  expect(doc.steps[2].error).toContain("不足两份");
  expect(JSON.stringify(doc)).not.toContain("internal-secret");
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
