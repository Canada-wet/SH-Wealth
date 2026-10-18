import { it, expect, vi, beforeEach } from "vitest";
const mock = vi.hoisted(() => ({
  auth: vi.fn(),
  create: vi.fn(),
  advance: vi.fn(),
  command: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  check: vi.fn(),
}));
vi.mock("../lib/server-auth", () => ({ authorizeRequest: mock.auth }));
vi.mock("../lib/council-provider", async () => ({
  ...(await vi.importActual<typeof import("../lib/council-provider")>(
    "../lib/council-provider",
  )),
  checkAlibabaConnection: mock.check,
}));
vi.mock("../lib/council-server", async () => {
  const actual = await vi.importActual<typeof import("../lib/council-server")>(
    "../lib/council-server",
  );
  return {
    ...actual,
    createCouncil: mock.create,
    advanceCouncil: mock.advance,
    councilCommand: mock.command,
  };
});
import { GET, POST } from "../app/api/council/route";
import { COUNCIL_MODELS, councilPlan, type CouncilRun } from "../lib/council";
const id = "00000000-0000-4000-8000-000000000003";
const run: CouncilRun = {
  id,
  question: "A complex question",
  participants: ["deepseek-light", "openai-light"],
  judge: null,
  models: COUNCIL_MODELS.slice(0, 2),
  status: "active",
  created_at: "2026-10-18",
  steps: councilPlan(["deepseek-light", "openai-light"], null).map((s) => ({
    ...s,
    status: "pending",
    answer: "",
    error: "",
    usage: { input: null, output: null },
    started_at: null,
    finished_at: null,
  })),
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.mockResolvedValue({
    status: 200,
    user: { id: "verified-user" },
    client: { from: mock.from, rpc: mock.rpc },
  });
  mock.create.mockResolvedValue(run);
  mock.advance.mockResolvedValue(run);
  mock.command.mockResolvedValue(run);
  mock.rpc.mockResolvedValue({ data: true, error: null });
  mock.check.mockResolvedValue({
    ok: true,
    message: "合成目录检查",
    modelKeys: ["glm-flagship"],
  });
});
const post = (body: unknown, origin = "https://app.test") =>
  POST(
    new Request("https://app.test/api/council", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin },
      body: JSON.stringify(body),
    }),
  );
it("目录检查验证本人和频率，仅检查不生成；过频不碰服务商", async () => {
  const r = await post({ action: "check-alibaba" });
  expect(r.status).toBe(200);
  expect(mock.rpc).toHaveBeenCalledWith("take_wealth_advisor_slot");
  expect(mock.check).toHaveBeenCalledTimes(1);
  expect(mock.create).not.toHaveBeenCalled();
  expect(mock.advance).not.toHaveBeenCalled();
  mock.rpc.mockResolvedValueOnce({ data: false });
  expect((await post({ action: "check-alibaba" })).status).toBe(429);
  expect(mock.check).toHaveBeenCalledTimes(1);
});
it("追问只把经过校验的请求交给本人原子命令，未授权不启动；流式结果剥离 claim", async () => {
  const spec = {
    action: "followup",
    id,
    turnId: id,
    question: "新的约束条件呢？",
    participants: ["openai-light"],
    judge: null,
    baseRound: 0,
    consent: true,
    user_id: "victim",
  };
  expect((await post({ ...spec, consent: false })).status).toBe(400);
  expect(mock.command).not.toHaveBeenCalled();
  expect((await post(spec)).status).toBe(200);
  expect(mock.command).toHaveBeenCalledWith("followup", "verified-user", id, {
    turnId: id,
    question: "新的约束条件呢？",
    participants: ["openai-light"],
    judge: null,
    baseRound: 0,
    mode: "direct",
  });
  const d = structuredClone(run);
  Object.assign(d.steps[0], { claim: "DO_NOT_EXPOSE" });
  mock.advance.mockImplementationOnce(async (_u, _id, progress) => {
    progress({ phase: "thinking", seq: 0 });
    progress({ phase: "answering", preview: "临时正文", seq: 0 });
    return d;
  });
  const stream = await post({ action: "advance", id, stream: true });
  expect(stream.headers.get("content-type")).toContain("application/x-ndjson");
  const body = await stream.text();
  expect(body).toContain('"type":"result"');
  expect(body).toContain("临时正文");
  expect(body).not.toContain("DO_NOT_EXPOSE");
});
it("所有读写需验证登录，拒绝跨源请求、任意动作和过大内容", async () => {
  mock.auth.mockResolvedValueOnce({ status: 401, error: "login" });
  expect((await GET(new Request("https://app.test/api/council"))).status).toBe(
    401,
  );
  mock.auth.mockResolvedValueOnce({ status: 403, error: "forbidden" });
  expect((await post({})).status).toBe(403);
  expect(
    (await post({ action: "advance", id }, "https://evil.test")).status,
  ).toBe(403);
  expect((await post({ action: "executeSql", id })).status).toBe(400);
  expect((await post({ action: "abandon", id, seq: 999 })).status).toBe(400);
  expect((await post({ question: "x".repeat(16001) })).status).toBe(400);
  expect(mock.create).not.toHaveBeenCalled();
  expect(mock.advance).not.toHaveBeenCalled();
});
it("追问三阶段模式校验后交给数据库，不能伪造计划；新增步骤可明确跳过到最后一轮", async () => {
  const spec = {
    action: "followup",
    id,
    turnId: id,
    question: "新条件下请继续研讨",
    participants: ["openai-light", "deepseek-light"],
    judge: null,
    baseRound: 0,
    consent: true,
    mode: "debate",
    steps: [{ stage: "evil" }],
  };
  expect((await post({ ...spec, participants: ["openai-light"] })).status).toBe(
    400,
  );
  expect((await post({ ...spec, mode: "evil" })).status).toBe(400);
  expect(mock.command).not.toHaveBeenCalled();
  expect((await post(spec)).status).toBe(200);
  expect(mock.command.mock.calls[0][3]).toMatchObject({
    mode: "debate",
    participants: spec.participants,
  });
  expect(mock.command.mock.calls[0][3]).not.toHaveProperty("steps");
  expect((await post({ action: "abandon", id, seq: 170 })).status).toBe(200);
  expect((await post({ action: "abandon", id, seq: 171 })).status).toBe(400);
});
it("服务端强制本人 ID 与模型白名单，不接受伪造 owner / secret / URL", async () => {
  const response = await post({
    action: "create",
    id,
    question: "请深入比较这两个方案",
    participants: ["deepseek-light", "openai-light"],
    judge: null,
    consent: true,
    user_id: "victim",
    api_key: "injected",
    endpoint: "https://evil.test",
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mock.create).toHaveBeenCalledWith("verified-user", {
    id,
    question: "请深入比较这两个方案",
    participants: ["deepseek-light", "openai-light"],
    judge: null,
  });
  expect(
    (
      await post({
        action: "create",
        id,
        question: "valid question",
        participants: ["evil-model", "openai-light"],
        judge: null,
        consent: true,
      })
    ).status,
  ).toBe(400);
});
it("有界文档超过旧 16K 限制仍可保存；图片与文字裁判不兼容、巨大请求在付费前拒绝", async () => {
  const attachment = {
    id,
    name: "paper.txt",
    kind: "text",
    mime: "text/plain",
    content: "研".repeat(20000),
    note: "Synthetic",
  };
  const spec = {
    action: "create",
    id,
    question: "分析材料中的证据",
    participants: ["deepseek-light", "openai-light"],
    judge: null,
    consent: true,
    attachments: [attachment],
  };
  expect((await post(spec)).status).toBe(200);
  expect(mock.create.mock.calls[0][1].attachments[0].content.length).toBe(
    20000,
  );
  expect(
    (
      await post({
        ...spec,
        attachments: [{ ...attachment, content: "a".repeat(710000) }],
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await post({
        ...spec,
        attachments: [
          {
            ...attachment,
            kind: "image",
            mime: "image/png",
            content: "https://evil.test/image",
          },
        ],
      })
    ).status,
  ).toBe(400);
  expect(mock.create).toHaveBeenCalledTimes(1);
  expect(mock.advance).not.toHaveBeenCalled();
});
it("返回归档时剥离执行 claim；无库不声称已保存，也不启动付费请求", async () => {
  const d = structuredClone(run);
  (d.steps[0] as unknown as Record<string, unknown>).claim = "private-claim";
  mock.advance.mockResolvedValueOnce(d);
  const r = await post({ action: "advance", id });
  expect(JSON.stringify(await r.json())).not.toContain("private-claim");
  const chain = {
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(async () => ({
      data: null,
      error: { message: "secret-database-detail" },
    })),
  };
  mock.from.mockReturnValue({ select: () => chain });
  const response = await GET(new Request("https://app.test/api/council"));
  const body = await response.json();
  expect(body.storageReady).toBe(false);
  expect(body.runs).toEqual([]);
  expect(JSON.stringify(body)).not.toContain("secret-database-detail");
});
it("查询个人历史使用本人过滤，不暴露其他账号的问题", async () => {
  const chain = {
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
  };
  mock.from.mockReturnValue({ select: () => chain });
  expect(
    (await GET(new Request(`https://app.test/api/council?id=${id}`))).status,
  ).toBe(404);
  expect(chain.eq).toHaveBeenCalledWith("user_id", "verified-user");
});
