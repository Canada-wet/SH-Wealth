// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import SecurityPicker from "../app/components/backtest/SecurityPicker";
import type { Security } from "../lib/security-search";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const security = (symbol = "NVDA.US"): Security => ({
  symbol,
  providerSymbol: symbol.replace(/\.US$/, ""),
  name: symbol.startsWith("NVDA") ? "NVIDIA Corporation" : "Public fixture",
  exchange: "NASDAQ",
  kind: "EQUITY",
  currency: "USD",
  verifiedAt: new Date().toISOString(),
});
const response = (q: string, options = [security()]) =>
  Response.json({
    version: 1,
    query: q,
    options,
    omitted: 0,
    checkedAt: new Date().toISOString(),
  });
function mount(excluded: string[] = []) {
  const select = vi.fn();
  function Fixture() {
    const [v, setV] = useState("SPY.US");
    return (
      <SecurityPicker
        value={v}
        label="标的1"
        excluded={excluded}
        onSelect={(s) => {
          select(s);
          setV(s.symbol);
        }}
      />
    );
  }
  const view = render(<Fixture />);
  return { select, view };
}
function search(q: string) {
  const input = screen.getByRole("combobox", { name: "标的1" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: q } });
  return input as HTMLInputElement;
}
it("只有点击已核对选项才提交，未匹配文字或单独回车不会改组合", async () => {
  const fetcher = vi.fn(async (u: string) =>
    response(new URL(u, "https://app.example").searchParams.get("q")!),
  );
  vi.stubGlobal("fetch", fetcher);
  const { select } = mount(),
    input = search("NVDA");
  expect(select).not.toHaveBeenCalled();
  await screen.findByRole("option", { name: /NVDA.US/ });
  expect(input.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("option", { name: /NVDA.US/ }));
  expect(select).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ symbol: "NVDA.US", name: "NVIDIA Corporation" }),
  );
  expect(input.value).toBe("NVDA.US");
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(fetcher.mock.calls[0][0]).toBe("/api/backtest/securities?q=NVDA");
});
it("任意未选文字在Escape或离焦后恢复原代码，不创建自定义证券", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response("NOT_A_SECURITY", [])),
  );
  const { select } = mount(),
    input = search("NOT_A_SECURITY");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.value).toBe("SPY.US");
  expect(select).not.toHaveBeenCalled();
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "anything" } });
  fireEvent.blur(input, { relatedTarget: document.body });
  expect(input.value).toBe("SPY.US");
  expect(select).not.toHaveBeenCalled();
});
it("已在组合的别名不可选，方向键跳过重复项，IME回车不误选", async () => {
  const berk = { ...security("BRK-B.US"), exchange: "NYSE" as const };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response("BRK", [berk, security()])),
  );
  const { select } = mount(["BRK.B.US"]),
    input = search("BRK");
  const duplicate = await screen.findByRole("option", { name: /BRK-B.US/ });
  expect((duplicate as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(select).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(select.mock.calls[0][0].symbol).toBe("NVDA.US");
});
it("晚到搜索结果不能覆盖当前查询，外部value变更与卸载取消请求", async () => {
  let resolveFirst!: (v: Response) => void;
  const first = new Promise<Response>((r) => {
    resolveFirst = r;
  });
  const fetcher = vi
    .fn()
    .mockImplementationOnce(() => first)
    .mockImplementationOnce(() =>
      Promise.resolve(response("META", [security("META.US")])),
    );
  vi.stubGlobal("fetch", fetcher);
  const { select, view } = mount(),
    input = search("NVDA");
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  fireEvent.change(input, { target: { value: "META" } });
  await screen.findByRole("option", { name: /META.US/ });
  resolveFirst(response("NVDA"));
  await waitFor(() =>
    expect(screen.queryByRole("option", { name: /NVDA.US/ })).toBeNull(),
  );
  expect(select).not.toHaveBeenCalled();
  view.unmount();
  expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);
});
it("数据源拒绝不提供原始输入作为候选，不自动重发，显式重试才查询", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ error: "暂时限流" }, { status: 429 }));
  vi.stubGlobal("fetch", fetcher);
  const { select } = mount();
  search("NVDA");
  await screen.findByText("暂时限流");
  expect(screen.queryByRole("option")).toBeNull();
  expect(select).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "重新搜索" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
});
it("恶意或失配响应拒绝，不能成为dropdown选项", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      response("NVDA", [{ ...security(), symbol: "https://evil.example" }]),
    ),
  );
  const { select } = mount();
  search("NVDA");
  await screen.findByText(/条目无效|响应无效/);
  expect(screen.queryByRole("option")).toBeNull();
  expect(select).not.toHaveBeenCalled();
});
it("Safari触摸候选先失焦到null也保留选项，点击仍可提交", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response("NVDA")),
  );
  const { select } = mount(),
    input = search("NVDA");
  const option = await screen.findByRole("option", { name: /NVDA.US/ });
  fireEvent.pointerDown(option, { pointerType: "touch" });
  fireEvent.blur(input, { relatedTarget: null });
  expect(screen.getByRole("option", { name: /NVDA.US/ })).toBeTruthy();
  fireEvent.pointerUp(option, { pointerType: "touch" });
  fireEvent.click(option);
  expect(select).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ symbol: "NVDA.US" }),
  );
});
it("软键盘缩小visualViewport后，下拉按可见区域重新定位", async () => {
  const viewport = Object.assign(new EventTarget(), {
    offsetLeft: 0,
    offsetTop: 100,
    width: 390,
    height: 400,
  });
  vi.stubGlobal("visualViewport", viewport);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response("NVDA")),
  );
  mount();
  const field = screen.getByRole("combobox", { name: "标的1" });
  vi.spyOn(field, "getBoundingClientRect").mockReturnValue({
    x: 20,
    left: 20,
    right: 250,
    top: 350,
    bottom: 394,
    y: 350,
    width: 230,
    height: 44,
    toJSON: () => ({}),
  });
  search("NVDA");
  await screen.findByRole("option", { name: /NVDA.US/ });
  const popup = screen.getByRole("listbox").parentElement!;
  expect(parseFloat(popup.style.top)).toBeGreaterThanOrEqual(112);
  expect(
    parseFloat(popup.style.top) + parseFloat(popup.style.maxHeight),
  ).toBeLessThanOrEqual(500);
  viewport.height = 250;
  viewport.dispatchEvent(new Event("resize"));
  await waitFor(() =>
    expect(
      parseFloat(popup.style.top) + parseFloat(popup.style.maxHeight),
    ).toBeLessThanOrEqual(350),
  );
});
