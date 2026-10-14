// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { JSDOM } from "jsdom";
import useMarketData from "../lib/useMarketData";
import { MARKET_CACHE_KEY } from "../lib/market-state";
const data = {
  fetchedAt: "2026-10-14T12:00:00Z",
  fx: [],
  yields: [],
  macro: [],
  failures: [],
};
beforeEach(() => {
  vi.stubGlobal(
    "localStorage",
    new JSDOM("", { url: "http://localhost" }).window.localStorage,
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("StrictMode 取消首个请求后仍立即发起有效请求，不等五分钟", async () => {
  const fetcher = vi.fn(
    (_url: string, options: { signal: AbortSignal }) =>
      new Promise<Response>((resolve, reject) => {
        if (fetcher.mock.calls.length === 1)
          options.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        else resolve(Response.json(data));
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(() => useMarketData(), {
    reactStrictMode: true,
  });
  await waitFor(() => expect(hook.result.current.data).toEqual(data));
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(hook.result.current.busy).toBe(false);
});
it("不支持 AbortSignal.any/timeout 的浏览器仍可加载并缓存", async () => {
  vi.stubGlobal("AbortSignal", {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data)));
  const { result } = renderHook(() => useMarketData());
  await waitFor(() => expect(result.current.data).toEqual(data));
  expect(localStorage.getItem(MARKET_CACHE_KEY)).toContain(data.fetchedAt);
});
it("离线重新打开恢复旧快照与原时间，不清空、不伪造当前读取", async () => {
  localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify(data));
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const { result } = renderHook(() => useMarketData());
  await waitFor(() => expect(result.current.error).toContain("offline"));
  expect(result.current.data).toEqual(data);
  expect(result.current.cached).toBe(true);
});
it("损坏缓存或坏格式响应不让页面崩溃，可重试成功", async () => {
  localStorage.setItem(MARKET_CACHE_KEY, "broken");
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ fx: "invalid" }))
    .mockResolvedValueOnce(Response.json(data));
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useMarketData());
  await waitFor(() => expect(result.current.error).toContain("格式"));
  await act(async () => result.current.refresh());
  expect(result.current.data).toEqual(data);
  expect(result.current.error).toBe("");
});
it("登录失效提供恢复状态，保留已有公开快照", async () => {
  localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify(data));
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
  );
  const { result } = renderHook(() => useMarketData());
  await waitFor(() => expect(result.current.needsLogin).toBe(true));
  expect(result.current.data).toEqual(data);
});
it("超时结束 loading，可立即再次刷新", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(
    (_url: string, options: { signal: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) =>
        options.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useMarketData());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(25000);
  });
  expect(result.current.busy).toBe(false);
  expect(result.current.error).toContain("超时");
  act(() => {
    void result.current.refresh();
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
