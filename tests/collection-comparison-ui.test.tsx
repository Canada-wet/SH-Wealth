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
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  LineChart: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
  ReferenceArea: () => null,
  Legend: () => null,
}));
import PortfolioComparison from "../app/components/backtest/PortfolioComparison";
import PortfolioCollection from "../app/components/backtest/PortfolioCollection";
import {
  EMPTY_PORTFOLIO_SHELF,
  type PortfolioShelf,
} from "../lib/backtest-comparison";
import { defaultBacktest, type BacktestLab } from "../lib/backtest-schema";
const dates = ["2020-01-02", "2020-01-03", "2020-01-06"];
const library = (): BacktestLab => ({
  version: 1,
  saved: Array.from({ length: 6 }, (_, i) => ({
    id: `p${i}`,
    at: `2026-10-${20 + i}T00:00:00Z`,
    config: {
      ...defaultBacktest("2020-01-06"),
      start: "2020-01-01",
      name: `库组合${i + 1}`,
      holdings: [{ symbol: `T${i}.US`, weight: 100 }],
    },
  })),
});
const response = (init?: RequestInit) => {
  const q = JSON.parse(String(init?.body));
  return Response.json({
    requested: q,
    results: [],
    data: {
      version: 1,
      synthetic: false,
      capturedAt: "2026-11-01T00:00:00Z",
      assets: q.symbols.map((symbol: string) => ({
        symbol,
        currency: "USD",
        basis: "total-return",
        dividendsKnown: false,
        source: "SYNTHETIC HTTP fixture",
        points: dates.map((date, i) => ({
          date,
          close: 100 + i,
          dividend: 0,
          split: 1,
        })),
      })),
    },
  });
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function mount(initial?: PortfolioShelf) {
  const onPreparedChange = vi.fn(),
    onEdit = vi.fn(),
    onLibrary = vi.fn(),
    onBusy = vi.fn();
  let latest!: PortfolioShelf;
  function Fixture() {
    const [shelf, setShelf] = useState(
        initial ?? structuredClone(EMPTY_PORTFOLIO_SHELF),
      ),
      [lab, setLab] = useState(library);
    latest = shelf;
    return (
      <>
        <button
          onClick={() =>
            setLab((l) => ({
              ...l,
              saved: l.saved.map((p, i) =>
                i === 0
                  ? {
                      ...p,
                      at: "2026-11-01T13:00:00Z",
                      config: { ...p.config, name: "来自另一设备的更新" },
                    }
                  : p,
              ),
            }))
          }
        >
          模拟库更新
        </button>
        <PortfolioComparison
          lab={lab}
          shelf={shelf}
          ready
          status="已缓存"
          onChange={(s) => {
            setShelf(s);
            onPreparedChange(s);
          }}
          onEdit={onEdit}
          onBack={vi.fn()}
          onLibrary={onLibrary}
          onPrepareBusy={onBusy}
        />
      </>
    );
  }
  render(<Fixture />);
  return {
    getShelf: () => latest,
    onPreparedChange,
    onEdit,
    onLibrary,
    onBusy,
  };
}
const choose = (n: number) =>
  fireEvent.click(
    screen.getByRole("checkbox", { name: `选择组合：库组合${n}` }),
  );
it("对照入口列出组合库而非要求工作台先跑；选择不触网，准备后直接显示结果", async () => {
  const f = vi.fn(async (_u: RequestInfo | URL, i?: RequestInit) =>
    response(i),
  );
  vi.stubGlobal("fetch", f);
  const h = mount();
  expect(screen.getAllByRole("checkbox", { name: /选择组合/ })).toHaveLength(6);
  choose(1);
  choose(2);
  expect(f).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "准备行情并对比" }));
  expect(
    await screen.findByRole("table", {
      name: "不同组合 · 同策略、同投入、同区间",
    }),
  ).toBeTruthy();
  expect(f).toHaveBeenCalledOnce();
  expect(h.getShelf().studies.map((s) => s.origin?.planId)).toEqual([
    "p0",
    "p1",
  ]);
  expect(h.onEdit).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "更换所选组合" })).toBeTruthy();
});
it("按名称或代码搜索，4个上限、基准与策略可选，隐藏筛选项不会取消选择", () => {
  mount();
  [1, 2, 3, 4].forEach(choose);
  expect(
    (
      screen.getByRole("checkbox", {
        name: "选择组合：库组合5",
      }) as HTMLInputElement
    ).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByRole("searchbox", { name: "搜索可对照组合" }), {
    target: { value: "T0.US" },
  });
  expect(screen.getAllByRole("checkbox", { name: /选择组合/ })).toHaveLength(1);
  expect(screen.getByText("已选 4/4 个")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("组合库对照基准"), {
    target: { value: "p1" },
  });
  fireEvent.change(screen.getByLabelText("组合库对照策略"), {
    target: { value: "dca" },
  });
  expect(
    (screen.getByLabelText("组合库对照基准") as HTMLSelectElement).value,
  ).toBe("p1");
});
it("取消准备保留选择与旧快照，不自动重发，未完成不能跳转工作台覆盖草稿", async () => {
  const f = vi.fn(
    (_u: RequestInfo | URL, i?: RequestInit) =>
      new Promise<Response>((_r, reject) =>
        i!.signal!.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        ),
      ),
  );
  vi.stubGlobal("fetch", f);
  const h = mount();
  choose(1);
  choose(2);
  fireEvent.click(screen.getByRole("button", { name: "准备行情并对比" }));
  await waitFor(() => expect(f).toHaveBeenCalledOnce());
  expect(
    (screen.getByRole("button", { name: "继续构建组合" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "停止准备" }));
  await screen.findByText(/已停止准备或等待超时/);
  expect(h.getShelf().studies).toHaveLength(0);
  expect(h.getShelf().collection?.ids).toEqual(["p0", "p1"]);
  expect(f).toHaveBeenCalledOnce();
  expect(h.onBusy).toHaveBeenLastCalledWith(false);
});
it("准备期间库配置被另一设备更新，不以旧版本覆盖当前研究", async () => {
  let resolve!: (r: Response) => void;
  let init: RequestInit | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((_u: RequestInfo | URL, i?: RequestInit) => {
      init = i;
      return new Promise<Response>((r) => {
        resolve = r;
      });
    }),
  );
  const h = mount();
  choose(1);
  choose(2);
  fireEvent.click(screen.getByRole("button", { name: "准备行情并对比" }));
  await screen.findByText(/正在获取第/);
  fireEvent.click(screen.getByRole("button", { name: "模拟库更新" }));
  resolve(response(init));
  await screen.findByText(/准备期间组合库或对照已变化/);
  expect(h.getShelf().studies).toHaveLength(0);
  expect(
    screen.queryByRole("table", { name: "不同组合 · 同策略、同投入、同区间" }),
  ).toBeNull();
});
it("删除的库条目明确提示，只有用户清理后才更新已选列表", () => {
  const s = {
    ...structuredClone(EMPTY_PORTFOLIO_SHELF),
    collection: { ids: ["p0", "deleted"], baseline: "deleted" },
  };
  const h = mount(s);
  expect(screen.getByText(/已从库中删除/)).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: "准备行情并对比",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "清理失效选择" }));
  expect(h.getShelf().collection).toEqual({ ids: ["p0"], baseline: "p0" });
});
it("组合库卡片可勾选并直接进入对照，不触发载入或保存配置", () => {
  const load = vi.fn(),
    save = vi.fn(),
    compare = vi.fn();
  function Fixture() {
    const [ids, setIds] = useState<string[]>([]);
    return (
      <PortfolioCollection
        lab={library()}
        selected=""
        editable
        onLoad={load}
        onSave={save}
        onRemove={vi.fn()}
        onBack={vi.fn()}
        comparisonIDs={ids}
        onToggleCompare={(id) =>
          setIds((p) =>
            p.includes(id) ? p.filter((x) => x !== id) : [...p, id],
          )
        }
        onCompare={compare}
      />
    );
  }
  render(<Fixture />);
  fireEvent.click(screen.getByRole("checkbox", { name: "加入对照：库组合1" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "加入对照：库组合2" }));
  fireEvent.click(screen.getByRole("button", { name: "对照已选组合（2）" }));
  expect(compare).toHaveBeenCalledOnce();
  expect(load).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
