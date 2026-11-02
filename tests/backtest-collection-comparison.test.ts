import { it, expect, vi } from "vitest";
import {
  defaultBacktest,
  type BacktestLab,
  type BacktestData,
} from "../lib/backtest-schema";
import {
  EMPTY_PORTFOLIO_SHELF,
  exportPortfolioShelf,
  readPortfolioShelf,
  type PortfolioShelf,
} from "../lib/backtest-comparison";
import {
  cachedCollectionData,
  prepareCollectionComparison,
} from "../lib/backtest-collection-comparison";
import { stableJSON } from "../lib/cloud-plan";
const dates = ["2020-01-02", "2020-01-03", "2020-01-06", "2020-01-07"];
function setup() {
  const lab: BacktestLab = {
    version: 1,
    saved: [0, 1].map((i) => ({
      id: `p${i}`,
      at: "2026-11-01T12:00:00Z",
      config: {
        ...defaultBacktest("2020-01-07"),
        start: "2020-01-01",
        name: `组合${i}`,
        initial: 1000 + i * 1000,
        holdings: [{ symbol: i ? "AVUV.US" : "VTV.US", weight: 100 }],
      },
    })),
  };
  const shelf: PortfolioShelf = {
    ...structuredClone(EMPTY_PORTFOLIO_SHELF),
    collection: { ids: ["p0", "p1"], baseline: "p0" },
  };
  return { lab, shelf, signal: new AbortController().signal };
}
function data(
  symbol = "VTV.US",
  currency: "USD" | "CAD" = "USD",
): BacktestData {
  return {
    version: 1,
    capturedAt: "2026-11-01T00:00:00Z",
    synthetic: false,
    assets: [
      {
        symbol,
        currency,
        basis: "total-return",
        dividendsKnown: false,
        source: "Synthetic HTTP test fixture",
        points: dates.map((date, i) => ({
          date,
          close: 100 + i,
          dividend: 0,
          split: 1,
        })),
      },
    ],
  };
}
const fetcher = () =>
  vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const q = JSON.parse(String(init?.body));
    return Response.json({
      requested: q,
      effectiveEnd: q.end,
      results: q.symbols.map((symbol: string) => ({ symbol })),
      data: {
        ...data(),
        assets: q.symbols.map((s: string) => data(s).assets[0]),
      },
    });
  });
it("组合库直接选取、一次请求去重代码，准备并比较不更改库/旧快照/草稿", async () => {
  const args = setup(),
    f = fetcher(),
    before = structuredClone(args);
  args.lab.saved[1].config.holdings = [
    { symbol: "VTV.US", weight: 50 },
    { symbol: "AVUV.US", weight: 50 },
  ];
  const original = stableJSON(args.lab),
    originalShelf = stableJSON(args.shelf);
  const r = await prepareCollectionComparison({ ...args, fetcher: f });
  expect(f).toHaveBeenCalledOnce();
  const q = JSON.parse(String(f.mock.calls[0][1]?.body));
  expect(q.symbols).toEqual(["VTV.US", "AVUV.US"]);
  expect(Object.keys(q).sort()).toEqual([
    "end",
    "provider",
    "start",
    "symbols",
  ]);
  expect(r.report.items).toHaveLength(2);
  expect(r.report.items[1].report.config.initial).toBe(1000);
  expect(r.shelf.studies[1].config.initial).toBe(2000);
  expect(r.shelf.studies[1].origin?.planId).toBe("p1");
  expect(stableJSON(args.lab)).toBe(original);
  expect(stableJSON(args.shelf)).toBe(originalShelf);
  expect(before.shelf.studies).toHaveLength(0);
  const copy = readPortfolioShelf(exportPortfolioShelf(r.shelf));
  expect(copy.collection).toEqual(args.shelf.collection);
  expect(copy.studies[0].origin).toEqual(r.shelf.studies[0].origin);
});
it("缓存与库版本相同可无外部请求复用，换权重后不把旧配置当新结果", async () => {
  const args = setup(),
    f = fetcher();
  const first = await prepareCollectionComparison({ ...args, fetcher: f });
  f.mockClear();
  expect(cachedCollectionData(args.lab.saved[0], first.shelf)).toBeTruthy();
  const second = await prepareCollectionComparison({
    ...args,
    shelf: first.shelf,
    fetcher: f,
  });
  expect(f).not.toHaveBeenCalled();
  expect(second.report.items).toHaveLength(2);
  args.lab.saved[0].config.name = "更新的组合";
  expect(cachedCollectionData(args.lab.saved[0], first.shelf)).toBeNull();
  await prepareCollectionComparison({
    ...args,
    shelf: first.shelf,
    fetcher: f,
  });
  expect(f).toHaveBeenCalledOnce();
  expect(JSON.parse(String(f.mock.calls[0][1]?.body)).symbols).toEqual([
    "VTV.US",
  ]);
});
it("可以复用精确匹配的工作台行情，不修改工作台；刷新选项则重新请求", async () => {
  const args = setup(),
    f = fetcher(),
    draft = { config: args.lab.saved[0].config, data: data() };
  const original = stableJSON(draft);
  await prepareCollectionComparison({ ...args, draft, fetcher: f });
  expect(JSON.parse(String(f.mock.calls[0][1]?.body)).symbols).toEqual([
    "AVUV.US",
  ]);
  expect(stableJSON(draft)).toBe(original);
  f.mockClear();
  await prepareCollectionComparison({
    ...args,
    draft,
    refresh: true,
    fetcher: f,
  });
  expect(JSON.parse(String(f.mock.calls[0][1]?.body)).symbols).toEqual([
    "VTV.US",
    "AVUV.US",
  ]);
});
it("同一批缺项则整体保留原对照，不删持仓、不重试、不运行残缺组合", async () => {
  const args = setup(),
    before = stableJSON(args.shelf),
    f = vi.fn(async (_u: RequestInfo | URL, i?: RequestInit) =>
      Response.json({
        requested: JSON.parse(String(i?.body)),
        data: data(),
        results: [{ symbol: "AVUV.US", error: "来源暂无覆盖" }],
      }),
    );
  await expect(
    prepareCollectionComparison({ ...args, fetcher: f }),
  ).rejects.toThrow(/AVUV.US/);
  expect(f).toHaveBeenCalledOnce();
  expect(stableJSON(args.shelf)).toBe(before);
});
it("删除、未选满、无共同日期、现金分红与未授权来源在上游前拒绝", async () => {
  const args = setup(),
    f = fetcher();
  args.lab.saved.pop();
  await expect(
    prepareCollectionComparison({ ...args, fetcher: f }),
  ).rejects.toThrow(/已被删除/);
  expect(f).not.toHaveBeenCalled();
  const few = setup();
  few.shelf.collection!.ids = ["p0"];
  await expect(
    prepareCollectionComparison({ ...few, fetcher: f }),
  ).rejects.toThrow(/2–4/);
  const dates = setup();
  dates.lab.saved[0].config.start = "2021-01-01";
  dates.lab.saved[0].config.end = "2021-12-31";
  await expect(
    prepareCollectionComparison({ ...dates, fetcher: f }),
  ).rejects.toThrow(/共同历史/);
  const cash = setup();
  cash.lab.saved[0].config.dividends = "cash";
  await expect(
    prepareCollectionComparison({ ...cash, fetcher: f }),
  ).rejects.toThrow(/再投资/);
  expect(f).not.toHaveBeenCalled();
});
it("只对总回报日线显式对齐共同交易日并记录省略，原价事件仍不许静默丢日", async () => {
  const args = setup(),
    f = fetcher();
  const first = await prepareCollectionComparison({ ...args, fetcher: f });
  const saved = first.shelf.studies[1].data.assets[0].points;
  saved.splice(1, 1);
  f.mockClear();
  const r = await prepareCollectionComparison({
    ...args,
    shelf: first.shelf,
    fetcher: f,
  });
  expect(f).not.toHaveBeenCalled();
  expect(r.report.observations).toBe(3);
  expect(r.report.warnings.join()).toMatch(/共同总回报日历/);
  expect(r.shelf.studies[0].data.alignment?.omitted).toBe(1);
  const raw = structuredClone(first.shelf);
  raw.studies.forEach((s) => {
    s.data.assets[0].basis = "raw";
    s.data.assets[0].dividendsKnown = true;
  });
  await expect(
    prepareCollectionComparison({ ...args, shelf: raw, fetcher: f }),
  ).rejects.toThrow(/交易日不一致/);
});
it("跨币种以所选基准币种统一，仅取一次历史FX，组合库原币种与金额不变", async () => {
  const args = setup();
  args.lab.saved[1].config.currency = "CAD";
  args.lab.saved[1].config.holdings = [{ symbol: "XCV.TO", weight: 100 }];
  args.shelf.collection!.baseline = "p1";
  const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes("/fx?"))
      return Response.json({
        source: "Bank of Canada FXUSDCAD",
        fetchedAt: "2026-11-01T12:00:00Z",
        points: dates.map((date) => ({ date, cadPerUsd: 1.3 })),
      });
    const q = JSON.parse(String(init?.body));
    return Response.json({
      requested: q,
      results: [],
      data: {
        ...data(),
        assets: q.symbols.map(
          (s: string) => data(s, s.endsWith(".TO") ? "CAD" : "USD").assets[0],
        ),
      },
    });
  });
  const r = await prepareCollectionComparison({ ...args, fetcher: f });
  expect(r.report.currency).toBe("CAD");
  expect(f).toHaveBeenCalledTimes(2);
  expect(r.shelf.studies[0].data.conversion?.native["VTV.US"]).toBe("USD");
  expect(args.lab.saved[0].config.currency).toBe("USD");
  expect(r.report.items[0].report.config.initial).toBe(2000);
});
it("外部取消或失配响应不生成新快照，不会自动再发请求", async () => {
  const args = setup(),
    controller = new AbortController(),
    f = fetcher();
  controller.abort();
  await expect(
    prepareCollectionComparison({
      ...args,
      signal: controller.signal,
      fetcher: f,
    }),
  ).rejects.toThrow();
  expect(f).not.toHaveBeenCalled();
  const bad = vi.fn(async () => Response.json({ requested: {}, data: data() }));
  await expect(
    prepareCollectionComparison({ ...args, fetcher: bad }),
  ).rejects.toThrow(/完整行情/);
  expect(bad).toHaveBeenCalledOnce();
});
it("不同组合大量代码不超过8个一批，重复持仓只取一次", async () => {
  const args = setup();
  args.lab.saved[0].config.holdings = Array.from({ length: 8 }, (_, i) => ({
    symbol: `T${i}.US`,
    weight: 12.5,
  }));
  args.lab.saved[1].config.holdings = Array.from({ length: 8 }, (_, i) => ({
    symbol: `T${i + 4}.US`,
    weight: 12.5,
  }));
  const f = fetcher();
  const r = await prepareCollectionComparison({ ...args, fetcher: f });
  expect(f).toHaveBeenCalledTimes(2);
  expect(
    f.mock.calls.map(([, i]) => JSON.parse(String(i?.body)).symbols.length),
  ).toEqual([8, 4]);
  expect(r.shelf.studies[0].config.holdings).toHaveLength(8);
});
it("多年历史按传输预算缩小批次，避免常见ETF因包太大被误判缺数据", async () => {
  const args = setup();
  args.lab.saved.forEach((p, j) => {
    p.config.start = "2007-01-01";
    p.config.end = "2025-12-31";
    p.config.holdings = Array.from({ length: 8 }, (_, i) => ({
      symbol: `T${i + j * 4}.US`,
      weight: 12.5,
    }));
  });
  const f = fetcher();
  await prepareCollectionComparison({ ...args, fetcher: f });
  expect(f).toHaveBeenCalledTimes(3);
  expect(
    f.mock.calls.every(
      ([, i]) => JSON.parse(String(i?.body)).symbols.length <= 4,
    ),
  ).toBe(true);
});
