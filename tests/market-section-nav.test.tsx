// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import MarketSectionNav from "../app/components/MarketSectionNav";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("Safari 锚点落在140px附近的分数像素时保留正确区块，手动滚动仍更新", () => {
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  let macroTop = 140.5,
    pulseTop = -1000;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const top =
        this.id === "macro-research"
          ? macroTop
          : this.id === "watchlist-pulse"
            ? pulseTop
            : -2000;
      return {
        top,
        bottom: this.tagName === "NAV" ? 110 : top + 100,
        x: 0,
        y: top,
        left: 0,
        right: 300,
        width: 300,
        height: 100,
        toJSON() {},
      };
    },
  );
  render(
    <>
      <MarketSectionNav />
      <section id="watchlist-pulse" />
      <section id="macro-research" />
    </>,
  );
  act(() => frame!(0));
  expect(
    screen.getByRole("link", { name: "宏观研究" }).getAttribute("aria-current"),
  ).toBe("location");
  macroTop = 900;
  pulseTop = 140.2;
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
  act(() => frame!(1));
  expect(
    screen.getByRole("link", { name: "自选涨跌" }).getAttribute("aria-current"),
  ).toBe("location");
});
