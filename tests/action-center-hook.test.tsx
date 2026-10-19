// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const authMock = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("../lib/cloud", () => ({ cloudClient: authMock.client }));
import useActionCenter from "../lib/useActionCenter";
import type { ActionItem } from "../lib/action-center";
const home = "20000000-0000-4000-8000-000000000001";
const item: ActionItem = {
  id: "10000000-0000-4000-8000-000000000001",
  title: "合成行动",
  note: "",
  owner: "joint",
  status: "planned",
  due: "",
  visibility: "private",
  sourceFeature: "",
  sourceRef: "",
  version: 1,
  createdAt: "2026-10-19T12:00:00Z",
  updatedAt: "2026-10-19T12:00:00Z",
};
beforeEach(() => {
  authMock.client.mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("等待服务端确认再更新；保存失败保留旧数据和UI草稿责任，不自动重试", async () => {
  let finish: ((response: Response) => void) | undefined;
  const fetcher = vi.fn(async (_url: string, options: RequestInit = {}) =>
    options.method === "POST"
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : Response.json({ items: [item] }),
  );
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useActionCenter(home));
  await waitFor(() => expect(result.current.items).toHaveLength(1));
  let pending!: Promise<ActionItem>;
  act(() => {
    pending = result.current.update(item, { status: "done" });
  });
  expect(result.current.items[0].status).toBe("planned");
  await act(async () => {
    finish!(Response.json({ error: "conflict" }, { status: 409 }));
    await expect(pending).rejects.toThrow("conflict");
  });
  expect(result.current.items[0].status).toBe("planned");
  expect(result.current.error).toBe("conflict");
  expect(
    fetcher.mock.calls.filter((call) => call[1]?.method === "POST"),
  ).toHaveLength(1);
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.error).toBe("");
});
it("未确认的创建明确重试使用同一ID；成功才派事件且删除等待确认", async () => {
  const created: string[] = [];
  let fail = true;
  const fetcher = vi.fn(async (_url: string, options: RequestInit = {}) => {
    if (options.method !== "POST") return Response.json({ items: [] });
    const raw = JSON.parse(String(options.body));
    if (raw.operation === "delete")
      return Response.json({ deleted: true, id: raw.id });
    created.push(raw.id);
    if (fail) throw Error("connection interrupted");
    return Response.json({ item: { ...item, ...raw.input, id: raw.id } });
  });
  vi.stubGlobal("fetch", fetcher);
  const event = vi.fn();
  window.addEventListener("together-actions-changed", event);
  const { result } = renderHook(() => useActionCenter(home));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await expect(result.current.create({ title: "合成行动" })).rejects.toThrow(
      "connection interrupted",
    );
  });
  expect(result.current.items).toEqual([]);
  expect(event).not.toHaveBeenCalled();
  await act(async () => {
    await expect(
      result.current.create({ title: "改过文字的另一项行动" }),
    ).rejects.toThrow("上一项新建结果尚未确认");
  });
  expect(created).toHaveLength(1);
  fail = false;
  let saved!: ActionItem;
  await act(async () => {
    saved = await result.current.create({ title: "合成行动" });
  });
  expect(created[0]).toBe(created[1]);
  expect(saved.visibility).toBe("private");
  expect(result.current.items).toEqual([saved]);
  expect(event).toHaveBeenCalledTimes(1);
  await act(async () => {
    await result.current.remove(saved);
  });
  expect(result.current.items).toEqual([]);
  expect(event).toHaveBeenCalledTimes(2);
  window.removeEventListener("together-actions-changed", event);
});
type FixtureUser = { id: string; email: string; email_confirmed_at?: string };
function authFixture() {
  const callbacks = new Set<
    (event: string, session: { user: FixtureUser } | null) => void
  >();
  authMock.client.mockReturnValue({
    auth: {
      onAuthStateChange: (
        callback: (
          event: string,
          session: { user: FixtureUser } | null,
        ) => void,
      ) => {
        callbacks.add(callback);
        return {
          data: {
            subscription: { unsubscribe: () => callbacks.delete(callback) },
          },
        };
      },
    },
  });
  return (event: string, user: FixtureUser | null) => {
    for (const callback of callbacks) callback(event, user ? { user } : null);
  };
}
const memberA = {
  id: "10000000-0000-4000-8000-000000000011",
  email: "henrywhy233@gmail.com",
  email_confirmed_at: "2026-10-01T00:00:00Z",
};
const memberB = {
  id: "10000000-0000-4000-8000-000000000012",
  email: "sallyxie0378@gmail.com",
  email_confirmed_at: "2026-10-01T00:00:00Z",
};
it("首次会话不重复查询；同家庭换账号立即清空，A晚到GET不能替代B的私有列表", async () => {
  const emit = authFixture();
  const replies: ((response: Response) => void)[] = [];
  const fetcher = vi.fn(
    async () => new Promise<Response>((resolve) => replies.push(resolve)),
  );
  vi.stubGlobal("fetch", fetcher);
  const changed = vi.fn();
  window.addEventListener("together-action-session-changed", changed);
  const { result } = renderHook(() => useActionCenter(home));
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => {
    emit("INITIAL_SESSION", memberA);
    emit("SIGNED_IN", memberA);
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => {
    replies[0](Response.json({ items: [item] }));
  });
  expect(result.current.items[0].title).toBe("合成行动");
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => {
    emit("SIGNED_IN", memberB);
    emit("TOKEN_REFRESHED", memberB);
  });
  expect(result.current.items).toEqual([]);
  expect(result.current.error).toBe("");
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(changed).toHaveBeenCalledTimes(1);
  const bItem = {
    ...item,
    id: "10000000-0000-4000-8000-000000000002",
    title: "B private",
  };
  await act(async () => {
    replies[2](Response.json({ items: [bItem] }));
  });
  await act(async () => {
    replies[1](Response.json({ items: [item] }));
  });
  expect(result.current.items).toEqual([bItem]);
  await act(async () => {
    emit("SIGNED_OUT", null);
    window.dispatchEvent(new Event("focus"));
    await result.current.refresh();
  });
  expect(result.current.items).toEqual([]);
  expect(result.current.error).toBe("");
  expect(fetcher).toHaveBeenCalledTimes(3);
  await expect(
    result.current.update(bItem, { status: "done" }),
  ).rejects.toThrow("登录身份尚未确认");
  window.removeEventListener("together-action-session-changed", changed);
});
it("同家庭换账号时旧保存回执被拒绝且不污染B，也不发保存成功事件", async () => {
  const emit = authFixture();
  let save: ((response: Response) => void) | undefined;
  const fetcher = vi.fn(async (_url: string, options: RequestInit = {}) =>
    options.method === "POST"
      ? new Promise<Response>((resolve) => {
          save = resolve;
        })
      : Response.json({ items: [] }),
  );
  vi.stubGlobal("fetch", fetcher);
  const changed = vi.fn();
  window.addEventListener("together-actions-changed", changed);
  const { result } = renderHook(() => useActionCenter(home));
  await act(async () => {
    emit("INITIAL_SESSION", memberA);
  });
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current
      .update(item, { status: "done" })
      .catch((error: Error) => error);
  });
  await act(async () => {
    emit("SIGNED_IN", memberB);
  });
  await act(async () => {
    save!(Response.json({ item: { ...item, status: "done", version: 2 } }));
  });
  const error = await pending;
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain("登录身份已变化");
  expect(result.current.items).toEqual([]);
  expect(result.current.error).toBe("");
  expect(changed).not.toHaveBeenCalled();
  window.removeEventListener("together-actions-changed", changed);
});
it("无确认邮箱或非白名单会话不查询；初始身份未知也拒绝修改", async () => {
  const emit = authFixture();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useActionCenter(home));
  await expect(result.current.create({ title: "blocked" })).rejects.toThrow(
    "登录身份尚未确认",
  );
  await act(async () => {
    emit("INITIAL_SESSION", { ...memberA, email_confirmed_at: undefined });
  });
  await act(async () => {
    emit("SIGNED_IN", { ...memberA, email: "other@example.invalid" });
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(result.current.items).toEqual([]);
});
it("其他实例成功事件与focus刷新；没有无限轮询或本机伪持久化", async () => {
  const fetcher = vi.fn(async (_url: string, _options?: RequestInit) =>
    Response.json({ items: [] }),
  );
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useActionCenter(home));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await act(async () => {
    window.dispatchEvent(new Event("together-actions-changed"));
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(result.current.items).toEqual([]);
  expect(
    fetcher.mock.calls.every((call) =>
      String(call[0]).includes("/api/actions"),
    ),
  ).toBe(true);
});
it("切换家庭后晚到响应不能串入新家庭，未知连接不查询", async () => {
  let finish: ((response: Response) => void) | undefined;
  const other = "20000000-0000-4000-8000-000000000002";
  const fetcher = vi.fn(async (url: string) =>
    url.includes(home)
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : Response.json({ items: [] }),
  );
  vi.stubGlobal("fetch", fetcher);
  const { result, rerender } = renderHook(({ id }) => useActionCenter(id), {
    initialProps: { id: "" },
  });
  expect(fetcher).not.toHaveBeenCalled();
  rerender({ id: home });
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  rerender({ id: other });
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    finish!(Response.json({ items: [item] }));
  });
  expect(result.current.items).toEqual([]);
});
it("旧家庭保存结果不能使新家庭读取卡住；权限撤销清除旧私有列表", async () => {
  let save: ((response: Response) => void) | undefined;
  let read: ((response: Response) => void) | undefined;
  let denied = false;
  const other = "20000000-0000-4000-8000-000000000002";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: RequestInit = {}) => {
      if (options.method === "POST")
        return new Promise<Response>((resolve) => {
          save = resolve;
        });
      if (denied)
        return Response.json({ error: "access revoked" }, { status: 403 });
      if (url.includes(other))
        return new Promise<Response>((resolve) => {
          read = resolve;
        });
      return Response.json({ items: [item] });
    }),
  );
  const { result, rerender } = renderHook(({ id }) => useActionCenter(id), {
    initialProps: { id: home },
  });
  await waitFor(() => expect(result.current.items).toHaveLength(1));
  let pending!: Promise<ActionItem>;
  act(() => {
    pending = result.current.update(item, { status: "done" });
  });
  rerender({ id: other });
  await waitFor(() => expect(read).toBeTypeOf("function"));
  await act(async () => {
    save!(Response.json({ item: { ...item, status: "done", version: 2 } }));
    await pending;
  });
  await act(async () => {
    read!(Response.json({ items: [item] }));
  });
  expect(result.current.loading).toBe(false);
  expect(result.current.items[0].status).toBe("planned");
  denied = true;
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.items).toEqual([]);
  expect(result.current.error).toBe("access revoked");
});
