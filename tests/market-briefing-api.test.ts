import { beforeEach, afterEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ status: 200, error: "denied" }));
const mocks = vi.hoisted(() => ({ read: vi.fn(), ensure: vi.fn() }));
vi.mock("../lib/server-auth", () => ({ authorizeRequest: async () => auth }));
vi.mock("../lib/market-briefing-server", () => ({
  readMarketBriefs: mocks.read,
  ensureMarketBrief: mocks.ensure,
}));
import { GET, POST } from "../app/api/market/briefing/route";
import { GET as cron } from "../app/api/market/briefing/daily/route";
beforeEach(() => {
  vi.clearAllMocks();
  auth.status = 200;
  mocks.read.mockResolvedValue([]);
  mocks.ensure.mockResolvedValue({ created: false, reports: [] });
});
afterEach(() => vi.unstubAllEnvs());
it("匿名与跨源请求不能触发模型，读取响应不可共享缓存", async () => {
  auth.status = 401;
  expect(
    (await GET(new Request("https://app.test/api/market/briefing"))).status,
  ).toBe(401);
  expect(
    (
      await POST(
        new Request("https://app.test/api/market/briefing", { method: "POST" }),
      )
    ).status,
  ).toBe(401);
  auth.status = 200;
  expect(
    (
      await POST(
        new Request("https://app.test/api/market/briefing", {
          method: "POST",
          headers: {
            origin: "https://evil.test",
            "content-type": "application/json",
          },
        }),
      )
    ).status,
  ).toBe(403);
  expect(mocks.ensure).not.toHaveBeenCalled();
  expect(
    (
      await GET(new Request("https://app.test/api/market/briefing"))
    ).headers.get("cache-control"),
  ).toBe("private, no-store");
});
it("客户端无法指定模型、历史日期或注入家庭内容，错误不泄漏凭证", async () => {
  const response = await POST(
    new Request("https://app.test/api/market/briefing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "expensive",
        day: "2000-01-01",
        private: "nope",
      }),
    }),
  );
  expect(response.status).toBe(200);
  expect(mocks.ensure).toHaveBeenCalledWith();
  mocks.read.mockRejectedValue(new Error("private-secret"));
  const failed = await GET(new Request("https://app.test/api/market/briefing"));
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain("secret");
});
it("定时任务独立校验secret，返回状态不泄漏内容或家庭数据", async () => {
  vi.stubEnv("CRON_SECRET", "synthetic-cron");
  expect(
    (await cron(new Request("https://app.test/api/market/briefing/daily")))
      .status,
  ).toBe(401);
  const response = await cron(
    new Request("https://app.test/api/market/briefing/daily", {
      headers: { authorization: "Bearer synthetic-cron" },
    }),
  );
  expect(await response.json()).toEqual({ ok: true, created: false });
});
