import { it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  yahooSymbol,
  yahooRequest,
  yahooCompletedEnd,
  parseYahooHistory,
} from "../lib/backtest-yahoo";
import { runBacktest } from "../lib/backtest";
import { defaultBacktest } from "../lib/backtest-schema";
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: string[]) => Promise<unknown>) => {
    const cache = new Map<string, Promise<unknown>>();
    return (...args: string[]) => {
      const key = JSON.stringify(args);
      if (cache.has(key)) return cache.get(key)!;
      const work = Promise.resolve(fn(...args)).catch((e) => {
        cache.delete(key);
        throw e;
      });
      cache.set(key, work);
      return work;
    };
  },
}));
const start = "2020-01-02",
  end = "2020-01-06";
function payload(symbol = "SPY", currency = "USD") {
  return {
    chart: {
      error: null,
      result: [
        {
          meta: {
            symbol,
            currency,
            instrumentType: "ETF",
            exchangeTimezoneName: "America/New_York",
            dataGranularity: "1d",
          },
          timestamp: [start, "2020-01-03", end].map(
            (d) => Date.parse(d + "T14:30:00Z") / 1000,
          ),
          indicators: {
            quote: [{ close: [100, 50, 51] }],
            adjclose: [{ adjclose: [49, 49.5, 51] }],
          },
          events: {
            splits: { test: { numerator: 2, denominator: 1 } },
            dividends: { test: { amount: 1 } },
          },
        },
      ],
    },
  };
}
beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("代码精确映射美国/TSX份额类别，不猜证券或允许URL", () => {
  expect(yahooSymbol("NVDA.US")).toBe("NVDA");
  expect(yahooSymbol("ZSP.TO")).toBe("ZSP.TO");
  expect(yahooSymbol("BRK.B.US")).toBe("BRK-B");
  expect(yahooSymbol("CGL.C.TO")).toBe("CGL-C.TO");
  for (const s of [
    "https://evil.example",
    "NVDA",
    "DEMO1.US",
    "A_B.US",
    "SPY.US?x=1",
  ])
    expect(() => yahooSymbol(s)).toThrow();
});
it("请求只保留公开代码日期，拒绝未来、重复、超量，不用后缀断定币种", () => {
  const good = { symbols: ["SPY.US"], start, end };
  expect(yahooRequest({ ...good, assets: "private", weights: [100] })).toEqual(
    good,
  );
  for (const bad of [
    { ...good, symbols: [] },
    { ...good, symbols: ["SPY.US", "SPY.US"] },
    { ...good, end: "2099-01-01" },
    { ...good, start: "2020-02-30" },
    { ...good, symbols: Array.from({ length: 9 }, (_, i) => `T${i}.US`) },
  ])
    expect(() => yahooRequest(bad)).toThrow();
  expect(
    yahooRequest({ ...good, symbols: ["SPY.US", "ZSP.U.TO"] }).symbols,
  ).toHaveLength(2);
});
it("TSX美元份额读取元数据USD，非CAD/USD仍拒绝", () => {
  const r = parseYahooHistory(
    payload("ZSP-U.TO", "USD"),
    "ZSP.U.TO",
    start,
    end,
  );
  expect(r.asset.currency).toBe("USD");
  const cad = parseYahooHistory(payload("ZSP.TO", "CAD"), "ZSP.TO", start, end);
  expect(cad.asset.currency).toBe("CAD");
  expect(() =>
    parseYahooHistory(payload("ZSP.TO", "JPY"), "ZSP.TO", start, end),
  ).toThrow();
});
it("多伦多跨日及夏冬令时都排除尚未完整的当日线", () => {
  expect(
    yahooCompletedEnd("2026-11-01", new Date("2026-11-01T03:00:00Z")),
  ).toBe("2026-10-30");
  expect(
    yahooCompletedEnd("2026-11-01", new Date("2026-11-01T12:00:00Z")),
  ).toBe("2026-10-31");
  expect(yahooCompletedEnd("2020-01-01")).toBe("2020-01-01");
});
it("使用Adj Close，不重复增加拆股和分红；现金分红拒绝、明细金额未知", () => {
  const { asset } = parseYahooHistory(payload(), "SPY.US", start, end);
  expect(asset.basis).toBe("total-return");
  expect(asset.dividendsKnown).toBe(false);
  expect(asset.points.map((p) => [p.close, p.dividend, p.split])).toEqual([
    [49, 0, 1],
    [49.5, 0, 1],
    [51, 0, 1],
  ]);
  const c = {
    ...defaultBacktest(end),
    start,
    holdings: [{ symbol: "SPY.US", weight: 100 }],
    monthly: 0,
    feeBps: 0,
  };
  const data = {
    version: 1 as const,
    capturedAt: new Date().toISOString(),
    synthetic: false,
    assets: [asset],
  };
  const r = runBacktest(c, data).results[0];
  expect(r.metrics.twr).toBeCloseTo(51 / 49 - 1);
  expect(r.metrics.dividends).toBeNull();
  expect(() => runBacktest({ ...c, dividends: "cash" }, data)).toThrow(
    /再投资/,
  );
});
it("不接受错误币种、相似代码、非股票基金或非日线", () => {
  for (const patch of [
    { symbol: "SPY.L" },
    { currency: "CAD" },
    { instrumentType: "INDEX" },
    { dataGranularity: "1wk" },
  ]) {
    const p = payload();
    Object.assign(p.chart.result[0].meta, patch);
    expect(() => parseYahooHistory(p, "SPY.US", start, end)).toThrow(/不匹配/);
  }
});
it("缺少复权值、坏价或重复日期不默默降级为原价", () => {
  const p = payload();
  p.chart.result[0].indicators.adjclose[0].adjclose = [];
  expect(() => parseYahooHistory(p, "SPY.US", start, end)).toThrow(/复权/);
  const zero = payload();
  zero.chart.result[0].indicators.adjclose[0].adjclose[1] = 0;
  expect(() => parseYahooHistory(zero, "SPY.US", start, end)).toThrow(/坏价/);
  const duplicate = payload();
  duplicate.chart.result[0].timestamp[1] =
    duplicate.chart.result[0].timestamp[0];
  expect(() => parseYahooHistory(duplicate, "SPY.US", start, end)).toThrow();
});
it("固定Yahoo域名、固定参数、无cookies、无重定向或重试，部分失败逐项报告", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(payload()))
    .mockResolvedValueOnce(new Response("not-found", { status: 404 }));
  vi.stubGlobal("fetch", fetcher);
  const { getYahooBatch } = await import("../lib/backtest-yahoo-server");
  const r = await getYahooBatch({
    symbols: ["SPY.US", "UNKNOWN.US"],
    start,
    end,
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  const [u, options] = fetcher.mock.calls[0];
  expect(u.origin).toBe("https://query1.finance.yahoo.com");
  expect(u.searchParams.get("interval")).toBe("1d");
  expect(Number(u.searchParams.get("period2"))).toBe(
    Date.parse(end) / 1000 + 86400,
  );
  expect(options.redirect).toBe("error");
  expect(options.headers.Cookie).toBeUndefined();
  expect(r.data?.assets).toHaveLength(1);
  expect(r.results[1].error).toMatch(/404/);
  expect(r.results[0]).not.toHaveProperty("asset");
});
it.each([401, 403, 429])(
  "上游%s后停止本批及冷却期内请求，不切换服务器绕过",
  async (status) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("restricted", { status }));
    vi.stubGlobal("fetch", fetcher);
    const { getYahooBatch, fetchYahooHistory } =
      await import("../lib/backtest-yahoo-server");
    const r = await getYahooBatch({
      symbols: ["SPY.US", "AGG.US"],
      start,
      end,
    });
    expect(r.data).toBeNull();
    expect(r.results[1].error).toMatch(/停止/);
    await fetchYahooHistory("NVDA.US", start, end);
    expect(fetcher).toHaveBeenCalledOnce();
  },
);
it("网络异常不重发、不泄漏原始错误，原价缺失不伪造成功", async () => {
  const fetcher = vi.fn().mockRejectedValue(Error("secret-cookie"));
  vi.stubGlobal("fetch", fetcher);
  const { getYahooBatch } = await import("../lib/backtest-yahoo-server");
  const r = await getYahooBatch({ symbols: ["SPY.US"], start, end });
  expect(r.data).toBeNull();
  expect(JSON.stringify(r)).not.toContain("secret-cookie");
  expect(fetcher).toHaveBeenCalledOnce();
});
it("瞬时失败不作为一小时成功缓存；明确的下一次用户请求可以恢复", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(Error("temporary"))
    .mockResolvedValueOnce(Response.json(payload("VTV")));
  vi.stubGlobal("fetch", fetcher);
  const { getYahooBatch } = await import("../lib/backtest-yahoo-server");
  const query = { symbols: ["VTV.US"], start, end };
  expect((await getYahooBatch(query)).data).toBeNull();
  expect(fetcher).toHaveBeenCalledOnce();
  expect((await getYahooBatch(query)).data?.assets[0].symbol).toBe("VTV.US");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("相同代码日期同时请求共用一个进行中的上游调用", async () => {
  let finish!: (r: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((r) => {
        finish = r;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const { getYahooBatch } = await import("../lib/backtest-yahoo-server");
  const query = { symbols: ["XCV.TO"], start, end };
  const first = getYahooBatch(query),
    second = getYahooBatch(query);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  finish(Response.json(payload("XCV.TO", "CAD")));
  expect((await first).data?.assets[0].currency).toBe("CAD");
  expect((await second).data?.assets[0].currency).toBe("CAD");
});
