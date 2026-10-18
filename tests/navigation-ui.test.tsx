// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
const mock = vi.hoisted(() => ({ pathname: "/markets" }));
vi.mock("next/navigation", () => ({ usePathname: () => mock.pathname }));
import NavigationProvider from "../app/components/NavigationProvider";
import AppNavigation from "../app/components/AppNavigation";
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
