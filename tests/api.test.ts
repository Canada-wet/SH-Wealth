import { describe, it, expect, vi } from "vitest";
import { emptyState, saveAsset } from "../lib/wealth";
const access = vi.hoisted(() => ({
  authorize: vi.fn(),
  slot: vi.fn(async () => ({ data: true, error: null })),
  market: vi.fn(),
}));
vi.mock("@/lib/server-auth", () => ({ authorizeRequest: access.authorize }));
vi.mock("@/lib/market-server", () => ({ getOfficialMarket: access.market }));
access.authorize.mockImplementation(async () => ({
  status: 200,
  user: { id: "fixture" },
  client: { rpc: access.slot },
}));
vi.mock("@/lib/ai/router", () => ({
  chooseRoute: vi.fn(() => ({
    provider: "local",
    model: "test",
    reason: "test",
    complexity: "simple",
  })),
  generateAdvice: vi.fn(),
}));
import { POST } from "../app/api/advisor/route";
import { chooseRoute, generateAdvice } from "../lib/ai/router";
import { defaultGrowthPlan } from "../lib/growth";
const request = (body: unknown) =>
  new Request("http://localhost/api/advisor", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
describe("顾问API", () => {
  it("已关联账户的市场提问使用服务端官方观测，不接受客户端伪造行情", async () => {
    vi.mocked(chooseRoute).mockReturnValueOnce({
      provider: "deepseek",
      model: "fixture",
      reason: "fixture",
      complexity: "simple",
    });
    vi.mocked(generateAdvice).mockResolvedValueOnce(
      '{"answer":"先核对敞口。","actions":[]}',
    );
    access.market.mockResolvedValueOnce({
      fetchedAt: "2026-10-15T16:00:00Z",
      fx: [],
      yields: [],
      macro: [],
      failures: [],
    });
    const state = saveAsset(emptyState(), {
      id: "a",
      name: "合成账户",
      owner: "first",
      category: "投资",
      value: 1000,
      annualReturn: null,
    });
    state.preferences.webSearch = "off";
    state.preferences.portfolioLinks = [
      {
        id: "link",
        assetId: "a",
        instrument: { ticker: "NVDA", exchange: "NASDAQ", name: "NVIDIA" },
        weight: 50,
        currency: "unknown",
      },
    ];
    const result = await POST(
      request({
        message: "分析持仓的风险，不改数据",
        state,
        market: { quote: 999999 },
      }),
    );
    expect(result.status).toBe(200);
    expect((await result.json()).actions).toEqual([]);
    expect(access.market).toHaveBeenCalledOnce();
    const text = vi.mocked(generateAdvice).mock.calls.at(-1)![1];
    expect(text).toContain('"linked":500');
    expect(text).toContain("ETF未穿透");
    expect(text).not.toContain("999999");
  });
  it("外部顾问收到已保存的计算情景与行动边界，分析不产生修改", async () => {
    vi.mocked(chooseRoute).mockReturnValueOnce({
      provider: "deepseek",
      model: "fixture",
      reason: "fixture",
      complexity: "simple",
    });
    vi.mocked(generateAdvice).mockResolvedValueOnce(
      '{"answer":"先落实留存，再复盘。","actions":[]}',
    );
    const state = emptyState();
    state.preferences.webSearch = "off";
    state.preferences.growthPlan = {
      ...defaultGrowthPlan(state),
      monthlySaving: 500,
      longTermMonthly: 200,
    };
    const result = await POST(
      request({ message: "分析增长计划，不修改数据", state }),
    );
    expect(result.status).toBe(200);
    expect((await result.json()).actions).toEqual([]);
    const call = vi.mocked(generateAdvice).mock.calls.at(-1)!;
    expect(call[1]).toContain('"growth":');
    expect(call[1]).toContain('"monthlySaving":500');
    expect(call[2]).toContain("不是实际收益");
    expect(call[2]).toContain("不支持通过现有 actions");
  });
  it("匿名和未授权邮箱在调用模型之前被拒绝", async () => {
    for (const status of [401, 403]) {
      access.authorize.mockResolvedValueOnce({ status, error: "denied" });
      expect(
        (await POST(request({ message: "hi", state: emptyState() }))).status,
      ).toBe(status);
    }
  });
  it("数据库限流生效，检查失败则安全拒绝", async () => {
    for (const [slot, status] of [
      [{ data: false, error: null }, 429],
      [{ data: null, error: { message: "unavailable" } }, 503],
    ] as const) {
      vi.mocked(chooseRoute).mockReturnValueOnce({
        provider: "openai",
        model: "test",
        reason: "test",
        complexity: "simple",
      });
      access.slot.mockResolvedValueOnce(slot as never);
      expect(
        (await POST(request({ message: "hi", state: emptyState() }))).status,
      ).toBe(status);
    }
  });
  it("非法JSON和空问题返回400", async () => {
    expect(
      (
        await POST(
          new Request("http://localhost/api/advisor", {
            method: "POST",
            body: "broken",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(request({ message: "", state: emptyState() }))).status,
    ).toBe(400);
  });
  it("非法数据快照返回400", async () =>
    expect(
      (await POST(request({ message: "hi", state: { version: 3 } }))).status,
    ).toBe(400));
  it("本地助手端到端产生真实回报变更", async () => {
    const state = saveAsset(emptyState(), {
      id: "a",
      name: "储蓄",
      category: "现金",
      owner: "joint",
      value: 500,
      annualReturn: 3,
    });
    const response = await POST(
      request({ message: "把储蓄本年回报改为 -5%", state }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).actions[0].annualReturn).toBe(-5);
  });
  it("外部模型输出包含无效actions时被过滤，分析问题不允许任何写操作", async () => {
    vi.mocked(chooseRoute).mockReturnValueOnce({
      provider: "openai",
      model: "test",
      reason: "test",
      complexity: "simple",
    });
    vi.mocked(generateAdvice).mockResolvedValueOnce(
      '{"answer":"分析","actions":[{"type":"delete_asset","name":"储蓄"}]}',
    );
    const response = await POST(
      request({ message: "如果删除储蓄会怎样？", state: emptyState() }),
    );
    expect((await response.json()).actions).toEqual([]);
  });
  it("provider异常返回503且没有伪造成功", async () => {
    vi.mocked(chooseRoute).mockImplementationOnce(() => {
      throw new Error("provider failed");
    });
    const response = await POST(
      request({ message: "hi", state: emptyState() }),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("provider failed");
  });
});
