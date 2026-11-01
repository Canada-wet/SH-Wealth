import { it, expect, vi, beforeEach } from "vitest";
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  search: vi.fn(),
  allow: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../lib/server-auth", () => ({ authorizeRequest: m.auth }));
vi.mock("../lib/security-search-server", () => ({
  getSecuritySearch: m.search,
  allowSecuritySearch: m.allow,
}));
import { GET } from "../app/api/backtest/securities/route";
const request = (q = "NVDA", origin = "http://localhost") =>
  new Request(
    `http://localhost/api/backtest/securities?q=${encodeURIComponent(q)}`,
    { headers: { origin } },
  );
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({
    status: 200,
    user: { id: "fixture-user" },
    client: { rpc: m.rpc },
  });
  m.allow.mockReturnValue(true);
  m.search.mockResolvedValue({
    version: 1,
    query: "NVDA",
    options: [],
    omitted: 0,
    checkedAt: new Date().toISOString(),
  });
});
it("登录和同源在查询上游前验证", async () => {
  m.auth.mockResolvedValueOnce({ status: 401, error: "请登录" });
  expect((await GET(request())).status).toBe(401);
  expect((await GET(request("NVDA", "https://evil.example"))).status).toBe(403);
  expect(m.search).not.toHaveBeenCalled();
  expect(m.allow).not.toHaveBeenCalled();
});
it("坏查询不外发，不把用户身份或财富资料交给供应商", async () => {
  for (const q of [
    "",
    "a".repeat(49),
    "someone@example.com",
    "https://evil.example",
  ])
    expect((await GET(request(q))).status).toBe(400);
  const r = await GET(request());
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(m.search).toHaveBeenCalledExactlyOnceWith("NVDA");
  expect(m.allow).toHaveBeenCalledWith("fixture-user");
  expect(m.rpc).not.toHaveBeenCalled();
});
it("限流或不可用失败关闭，不暴露上游错误细节或提供猜测代码", async () => {
  m.allow.mockReturnValueOnce(false);
  expect((await GET(request())).status).toBe(429);
  expect(m.search).not.toHaveBeenCalled();
  m.search.mockRejectedValueOnce(Error("secret internal provider error"));
  const r = await GET(request());
  expect(r.status).toBe(503);
  expect(await r.text()).not.toContain("secret internal");
});
