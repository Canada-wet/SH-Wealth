// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MarketInvestmentDesk from "../app/components/MarketInvestmentDesk";
import { DEFAULT_WATCHLIST, type MarketInstrument } from "../lib/market";
import {
  EMPTY_RESEARCH_NOTE,
  type ResearchNotes,
  type ResearchNote,
} from "../lib/market-research";
afterEach(cleanup);
const props = () => ({
  rows: DEFAULT_WATCHLIST,
  selected: "NASDAQ:NVDA",
  notes: {} as ResearchNotes,
  ready: true,
  syncStatus: "仅保存于本机",
  onSelect: vi.fn(),
  onChart: vi.fn(),
  onSave: vi.fn(
    (
      _row: MarketInstrument,
      _baseline: ResearchNote | undefined,
      _draft: ResearchNote,
    ) => true,
  ),
});
it("研究草稿切换保留，只有保存成功才清理；草稿基线不随云端更新改变", () => {
  const p = props(),
    view = render(<MarketInvestmentDesk {...p} />);
  fireEvent.change(screen.getByLabelText("投资逻辑"), {
    target: { value: "合成初始逻辑" },
  });
  view.rerender(<MarketInvestmentDesk {...p} selected="NASDAQ:META" />);
  expect((screen.getByLabelText("投资逻辑") as HTMLTextAreaElement).value).toBe(
    "",
  );
  view.rerender(
    <MarketInvestmentDesk
      {...p}
      notes={{
        "NASDAQ:NVDA": {
          ...EMPTY_RESEARCH_NOTE,
          thesis: "云端新内容",
          updatedAt: "2026-10-14T00:00:00Z",
        },
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText("主要风险"), {
    target: { value: "后续补充" },
  });
  p.onSave.mockReturnValueOnce(false);
  fireEvent.click(screen.getByRole("button", { name: "保存研究记录" }));
  expect(p.onSave.mock.calls[0][1]).toBeUndefined();
  expect((screen.getByLabelText("投资逻辑") as HTMLTextAreaElement).value).toBe(
    "合成初始逻辑",
  );
  fireEvent.click(screen.getByRole("button", { name: "放弃此标的草稿" }));
  expect((screen.getByLabelText("投资逻辑") as HTMLTextAreaElement).value).toBe(
    "云端新内容",
  );
});
it("加币收益不重复叠加外汇；空输入不变成零；可以模拟归零", () => {
  render(<MarketInvestmentDesk {...props()} />);
  expect(screen.getByLabelText("压力试算结果").textContent).toContain(
    "−".replace("−", "-"),
  );
  expect(screen.getByLabelText("压力试算结果").textContent).toContain("25.00%");
  fireEvent.change(screen.getByLabelText("压力试算收益口径"), {
    target: { value: "foreign" },
  });
  fireEvent.change(screen.getByLabelText("汇率变化假设"), {
    target: { value: "10" },
  });
  expect(screen.getByLabelText("压力试算结果").textContent).toContain(
    "-12.00%",
  );
  fireEvent.change(screen.getByLabelText("压力试算收益口径"), {
    target: { value: "cad" },
  });
  expect(screen.getByLabelText("压力试算结果").textContent).toContain(
    "-20.00%",
  );
  fireEvent.change(screen.getByLabelText("压力试算投入"), {
    target: { value: "" },
  });
  expect(screen.getByLabelText("压力试算结果").textContent).toContain(
    "有效数字",
  );
  fireEvent.change(screen.getByLabelText("压力试算投入"), {
    target: { value: "100" },
  });
  fireEvent.change(screen.getByLabelText("价格收益假设"), {
    target: { value: "-100" },
  });
  expect(screen.getByLabelText("压力试算结果").textContent).toContain(
    "本金归零",
  );
});
it("到期复盘按钮与图表使用同一标的，空自选没有可保存表单", () => {
  const p = props(),
    view = render(
      <MarketInvestmentDesk
        {...p}
        notes={{
          "NASDAQ:META": {
            ...EMPTY_RESEARCH_NOTE,
            reviewDate: "2020-01-01",
            updatedAt: "2020-01-01T00:00:00Z",
          },
        }}
      />,
    );
  fireEvent.click(screen.getByRole("button", { name: "META · 2020-01-01" }));
  expect(p.onSelect).toHaveBeenCalledWith("NASDAQ:META");
  fireEvent.click(screen.getByRole("button", { name: "查看 NVDA 图表 ↓" }));
  expect(p.onChart).toHaveBeenCalledWith(DEFAULT_WATCHLIST[0]);
  view.rerender(<MarketInvestmentDesk {...p} rows={[]} />);
  expect(screen.queryByRole("button", { name: "保存研究记录" })).toBeNull();
});
