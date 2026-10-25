// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import FinancialFreedom from "../app/components/FinancialFreedom";
import { emptyState, type WealthState } from "../lib/wealth";
import { FREEDOM_KEY, parseFreedomPlan } from "../lib/freedom";
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: unknown }) => children,
  LineChart: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
}));
afterEach(cleanup);
const state = () => {
  const s = emptyState();
  s.budget = [
    {
      id: "e",
      name: "开销",
      kind: "expense",
      amount: 2000,
      owner: "joint",
      essential: true,
    },
  ];
  return s;
};
it("先编辑草稿，明确保存才写计划；刷新重新渲染读回，讨论只发送当前情景", () => {
  let current = state();
  const discuss = vi.fn();
  const change = vi.fn((fn: (s: WealthState) => WealthState) => {
    current = fn(current);
    return true;
  });
  const props = () => ({
    state: current,
    ready: true,
    syncStatus: "已同步 Supabase",
    onChange: change,
    onDiscuss: discuss,
  });
  const page = render(<FinancialFreedom {...props()} />);
  fireEvent.change(screen.getByLabelText("初始年提取率 %"), {
    target: { value: "3" },
  });
  expect(current.plan.values[FREEDOM_KEY]).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "保存财务自由计划" }));
  expect(
    parseFreedomPlan(current.plan.values[FREEDOM_KEY])?.withdrawalRate,
  ).toBe(3);
  page.unmount();
  render(<FinancialFreedom {...props()} />);
  expect(
    (screen.getByLabelText("初始年提取率 %") as HTMLInputElement).value,
  ).toBe("3");
  fireEvent.click(screen.getByRole("button", { name: "与顾问检视此情景" }));
  expect(discuss.mock.calls[0][0]).toContain("只做分析，不修改账本");
  expect(discuss.mock.calls[0][0]).toContain("已保存");
  expect(change).toHaveBeenCalledTimes(1);
});
it("无效金额不保存；专项可增删，草稿期间伴侣更新会阻止覆盖", () => {
  const s = state(),
    change = vi.fn(() => true),
    props = {
      state: s,
      ready: true,
      syncStatus: "已同步",
      onChange: change,
      onDiscuss: vi.fn(),
    };
  const page = render(<FinancialFreedom {...props} />);
  fireEvent.change(screen.getByLabelText("初始年提取率 %"), {
    target: { value: "0" },
  });
  expect(
    (
      screen.getByRole("button", {
        name: "保存财务自由计划",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("初始年提取率 %"), {
    target: { value: "2.5" },
  });
  fireEvent.click(screen.getByRole("button", { name: "＋ 添加专项预算" }));
  fireEvent.change(screen.getByLabelText("专项1名称"), {
    target: { value: "额外教育" },
  });
  fireEvent.change(screen.getByLabelText("专项1金额"), {
    target: { value: "10000" },
  });
  expect(screen.getByLabelText("财务自由测算结果").textContent).toContain(
    "$10,000.00",
  );
  fireEvent.click(screen.getByRole("button", { name: "移除专项1" }));
  expect(screen.queryByLabelText("专项1金额")).toBeNull();
  const newer = structuredClone(s);
  newer.budget![0].amount = 3000;
  page.rerender(<FinancialFreedom {...props} state={newer} />);
  expect(screen.getByRole("alert").textContent).toContain("草稿仍在");
  expect(
    (
      screen.getByRole("button", {
        name: "保存财务自由计划",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "重新载入共享计划" }));
  expect(
    (
      screen.getByRole("button", {
        name: "保存财务自由计划",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});
