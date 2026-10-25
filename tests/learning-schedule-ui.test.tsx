// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import LearningScheduleControl from "../app/components/LearningScheduleControl";
import { emptyState, type WealthState } from "../lib/wealth";
afterEach(cleanup);
it("默认暂停，点击明确开启并可再次暂停，重载保留设置，不动收藏和资产", () => {
  let s = emptyState();
  const onChange = vi.fn((fn: (s: WealthState) => WealthState) => {
    s = fn(s);
  });
  const props = () => ({
    state: s,
    ready: true,
    syncStatus: "已同步 Supabase",
    onChange,
  });
  const page = render(<LearningScheduleControl {...props()} />);
  expect(screen.getByText("每日卡片自动更新已暂停")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重新开启每日更新" }));
  expect(s.preferences.learningSchedule?.enabled).toBe(true);
  page.rerender(<LearningScheduleControl {...props()} />);
  fireEvent.click(screen.getByRole("button", { name: "暂停每日更新" }));
  page.unmount();
  render(<LearningScheduleControl {...props()} />);
  expect(screen.getByText("每日卡片自动更新已暂停")).toBeTruthy();
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(s.assets).toEqual([]);
});
it("同步未确认、冲突或保存失败不冒充已启动", () => {
  const onChange = vi.fn(() => {
    throw Error("保存失败");
  });
  const props = {
    state: emptyState(),
    ready: true,
    syncStatus: "正在同步云端…",
    onChange,
  };
  const p = render(<LearningScheduleControl {...props} />);
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  p.rerender(
    <LearningScheduleControl {...props} syncStatus="已同步 Supabase" />,
  );
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("alert").textContent).toContain("保存失败");
  expect(screen.getByText("每日卡片自动更新已暂停")).toBeTruthy();
});
