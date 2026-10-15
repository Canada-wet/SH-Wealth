// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import MarketPulse from "../app/components/MarketPulse";
import MarketQuoteTile from "../app/components/MarketQuoteTile";
import { DEFAULT_WATCHLIST } from "../lib/market";
afterEach(cleanup);
it("报价状态只接收当前供应商窗口的消息，不让其他窗口伪造就绪", () => {
  const view = render(
    <MarketQuoteTile row={DEFAULT_WATCHLIST[0]} ready onSelect={() => {}} />,
  );
  const frame = view.container.querySelector("iframe")!;
  const card = screen.getByRole("article");
  const message = (
    name: string,
    origin = "https://www.tradingview-widget.com",
    source = frame.contentWindow,
  ) =>
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", { origin, source, data: { name } }),
      ),
    );
  message("tv-widget-ready", "https://evil.invalid");
  message("tv-widget-ready", "https://www.tradingview-widget.com", window);
  expect(card.getAttribute("data-state")).toBe("waiting");
  message("tv-widget-ready");
  expect(card.getAttribute("data-state")).toBe("ready");
  message("tv-widget-no-data");
  message("tv-widget-ready");
  expect(card.getAttribute("data-state")).toBe("unavailable");
});
it("速览明确授权后才加载，按同一清单筛选币种，支持选图和空列表", () => {
  const onEnable = vi.fn(),
    onSelect = vi.fn();
  const props = {
    rows: DEFAULT_WATCHLIST,
    live: false,
    ready: true,
    onEnable,
    onSelect,
  };
  const view = render(<MarketPulse {...props} />);
  expect(view.container.querySelector("iframe")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "开启自选涨跌速览" }));
  expect(onEnable).toHaveBeenCalledOnce();
  view.rerender(<MarketPulse {...props} live />);
  const symbols = () =>
    Array.from(view.container.querySelectorAll("iframe")).flatMap(
      (frame) =>
        JSON.parse(decodeURIComponent(new URL(frame.src).hash.slice(1))).symbol,
    );
  expect(symbols()).toHaveLength(29);
  const oldFrame = screen.getByTitle("当前涨跌NASDAQ:NVDA");
  fireEvent.click(screen.getByRole("button", { name: "重试涨跌NASDAQ:NVDA" }));
  expect(screen.getByTitle("当前涨跌NASDAQ:NVDA")).not.toBe(oldFrame);
  fireEvent.click(
    screen.getByRole("button", { name: "速览打开NASDAQ:NVDA图表" }),
  );
  expect(onSelect).toHaveBeenLastCalledWith(DEFAULT_WATCHLIST[0]);
  expect(screen.getByText(/当前源暂无覆盖/)).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "查看官方价格与净值 ↗" })
      .getAttribute("href"),
  ).toContain("bmoetfs.ca");
  fireEvent.click(screen.getByRole("button", { name: "加拿大 · CAD" }));
  expect(symbols().every((symbol: string) => symbol.startsWith("TSX:"))).toBe(
    true,
  );
  fireEvent.change(screen.getByLabelText("从速览查看图表"), {
    target: { value: "TSX:ZSP" },
  });
  expect(onSelect).toHaveBeenCalledWith(
    DEFAULT_WATCHLIST.find((row) => row.ticker === "ZSP"),
  );
  view.rerender(<MarketPulse {...props} rows={[]} live />);
  expect(view.container.querySelector("iframe")).toBeNull();
  expect(screen.getByText(/自选清单为空/)).toBeTruthy();
});
