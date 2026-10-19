// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
const mock = vi.hoisted(() => ({ pathname: "/markets" }));
vi.mock("next/navigation", () => ({ usePathname: () => mock.pathname }));
import NavigationProvider from "../app/components/NavigationProvider";
import AppNavigation, {
  ModuleBridge,
  WorkspaceHub,
} from "../app/components/AppNavigation";
import type { NavEntry } from "../lib/navigation";
beforeEach(() => {
  mock.pathname = "/markets";
  window.history.replaceState(null, "", "/markets");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("导航连接失败仍能搜索，准确显示未同步且不伪装可持久化置顶", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ error: "offline" }, { status: 503 })),
  );
  render(
    <NavigationProvider>
      <AppNavigation />
    </NavigationProvider>,
  );
  await waitFor(() =>
    expect(screen.getByText("导航未同步 · 重新连接")).toBeTruthy(),
  );
  fireEvent.click(screen.getByText("搜索页面与功能"));
  fireEvent.change(screen.getByRole("searchbox", { name: "搜索页面与功能" }), {
    target: { value: "CPI" },
  });
  expect(
    screen.getByRole("link", { name: /宏观研究/ }).getAttribute("href"),
  ).toBe("/markets#macro-research");
  expect(
    (screen.getByRole("button", { name: "置顶宏观研究" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it("置顶等待本人云端确认，失败保留旧状态；重连可恢复另一设备已保存的置顶", async () => {
  let rows: NavEntry[] = [],
    failPin = true;
  const fetcher = vi.fn(async (_url: string, options: RequestInit = {}) => {
    if (options.method === "POST") {
      const body = JSON.parse(String(options.body));
      if (body.action === "pin" && failPin)
        return Response.json({ error: "尚未保存" }, { status: 503 });
      if (body.action === "visit")
        rows = [
          {
            feature_id: "markets",
            pinned: false,
            last_used_at: "2026-10-18T00:00:00Z",
            pinned_at: null,
          },
          ...rows.filter((r) => r.feature_id !== "markets"),
        ];
    }
    return Response.json({ userId: "own-id", entries: rows });
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <NavigationProvider>
      <AppNavigation />
    </NavigationProvider>,
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "置顶市场看板",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "置顶市场看板" }));
  await waitFor(() =>
    expect(screen.getByText("导航未同步 · 重新连接")).toBeTruthy(),
  );
  expect(screen.queryByRole("button", { name: "取消置顶市场看板" })).toBeNull();
  rows = [
    {
      feature_id: "fx-research",
      pinned: true,
      pinned_at: "2026-10-18T01:00:00Z",
      last_used_at: null,
    },
  ];
  failPin = false;
  fireEvent.click(screen.getByText("导航未同步 · 重新连接"));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "取消置顶加币汇率" }),
    ).toBeTruthy(),
  );
  expect(
    fetcher.mock.calls.every((c) => !String(c[1]?.body).includes("household")),
  ).toBe(true);
});
it("登录与重置页不读取个人导航、不记使用；键盘快捷键打开功能搜索", async () => {
  mock.pathname = "/login";
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(
    <NavigationProvider>
      <AppNavigation />
    </NavigationProvider>,
  );
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  expect(screen.getByRole("dialog", { name: "想去哪里？" })).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});

const syntheticNavigation = (entries: NavEntry[] = []) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ userId: "own-id", entries })),
  );
};
it("侧栏用六个空间建立层级，品牌回到家庭首页，非财富空间不堆叠账本入口", async () => {
  syntheticNavigation();
  const { container } = render(
    <NavigationProvider>
      <AppNavigation active="markets" />
    </NavigationProvider>,
  );
  const sidebar = screen.getByRole("complementary", { name: "家庭空间导航" });
  const spaces = sidebar.querySelector(".app-space-navigation")!;
  expect(within(spaces as HTMLElement).getAllByRole("link")).toHaveLength(6);
  expect(spaces.querySelector("a")?.getAttribute("href")).toBe("/space");
  expect(
    within(sidebar).getByRole("heading", { name: /我的空间/ }),
  ).toBeTruthy();
  expect(container.querySelector(".app-wealth-navigation")).toBeNull();
  expect(sidebar.querySelector("a.brand")?.getAttribute("href")).toBe("/space");
  expect(
    container.querySelector("a.app-mobile-brand")?.getAttribute("href"),
  ).toBe("/space");
  await waitFor(() => expect(document.title).toBe("市场看板 · Together"));
});
it("精确子功能置顶有当前态，父空间保留上下文但不冒充当前页面", async () => {
  window.history.replaceState(null, "", "/markets#fx-research");
  syntheticNavigation([
    {
      feature_id: "fx-research",
      pinned: true,
      pinned_at: "2026-10-18T00:00:00Z",
      last_used_at: null,
    },
  ]);
  const { container } = render(
    <NavigationProvider>
      <AppNavigation active="markets" />
    </NavigationProvider>,
  );
  const sidebar = screen.getByRole("complementary", { name: "家庭空间导航" });
  await waitFor(() =>
    expect(
      within(sidebar)
        .getByRole("link", { name: "加币汇率" })
        .getAttribute("aria-current"),
    ).toBe("page"),
  );
  expect(sidebar.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
  expect(
    within(sidebar)
      .getByRole("link", { name: "市场看板" })
      .getAttribute("aria-current"),
  ).toBe("location");
  expect(
    container
      .querySelector('.app-mobile-shortcuts a[href="/markets#fx-research"]')
      ?.getAttribute("aria-current"),
  ).toBe("page");
  expect(document.title).toBe("加币汇率 · Together");
});
it("财富空间提供稳定二级入口，置顶后不重复当前态或图钉", async () => {
  mock.pathname = "/";
  window.history.replaceState(null, "", "/#assets");
  syntheticNavigation([
    {
      feature_id: "assets",
      pinned: true,
      pinned_at: "2026-10-18T00:00:00Z",
      last_used_at: null,
    },
    {
      feature_id: "overview",
      pinned: true,
      pinned_at: "2026-10-18T00:01:00Z",
      last_used_at: null,
    },
  ]);
  render(
    <NavigationProvider>
      <AppNavigation active="assets" />
    </NavigationProvider>,
  );
  const sidebar = screen.getByRole("complementary", { name: "家庭空间导航" });
  await waitFor(() =>
    expect(
      within(sidebar).getByRole("button", { name: "取消置顶资产与负债" }),
    ).toBeTruthy(),
  );
  const workbench = sidebar.querySelector(".app-wealth-navigation")!;
  expect(
    within(workbench as HTMLElement)
      .getAllByRole("link")
      .map((l) => l.getAttribute("href")),
  ).toEqual([
    "/#assets",
    "/#cashflow",
    "/#growth",
    "/#contributions",
    "/#quarterly-review",
    "/#framework",
  ]);
  expect(sidebar.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
  expect(
    within(sidebar).getAllByRole("button", { name: "取消置顶资产与负债" }),
  ).toHaveLength(1);
  expect(
    within(sidebar).getAllByRole("button", { name: "取消置顶财富总览" }),
  ).toHaveLength(1);
});
it("手机快捷入口与工作台可以重复唤起已收起的同一个顾问入口", async () => {
  mock.pathname = "/";
  window.history.replaceState(null, "", "/#advisor");
  syntheticNavigation([
    {
      feature_id: "advisor",
      pinned: true,
      pinned_at: "2026-10-18T00:00:00Z",
      last_used_at: null,
    },
  ]);
  const opened = vi.fn();
  window.addEventListener("together-open-advisor", opened);
  const { container } = render(
    <NavigationProvider>
      <AppNavigation />
      <WorkspaceHub />
    </NavigationProvider>,
  );
  await waitFor(() =>
    expect(
      container.querySelector('.app-mobile-shortcuts a[href="/#advisor"]'),
    ).toBeTruthy(),
  );
  for (const selector of [
    '.app-mobile-shortcuts a[href="/#advisor"]',
    '.app-workspace-hub a[href="/#advisor"]',
  ]) {
    const link = container.querySelector(selector)!;
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
  }
  expect(opened).toHaveBeenCalledTimes(2);
  window.removeEventListener("together-open-advisor", opened);
});
it("输入法确认文字不打开搜索结果，确认结束后回车才导航，并将焦点还给搜索按钮", async () => {
  syntheticNavigation();
  render(
    <NavigationProvider>
      <AppNavigation />
    </NavigationProvider>,
  );
  const trigger = screen.getByRole("button", {
    name: "搜索页面与功能",
  });
  trigger.focus();
  fireEvent.click(trigger);
  const input = screen.getByRole("searchbox", { name: "搜索页面与功能" });
  fireEvent.change(input, { target: { value: "CPI" } });
  const link = screen.getByRole("link", { name: /宏观研究/ });
  const clicked = vi.fn((event: Event) => event.preventDefault());
  link.addEventListener("click", clicked);
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
  expect(clicked).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "想去哪里？" })).toBeTruthy();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(clicked).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog", { name: "想去哪里？" })).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
it("上下键选择有活动结果播报，搜索仍保留原生可点击链接和独立图钉", () => {
  syntheticNavigation();
  render(
    <NavigationProvider>
      <AppNavigation />
    </NavigationProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "搜索页面与功能" }));
  const input = screen.getByRole("searchbox", { name: "搜索页面与功能" });
  fireEvent.change(input, { target: { value: "DJ" } });
  const list = screen.getByRole("list", { name: "功能搜索结果" });
  const results = within(list).getAllByRole("listitem");
  expect(results.length).toBeGreaterThan(1);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(screen.getByRole("status").textContent).toContain(
    results[1].querySelector("strong")!.textContent,
  );
  expect(screen.getByRole("status").textContent).toContain("第 2 项");
  expect(input.getAttribute("aria-describedby")).toBe("app-search-selection");
  expect(within(results[1]).getByRole("link").getAttribute("href")).toMatch(
    /^\/lifestyle/,
  );
  expect(
    within(results[1]).getByRole("button", { name: /^置顶/ }),
  ).toBeTruthy();
});
it("取消搜索恢复发起按钮的焦点，不用快捷键遮住已有未保存弹窗", () => {
  syntheticNavigation();
  render(
    <NavigationProvider>
      <AppNavigation />
    </NavigationProvider>,
  );
  const trigger = screen.getByRole("button", {
    name: "搜索页面与功能",
  });
  trigger.focus();
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  const dialog = screen.getByRole("dialog", { name: "想去哪里？" });
  fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  expect(screen.queryByRole("dialog", { name: "想去哪里？" })).toBeNull();
  expect(document.activeElement).toBe(trigger);
  const existing = document.createElement("dialog");
  existing.setAttribute("open", "");
  document.body.append(existing);
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  expect(screen.queryByRole("dialog", { name: "想去哪里？" })).toBeNull();
  existing.remove();
});
it("关联功能默认折叠，展开后保留真实深链接，不抢占主页面视觉层级", () => {
  const { container } = render(<ModuleBridge featureId="council" />);
  const region = screen.getByRole("region", { name: "关联功能" });
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(region.querySelectorAll("a").length).toBeGreaterThan(0);
  fireEvent.click(region.querySelector("summary")!);
  expect(details.open).toBe(true);
  expect(
    within(region).getByRole("link", { name: "投资研究" }).getAttribute("href"),
  ).toBe("/markets#investment-desk");
});
