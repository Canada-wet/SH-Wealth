import { it, expect } from "vitest";
import {
  validMarketData,
  editWatchlist,
  marketSnapshot,
  instrumentFallback,
  watchlistFingerprint,
  mergeMarketData,
} from "../lib/market-state";
import { DEFAULT_WATCHLIST, type MarketData } from "../lib/market";
import { emptyState } from "../lib/wealth";
import { connectionPlan, hasSavedData } from "../lib/cloud-plan";
const data: MarketData = {
  fetchedAt: "2026-10-14T12:00:00Z",
  fx: [],
  yields: [],
  macro: [],
  failures: [],
};
it("部分数据源失效保留上次有效值和源日期，不用新时间伪装旧观测", () => {
  const row = {
    id: "DGS2",
    label: "2年",
    value: 4,
    date: "2026-10-13",
    unit: "%",
    frequency: "daily" as const,
    source: "https://fred.stlouisfed.org/series/DGS2",
    trend: [],
  };
  const old = { ...data, yields: [row] };
  const incoming = {
    ...data,
    fetchedAt: "2026-10-14T13:00:00Z",
    yields: [{ ...row, value: null, date: null }],
  };
  const merged = mergeMarketData(old, incoming);
  expect(merged.yields[0]).toMatchObject({ value: 4, date: "2026-10-13" });
  expect(merged.yields[0].note).toContain("保留上次有效观测");
  expect(merged.failures).toContain("2年");
  expect(mergeMarketData(null, incoming).yields[0].value).toBeNull();
});
it("市场响应必须结构完整、来源受控，不接受HTML或非有限数字", () => {
  expect(validMarketData(data)).toBe(true);
  expect(validMarketData("<html>login</html>")).toBe(false);
  expect(validMarketData({ ...data, fx: {} })).toBe(false);
  const reading = {
    id: "x",
    label: "x",
    value: 1,
    date: "2026-10-13",
    unit: "%",
    frequency: "daily",
    source: "https://fred.stlouisfed.org/series/x",
    trend: [],
  };
  expect(validMarketData({ ...data, fx: [reading] })).toBe(true);
  expect(validMarketData({ ...data, fx: [{ ...reading, value: NaN }] })).toBe(
    false,
  );
  expect(
    validMarketData({
      ...data,
      fx: [{ ...reading, source: "https://evil.test/" }],
    }),
  ).toBe(false);
});
it("自选可改名称和代码；重复和过期编辑不静默覆盖", () => {
  const next = { ...DEFAULT_WATCHLIST[0], name: "自己的名称" };
  expect(editWatchlist(DEFAULT_WATCHLIST, "NASDAQ:NVDA", next)[0].name).toBe(
    "自己的名称",
  );
  expect(() =>
    editWatchlist(DEFAULT_WATCHLIST, "NASDAQ:NVDA", DEFAULT_WATCHLIST[1]),
  ).toThrow(/重复/);
  expect(() => editWatchlist([], "NASDAQ:NVDA", next)).toThrow(/变化/);
});
it("导出不包含家庭信息、聊天、自定义名称或跨域报价", () => {
  const output = marketSnapshot(
    { ...data, assets: [{ value: 123 }], messages: ["private"] } as MarketData,
    [{ ...DEFAULT_WATCHLIST[0], name: "SECRET_LABEL" }],
  );
  expect(output.watchlist).toEqual([{ ticker: "NVDA", exchange: "NASDAQ" }]);
  expect(JSON.stringify(output)).not.toMatch(
    /SECRET_LABEL|"assets"|"messages"|"123"/,
  );
});
it("ZGIN 转官方入口，其他代码使用安全编码提供商入口", () => {
  expect(
    instrumentFallback(DEFAULT_WATCHLIST.find((row) => row.ticker === "ZGIN")),
  ).toContain("bmoetfs.ca");
  expect(instrumentFallback(DEFAULT_WATCHLIST[0])).toContain("NASDAQ%3ANVDA");
});
it("仅自选或删空自选也属于保存数据，不能被空家庭吞掉", () => {
  const state = emptyState();
  state.preferences.marketWatchlist = [];
  expect(hasSavedData(state)).toBe(true);
  expect(connectionPlan(state, emptyState())).toBe("upload");
  const cloud = emptyState();
  cloud.preferences.marketWatchlist = [DEFAULT_WATCHLIST[0]];
  expect(connectionPlan(emptyState(), cloud)).toBe("load");
  expect(connectionPlan(state, cloud)).toBe("choice");
});
it("自选比较忽略对象键顺序，但保留标的顺序和名称变化", () => {
  expect(watchlistFingerprint([DEFAULT_WATCHLIST[0]])).toBe(
    watchlistFingerprint([
      { name: "NVIDIA", exchange: "NASDAQ", ticker: "NVDA" },
    ]),
  );
});
