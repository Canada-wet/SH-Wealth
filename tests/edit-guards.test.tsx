// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import Dialog from "../app/components/Dialog";
import CashflowTable from "../app/components/CashflowTable";
import { emptyState, type WealthState } from "../lib/wealth";
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("未保存表单拒绝放弃时继续保留，确认放弃才关闭", () => {
  const close = vi.fn(),
    confirm = vi.fn().mockReturnValue(false);
  vi.stubGlobal("confirm", confirm);
  render(
    <Dialog title="编辑" onClose={close} onSubmit={vi.fn()}>
      <input aria-label="数字" />
      <button type="button" onClick={close}>
        取消
      </button>
    </Dialog>,
  );
  fireEvent.change(screen.getByLabelText("数字"), { target: { value: "100" } });
  fireEvent.click(screen.getByLabelText("关闭弹窗"));
  expect(close).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByText("取消"));
  expect(close).toHaveBeenCalledOnce();
});
it("未改表单无需确认，查看型弹窗不增加确认步骤", () => {
  const close = vi.fn(),
    confirm = vi.fn();
  vi.stubGlobal("confirm", confirm);
  render(
    <Dialog title="查看" onClose={close}>
      <input aria-label="查找" />
    </Dialog>,
  );
  fireEvent.change(screen.getByLabelText("查找"), {
    target: { value: "查找" },
  });
  fireEvent.click(screen.getByLabelText("关闭弹窗"));
  expect(close).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();
});
it("现金流编辑期间伴侣更新数据，原表单不能覆盖", () => {
  const first: WealthState = {
    ...emptyState(),
    budget: [
      {
        id: "b",
        name: "房租",
        owner: "joint",
        amount: 1000,
        kind: "expense" as const,
        essential: true,
      },
    ],
  };
  let latest = first;
  const save = vi.fn((update: (s: WealthState) => WealthState) => {
    latest = update(latest);
    return true;
  });
  const view = render(<CashflowTable state={first} onChange={save} />);
  fireEvent.click(screen.getByLabelText("编辑现金流房租"));
  latest = { ...first, budget: [{ ...first.budget![0], amount: 2000 }] };
  view.rerender(<CashflowTable state={latest} onChange={save} />);
  fireEvent.change(screen.getByLabelText("每月金额（CAD）"), {
    target: { value: "1500" },
  });
  fireEvent.submit(screen.getByLabelText("每月金额（CAD）").closest("form")!);
  expect(latest.budget![0].amount).toBe(2000);
  expect(screen.getByRole("alert").textContent).toContain("已更新");
});
