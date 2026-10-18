import { it, expect, vi, beforeEach } from "vitest";
const mock = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock("../lib/server-auth", () => ({ authorizeRequest: mock.auth }));
import { GET, POST } from "../app/api/navigation/route";
beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.mockResolvedValue({
    status: 200,
    user: { id: "verified-person" },
    client: { from: mock.from, rpc: mock.rpc },
  });
  mock.rpc.mockResolvedValue({ data: [], error: null });
});
const post = (body: unknown, origin = "https://app.test") =>
  POST(
    new Request("https://app.test/api/navigation", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
it("认证先于读取与更新；无私人缓存，强制本人而非客户端 user_id", async () => {
  mock.auth.mockResolvedValueOnce({ status: 401, error: "登录" });
  expect(
    (await GET(new Request("https://app.test/api/navigation"))).status,
  ).toBe(401);
  mock.auth.mockResolvedValueOnce({ status: 403, error: "禁止" });
  expect((await post({ featureId: "markets", action: "pin" })).status).toBe(
    403,
  );
  expect(mock.rpc).not.toHaveBeenCalled();
  const response = await post({
    user_id: "partner",
    featureId: "markets",
    action: "pin",
    last_used_at: "9999-01-01",
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mock.rpc).toHaveBeenCalledWith("update_wealth_navigation", {
    target_feature: "markets",
    operation: "pin",
  });
  expect(await response.json()).toEqual({
    userId: "verified-person",
    entries: [],
  });
});
it("拒绝跨源、超限、未知功能与坏操作，不接受任意 URL 或家庭账本内容", async () => {
  expect((await post({}, "https://evil.test")).status).toBe(403);
  for (const body of [
    { featureId: "https://evil.test", action: "visit" },
    { featureId: "markets", action: "delete" },
    { featureId: "markets", action: "pin", padding: "x".repeat(2000) },
  ])
    expect((await post(body)).status).toBe(400);
  expect(mock.rpc).not.toHaveBeenCalled();
});
it("读取限制本人；数据库失败和坏确认不伪装保存成功或泄漏内部信息", async () => {
  const eq = vi.fn(async () => ({ data: [], error: null }));
  mock.from.mockReturnValue({ select: () => ({ eq }) });
  expect(
    (await GET(new Request("https://app.test/api/navigation"))).status,
  ).toBe(200);
  expect(eq).toHaveBeenCalledWith("user_id", "verified-person");
  mock.rpc.mockResolvedValueOnce({ error: { message: "SECRET_DATABASE" } });
  const bad = await post({ featureId: "markets", action: "unpin" });
  expect(bad.status).toBe(503);
  expect(await bad.text()).not.toContain("SECRET_DATABASE");
  mock.rpc.mockResolvedValueOnce({
    data: [{ feature_id: "evil" }],
    error: null,
  });
  expect((await post({ featureId: "markets", action: "visit" })).status).toBe(
    503,
  );
});
