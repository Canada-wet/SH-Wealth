import { it, expect, vi, beforeEach, afterEach } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock("../lib/server-auth", () => ({ authorizeRequest: m.auth }));
vi.mock("next/cache", () => ({ unstable_cache: (f: unknown) => f }));
import { GET as providers } from "../app/api/backtest/providers/route";
import { GET as fx } from "../app/api/backtest/fx/route";
const req = (
  path = "fx?start=2020-01-01&end=2020-12-31",
  origin = "http://localhost",
) =>
  new Request(`http://localhost/api/backtest/${path}`, { headers: { origin } });
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ status: 200, client: { rpc: m.rpc } });
  m.rpc.mockResolvedValue({ data: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("两条新增端点未登录或跨域不访问供方，也不泄露配置", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  for (const get of [providers, fx]) {
    m.auth.mockResolvedValueOnce({ status: 401, error: "请登录" });
    expect((await get(req())).status).toBe(401);
    expect(
      (
        await get(
          req("fx?start=2020-01-01&end=2020-12-31", "https://evil.example"),
        )
      ).status,
    ).toBe(403);
  }
  expect(m.rpc).not.toHaveBeenCalled();
  expect(f).not.toHaveBeenCalled();
});
it("配置只返回布尔，无key/前缀或外部调用", async () => {
  vi.stubEnv("TIINGO_API_KEY", "test-only-private-key");
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  const r = await providers(req("providers"));
  expect(await r.json()).toEqual({ tiingo: true });
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(f).not.toHaveBeenCalled();
});
it("无效或未来日期、配额失败不取外部汇率", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  for (const p of [
    "fx?start=2020-02-31&end=2020-12-31",
    "fx?start=2020-01-01&end=2099-01-01",
    "fx?start=2020-01-01&end=2020-01-01",
  ])
    expect((await fx(req(p))).status).toBe(400);
  m.rpc.mockResolvedValueOnce({ data: false });
  expect((await fx(req())).status).toBe(429);
  m.rpc.mockResolvedValueOnce({ error: { message: "private-db-error" } });
  expect((await fx(req())).status).toBe(503);
  expect(f).not.toHaveBeenCalled();
});
it("固定BoC系列，仅发送日期，不发送家庭财务；成功格式验证且HTTP私密", async () => {
  const f = vi.fn(async (_url: URL) =>
    Response.json({
      seriesDetail: {
        FXUSDCAD: {
          label: "USD/CAD",
          metadata: { unit: "Canadian dollars per US dollar" },
        },
      },
      observations: [
        { d: "2020-01-02", FXUSDCAD: { v: "1.3" } },
        { d: "2020-01-03", FXUSDCAD: { v: "1.31" } },
      ],
    }),
  );
  vi.stubGlobal("fetch", f);
  const r = await fx(req());
  expect(r.status).toBe(200);
  expect((await r.json()).points).toHaveLength(2);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  const u = f.mock.calls[0][0] as unknown as URL;
  expect(u.origin + u.pathname).toBe(
    "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json",
  );
  expect([...u.searchParams.keys()].sort()).toEqual(["end_date", "start_date"]);
});
it("BoC访问拒绝只请求一次，未补值或泄露原始错误", async () => {
  const f = vi.fn(
    async () => new Response("raw-private-error", { status: 403 }),
  );
  vi.stubGlobal("fetch", f);
  const r = await fx(req());
  expect(r.status).toBe(503);
  expect(JSON.stringify(await r.json())).not.toContain("raw-private");
  expect(f).toHaveBeenCalledOnce();
});
