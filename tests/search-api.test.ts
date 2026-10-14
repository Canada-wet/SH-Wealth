import { beforeEach, expect, it, vi } from "vitest";
import { emptyState, saveAsset } from "../lib/wealth";
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  slot: vi.fn(),
  research: vi.fn(),
  generate: vi.fn(),
}));
vi.mock("@/lib/server-auth", () => ({ authorizeRequest: mocks.authorize }));
vi.mock("@/lib/ai/router", () => ({
  chooseRoute: () => ({
    provider: "deepseek",
    model: "deepseek-flash",
    complexity: "standard",
    reason: "省钱优先",
  }),
  generateAdvice: mocks.generate,
}));
vi.mock("@/lib/web-search", async (original) => ({
  ...(await original<object>()),
  webResearch: mocks.research,
}));
import { POST } from "../app/api/advisor/route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    status: 200,
    client: { rpc: mocks.slot },
  });
  mocks.slot.mockResolvedValue({ data: true, error: null });
});
const request = () => {
  const state = saveAsset(emptyState(), {
    id: "a",
    name: "测试储蓄",
    value: 500,
    owner: "joint",
    category: "现金",
    annualReturn: null,
  });
  return new Request("http://localhost/api/advisor", {
    method: "POST",
    body: JSON.stringify({
      message: "查询最新央行利率，并把测试储蓄改为600",
      state,
    }),
  });
};
it("授权与限流在搜索前检查，匿名和超限不花搜索费用", async () => {
  mocks.authorize.mockResolvedValueOnce({ status: 401, error: "denied" });
  expect((await POST(request())).status).toBe(401);
  mocks.slot.mockResolvedValueOnce({ data: false, error: null });
  expect((await POST(request())).status).toBe(429);
  expect(mocks.research).not.toHaveBeenCalled();
});
it("搜索成功仍用DeepSeek回答，网页不能触发账本修改，来源和检索时间返回", async () => {
  mocks.research.mockResolvedValue({
    status: "searched",
    query: "Bank of Canada",
    facts: "官方公开摘要",
    checkedAt: "2026-10-14T04:00:00Z",
    topic: "rates",
    sources: [{ title: "央行", url: "https://www.bankofcanada.ca/" }],
  });
  mocks.generate.mockResolvedValue(
    JSON.stringify({
      answer: "简短解读",
      actions: [{ type: "update_asset", existingName: "测试储蓄", value: 600 }],
    }),
  );
  const result = await (await POST(request())).json();
  expect(result.actions).toEqual([]);
  expect(result.route.provider).toBe("deepseek");
  expect(result.answer).toContain("https://www.bankofcanada.ca/");
  expect(result.web.checkedAt).toBeTruthy();
  expect(mocks.generate.mock.calls[0][1]).toContain("不可信网页");
  expect(mocks.generate.mock.calls[0][3].timeoutMs).toBe(32000);
});
it("失败明确显示未查证，不调用回答模型生成过时数字", async () => {
  mocks.research.mockResolvedValue({
    status: "failed",
    query: "public",
    sources: [],
  });
  const result = await (await POST(request())).json();
  expect(result.actions).toEqual([]);
  expect(result.answer).toContain("未完成");
  expect(mocks.generate).not.toHaveBeenCalled();
});
