// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { emptyState } from "../lib/wealth";
import { EMPTY_LIFESTYLE } from "../lib/lifestyle-schema";
import { homeSnapshot } from "../lib/home-space";
const mocks = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  nav: {} as Record<string, unknown>,
}));
vi.mock("../lib/useWealth", () => ({ default: () => mocks.store }));
vi.mock("../app/components/NavigationProvider", () => ({
  useNavigation: () => mocks.nav,
}));
vi.mock("../app/components/MarketNavigator", () => ({
  default: () => <nav>Navigation fixture</nav>,
}));
import FamilySpace from "../app/space/page";
const richState = () => {
  const state = emptyState();
  state.members = {
    first: "SYNTHETIC_PRIVATE_FIRST",
    second: "SYNTHETIC_PRIVATE_SECOND",
  };
  state.assets = [
    {
      id: "synthetic-investment",
      name: "SYNTHETIC_PRIVATE_ASSET",
      owner: "first",
      category: "投资",
      value: 1456789,
      annualReturn: null,
    },
    {
      id: "synthetic-cash",
      name: "SYNTHETIC_PRIVATE_CASH",
      owner: "second",
      category: "现金",
      value: 23456,
      annualReturn: null,
    },
  ];
  state.debts = [
    {
      id: "synthetic-debt",
      name: "SYNTHETIC_PRIVATE_DEBT",
      owner: "joint",
      value: 245678,
    },
  ];
  state.budget = [
    {
      id: "synthetic-income",
      name: "SYNTHETIC_PRIVATE_INCOME",
      kind: "income",
      owner: "first",
      amount: 12345,
      essential: false,
    },
    {
      id: "synthetic-expense",
      name: "SYNTHETIC_PRIVATE_EXPENSE",
      kind: "expense",
      owner: "joint",
      amount: 23456,
      essential: true,
    },
  ];
  state.preferences.lifestyle = {
    ...structuredClone(EMPTY_LIFESTYLE),
    practices: [
      {
        id: "synthetic-practice",
        date: "2026-10-17",
        member: "joint",
        minutes: 98,
        enjoyment: 4,
        setId: null,
        setName: "SYNTHETIC_PRIVATE_PRACTICE",
        trackCount: 0,
        focus: "Synthetic transition practice",
        note: "",
      },
    ],
  };
  return state;
};
const expectPrivateHidden = (container: HTMLElement) => {
  for (const value of [
    "SYNTHETIC_PRIVATE",
    "1,234,567",
    "11,111",
    "98 分钟",
    "累计 1 次已记录练习",
  ])
    expect(container.textContent).not.toContain(value);
  expect(container.querySelectorAll(".space-action")).toHaveLength(0);
  expect(
    screen.queryByRole("link", { name: /已记录的月支出超过收入/ }),
  ).toBeNull();
  expect(screen.queryByRole("link", { name: /一起做一次复盘/ })).toBeNull();
};
beforeEach(() => {
  sessionStorage.clear();
  mocks.store = {
    state: emptyState(),
    ready: true,
    cloudLoading: false,
    cloudStatus: "已同步 Supabase",
    error: "",
    cloudChoice: null,
  };
  mocks.nav = { ready: true, entries: [], error: "" };
});
afterEach(cleanup);
it("空账本不呈现虚假的零财富，数据来源与空间入口可见", () => {
  render(<FamilySpace />);
  expect(screen.getByText("尚未盘点")).toBeTruthy();
  expect(screen.getByText("待补齐收支")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: /家庭敞口/ }).getAttribute("href"),
  ).toBe("/markets#market-wealth");
  expect(
    screen.getByRole("link", { name: /Set 编排/ }).getAttribute("href"),
  ).toBe("/lifestyle#sets");
  expect(screen.getByText(/还没有浏览记录/)).toBeTruthy();
});
it("隐藏偏好从首屏到恢复都不泄露姓名、金额与行动明细，切换沿用全站键", () => {
  sessionStorage.setItem("together-privacy", "on");
  mocks.store.state = richState();
  const { container } = render(<FamilySpace />);
  expectPrivateHidden(container);
  fireEvent.click(screen.getByRole("button", { name: "显示家庭数据" }));
  expect(container.textContent).toContain("SYNTHETIC_PRIVATE_FIRST");
  expect(container.textContent).toContain("SYNTHETIC_PRIVATE_SECOND");
  expect(container.textContent).toContain("1,234,567");
  expect(container.textContent).toContain("11,111");
  expect(container.textContent).toContain("98 分钟");
  expect(sessionStorage.getItem("together-privacy")).toBe("off");
});
it("本机和云端加载、版本冲突都不透露缓存姓名和金额，解决后可恢复真实摘要与行动", () => {
  mocks.store.state = richState();
  mocks.store.ready = false;
  const { container, rerender } = render(<FamilySpace />);
  const metrics = screen.getByRole("region", { name: "家庭状态摘要" });
  expect(within(metrics).getAllByText("读取中")).toHaveLength(3);
  expectPrivateHidden(container);
  mocks.store.ready = true;
  mocks.store.cloudLoading = true;
  rerender(<FamilySpace />);
  expect(screen.getByText(/等记录读取完成/)).toBeTruthy();
  expect(within(metrics).getAllByText("读取中")).toHaveLength(3);
  expectPrivateHidden(container);
  mocks.store.cloudLoading = false;
  mocks.store.cloudChoice = { householdId: "synthetic" };
  rerender(<FamilySpace />);
  expect(screen.getByText("先把数据版本确认好。")).toBeTruthy();
  expect(within(metrics).getAllByText("待确认版本")).toHaveLength(3);
  expectPrivateHidden(container);
  expect(
    screen.getByRole("link", { name: /检查数据版本/ }).getAttribute("href"),
  ).toBe("/#settings");
  mocks.store.cloudChoice = null;
  rerender(<FamilySpace />);
  expect(container.textContent).toContain("SYNTHETIC_PRIVATE_FIRST");
  expect(container.textContent).toContain("SYNTHETIC_PRIVATE_SECOND");
  expect(container.textContent).toContain("1,234,567");
  expect(container.textContent).toContain("98 分钟");
  expect(
    screen.getByRole("link", { name: /已记录的月支出超过收入/ }),
  ).toBeTruthy();
});
it("离线错误不把本机余额和私人行动当作已同步数据，重新连接成功后才恢复", () => {
  mocks.store.state = richState();
  mocks.store.error = "合成网络暂不可用";
  mocks.store.cloudStatus = "云端读取失败 · 本机已保存";
  const { container, rerender } = render(<FamilySpace />);
  const metrics = screen.getByRole("region", { name: "家庭状态摘要" });
  expect(screen.getByRole("alert").textContent).toContain("合成网络暂不可用");
  expect(within(metrics).getAllByText("待重新连接")).toHaveLength(3);
  expectPrivateHidden(container);
  expect(screen.queryByText("已同步 Supabase")).toBeNull();
  mocks.store.error = "";
  mocks.store.cloudStatus = "已同步 Supabase";
  rerender(<FamilySpace />);
  expect(screen.getByText("已同步 Supabase")).toBeTruthy();
  expect(container.textContent).toContain("SYNTHETIC_PRIVATE_FIRST");
  expect(container.textContent).toContain("1,234,567");
  expect(container.textContent).toContain("11,111");
});
it.each(["conflict", "offline"])(
  "隐藏偏好优先于%s状态，不通过提示或行动泄露私人数据；解除隐藏仍先要求确认数据",
  (kind) => {
    sessionStorage.setItem("together-privacy", "on");
    mocks.store.state = richState();
    if (kind === "conflict")
      mocks.store.cloudChoice = { householdId: "synthetic" };
    else {
      mocks.store.error = "合成网络暂不可用";
      mocks.store.cloudStatus = "云端待连接 · 本机已保存";
    }
    const { container } = render(<FamilySpace />);
    const metrics = screen.getByRole("region", { name: "家庭状态摘要" });
    expect(within(metrics).getAllByText("••••••")).toHaveLength(3);
    expect(screen.getByText("家庭数据已隐藏")).toBeTruthy();
    expect(screen.queryByText("先把数据版本确认好。")).toBeNull();
    expectPrivateHidden(container);
    fireEvent.click(screen.getByRole("button", { name: "显示家庭数据" }));
    expect(screen.getByText("先把数据版本确认好。")).toBeTruthy();
    expect(
      within(metrics).getAllByText(
        kind === "conflict" ? "待确认版本" : "待重新连接",
      ),
    ).toHaveLength(3);
    expectPrivateHidden(container);
  },
);
it("没有财富历史时，不用聊天或偏好的更新时间冒充财富更新时间", () => {
  const state = richState();
  state.updatedAt = "2099-07-13T23:45:00.000Z";
  state.messages = [
    {
      id: "synthetic-chat",
      role: "user",
      text: "SYNTHETIC_PRIVATE_CHAT",
      createdAt: state.updatedAt,
    },
  ];
  expect(state.history).toHaveLength(0);
  expect(
    homeSnapshot(state, new Date("2026-10-18T15:00:00Z")).financialAt,
  ).toBeNull();
  mocks.store.state = state;
  const { container } = render(<FamilySpace />);
  expect(container.textContent).toContain("1,234,567");
  expect(container.textContent).not.toContain("2099");
  expect(container.textContent).not.toContain("23:45");
  expect(container.textContent).not.toContain("SYNTHETIC_PRIVATE_CHAT");
  expect(
    screen.queryByText(/财务更新时间|财富更新时间|最新财务快照/),
  ).toBeNull();
});
it("继续使用读取个人真实访问时间，首页不调用生成接口或写账本", () => {
  mocks.nav.entries = [
    {
      feature_id: "space",
      pinned: false,
      last_used_at: "2026-10-18T12:00:00Z",
      pinned_at: null,
    },
    {
      feature_id: "fx-research",
      pinned: true,
      last_used_at: "2026-10-18T11:00:00Z",
      pinned_at: "2026-10-18T12:00:00Z",
    },
  ];
  const commit = vi.fn();
  mocks.store.commit = commit;
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const event = vi.fn();
  window.addEventListener("together-navigation-search", event);
  try {
    render(<FamilySpace />);
    expect(
      screen.getByRole("link", { name: /加币汇率/ }).getAttribute("href"),
    ).toBe("/markets#fx-research");
    fireEvent.click(screen.getByRole("button", { name: "搜索全部功能" }));
    expect(event).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("together-navigation-search", event);
    vi.unstubAllGlobals();
  }
});
