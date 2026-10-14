// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { JSDOM } from "jsdom";
import FloatingAdvisor from "../app/components/FloatingAdvisor";
import { emptyState, saveAsset } from "../lib/wealth";
const storage = new JSDOM("", { url: "http://localhost" }).window;
beforeEach(() => {
  storage.localStorage.clear();
  storage.sessionStorage.clear();
  vi.stubGlobal("localStorage", storage.localStorage);
  vi.stubGlobal("sessionStorage", storage.sessionStorage);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const state = () =>
  saveAsset(emptyState(), {
    id: "a",
    name: "储蓄",
    category: "现金",
    value: 500,
    owner: "joint",
    annualReturn: null,
  });
it("生成修改仅预览；伴侣财务变化后拒绝过期确认", async () => {
  const initial = state();
  const onActions = vi.fn(() => initial);
  const onChange = vi.fn(() => initial);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            answer: "准备更新",
            actions: [
              { type: "update_asset", existingName: "储蓄", value: 1000 },
            ],
          }),
        ),
    ),
  );
  const view = render(
    <FloatingAdvisor
      state={initial}
      onActions={onActions}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByLabelText("打开财富顾问"));
  fireEvent.change(screen.getByLabelText("顾问消息"), {
    target: { value: "把储蓄价值改为1000" },
  });
  fireEvent.click(screen.getByLabelText("发送消息"));
  await waitFor(() =>
    expect(screen.getByLabelText("数据修改预览")).toBeTruthy(),
  );
  expect(onActions).not.toHaveBeenCalled();
  const updated = {
    ...initial,
    assets: [{ ...initial.assets[0], value: 600 }],
  };
  view.rerender(
    <FloatingAdvisor
      state={updated}
      onActions={onActions}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByText("确认并保存修改"));
  expect(onActions).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("预览已过期");
});
it("确认批量变更传递快照，取消后不调用财务保存", async () => {
  const initial = state();
  const onActions = vi.fn(() => initial);
  const onChange = vi.fn(() => initial);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            answer: "待确认",
            actions: [
              { type: "update_asset", existingName: "储蓄", value: 1000 },
            ],
          }),
        ),
    ),
  );
  render(
    <FloatingAdvisor
      state={initial}
      onActions={onActions}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByLabelText("打开财富顾问"));
  fireEvent.change(screen.getByLabelText("顾问消息"), {
    target: { value: "把储蓄价值改为1000" },
  });
  fireEvent.click(screen.getByLabelText("发送消息"));
  await waitFor(() => expect(screen.getByText("确认并保存修改")).toBeTruthy());
  fireEvent.click(screen.getByText("确认并保存修改"));
  expect(onActions).toHaveBeenCalledTimes(1);
  expect(onActions.mock.calls[0]).toHaveLength(2);
});
it("停止请求保留草稿，不伪造回答或执行修改", async () => {
  const initial = state();
  const onActions = vi.fn(() => initial);
  const onChange = vi.fn(() => initial);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("stopped", "AbortError")),
          ),
        ),
    ),
  );
  render(
    <FloatingAdvisor
      state={initial}
      onActions={onActions}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByLabelText("打开财富顾问"));
  fireEvent.change(screen.getByLabelText("顾问消息"), {
    target: { value: "分析当前资产" },
  });
  fireEvent.click(screen.getByLabelText("发送消息"));
  fireEvent.click(screen.getByText("停止本次回复"));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("顾问消息") as HTMLTextAreaElement).value,
    ).toBe("分析当前资产"),
  );
  expect(onActions).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("已停止");
});
