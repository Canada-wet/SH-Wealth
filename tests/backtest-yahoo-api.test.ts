import { it, expect, vi, beforeEach } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), batch: vi.fn() }));
vi.mock("../lib/server-auth", () => ({ authorizeRequest: m.auth }));
vi.mock("../lib/backtest-yahoo-server", () => ({ getYahooBatch: m.batch }));
import { POST } from "../app/api/backtest/history/route";
const good = { symbols: ["SPY.US"], start: "2020-01-01", end: "2020-12-31" };
const req = (body: unknown, origin = "http://localhost") =>
  new Request("http://localhost/api/backtest/history", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ status: 200, client: { rpc: m.rpc } });
  m.rpc.mockResolvedValue({ data: true });
  m.batch.mockResolvedValue({ data: null, results: [] });
});
it("匿名和跨域不访问Yahoo或占用额度", async () => {
  m.auth.mockResolvedValueOnce({ status: 401, error: "请登录" });
  expect((await POST(req(good))).status).toBe(401);
  expect((await POST(req(good, "https://evil.example"))).status).toBe(403);
  expect(m.batch).not.toHaveBeenCalled();
  expect(m.rpc).not.toHaveBeenCalled();
});
it("坏代码、超量和过大正文在请求上游前拒绝", async () => {
  for (const b of [
    { ...good, symbols: ["https://evil.example"] },
    { ...good, end: "2099-01-01" },
    { ...good, symbols: ["DEMO1.US"] },
    { ...good, private: "x".repeat(5000) },
  ])
    expect((await POST(req(b))).status).toBe(400);
  expect(m.batch).not.toHaveBeenCalled();
  expect(m.rpc).not.toHaveBeenCalled();
});
it("分布式额度拒绝或失败时停止，未运行模型或新SQL", async () => {
  m.rpc.mockResolvedValueOnce({ data: false });
  expect((await POST(req(good))).status).toBe(429);
  m.rpc.mockResolvedValueOnce({ error: { message: "secret" } });
  expect((await POST(req(good))).status).toBe(503);
  expect(m.batch).not.toHaveBeenCalled();
});
it("只转发公开代码与日期，成功/部分失败均私密不缓存HTTP响应", async () => {
  const r = await POST(
    req({ ...good, wealth: "private", weights: [100], messages: ["private"] }),
  );
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(m.batch).toHaveBeenCalledWith(good);
  expect(m.rpc).toHaveBeenCalledWith("take_wealth_advisor_slot");
});
