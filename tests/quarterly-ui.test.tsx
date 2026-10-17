// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import QuarterlyReview from "../app/components/QuarterlyReview";
import { emptyState, type WealthState } from "../lib/wealth";
import { latestCompletedQuarter, updateQuarter } from "../lib/quarterly-review";
afterEach(cleanup);
it("另一设备更新时保留正在输入的草稿，保存时不覆盖伴侣笔记", () => {
  const key = latestCompletedQuarter();
  let state = updateQuarter(emptyState(), key, (r) => ({
    ...r,
    notes: "旧笔记",
  }));
  const change = vi.fn((update: (s: WealthState) => WealthState) => {
    try {
      state = update(state);
      return true;
    } catch {
      return false;
    }
  });
  const { rerender } = render(
    <QuarterlyReview state={state} onChange={change} />,
  );
  const input = screen.getByLabelText("季度复盘笔记") as HTMLTextAreaElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "我的尚未保存草稿" } });
  state = updateQuarter(state, key, (r) => ({
    ...r,
    notes: "另一设备的新结论",
  }));
  rerender(<QuarterlyReview state={state} onChange={change} />);
  expect(input.value).toBe("我的尚未保存草稿");
  fireEvent.blur(input);
  expect(state.preferences.quarterlyReviews!.records[key].notes).toBe(
    "另一设备的新结论",
  );
  expect(input.value).toBe("我的尚未保存草稿");
  expect(
    screen
      .getAllByRole("alert")
      .some((e) => e.textContent?.includes("草稿仍保留")),
  ).toBe(true);
});
it("提醒偏好与复盘内容加载不制造金融快照，禁用期间不能输入", () => {
  const change = vi.fn();
  render(<QuarterlyReview state={emptyState()} onChange={change} disabled />);
  expect(
    (screen.getByLabelText("季度复盘笔记") as HTMLTextAreaElement).disabled,
  ).toBe(true);
  expect(change).not.toHaveBeenCalled();
});
