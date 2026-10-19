// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { EMPTY_LIFESTYLE } from "../lib/lifestyle-schema";
import { emptyState, type WealthState } from "../lib/wealth";
import { STATE_KEY } from "../lib/storage";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  home: vi.fn(),
  client: { auth: { getUser: vi.fn(), getSession: vi.fn() } },
}));
vi.mock("../lib/cloud", async (original) => ({
  ...(await original<object>()),
  cloudClient: () => mocks.client,
  cloudRead: mocks.read,
  cloudWrite: mocks.write,
  sharedHousehold: mocks.home,
}));
import { CloudConflictError } from "../lib/cloud";
import useWealth from "../lib/useWealth";
const baseline = (): WealthState => ({
  ...emptyState(),
  revision: 4,
  assets: [
    {
      id: "a",
      name: "账户",
      owner: "joint",
      category: "现金",
      value: 100,
      annualReturn: null,
    },
  ],
});
const otherModule = (): WealthState => ({
  ...baseline(),
  revision: 5,
  preferences: {
    ...baseline().preferences,
    lifestyle: structuredClone(EMPTY_LIFESTYLE),
  },
});
function defer<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "localStorage",
    new JSDOM("", { url: "http://localhost" }).window.localStorage,
  );
  mocks.client.auth.getUser.mockResolvedValue({ data: { user: { id: "u" } } });
  mocks.client.auth.getSession.mockResolvedValue({ data: { session: null } });
  mocks.read.mockResolvedValue({
    household_id: "h",
    revision: 7,
    document: baseline(),
  });
  mocks.write.mockResolvedValue(9);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function connected() {
  const hook = renderHook(() => useWealth());
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () => hook.result.current.connectCloud("h", "load"));
  return hook;
}
function changeMoney(hook: Awaited<ReturnType<typeof connected>>) {
  act(() =>
    hook.result.current.commit(
      (state) => ({
        ...state,
        assets: [{ ...state.assets[0], value: 200 }],
      }),
      "估值",
      true,
    ),
  );
}

it("已确认共同 baseline 时，财务与兴趣冲突读最新一次并 CAS 合并一次", async () => {
  const hook = await connected();
  mocks.read.mockResolvedValue({
    household_id: "h",
    revision: 8,
    document: otherModule(),
  });
  mocks.write.mockRejectedValueOnce(new CloudConflictError());
  changeMoney(hook);
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(hook.result.current.cloudStatus).toBe("已同步 Supabase"),
  );
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(mocks.write.mock.calls[1][0]).toBe("h");
  expect(mocks.write.mock.calls[1][1]).toBe(8);
  expect(hook.result.current.state.assets[0].value).toBe(200);
  expect(hook.result.current.state.preferences.lifestyle).toEqual(
    EMPTY_LIFESTYLE,
  );
  expect(hook.result.current.state.history).toHaveLength(1);
  expect(hook.result.current.state.history[0].assets[0].value).toBe(200);
  expect(JSON.parse(localStorage.getItem(STATE_KEY)!)).toEqual(
    hook.result.current.state,
  );
  expect(
    JSON.parse(localStorage.getItem("together-cloud-link")!).remoteRevision,
  ).toBe(9);
});

it("两边同时修改财务时保留本机且不拼接 history、不自动覆盖", async () => {
  const hook = await connected();
  mocks.read.mockResolvedValue({
    household_id: "h",
    revision: 8,
    document: {
      ...baseline(),
      debts: [{ id: "d", name: "借款", owner: "joint", value: 20 }],
    },
  });
  mocks.write.mockRejectedValueOnce(new CloudConflictError());
  changeMoney(hook);
  await waitFor(() =>
    expect(hook.result.current.error).toContain("资产与规划在两边都有修改"),
  );
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(hook.result.current.state.assets[0].value).toBe(200);
  expect(hook.result.current.state.debts).toEqual([]);
  expect(hook.result.current.state.history).toHaveLength(1);
});

it("普通网络错误即使含 conflict 字样也不读最新、不自动重发", async () => {
  const hook = await connected();
  mocks.write.mockRejectedValueOnce(
    new Error("network conflict connection lost"),
  );
  changeMoney(hook);
  await waitFor(() =>
    expect(hook.result.current.cloudStatus).toContain("同步失败"),
  );
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(hook.result.current.state.assets[0].value).toBe(200);
});

it("合并的第二次 CAS 再冲突后立即停止，不形成自动循环", async () => {
  const hook = await connected();
  mocks.read.mockResolvedValue({
    household_id: "h",
    revision: 8,
    document: otherModule(),
  });
  mocks.write.mockRejectedValue(new CloudConflictError());
  changeMoney(hook);
  await waitFor(() =>
    expect(hook.result.current.cloudStatus).toContain("同步失败"),
  );
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(mocks.write).toHaveBeenCalledTimes(2);
  expect(hook.result.current.state.preferences.lifestyle).toBeUndefined();
});

it("冲突读取期间又有本机编辑时保留全部新内容，不自动发起合并写入", async () => {
  const hook = await connected(),
    pending = defer<{
      household_id: string;
      revision: number;
      document: WealthState;
    }>();
  mocks.read.mockReturnValueOnce(pending.promise);
  mocks.write.mockRejectedValueOnce(new CloudConflictError());
  changeMoney(hook);
  await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
  act(() =>
    hook.result.current.commit(
      (state) => ({
        ...state,
        messages: [{ id: "m", role: "user", text: "期间的新问题" }],
      }),
      "新问题",
    ),
  );
  await act(async () =>
    pending.resolve({
      household_id: "h",
      revision: 8,
      document: otherModule(),
    }),
  );
  await waitFor(() =>
    expect(hook.result.current.error).toContain("本机又有新修改"),
  );
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(hook.result.current.state.assets[0].value).toBe(200);
  expect(hook.result.current.state.messages[0].text).toBe("期间的新问题");
});

it("合并 CAS 已发送后有新编辑也绝不覆盖本机，并明确提示重新确认版本", async () => {
  const hook = await connected(),
    pending = defer<number>();
  mocks.read.mockResolvedValue({
    household_id: "h",
    revision: 8,
    document: otherModule(),
  });
  mocks.write
    .mockRejectedValueOnce(new CloudConflictError())
    .mockReturnValueOnce(pending.promise);
  changeMoney(hook);
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(2));
  act(() =>
    hook.result.current.commit(
      (state) => ({
        ...state,
        messages: [{ id: "new", role: "user", text: "保留我的新编辑" }],
      }),
      "新聊天",
    ),
  );
  await act(async () => pending.resolve(9));
  await waitFor(() =>
    expect(hook.result.current.error).toContain("模块合并已保存云端"),
  );
  expect(hook.result.current.state.messages[0].text).toBe("保留我的新编辑");
  expect(hook.result.current.state.preferences.lifestyle).toBeUndefined();
  expect(mocks.write).toHaveBeenCalledTimes(2);
  expect(JSON.parse(localStorage.getItem(STATE_KEY)!)).toEqual(
    hook.result.current.state,
  );
});

it("刷新后的 localStorage 版本链接不能冒充内容 baseline", async () => {
  localStorage.setItem(
    STATE_KEY,
    JSON.stringify({
      ...baseline(),
      revision: 5,
      messages: [{ id: "m", role: "user", text: "未同步" }],
    }),
  );
  localStorage.setItem(
    "together-cloud-link",
    JSON.stringify({
      householdId: "h",
      userId: "u",
      remoteRevision: 7,
      localRevision: 4,
    }),
  );
  mocks.write.mockRejectedValueOnce(new CloudConflictError());
  const hook = renderHook(() => useWealth());
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () => {
    await expect(
      hook.result.current.connectCloud("h", "resume"),
    ).rejects.toThrow("云端同步未完成");
  });
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(hook.result.current.state.messages[0].text).toBe("未同步");
});

it("合并前账号变更则停止，无跨用户使用 baseline", async () => {
  const hook = await connected();
  mocks.client.auth.getUser.mockResolvedValue({
    data: { user: { id: "other-user" } },
  });
  mocks.read.mockResolvedValue({
    household_id: "h",
    revision: 8,
    document: otherModule(),
  });
  mocks.write.mockRejectedValueOnce(new CloudConflictError());
  changeMoney(hook);
  await waitFor(() =>
    expect(hook.result.current.error).toContain("登录账号已变化"),
  );
  expect(mocks.write).toHaveBeenCalledTimes(1);
});

it("不同家庭的意外读取结果绝不用于自动合并", async () => {
  const hook = await connected();
  mocks.read.mockResolvedValue({
    household_id: "wrong-home",
    revision: 8,
    document: otherModule(),
  });
  mocks.write.mockRejectedValueOnce(new CloudConflictError());
  changeMoney(hook);
  await waitFor(() =>
    expect(hook.result.current.error).toContain("云端版本无法确认"),
  );
  expect(mocks.write).toHaveBeenCalledTimes(1);
});

it("在等待期间断开连接不会被迟到的合并结果改回已同步", async () => {
  const hook = await connected(),
    pending = defer<{
      household_id: string;
      revision: number;
      document: WealthState;
    }>();
  mocks.read.mockReturnValueOnce(pending.promise);
  mocks.write.mockRejectedValueOnce(new CloudConflictError());
  changeMoney(hook);
  await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
  act(() => hook.result.current.disconnectCloud());
  await act(async () =>
    pending.resolve({
      household_id: "h",
      revision: 8,
      document: otherModule(),
    }),
  );
  expect(hook.result.current.cloudStatus).toBe("仅保存于本机");
  expect(hook.result.current.cloudHousehold).toBe("");
  expect(mocks.write).toHaveBeenCalledTimes(1);
});

it("正常写入的 ACK 期间又有编辑会依序继续同步，而不是覆盖新编辑", async () => {
  const hook = await connected(),
    pending = defer<number>();
  mocks.write.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(9);
  changeMoney(hook);
  act(() =>
    hook.result.current.commit(
      (state) => ({
        ...state,
        messages: [{ id: "m", role: "user", text: "排队的编辑" }],
      }),
      "聊天",
    ),
  );
  await act(async () => pending.resolve(8));
  await waitFor(() =>
    expect(hook.result.current.cloudStatus).toBe("已同步 Supabase"),
  );
  expect(mocks.write).toHaveBeenCalledTimes(2);
  expect(mocks.write.mock.calls[1][1]).toBe(8);
  expect(mocks.write.mock.calls[1][2].messages[0].text).toBe("排队的编辑");
  expect(hook.result.current.state.messages[0].text).toBe("排队的编辑");
});

it("本机存储写失败即使云端已 ACK 也不伪称本机已更新", async () => {
  const hook = await connected();
  mocks.read.mockResolvedValue({
    household_id: "h",
    revision: 8,
    document: otherModule(),
  });
  const pending = defer<number>();
  mocks.write
    .mockRejectedValueOnce(new CloudConflictError())
    .mockReturnValueOnce(pending.promise);
  changeMoney(hook);
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(2));
  const prototype = Object.getPrototypeOf(localStorage) as Storage;
  const original = prototype.setItem;
  vi.spyOn(prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key === STATE_KEY) throw new Error("quota full");
    return original.call(this, key, value);
  });
  await act(async () => pending.resolve(9));
  await waitFor(() => expect(hook.result.current.error).toBe("quota full"));
  expect(hook.result.current.cloudStatus).toContain("同步失败");
  expect(hook.result.current.state.preferences.lifestyle).toBeUndefined();
  expect(hook.result.current.state.assets[0].value).toBe(200);
});

it("云端链接 metadata 本机写失败不能保持虚假的同步状态", async () => {
  const hook = await connected();
  const prototype = Object.getPrototypeOf(localStorage) as Storage,
    original = prototype.setItem;
  vi.spyOn(prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key === "together-cloud-link") throw new Error("link quota full");
    return original.call(this, key, value);
  });
  changeMoney(hook);
  await waitFor(() =>
    expect(hook.result.current.error).toBe("link quota full"),
  );
  expect(hook.result.current.cloudStatus).toContain("同步失败");
  expect(hook.result.current.state.assets[0].value).toBe(200);
  expect(mocks.write).toHaveBeenCalledTimes(1);
});
