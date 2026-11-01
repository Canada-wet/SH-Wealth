// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  LineChart: () => <div>Chart fixture</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
  ReferenceArea: () => null,
  Legend: () => null,
}));
vi.mock("../lib/backtest-cache", () => ({
  backtestCache: vi.fn<(...args: unknown[]) => Promise<unknown>>(
    async () => null,
  ),
}));
import { backtestCache } from "../lib/backtest-cache";
import { syntheticBacktest } from "../lib/backtest-import";
import { changeBacktestLab, EMPTY_BACKTEST_LAB } from "../lib/backtest-context";
import { stableJSON } from "../lib/cloud-plan";
import BacktestWorkspace from "../app/components/backtest/BacktestWorkspace";
import { emptyState } from "../lib/wealth";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("恢复旧私密对话不自动授权，也不把历史发送到未授权请求", async () => {
  const p = syntheticBacktest();
  vi.mocked(backtestCache).mockResolvedValueOnce({
    ...p,
    conversation: {
      config: p.config,
      capturedAt: p.data.capturedAt,
      householdIncluded: true,
      messages: [{ role: "assistant", text: "private-old-answer" }],
    },
  });
  const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
    Response.json({
      answer: "new-public-answer",
      route: { provider: "deepseek", model: "fixture" },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  mount();
  await screen.findByText("同样的外部投入，不同的部署方式");
  fireEvent.click(screen.getByRole("tab", { name: "AI 与家庭适配" }));
  expect(screen.getByText("private-old-answer")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("继续研究或追问"), {
    target: { value: "public research" },
  });
  fireEvent.click(screen.getByRole("button", { name: "提问" }));
  await screen.findByText("new-public-answer");
  const body = JSON.parse(String(fetcher.mock.calls[0][1].body));
  expect(body.includeHousehold).toBe(false);
  expect(body.history).toEqual([]);
  expect(body.state).toBeUndefined();
});
it("载入计划后另一窗口变更，旧草稿保存保留原基线而非覆盖最新版本", async () => {
  const s = emptyState(),
    p = syntheticBacktest();
  s.preferences.backtestLab = {
    version: 1,
    saved: [{ id: "saved-plan", at: "2026-10-31T00:00:00Z", config: p.config }],
  };
  const remote = structuredClone(s);
  remote.preferences.backtestLab!.saved[0].config.name = "remote version";
  const save = vi.fn((next, expected) => {
    changeBacktestLab(remote, expected, next);
  });
  const view = render(
    <BacktestWorkspace
      state={s}
      scope="synthetic-household"
      editable
      onSaveLab={save}
    />,
  );
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "保存计划" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText("已存家庭计划"), {
    target: { value: "saved-plan" },
  });
  fireEvent.change(screen.getByLabelText("计划名称"), {
    target: { value: "my stale edit" },
  });
  view.rerender(
    <BacktestWorkspace
      state={remote}
      scope="synthetic-household"
      editable
      onSaveLab={save}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "保存计划" }));
  expect(save.mock.calls[0][1]).toBe(
    stableJSON(s.preferences.backtestLab ?? EMPTY_BACKTEST_LAB),
  );
  expect(screen.getByRole("alert").textContent).toMatch(/另一窗口变化/);
  expect(remote.preferences.backtestLab!.saved[0].config.name).toBe(
    "remote version",
  );
});
const mount = () => {
  const save = vi.fn();
  render(
    <BacktestWorkspace
      state={emptyState()}
      scope="synthetic-household"
      editable
      onSaveLab={save}
    />,
  );
  return save;
};
async function demo() {
  mount();
  const b = screen.getByRole("button", { name: /试用合成演示/ });
  await waitFor(() => expect((b as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(b);
  await screen.findByText(/同样的外部投入/);
}
it("无行情时明确提醒，不默认编造价格或启动AI", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  mount();
  const run = screen.getByRole("button", { name: "运行策略比较" });
  await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(run);
  expect(screen.getByRole("alert").textContent).toMatch(/先导入日线数据/);
  expect(fetcher).not.toHaveBeenCalled();
});
it("演示展示三策略、常见指标和非真实数据警告", async () => {
  await demo();
  expect(screen.getAllByText(/合成演示/).length).toBeGreaterThan(1);
  const table = screen.getByRole("table", {
    name: "同样的外部投入，不同的部署方式",
  });
  expect(within(table).getByText("年化回报 CAGR · 时间加权")).toBeTruthy();
  expect(within(table).getByText("最大净值回撤")).toBeTruthy();
  expect(within(table).getAllByRole("columnheader")).toHaveLength(4);
});
it("历史事件可读、未覆盖不显示零风险", async () => {
  await demo();
  fireEvent.click(screen.getByRole("tab", { name: "历史冲击" }));
  const pane = screen.getByRole("tabpanel");
  expect(within(pane).getByText("全球金融危机")).toBeTruthy();
  expect(within(pane).getAllByText("未覆盖").length).toBeGreaterThan(0);
  expect(
    within(pane).getAllByText("不要将缺失误读为零风险").length,
  ).toBeGreaterThan(0);
});
it("改动设置后保留旧结果并禁止使用未重跑参数提问", async () => {
  await demo();
  fireEvent.change(screen.getByLabelText("计划名称"), {
    target: { value: "changed" },
  });
  expect(screen.getByText(/设置或数据已变化/)).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "AI 与家庭适配" }));
  fireEvent.change(screen.getByLabelText("继续研究或追问"), {
    target: { value: "test" },
  });
  expect(
    (
      screen.getByRole("button", {
        name: "提问",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
it("请求只在用户提问时发送，默认不含家庭快照，追问带有限历史", async () => {
  const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
    Response.json({
      answer: "研究回答",
      route: { provider: "deepseek", model: "fixture" },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  await demo();
  fireEvent.click(screen.getByRole("tab", { name: "AI 与家庭适配" }));
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("继续研究或追问"), {
    target: { value: "test question" },
  });
  fireEvent.click(screen.getByRole("button", { name: "提问" }));
  await screen.findByText("研究回答");
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(body.includeHousehold).toBe(false);
  expect(body.state).toBeUndefined();
  expect(body.preference).toBe("deepseek-chat");
  fireEvent.change(screen.getByLabelText("继续研究或追问"), {
    target: { value: "follow up" },
  });
  fireEvent.click(screen.getByRole("button", { name: "提问" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(
    JSON.parse(fetcher.mock.calls[1][1]!.body as string).history,
  ).toHaveLength(2);
});
