// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import MarketIntelligence from "../app/components/MarketIntelligence";
import { ruleMarketBrief } from "../lib/market-briefing";
import { MARKET_INDICATORS } from "../lib/market-indicators";
import type { MarketData } from "../lib/market";
const data: MarketData = {
  fetchedAt: "2026-10-15T14:00:00Z",
  fx: [],
  yields: [],
  macro: [],
  failures: [],
  indicators: MARKET_INDICATORS.map((d, i) => ({
    ...d,
    value: 20 + i,
    date: d.frequency === "daily" ? "2026-10-14" : "2026-08-01",
    trend: [],
    source: `https://fred.stlouisfed.org/series/${d.id}`,
  })),
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("今日缺失时自动请求一次，显示真实降级身份，历史切换不付费", async () => {
  const older = ruleMarketBrief(data, new Date("2026-10-14T14:00:00Z")),
    today = ruleMarketBrief(data, new Date("2026-10-15T14:00:00Z"));
  const request = vi.fn(async (_url: string, init?: RequestInit) =>
    Response.json({
      today: "2026-10-15",
      canGenerate: true,
      reports: init?.method === "POST" ? [today, older] : [older],
    }),
  );
  vi.stubGlobal("fetch", request);
  render(<MarketIntelligence data={data} />, { reactStrictMode: true });
  await waitFor(() =>
    expect(screen.getByLabelText("查看历史市场简报")).toHaveProperty(
      "value",
      "2026-10-15",
    ),
  );
  expect(
    request.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
  expect(screen.getByText("规则摘要 · 非 AI")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("查看历史市场简报"), {
    target: { value: "2026-10-14" },
  });
  expect(screen.getByText(/当前查看 2026-10-14 的归档/)).toBeTruthy();
  expect(
    request.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
});
it("指标分组、来源和缺失状态可切换，不给AI代理虚构供需缺口", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ today: "2026-10-15", reports: [], canGenerate: false }),
    ),
  );
  const view = render(<MarketIntelligence data={data} />);
  fireEvent.click(screen.getByRole("button", { name: "AI 产业供需代理" }));
  expect(screen.getByText("计算机与电子产品新订单")).toBeTruthy();
  expect(screen.getByText(/它们不是全球 AI 供需指数/)).toBeTruthy();
  view.rerender(<MarketIntelligence data={null} />);
  expect(screen.getAllByText("暂不可用")).toHaveLength(3);
  await waitFor(() => expect(screen.getByText(/暂无已保存简报/)).toBeTruthy());
});
it("读取失败保留先前归档，不把错误冒充今日成功", async () => {
  const report = ruleMarketBrief(data, new Date("2026-10-14T14:00:00Z"));
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        today: "2026-10-15",
        reports: [report],
        canGenerate: false,
      }),
    )
    .mockRejectedValueOnce(new Error("offline"));
  vi.stubGlobal("fetch", request);
  render(<MarketIntelligence data={data} />);
  await waitFor(() =>
    expect(screen.getByText(/当前查看 2026-10-14 的归档/)).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "检查今日简报" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("offline"),
  );
  expect(screen.getByText(report.summary)).toBeTruthy();
});
