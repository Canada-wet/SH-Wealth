// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";
import useWealth from "../lib/useWealth";
import { BACKUP_KEY, STATE_KEY } from "../lib/storage";
import { emptyState, saveAsset } from "../lib/wealth";
vi.mock("../lib/cloud", () => ({
  cloudClient: () => null,
  cloudRead: vi.fn(),
  cloudWrite: vi.fn(),
}));
const testStorage = new JSDOM("", { url: "http://localhost" }).window
  .localStorage;
beforeEach(() => {
  vi.stubGlobal("localStorage", testStorage);
  testStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("页面数据保存", () => {
  it("保存后重挂载恢复所有数据，已删除资产不会复活", async () => {
    let hook = renderHook(() => useWealth());
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    act(() => {
      hook.result.current.commit(
        (state) =>
          saveAsset(state, {
            id: "a",
            name: "账户",
            owner: "first",
            category: "其他",
            value: 123.45,
            annualReturn: -2,
          }),
        "新增",
        true,
      );
    });
    hook.unmount();
    hook = renderHook(() => useWealth());
    await waitFor(() =>
      expect(hook.result.current.state.assets).toHaveLength(1),
    );
    expect(hook.result.current.state.assets[0].annualReturn).toBe(-2);
    act(() => {
      hook.result.current.commit(
        (state) => ({ ...state, assets: [] }),
        "删除",
        true,
      );
    });
    hook.unmount();
    hook = renderHook(() => useWealth());
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.state.assets).toEqual([]);
    expect(hook.result.current.state.history).toHaveLength(2);
  });
  it("存储失败不更新界面数据", async () => {
    const { result } = renderHook(() => useWealth());
    await waitFor(() => expect(result.current.ready).toBe(true));
    vi.spyOn(Object.getPrototypeOf(testStorage), "setItem").mockImplementation(
      () => {
        throw new Error("quota");
      },
    );
    expect(() =>
      act(() => {
        result.current.commit(
          (state) => ({ ...state, goal: { ...state.goal, target: 100 } }),
          "修改",
        );
      }),
    ).toThrow("quota");
    expect(result.current.state.goal.target).toBe(2150000);
  });
  it("跨标签storage事件更新页面", async () => {
    const { result } = renderHook(() => useWealth());
    await waitFor(() => expect(result.current.ready).toBe(true));
    const next = {
      ...emptyState(),
      revision: 2,
      members: { first: "A", second: "B" },
    };
    act(() => {
      localStorage.setItem(STATE_KEY, JSON.stringify(next));
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STATE_KEY,
          newValue: JSON.stringify(next),
        }),
      );
    });
    expect(result.current.state.members.first).toBe("A");
  });
  it("损坏主数据保留并可以从上一版本恢复", async () => {
    localStorage.setItem(STATE_KEY, "broken");
    localStorage.setItem(
      BACKUP_KEY,
      JSON.stringify({
        ...emptyState(),
        members: { first: "Alice", second: "Bob" },
      }),
    );
    const { result } = renderHook(() => useWealth());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.error).toMatch(/无法读取/);
    expect(localStorage.getItem(STATE_KEY)).toBe("broken");
    act(() => result.current.recoverPrevious());
    expect(result.current.state.members.first).toBe("Alice");
    expect(result.current.error).toBe("");
    expect(JSON.parse(localStorage.getItem(BACKUP_KEY)!).members.first).toBe(
      "Alice",
    );
  });
});
