import { it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => Promise<unknown>) => {
    const cache = new Map<string, Promise<unknown>>();
    return (...args: unknown[]) => {
      const k = JSON.stringify(args);
      if (cache.has(k)) return cache.get(k)!;
      const p = Promise.resolve(fn(...args)).catch((e) => {
        cache.delete(k);
        throw e;
      });
      cache.set(k, p);
      return p;
    };
  },
}));
const dates = ["2020-01-02", "2020-01-03", "2020-01-06"];
const meta = (ticker = "VTV") => ({
  ticker,
  name: "Vanguard Value ETF",
  exchangeCode: "NYSE ARCA",
  startDate: "2004-01-26",
  endDate: new Date().toISOString().slice(0, 10),
});
const rows = () =>
  dates.map((date, i) => ({
    date: `${date}T00:00:00.000Z`,
    close: 100 + i,
    adjClose: 95 + i,
  }));
beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("缺少key或不支持TSX时绝不请求Tiingo", async () => {
  vi.stubEnv("TIINGO_API_KEY", "");
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  const { getTiingoHistory } = await import("../lib/backtest-tiingo-server");
  expect((await getTiingoHistory("VTV.US", dates[0], dates[2])).error).toMatch(
    /未配置/,
  );
  vi.stubEnv("TIINGO_API_KEY", "test-only-not-real");
  expect((await getTiingoHistory("XCV.TO", dates[0], dates[2])).error).toMatch(
    /加拿大/,
  );
  expect(f).not.toHaveBeenCalled();
});
it("固定主机及Token header，无token查询参数，成功缓存并合并并发请求", async () => {
  vi.stubEnv("TIINGO_API_KEY", "test-only-not-real");
  const f = vi.fn(async (u: URL) =>
    Response.json(u.pathname.endsWith("prices") ? rows() : meta()),
  );
  vi.stubGlobal("fetch", f);
  const { getTiingoHistory } = await import("../lib/backtest-tiingo-server");
  const [a, b] = await Promise.all([
    getTiingoHistory("VTV.US", dates[0], dates[2]),
    getTiingoHistory("VTV.US", dates[0], dates[2]),
  ]);
  expect(a.asset?.points).toHaveLength(3);
  expect(b).toEqual(a);
  await getTiingoHistory("VTV.US", dates[0], dates[2]);
  expect(f).toHaveBeenCalledTimes(2);
  for (const [u, opts] of f.mock.calls as unknown as [URL, RequestInit][]) {
    expect(u.host).toBe("api.tiingo.com");
    expect(u.toString()).not.toContain("test-only");
    expect(u.searchParams.has("token")).toBe(false);
    expect((opts.headers as Record<string, string>).Authorization).toBe(
      "Token test-only-not-real",
    );
  }
  expect(JSON.stringify(a)).not.toContain("test-only");
});
it("供方拒绝即停止，无自动重发；异常正文与token不回传", async () => {
  vi.stubEnv("TIINGO_API_KEY", "test-only-not-real");
  const f = vi.fn(
    async () => new Response("raw-sensitive-error", { status: 429 }),
  );
  vi.stubGlobal("fetch", f);
  const { getTiingoHistory } = await import("../lib/backtest-tiingo-server");
  const a = await getTiingoHistory("VTV.US", dates[0], dates[2]);
  await getTiingoHistory("AVUV.US", dates[0], dates[2]);
  expect(f).toHaveBeenCalledTimes(1);
  expect(a.asset).toBeUndefined();
  expect(JSON.stringify(a)).not.toMatch(/raw-sensitive|test-only/);
});
it("自动模式Yahoo拒绝后独立Tiingo提供完整标的，不继续访问被拒供方", async () => {
  vi.stubEnv("TIINGO_API_KEY", "test-only-not-real");
  const f = vi.fn(async (u: URL) =>
    u.host.includes("yahoo")
      ? new Response("denied", { status: 403 })
      : Response.json(u.pathname.endsWith("prices") ? rows() : meta()),
  );
  vi.stubGlobal("fetch", f);
  const { getHistoricalBatch } = await import("../lib/backtest-history-server");
  const r = await getHistoricalBatch({
    symbols: ["VTV.US"],
    start: dates[0],
    end: dates[2],
    provider: "auto",
  });
  expect(r.data?.assets[0].source).toContain("Tiingo");
  expect(r.results[0].attempts?.map((x) => x.status)).toEqual(["failed", "ok"]);
  expect(f).toHaveBeenCalledTimes(3);
  expect(r.providers?.tiingo).toBe(true);
});
it("指定Tiingo不会偷偷调用Yahoo，TSX明确失败，不改变请求标的", async () => {
  vi.stubEnv("TIINGO_API_KEY", "test-only-not-real");
  const f = vi.fn(async (u: URL) =>
    Response.json(u.pathname.endsWith("prices") ? rows() : meta()),
  );
  vi.stubGlobal("fetch", f);
  const { getHistoricalBatch } = await import("../lib/backtest-history-server");
  const r = await getHistoricalBatch({
    symbols: ["VTV.US", "XCV.TO"],
    start: dates[0],
    end: dates[2],
    provider: "tiingo",
  });
  expect(r.data?.assets.map((a) => a.symbol)).toEqual(["VTV.US"]);
  expect(r.requested.symbols).toEqual(["VTV.US", "XCV.TO"]);
  expect(r.results[1].error).toBeTruthy();
  expect(f.mock.calls.every(([u]) => u.host === "api.tiingo.com")).toBe(true);
});
it("Yahoo搜索失效时常见ETF精确代码可由Tiingo核对，名称查询不猜ETF", async () => {
  vi.stubEnv("TIINGO_API_KEY", "test-only-not-real");
  const f = vi.fn(async (u: URL) =>
    u.host.includes("yahoo")
      ? new Response("denied", { status: 403 })
      : Response.json(meta()),
  );
  vi.stubGlobal("fetch", f);
  const { fetchSecuritySearch } = await import("../lib/security-search-server");
  const r = await fetchSecuritySearch("VTV");
  expect(r.options[0]).toMatchObject({
    symbol: "VTV.US",
    kind: "ETF",
    verifiedBy: "tiingo",
  });
  expect(f).toHaveBeenCalledTimes(2);
  await expect(fetchSecuritySearch("Vanguard")).rejects.toThrow();
  expect(f).toHaveBeenCalledTimes(2);
});
