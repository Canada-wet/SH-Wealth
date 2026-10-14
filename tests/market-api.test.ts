import { it, expect, vi, beforeEach, afterEach } from "vitest";
const auth = vi.hoisted(() => ({ status: 200, error: "请先登录。" }));
const get = vi.hoisted(() => vi.fn());
vi.mock("../lib/server-auth", () => ({
  authorizeRequest: vi.fn(async () => auth),
}));
vi.mock("../lib/market-server", () => ({ getOfficialMarket: get }));
import { GET } from "../app/api/market/route";
beforeEach(() => {
  vi.clearAllMocks();
  auth.status = 200;
});
afterEach(() => vi.unstubAllGlobals());
it("匿名不可读取，也不会启动供应商查询", async () => {
  auth.status = 401;
  expect((await GET(new Request("http://localhost/api/market"))).status).toBe(
    401,
  );
  expect(get).not.toHaveBeenCalled();
});
it("已授权只获取公共序列，返回私密不可缓存响应", async () => {
  get.mockResolvedValue({
    fx: [],
    yields: [],
    macro: [],
    fetchedAt: "date",
    failures: [],
  });
  const r = await GET(new Request("http://localhost/api/market?symbol=evil"));
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(get).toHaveBeenCalledWith();
});
it("错误不会显示示例价格或泄漏供应商错误内容", async () => {
  get.mockRejectedValue(new Error("private credential should not echo"));
  const r = await GET(new Request("http://localhost/api/market"));
  expect(r.status).toBe(503);
  expect(await r.text()).not.toContain("credential");
});
