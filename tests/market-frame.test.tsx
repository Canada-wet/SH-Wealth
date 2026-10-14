// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import MarketFrame from "../app/components/MarketFrame";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("窗口有加载、迟缓、重试状态与真正的替代链接", async () => {
  vi.useFakeTimers();
  const { container } = render(
    <MarketFrame
      title="测试行情"
      src="https://www.tradingview-widget.com/embed-widget/market-quotes/"
      height={240}
      fallback="https://www.tradingview.com/markets/"
    />,
  );
  expect(screen.getByRole("status").textContent).toContain("载入");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12000);
  });
  expect(screen.getByRole("status").textContent).toContain("未能及时");
  const old = container.querySelector("iframe");
  fireEvent.click(screen.getByRole("button", { name: "重试测试行情" }));
  expect(container.querySelector("iframe")).not.toBe(old);
  fireEvent.load(container.querySelector("iframe")!);
  expect(screen.getByRole("status").textContent).toContain("文档已载入");
  expect(
    screen.getByRole("link", { name: /在提供商查看/ }).getAttribute("href"),
  ).toBe("https://www.tradingview.com/markets/");
});
