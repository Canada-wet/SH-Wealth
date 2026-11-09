// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { emptyState } from "../lib/wealth";
import Markets from "../app/markets/page";

const fixture = vi.hoisted(() => ({
  refresh: vi.fn(),
  commit: vi.fn(),
  state: {} as ReturnType<typeof emptyState>,
}));
vi.mock("../lib/useWealth", () => ({
  default: () => ({
    state: fixture.state,
    ready: true,
    cloudLoading: false,
    cloudChoice: null,
    cloudStatus: "Isolated test fixture",
    commit: fixture.commit,
  }),
}));
vi.mock("../lib/useMarketData", () => ({
  default: () => ({
    data: {
      fx: [],
      yields: [],
      macro: [],
      indicators: [],
      failures: [],
      fetchedAt: "2026-11-09T15:00:00Z",
    },
    refresh: fixture.refresh,
    busy: false,
    error: "",
    cached: false,
    needsLogin: false,
  }),
}));
vi.mock("../lib/cloud", () => ({ cloudClient: () => null }));
vi.mock("../app/components/MarketNavigator", () => ({ default: () => null }));
vi.mock("../app/components/AppNavigation", () => ({
  ModuleBridge: () => null,
}));
vi.mock("../app/components/MarketSectionNav", () => ({ default: () => null }));
vi.mock("../app/components/MarketInvestmentDesk", () => ({
  default: () => null,
}));
vi.mock("../app/components/MarketIntelligence", () => ({
  default: () => null,
}));
vi.mock("../app/components/MarketWealth", () => ({ default: () => null }));
vi.mock("../app/components/MarketResearchArchive", () => ({
  default: () => null,
}));
vi.mock("../app/components/MarketResearch", () => ({
  MarketOverview: () => null,
  MacroResearch: () => null,
  YieldResearch: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "localStorage",
    new JSDOM("", { url: "http://localhost" }).window.localStorage,
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 0),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("IntersectionObserver", undefined);
  fixture.state = emptyState();
  fixture.state.preferences.marketWatchlist = [
    { ticker: "NVDA", exchange: "NASDAQ", name: "NVIDIA" },
    { ticker: "META", exchange: "NASDAQ", name: "Meta" },
  ];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("三个整组刷新入口均重连速览、行情表、外汇和打开的图表；仅页头核对官方API", () => {
  localStorage.setItem("together-market-embeds", "on");
  const original = JSON.stringify(fixture.state);
  render(<Markets />);
  fireEvent.click(
    screen.getByRole("button", { name: "速览打开NASDAQ:NVDA图表" }),
  );
  fireEvent.change(screen.getByLabelText("搜索涨跌速览"), {
    target: { value: "nvda" },
  });
  const titles = [
    "当前涨跌NASDAQ:NVDA",
    "自选股票ETF行情",
    "加币盘中外汇参考",
    "所选证券历史图表",
  ];
  const frames = () => titles.map((title) => screen.getByTitle(title));
  let previous = frames();
  for (const name of ["刷新自选行情", "重新连接行情", "刷新市场数据"]) {
    fireEvent.click(screen.getByRole("button", { name }));
    const next = frames();
    next.forEach((frame, index) => expect(frame).not.toBe(previous[index]));
    previous = next;
    expect(screen.getByLabelText("搜索涨跌速览")).toHaveProperty(
      "value",
      "nvda",
    );
    expect(screen.getByLabelText("选择证券图表")).toHaveProperty(
      "value",
      "NASDAQ:NVDA",
    );
  }
  expect(fixture.refresh).toHaveBeenCalledOnce();
  expect(fixture.commit).not.toHaveBeenCalled();
  expect(JSON.stringify(fixture.state)).toBe(original);
  expect(screen.getByText(/非报价更新时间/)).toBeTruthy();
  expect(screen.getByText(/不代表已取得最新价格/)).toBeTruthy();
});

it("未授权外部行情时页头仍可核对官方数据，但不会创建报价连接或更改授权", () => {
  const view = render(<Markets />);
  fireEvent.click(screen.getByRole("button", { name: "刷新市场数据" }));
  expect(fixture.refresh).toHaveBeenCalledOnce();
  expect(view.container.querySelector("iframe")).toBeNull();
  expect(localStorage.getItem("together-market-embeds")).toBeNull();
  expect(screen.getByRole("button", { name: "刷新自选行情" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(fixture.commit).not.toHaveBeenCalled();
});
