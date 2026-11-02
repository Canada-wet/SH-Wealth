// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
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
  portfolioShelfCache: vi.fn<(...args: unknown[]) => Promise<unknown>>(
    async () => null,
  ),
}));
import { backtestCache, portfolioShelfCache } from "../lib/backtest-cache";
import { syntheticBacktest } from "../lib/backtest-import";
import { backtestToday } from "../lib/backtest-schema";
import { changeBacktestLab, EMPTY_BACKTEST_LAB } from "../lib/backtest-context";
import { stableJSON } from "../lib/cloud-plan";
import BacktestWorkspace from "../app/components/backtest/BacktestWorkspace";
import { emptyState } from "../lib/wealth";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
  goStep(/历史数据/);
  const b = screen.getByRole("button", { name: /试用合成演示/ });
  await waitFor(() => expect((b as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(b);
  await screen.findByText(/同样的外部投入/);
}
function goStep(name: RegExp) {
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "回测工作流" })).getByRole(
      "button",
      { name },
    ),
  );
}
it("无行情时明确提醒，不默认编造价格或启动AI", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  mount();
  goStep(/历史数据/);
  const run = screen.getByRole("button", { name: "运行策略比较" });
  await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(true));
  expect(screen.getByLabelText("当前组合数据就绪情况").textContent).toMatch(
    /尚未载入.*SPY/,
  );
  expect(fetcher).not.toHaveBeenCalled();
});
it("手机编辑清空权重不产生NaN，一键等权修正后可继续；新增空证券不准提交", async () => {
  mount();
  const next = screen.getByRole("button", { name: "下一步：历史数据" });
  await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText("权重1"), { target: { value: "" } });
  expect((screen.getByLabelText("权重1") as HTMLInputElement).value).toBe("");
  expect(screen.getByLabelText("组合填写检查").textContent).not.toContain(
    "NaN",
  );
  expect((next as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "一键等权" }));
  expect((screen.getByLabelText("权重1") as HTMLInputElement).value).toBe("50");
  expect((next as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "添加标的" }));
  expect((next as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByLabelText("组合填写检查").textContent).toContain(
    "第3项尚未选择证券",
  );
});
it("完整行情可显式采用并运行，运行前不采用或请求AI", async () => {
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    const q = JSON.parse(String(init.body)),
      r = yahooFixture(q);
    r.data.assets = q.symbols.map((symbol: string) => ({
      ...r.data.assets[0],
      symbol,
    }));
    r.results = r.results.map(({ error: _error, ...r }) => r);
    return Response.json(r);
  });
  vi.stubGlobal("fetch", fetcher);
  const save = mount();
  goStep(/历史数据/);
  const get = screen.getByRole("button", { name: "从Yahoo获取组合历史" });
  await waitFor(() => expect((get as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(get);
  const use = await screen.findByRole("button", { name: "采用并运行比较" });
  expect(
    screen.queryByRole("table", { name: "行情质量与覆盖日期" }),
  ).toBeNull();
  fireEvent.click(use);
  expect(
    await screen.findByRole("table", {
      name: "同样的外部投入，不同的部署方式",
    }),
  ).toBeTruthy();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
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
  goStep(/组合设置/);
  fireEvent.change(screen.getByLabelText("计划名称"), {
    target: { value: "changed" },
  });
  goStep(/比较结果/);
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
function yahooFixture(query: {
  symbols: string[];
  start: string;
  end: string;
}) {
  return {
    requested: query,
    effectiveEnd: "2026-10-30",
    results: query.symbols.map((symbol, i) => ({
      symbol,
      yahooSymbol: symbol.replace(".US", ""),
      fetchedAt: "2026-11-01T04:00:00Z",
      warnings: [],
      ...(i ? { error: "Yahoo未返回历史（404）" } : {}),
    })),
    data: {
      version: 1,
      synthetic: false,
      capturedAt: "2026-11-01T04:00:00Z",
      assets: [
        {
          symbol: query.symbols[0],
          currency: "USD",
          basis: "total-return",
          dividendsKnown: false,
          source: "Yahoo Finance · synthetic fixture",
          points: ["2020-01-02", "2020-01-03", "2020-01-06"].map((date, i) => ({
            date,
            close: 100 + i,
            dividend: 0,
            split: 1,
          })),
        },
      ],
    },
  };
}
it("Yahoo仅点击时发送代码日期，部分成功预览，不自动删除失败持仓或改变权重", async () => {
  const fetcher = vi.fn(async (_url: string, init: RequestInit) =>
    Response.json(yahooFixture(JSON.parse(String(init.body)))),
  );
  vi.stubGlobal("fetch", fetcher);
  const save = mount();
  goStep(/历史数据/);
  const button = screen.getByRole("button", { name: "从Yahoo获取组合历史" });
  await waitFor(() =>
    expect((button as HTMLButtonElement).disabled).toBe(false),
  );
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(button);
  await screen.findByText("已获取 1/2 项");
  expect(fetcher.mock.calls[0][0]).toBe("/api/backtest/history");
  expect(
    Object.keys(JSON.parse(String(fetcher.mock.calls[0][1].body))).sort(),
  ).toEqual(["end", "start", "symbols"]);
  expect(
    screen.queryByRole("table", { name: "行情质量与覆盖日期" }),
  ).toBeNull();
  expect(
    (screen.getByRole("button", { name: "使用这批行情" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (
      screen.getByRole("button", {
        name: "采用并运行比较",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "使用这批行情" }));
  expect(
    screen.queryByRole("table", { name: "行情质量与覆盖日期" }),
  ).toBeNull();
  expect((screen.getByLabelText("标的2") as HTMLInputElement).value).toBe(
    "AGG.US",
  );
  expect(save).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("button", { name: "运行策略比较" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByLabelText("当前组合数据就绪情况").textContent).toMatch(
    /AGG/,
  );
});
it("Yahoo抓取后修改日期使预览过期；不会把旧请求用于新组合", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) =>
      Response.json(yahooFixture(JSON.parse(String(init.body)))),
    ),
  );
  mount();
  goStep(/历史数据/);
  const button = screen.getByRole("button", { name: "从Yahoo获取组合历史" });
  await waitFor(() =>
    expect((button as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(button);
  await screen.findByText("已获取 1/2 项");
  goStep(/组合设置/);
  fireEvent.change(screen.getByLabelText("开始日期"), {
    target: { value: "2021-01-01" },
  });
  goStep(/历史数据/);
  expect(
    (screen.getByRole("button", { name: "使用这批行情" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    screen.getAllByRole("alert").some((a) => /过期/.test(a.textContent ?? "")),
  ).toBe(true);
});
it("Yahoo错误不覆盖既有行情，演示代码不会外发", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await demo();
  goStep(/历史数据/);
  fireEvent.click(screen.getByRole("button", { name: "从Yahoo获取组合历史" }));
  expect(screen.getByRole("alert").textContent).toMatch(/演示代码/);
  expect(fetcher).not.toHaveBeenCalled();
  goStep(/比较结果/);
  expect(
    screen.getByRole("table", { name: "同样的外部投入，不同的部署方式" }),
  ).toBeTruthy();
});
it("分步界面一次只显示当前任务，结果可加入对照并复制修改另一组合", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await demo();
  expect(screen.queryByRole("button", { name: "保存计划" })).toBeNull();
  const add = screen.getByRole("button", { name: "加入组合对照" });
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(add);
  expect(screen.getByLabelText("组合1名称")).toBeTruthy();
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  fireEvent.click(screen.getByRole("button", { name: "复制到工作台修改" }));
  fireEvent.change(screen.getByLabelText("计划名称"), {
    target: { value: "第二组合" },
  });
  fireEvent.change(screen.getByLabelText("权重1"), { target: { value: "30" } });
  fireEvent.change(screen.getByLabelText("权重2"), { target: { value: "70" } });
  goStep(/历史数据/);
  fireEvent.click(screen.getByRole("button", { name: "运行策略比较" }));
  fireEvent.click(screen.getByRole("button", { name: "加入组合对照" }));
  fireEvent.click(screen.getByRole("button", { name: "运行组合对照" }));
  const table = screen.getByRole("table", {
    name: "不同组合 · 同策略、同投入、同区间",
  });
  expect(within(table).getAllByRole("columnheader")).toHaveLength(3);
  expect(within(table).getByText("Sharpe")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "保存计划" })).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
it("对照设置变化标记旧结果过期，少于2个组合不能运行", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "组合对照" }));
  const demo = screen.getByRole("button", { name: "体验两个组合 · 合成演示" });
  await waitFor(() => expect((demo as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(demo);
  fireEvent.click(screen.getByRole("button", { name: "运行组合对照" }));
  fireEvent.change(screen.getByLabelText("统一策略"), {
    target: { value: "dca" },
  });
  expect(screen.getByText(/对照选择或设置已变化/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "运行组合对照" }));
  expect(screen.queryByText(/对照选择或设置已变化/)).toBeNull();
  const checks = screen.getAllByRole("checkbox", { name: /参与对照/ });
  fireEvent.click(checks[1]);
  expect(
    (screen.getByRole("button", { name: "运行组合对照" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it("当前工作台无效输入不阻断对照独立缓存，快照无家庭数据或聊天", async () => {
  const save = mount();
  fireEvent.click(screen.getByRole("button", { name: "组合对照" }));
  const demo = screen.getByRole("button", { name: "体验两个组合 · 合成演示" });
  await waitFor(() => expect((demo as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(demo);
  fireEvent.click(screen.getByRole("button", { name: "继续构建组合" }));
  fireEvent.change(screen.getByLabelText("计划名称"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "组合对照" }));
  fireEvent.change(screen.getByLabelText("组合1名称"), {
    target: { value: "已整理的对照快照" },
  });
  await waitFor(
    () =>
      expect(
        vi
          .mocked(portfolioShelfCache)
          .mock.calls.some(
            (c) =>
              (c[1] as { studies?: { title: string }[] } | undefined)
                ?.studies?.[0].title === "已整理的对照快照",
          ),
      ).toBe(true),
    { timeout: 2000 },
  );
  const payload = vi
    .mocked(portfolioShelfCache)
    .mock.calls.find((c) => c[1])![1];
  expect(payload).not.toHaveProperty("state");
  expect(payload).not.toHaveProperty("messages");
  expect(save).not.toHaveBeenCalled();
});
it("Collection搜索、复制后另存、载入与删除沿用家庭配置同步，不覆盖原组合", async () => {
  const seed = emptyState(),
    p = syntheticBacktest();
  seed.preferences.backtestLab = {
    version: 1,
    saved: [
      {
        id: "one",
        at: "2026-10-30T12:00:00Z",
        config: {
          ...p.config,
          name: "长期核心",
          holdings: [{ symbol: "NVDA.US", weight: 100 }],
        },
      },
      {
        id: "two",
        at: "2026-10-31T12:00:00Z",
        config: {
          ...p.config,
          name: "加币备用",
          currency: "CAD",
          holdings: [{ symbol: "XIC.TO", weight: 100 }],
        },
      },
    ],
  };
  let last = seed;
  const saves = vi.fn();
  const Harness = () => {
    const [state, setState] = useState(seed);
    return (
      <BacktestWorkspace
        state={state}
        scope="collection-fixture"
        editable
        onSaveLab={(next, expected) => {
          last = changeBacktestLab(state, expected, next);
          setState(last);
          saves(next, expected);
        }}
      />
    );
  };
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "组合Collection" }));
  fireEvent.change(screen.getByLabelText("搜索组合或股票代码"), {
    target: { value: "nvda" },
  });
  expect(screen.getByRole("heading", { name: "长期核心" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "加币备用" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "复制为新组合" }));
  expect(
    (screen.getByLabelText("计划名称") as HTMLInputElement).value,
  ).toContain("副本");
  const save = screen.getByRole("button", { name: "保存计划" });
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(save);
  expect(last.preferences.backtestLab!.saved).toHaveLength(3);
  expect(
    last.preferences.backtestLab!.saved.find((p) => p.id === "one")!.config
      .name,
  ).toBe("长期核心");
  fireEvent.click(screen.getByRole("button", { name: "组合Collection" }));
  fireEvent.change(screen.getByLabelText("搜索组合或股票代码"), {
    target: { value: "" },
  });
  fireEvent.change(screen.getByLabelText("组合计价币种"), {
    target: { value: "CAD" },
  });
  expect(screen.getByRole("heading", { name: "加币备用" })).toBeTruthy();
  confirm.mockReturnValueOnce(false);
  fireEvent.click(screen.getByRole("button", { name: "删除组合：加币备用" }));
  expect(last.preferences.backtestLab!.saved).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "删除组合：加币备用" }));
  expect(last.preferences.backtestLab!.saved).toHaveLength(2);
  expect(last.assets).toEqual(seed.assets);
  expect(saves).toHaveBeenCalledTimes(2);
});
it("官方汇率仅显式读取并在采用后改规划参数，不改资金或调用AI", async () => {
  const p = syntheticBacktest();
  vi.mocked(backtestCache).mockResolvedValueOnce(p);
  const fetcher = vi.fn(async (_url: string) =>
    Response.json({
      fetchedAt: new Date().toISOString(),
      fx: [
        {
          id: "FXUSDCAD",
          date: backtestToday(),
          value: 1 / 1.38,
          unit: " / CAD",
          source:
            "https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/",
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const save = mount();
  await waitFor(() =>
    expect((screen.getByLabelText("计划名称") as HTMLInputElement).value).toBe(
      p.config.name,
    ),
  );
  fireEvent.click(screen.getByText("我的投资偏好与规划"));
  const rate = screen.getByLabelText(
    "规划换算 · 1 USD = 多少 CAD",
  ) as HTMLInputElement;
  const oldRate = rate.value;
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "获取最新官方参考汇率" }));
  await screen.findByText(/1 USD = 1.38 CAD/);
  expect(rate.value).toBe(oldRate);
  fireEvent.click(screen.getByRole("button", { name: "用于家庭规划换算" }));
  expect(rate.value).toBe("1.38");
  expect(
    (screen.getByLabelText("起始资金 · USD") as HTMLInputElement).value,
  ).toBe(String(p.config.initial));
  expect(fetcher.mock.calls[0][0]).toBe("/api/market");
  expect(save).not.toHaveBeenCalled();
});
it("Yahoo完整单币种预览自动带入币种需确认，混币预览不能采用", async () => {
  const p = syntheticBacktest();
  let mixed = false;
  const fetcher = vi.fn(async (_u: string, options: RequestInit) => {
    const q = JSON.parse(String(options.body));
    return Response.json({
      requested: q,
      effectiveEnd: q.end,
      results: q.symbols.map((s: string) => ({
        symbol: s,
        yahooSymbol: s,
        warnings: [],
        fetchedAt: p.data.capturedAt,
      })),
      data: {
        ...p.data,
        synthetic: false,
        assets: p.data.assets.map((a, i) => ({
          ...a,
          symbol: q.symbols[i],
          currency: mixed && i === 1 ? "USD" : "CAD",
          basis: "total-return",
          dividendsKnown: false,
          points: a.points.map((p) => ({ ...p, dividend: 0, split: 1 })),
        })),
      },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.mocked(backtestCache).mockResolvedValueOnce({
    config: {
      ...p.config,
      currency: "USD",
      holdings: [
        { symbol: "XIC.TO", weight: 70 },
        { symbol: "ZAG.TO", weight: 30 },
      ],
    },
    data: null,
  });
  mount();
  await waitFor(() =>
    expect((screen.getByLabelText("标的1") as HTMLInputElement).value).toBe(
      "XIC.TO",
    ),
  );
  goStep(/历史数据/);
  const b = screen.getByRole("button", { name: "从Yahoo获取组合历史" });
  await waitFor(() => expect((b as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(b);
  await screen.findByText(/已获取 2/);
  fireEvent.click(screen.getByRole("button", { name: "使用这批行情" }));
  expect((screen.getByLabelText("计价币种") as HTMLSelectElement).value).toBe(
    "USD",
  );
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "使用这批行情" }));
  expect((screen.getByLabelText("计价币种") as HTMLSelectElement).value).toBe(
    "CAD",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  mixed = true;
  fireEvent.click(b);
  await screen.findByText(/实际成交币种混合/);
  expect(
    (screen.getByRole("button", { name: "使用这批行情" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect((screen.getByLabelText("计价币种") as HTMLSelectElement).value).toBe(
    "CAD",
  );
});
