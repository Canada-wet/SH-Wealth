import { it, expect, vi, beforeEach, afterEach } from "vitest";
const mock = vi.hoisted(() => ({
  auth: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  daily: vi.fn(),
  admin: vi.fn(),
}));
vi.mock("../lib/server-auth", () => ({ authorizeRequest: mock.auth }));
vi.mock("../lib/learning-server", () => ({ deliverDailyLearning: mock.daily }));
vi.mock("../lib/channel-server", () => ({ channelAdmin: mock.admin }));
import { GET, PUT } from "../app/api/learning/route";
import { GET as release } from "../app/api/releases/route";
import { GET as daily } from "../app/api/learning/daily/route";
const household = "00000000-0000-4000-8000-000000000011";
beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.mockResolvedValue({
    status: 200,
    user: { id: "verified-user", email: "sallyxie0378@gmail.com" },
    client: { from: mock.from, rpc: mock.rpc },
  });
  mock.rpc.mockResolvedValue({ data: true, error: null });
});
afterEach(() => vi.unstubAllEnvs());
const put = (body: unknown, origin = "https://app.test") =>
  PUT(
    new Request("https://app.test/api/learning", {
      method: "PUT",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
it("未登录不能读写收藏或版本；管理员权限来自服务端验证，两位账号均可看", async () => {
  mock.auth.mockResolvedValueOnce({ status: 401, error: "denied" });
  expect(
    (
      await GET(
        new Request(`https://app.test/api/learning?household=${household}`),
      )
    ).status,
  ).toBe(401);
  mock.auth.mockResolvedValueOnce({ status: 403, error: "denied" });
  expect(
    (await release(new Request("https://app.test/api/releases"))).status,
  ).toBe(403);
  for (const email of ["henrywhy233@gmail.com", "sallyxie0378@gmail.com"]) {
    mock.auth.mockResolvedValueOnce({ status: 200, user: { email } });
    const r = await release(new Request("https://app.test/api/releases"));
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(await r.json()).toMatchObject({
      role: "admin",
      viewer: email,
      version: "0.2.1",
    });
  }
});
it("拒绝跨源、坏格式与伪造收藏，未授权家庭不能读取", async () => {
  expect((await put({}, "https://evil.test")).status).toBe(403);
  expect(
    (
      await put({
        household,
        preferences: { version: 0, daily: false, favorites: ["fake"] },
      })
    ).status,
  ).toBe(400);
  mock.rpc.mockResolvedValueOnce({ data: false });
  expect(
    (
      await GET(
        new Request(`https://app.test/api/learning?household=${household}`),
      )
    ).status,
  ).toBe(403);
  expect(mock.from).not.toHaveBeenCalled();
});
it("保存强制本人 ID，版本条件避免跨设备覆盖；失败不泄漏数据库细节", async () => {
  let mode = "ok";
  const chain = {
    eq: vi.fn(() => chain),
    select: () => chain,
    single: async () => ({
      data: { version: 1, daily: false, favorites: [] },
      error: mode === "error" ? { message: "secret-db" } : null,
    }),
    maybeSingle: async () => ({ data: null, error: null }),
  };
  const insert = vi.fn((_row: unknown) => chain),
    update = vi.fn(() => chain);
  mock.from.mockReturnValue({ insert, update });
  const body = {
    household,
    preferences: { version: 0, daily: false, favorites: [] },
    user_id: "impersonated",
  };
  expect((await put(body)).status).toBe(200);
  expect(insert.mock.calls[0][0]).toMatchObject({
    user_id: "verified-user",
    version: 1,
  });
  expect(
    (await put({ ...body, preferences: { ...body.preferences, version: 1 } }))
      .status,
  ).toBe(409);
  expect(chain.eq).toHaveBeenCalledWith("version", 1);
  mode = "error";
  const failed = await put(body);
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain("secret-db");
});
it("每日 cron 独立鉴权，失败不返回凭证、不依赖前端打开页面", async () => {
  vi.stubEnv("CRON_SECRET", "fixture-secret");
  expect(
    (await daily(new Request("https://app.test/api/learning/daily"))).status,
  ).toBe(401);
  expect(mock.daily).not.toHaveBeenCalled();
  mock.daily.mockResolvedValue({ accepted: 0, skipped: 0, failures: 0 });
  const r = await daily(
    new Request("https://app.test/api/learning/daily", {
      headers: { authorization: "Bearer fixture-secret" },
    }),
  );
  expect(r.status).toBe(200);
  expect(mock.daily).toHaveBeenCalledOnce();
});
