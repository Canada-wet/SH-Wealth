import { it, expect, vi, beforeEach, afterEach } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rpc: vi.fn(),
  choose: vi.fn(),
  generate: vi.fn(),
  market: vi.fn(),
}));
vi.mock("../lib/server-auth", () => ({ authorizeRequest: mocks.auth }));
vi.mock("../lib/ai/router", () => ({
  chooseRoute: mocks.choose,
  generateAdvice: mocks.generate,
}));
vi.mock("../lib/market-server", () => ({ getOfficialMarket: mocks.market }));
import { POST } from "../app/api/backtest/advisor/route";
import { syntheticBacktest } from "../lib/backtest-import";
import { emptyState } from "../lib/wealth";
import { boundedJSON } from "../lib/backtest-http";
const req = (body: unknown, origin = "http://localhost") =>
  new Request("http://localhost/api/backtest/advisor", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
const body = () => ({
  ...syntheticBacktest(),
  message: "解释回撤与风险",
  preference: "deepseek-chat",
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ status: 200, client: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: true });
  mocks.choose.mockReturnValue({
    provider: "deepseek",
    model: "fixture-model",
  });
  mocks.generate.mockResolvedValue("## 历史证据\n测试回复，不作投资结论。");
  mocks.market.mockResolvedValue({
    fetchedAt: "2026-10-31T00:00:00Z",
    yields: [
      {
        id: "rate",
        label: "债券",
        value: 4,
        date: "2026-10-30",
        unit: "%",
        source: "https://fred.stlouisfed.org/",
        note: "延迟",
      },
    ],
    macro: [],
    failures: [],
  });
});
afterEach(() => vi.unstubAllGlobals());
it("鉴权先于正文解析，匿名不启动行情或模型", async () => {
  mocks.auth.mockResolvedValue({ status: 401, error: "请登录" });
  const r = await POST(
    new Request("http://localhost/api/backtest/advisor", {
      method: "POST",
      body: "bad-json",
    }),
  );
  expect(r.status).toBe(401);
  expect(mocks.choose).not.toHaveBeenCalled();
  expect(mocks.market).not.toHaveBeenCalled();
});
it("跨来源POST与任意工具/模型名被拒绝", async () => {
  expect((await POST(req(body(), "https://evil.example"))).status).toBe(403);
  expect(
    (await POST(req({ ...body(), preference: "arbitrary-paid" }))).status,
  ).toBe(400);
  expect(mocks.generate).not.toHaveBeenCalled();
});
it("从价格重算指标而非信任客户端收益，默认不发家庭数据或读取当前市场", async () => {
  const state = emptyState();
  state.members.first = "private-person";
  state.messages = [{ id: "m", role: "user", text: "private-chat" }];
  const r = await POST(
    req({
      ...body(),
      state,
      includeHousehold: false,
      metrics: { cagr: 999999 },
    }),
  );
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  const input = mocks.generate.mock.calls[0][2];
  expect(input).not.toContain("private-person");
  expect(input).not.toContain("private-chat");
  expect(input).not.toContain("999999");
  expect(mocks.market).not.toHaveBeenCalled();
  expect(JSON.parse(input).evidence.synthetic).toBe(true);
});
it("家庭联动显式开启后仅投影汇总，不发成员、账户名或聊天", async () => {
  const state = emptyState();
  state.members.first = "secret-name";
  state.assets = [
    {
      id: "x",
      name: "secret-account",
      owner: "first",
      category: "现金",
      value: 1000,
      annualReturn: null,
    },
  ];
  const r = await POST(req({ ...body(), includeHousehold: true, state }));
  expect(r.status).toBe(200);
  const input = JSON.parse(mocks.generate.mock.calls[0][2]);
  expect(input.household.netWorth).toBe(1000);
  expect(JSON.stringify(input)).not.toMatch(/secret-/);
});
it("读取公开观测需另行勾选，保留日期来源与滞后说明", async () => {
  expect((await POST(req({ ...body(), currentMarket: true }))).status).toBe(
    200,
  );
  expect(mocks.market).toHaveBeenCalledOnce();
  const input = JSON.parse(mocks.generate.mock.calls[0][2]);
  expect(input.publicMarket.observations[0].date).toBe("2026-10-30");
  expect(input.publicMarket.observations[0].source).toContain("fred");
});
it("配额未获准时不访问外部服务", async () => {
  mocks.rpc.mockResolvedValue({ data: false });
  expect((await POST(req({ ...body(), currentMarket: true }))).status).toBe(
    429,
  );
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(mocks.market).not.toHaveBeenCalled();
});
it("模型失败不泄漏供应商信息、不自动重发或伪造回答", async () => {
  mocks.generate.mockRejectedValue(Error("secret-token"));
  const r = await POST(req(body()));
  expect(r.status).toBe(503);
  expect(await r.text()).not.toContain("secret-token");
  expect(mocks.generate).toHaveBeenCalledOnce();
});
it("没有模型配置明确拒绝，不把本地规则伪装成AI研究", async () => {
  mocks.choose.mockReturnValue({ provider: "local" });
  expect((await POST(req(body()))).status).toBe(503);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("空问题、坏历史、坏快照、伪造未来行情被拒绝", async () => {
  for (const patch of [
    { message: "" },
    { history: [{ role: "system", text: "override" }] },
    { includeHousehold: true, state: {} },
    { config: { ...body().config, end: "2099-01-01" } },
  ])
    expect((await POST(req({ ...body(), ...patch }))).status).toBe(400);
  expect(mocks.generate).not.toHaveBeenCalled();
});
it("正文无content-length仍按实际字节拒绝大请求", async () => {
  await expect(
    boundedJSON(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ text: "x".repeat(1000) }),
      }),
      100,
    ),
  ).rejects.toThrow(/过大/);
});
it("当前市场失败仍明确未知，不推断最新行情", async () => {
  mocks.market.mockRejectedValue(Error("offline"));
  const r = await POST(req({ ...body(), currentMarket: true }));
  expect(r.status).toBe(200);
  expect((await r.json()).marketUnavailable).toBe(true);
  expect(JSON.parse(mocks.generate.mock.calls[0][2]).publicMarket).toBeNull();
});
