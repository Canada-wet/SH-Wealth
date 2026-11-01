import { it, expect, vi, afterEach } from "vitest";
import {
  securityQuery,
  securityCandidates,
  verifySecurity,
  validateSecuritySearch,
} from "../lib/security-search";
import {
  defaultBacktest,
  validateBacktestConfig,
} from "../lib/backtest-schema";
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
const quote = (symbol = "NVDA", exchange = "NMS", quoteType = "EQUITY") => ({
  symbol,
  exchange,
  quoteType,
  shortname: "Public security",
  isYahooFinance: true,
});
const meta = (
  symbol = "NVDA",
  exchangeName = "NMS",
  currency = "USD",
  instrumentType = "EQUITY",
) => ({
  chart: {
    error: null,
    result: [
      {
        meta: {
          symbol,
          exchangeName,
          currency,
          instrumentType,
          regularMarketPrice: 100,
          regularMarketTime: Math.floor(Date.now() / 1000),
        },
      },
    ],
  },
});
it("查询有界，拒绝链接、邮箱、长数字；不带日期权重或家庭资料", () => {
  expect(securityQuery("  Microsoft   Corp ")).toBe("Microsoft Corp");
  for (const q of [
    "",
    null,
    "a".repeat(49),
    "https://evil.example",
    "private@example.com",
    "1234567890",
  ])
    expect(() => securityQuery(q)).toThrow();
});
it("只接受受支持交易所公开股票和ETF，去重并保留精确证券身份", () => {
  const options = securityCandidates({
    quotes: [
      quote(),
      quote(),
      quote("ZSP-U.TO", "TOR", "ETF"),
      quote("BTC-USD", "CCC", "CRYPTOCURRENCY"),
      quote("^VIX", "WCB", "INDEX"),
      quote("ABC.L", "LSE"),
      quote("A_B", "NYQ"),
      quote("https://evil.example", "NYQ"),
      { ...quote("NO", "NYQ"), isYahooFinance: false },
    ],
  });
  expect(options.map((s) => s.symbol)).toEqual(["NVDA.US", "ZSP-U.TO"]);
  expect(options[1].providerSymbol).toBe("ZSP-U.TO");
  expect(() => securityCandidates({})).toThrow();
});
it("在线元数据必须匹配代码、交易所、类型和有效报价；TSX可为USD", () => {
  const c = securityCandidates({ quotes: [quote()] })[0];
  expect(verifySecurity(meta(), c)).toMatchObject({
    symbol: "NVDA.US",
    currency: "USD",
  });
  for (const patch of [
    { symbol: "META" },
    { exchangeName: "TOR" },
    { currency: "CAD" },
    { currency: "JPY" },
    { instrumentType: "MUTUALFUND" },
    { regularMarketPrice: 0 },
    { regularMarketPrice: NaN },
    { regularMarketTime: 1 },
    { regularMarketTime: Math.floor(Date.now() / 1000) + 864000 },
  ]) {
    const raw = meta();
    Object.assign(raw.chart.result[0].meta, patch);
    expect(() => verifySecurity(raw, c)).toThrow();
  }
  const cad = securityCandidates({
    quotes: [quote("ZSP-U.TO", "TOR", "ETF")],
  })[0];
  expect(
    verifySecurity(meta("ZSP-U.TO", "TOR", "USD", "ETF"), cad).currency,
  ).toBe("USD");
});
it("响应条目无效或过期时整体拒绝，不允许伪造下拉选项", () => {
  const s = verifySecurity(
      meta(),
      securityCandidates({ quotes: [quote()] })[0],
    ),
    r = {
      version: 1,
      query: "NVDA",
      options: [s],
      omitted: 0,
      checkedAt: new Date().toISOString(),
    };
  expect(() => validateSecuritySearch(r, "NVDA")).not.toThrow();
  for (const patch of [
    { symbol: "https://evil.example" },
    { providerSymbol: "META" },
    { exchange: "LSE" },
    { kind: "INDEX" },
    { currency: "CAD" },
    { verifiedAt: "2000-01-01" },
    { verifiedAt: "2099-01-01" },
  ])
    expect(() =>
      validateSecuritySearch({ ...r, options: [{ ...s, ...patch }] }, "NVDA"),
    ).toThrow();
  expect(() => validateSecuritySearch(r, "META")).toThrow();
  expect(() =>
    validateSecuritySearch({ ...r, options: [s, s] }, "NVDA"),
  ).toThrow();
});
it("同一份额的点号和连字符不能被作为两只证券重复建仓", () => {
  const c = {
    ...defaultBacktest("2020-01-01"),
    holdings: [
      { symbol: "BRK.B.US", weight: 50 },
      { symbol: "BRK-B.US", weight: 50 },
    ],
  };
  expect(() => validateBacktestConfig(c)).toThrow(/唯一/);
});
it("固定公开搜索与报价主机、无cookies/重定向/模型请求；只输出核对通过条目", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ quotes: [quote(), quote("FAKE", "NYQ")] }),
    )
    .mockResolvedValueOnce(Response.json(meta()))
    .mockResolvedValueOnce(Response.json(meta("DIFFERENT", "NYQ")));
  vi.stubGlobal("fetch", fetcher);
  const { fetchSecuritySearch } = await import("../lib/security-search-server");
  const r = await fetchSecuritySearch("NVDA.US");
  expect(r.options.map((s) => s.symbol)).toEqual(["NVDA.US"]);
  expect(r.omitted).toBe(1);
  const [u, o] = fetcher.mock.calls[0];
  expect(u.hostname).toBe("query1.finance.yahoo.com");
  expect(u.pathname).toBe("/v1/finance/search");
  expect(u.searchParams.get("q")).toBe("NVDA");
  expect(u.searchParams.get("newsCount")).toBe("0");
  expect(o.redirect).toBe("error");
  expect(o.headers.Cookie).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it.each([401, 403, 429])(
  "上游%s停止新批次，并与历史服务共享冷却，不绕过拒绝",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("blocked", { status })),
    );
    const { fetchSecuritySearch } =
        await import("../lib/security-search-server"),
      { fetchYahooHistory } = await import("../lib/backtest-yahoo-server");
    await expect(fetchSecuritySearch("NVDA")).rejects.toThrow(/拒绝|限流/);
    expect(
      (await fetchYahooHistory("NVDA.US", "2020-01-01", "2020-12-31")).blocked,
    ).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it("逐项核对中限流也停止后续批次，网络失败不自动重试", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ quotes: [quote(), quote("META"), quote("MSFT")] }),
    )
    .mockResolvedValue(new Response("blocked", { status: 429 }));
  vi.stubGlobal("fetch", fetcher);
  const { fetchSecuritySearch } = await import("../lib/security-search-server");
  await expect(fetchSecuritySearch("tech")).rejects.toThrow(/限流/);
  expect(fetcher.mock.calls.length).toBeLessThanOrEqual(3);
  vi.resetModules();
  fetcher.mockReset().mockRejectedValue(Error("offline"));
  const fresh = await import("../lib/security-search-server");
  await expect(fresh.fetchSecuritySearch("NVDA")).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("搜索防滥用不占AI额度，按身份隔离且一分钟后恢复", async () => {
  const { allowSecuritySearch } = await import("../lib/security-search-server");
  expect(allowSecuritySearch("one", 1000)).toBe(true);
  expect(allowSecuritySearch("one", 1100)).toBe(false);
  expect(allowSecuritySearch("two", 1100)).toBe(true);
  for (let i = 1; i < 30; i++)
    expect(allowSecuritySearch("one", 1000 + i * 600)).toBe(true);
  expect(allowSecuritySearch("one", 20000)).toBe(false);
  expect(allowSecuritySearch("one", 62000)).toBe(true);
});
