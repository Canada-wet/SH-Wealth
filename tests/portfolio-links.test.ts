import { it, expect } from "vitest";
import { emptyState, validateState } from "../lib/wealth";
import {
  validPortfolioLinks,
  savePortfolioLinks,
  linkBaseline,
  portfolioExposure,
  portfolioInsights,
  portfolioStress,
  type PortfolioLink,
} from "../lib/portfolio-links";
import { connectionPlan } from "../lib/cloud-plan";
const link = (
  id = "l",
  assetId = "a",
  weight = 50,
  currency: PortfolioLink["currency"] = "USD",
): PortfolioLink => ({
  id,
  assetId,
  weight,
  currency,
  instrument: { ticker: "NVDA", exchange: "NASDAQ", name: "NVIDIA" },
});
function state() {
  const s = emptyState();
  s.assets = [
    {
      id: "a",
      name: "合成账户",
      owner: "first",
      category: "投资",
      value: 10000,
      annualReturn: null,
    },
    {
      id: "b",
      name: "合成账户二",
      owner: "second",
      category: "投资",
      value: 5000,
      annualReturn: null,
    },
  ];
  s.preferences.portfolioLinks = [link(), link("l2", "b", 100)];
  return s;
}
it("配置比例校验：拒绝超配、重复、非有限、错误币种和重复证券", () => {
  expect(validPortfolioLinks([link()])).toBe(true);
  for (const rows of [
    [link("l", "a", 101)],
    [link("l", "a", 0)],
    [link("l", "a", NaN)],
    [link(), link("l2", "a", 20)],
    [
      link(),
      {
        ...link("l2", "a", 60),
        instrument: { ticker: "META", exchange: "NASDAQ", name: "meta" },
      },
    ],
    [{ ...link(), currency: "toString" }],
    [null],
  ])
    expect(validPortfolioLinks(rows)).toBe(false);
});
it("只计算显式关联、跨账户汇总，占比以总资产为分母，账户金额动态联动", () => {
  const s = state(),
    e = portfolioExposure(s);
  expect(e.linked).toBe(10000);
  expect(e.unknown).toBe(5000);
  expect(e.byInstrument[0]).toMatchObject({ accounts: 2, value: 10000 });
  expect(e.coverage).toBeCloseTo(66.6667);
  s.assets[0].value = 20000;
  expect(portfolioExposure(s).linked).toBe(15000);
});
it("未关联自选不当持仓、删除账户关联保持可见警示且不复活", () => {
  const s = state();
  s.assets = s.assets.slice(1);
  expect(portfolioExposure(s)).toMatchObject({ linked: 5000, missing: 1 });
  expect(portfolioInsights(emptyState())[0].id).toBe("mapping");
});
it("压力试算乘法合成，不重复换算 CAD；对冲和未知不臆造外币敞口", () => {
  const s = state();
  expect(portfolioStress(s, -20, -5).effect).toBe(-2400);
  s.preferences.portfolioLinks![0].currency = "hedged";
  expect(portfolioStress(s, -20, -5).effect).toBe(-2200);
  s.preferences.portfolioLinks![1].currency = "unknown";
  expect(portfolioStress(s, -20, -5)).toMatchObject({
    effect: -2000,
    unknownFx: 5000,
  });
  expect(() => portfolioStress(s, -101, 0)).toThrow();
  expect(() => portfolioStress(s, 0, -100)).toThrow();
});
it("缺失或未来 / 陈旧市场观测不伪造当前数字；不把 VIX 当预测", () => {
  const s = state(),
    now = new Date("2026-10-15T16:00:00Z");
  const data = {
    fx: [
      {
        id: "FXUSDCAD",
        date: "2026-10-14",
        value: 0.75,
        source: "https://www.bankofcanada.ca/",
        trend: [],
        label: "USD",
        unit: " / CAD",
        frequency: "daily" as const,
      },
    ],
    yields: [],
    macro: [],
    failures: [],
    fetchedAt: now.toISOString(),
    indicators: [
      {
        id: "VIXCLS",
        date: "2026-10-14",
        value: 20,
        source: "https://fred.stlouisfed.org/series/VIXCLS",
        trend: [],
        label: "VIX",
        unit: "",
        frequency: "daily" as const,
      },
    ],
  };
  expect(
    portfolioInsights(s, data, now).find((x) => x.id === "fx-USD")?.body,
  ).toContain("0.7500");
  expect(
    portfolioInsights(s, data, now).find((x) => x.id === "vix")?.body,
  ).toContain("不是");
  data.fx[0].date = "2026-10-20";
  expect(
    portfolioInsights(s, data, now).find((x) => x.id === "fx-USD")?.body,
  ).toContain("缺少");
  data.indicators[0].date = "2026-09-01";
  expect(portfolioInsights(s, data, now).some((x) => x.id === "vix")).toBe(
    false,
  );
});
it("保存只更新配置，不改变资产与历史；过期金额或关联拒绝覆盖", () => {
  const s = state(),
    before = structuredClone(s),
    stamp = linkBaseline(s);
  const next = savePortfolioLinks(s, stamp, [link()]);
  validateState(next);
  expect(next.assets).toEqual(before.assets);
  expect(next.history).toEqual(before.history);
  s.assets[0].value++;
  expect(() => savePortfolioLinks(s, stamp, [])).toThrow("已变化");
  expect(() =>
    savePortfolioLinks(s, linkBaseline(s), [link("x", "gone")]),
  ).toThrow("已删除");
});
it("纯关联文档是已保存内容、不会被当成仅聊天合并", () => {
  const a = emptyState();
  a.preferences.portfolioLinks = [];
  const b = emptyState();
  b.preferences.portfolioLinks = [link()];
  expect(connectionPlan(a, b)).toBe("choice");
  expect(() =>
    validateState({
      ...b,
      preferences: { ...b.preferences, portfolioLinks: [link("l", "a", -1)] },
    }),
  ).toThrow();
});
