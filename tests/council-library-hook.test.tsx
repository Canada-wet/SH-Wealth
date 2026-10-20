// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("../lib/cloud", () => ({ cloudClient: mock.client }));
import useCouncilLibrary from "../lib/useCouncilLibrary";
import { libraryItem } from "./fixtures/council-library";
beforeEach(() => mock.client.mockReturnValue(null));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("搜索是有界私密POST，后到的旧请求不能污染新结果；失败不伪装成功", async () => {
  let late: ((r: Response) => void) | undefined;
  const fetcher = vi.fn(async (_url: string, o: RequestInit) => {
    const b = JSON.parse(String(o.body));
    if (b.query === "旧查询") return new Promise<Response>((r) => (late = r));
    return Response.json({
      userId: "owner",
      items: [libraryItem({ question: b.query || "初始问题" })],
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useCouncilLibrary());
  await waitFor(() => expect(result.current.ready).toBe(true));
  act(() => result.current.setQuery("旧查询"));
  await waitFor(() => expect(late).toBeTruthy());
  act(() => result.current.setQuery("新查询"));
  await waitFor(() => expect(result.current.items[0].question).toBe("新查询"));
  await act(async () =>
    late!(
      Response.json({
        userId: "owner",
        items: [libraryItem({ question: "错误旧内容" })],
      }),
    ),
  );
  expect(result.current.items[0].question).toBe("新查询");
  expect(
    fetcher.mock.calls.every(([url]) => url === "/api/council/library"),
  ).toBe(true);
});
it("保存必须等正确版本与账号ACK；网络未确认不重发，刷新核对后才可再次修改", async () => {
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, o: RequestInit) => {
      const b = JSON.parse(String(o.body));
      if (b.action === "search")
        return Response.json({ userId: "owner", items: [libraryItem()] });
      calls++;
      return Response.json({ error: "冲突，草稿保留" }, { status: 409 });
    }),
  );
  const { result } = renderHook(() => useCouncilLibrary());
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => {
    await expect(
      result.current.save(libraryItem().id, {
        ...libraryItem().memo,
        pinned: true,
      }),
    ).rejects.toThrow("冲突");
  });
  expect(calls).toBe(1);
  expect(result.current.items[0].memo.pinned).toBe(false);
});
it("账号切换立即清空历史、迟到的读取与保存不能跨账号生效", async () => {
  let callback!: (
    _e: string,
    s: {
      user: { id: string; email: string; email_confirmed_at: string };
    } | null,
  ) => void;
  mock.client.mockReturnValue({
    auth: {
      onAuthStateChange: (fn: typeof callback) => {
        callback = fn;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  });
  let late: ((r: Response) => void) | undefined;
  let user = "A";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, o: RequestInit) => {
      const b = JSON.parse(String(o.body));
      if (b.action === "save") return new Promise<Response>((r) => (late = r));
      return Response.json({
        userId: user,
        items: [libraryItem({ question: user })],
      });
    }),
  );
  const { result } = renderHook(() => useCouncilLibrary());
  const session = (id: string, email: string) => ({
    user: { id, email, email_confirmed_at: "2026-01-01" },
  });
  act(() => callback("SIGNED_IN", session("A", "henrywhy233@gmail.com")));
  await waitFor(() => expect(result.current.ready).toBe(true));
  let promise!: Promise<unknown>;
  act(() => {
    promise = result.current
      .save(libraryItem().id, { ...libraryItem().memo, pinned: true })
      .catch((e) => e.message);
  });
  await waitFor(() => expect(late).toBeTruthy());
  act(() => {
    user = "B";
    callback("SIGNED_IN", session("B", "sallyxie0378@gmail.com"));
  });
  await waitFor(() => expect(result.current.items[0]?.question).toBe("B"));
  await act(async () =>
    late!(
      Response.json({
        userId: "A",
        id: libraryItem().id,
        memo: { ...libraryItem().memo, pinned: true, version: 1 },
      }),
    ),
  );
  expect(await promise).toContain("账号已变化");
  expect(result.current.items[0].question).toBe("B");
  expect(result.current.items[0].memo.pinned).toBe(false);
  act(() => callback("SIGNED_OUT", null));
  expect(result.current.items).toEqual([]);
});
