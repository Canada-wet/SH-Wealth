// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { JSDOM } from "jsdom";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { emptyState } from "../lib/wealth";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  client: { auth: { getUser: vi.fn(), getSession: vi.fn() } },
}));
vi.mock("../lib/cloud", () => ({
  cloudClient: () => mocks.client,
  cloudRead: mocks.read,
  cloudWrite: mocks.write,
}));
import useWealth from "../lib/useWealth";
beforeEach(() => {
  const storage = new JSDOM("", { url: "http://localhost" }).window
    .localStorage;
  vi.stubGlobal("localStorage", storage);
  mocks.client.auth.getUser.mockResolvedValue({ data: { user: { id: "u" } } });
  mocks.client.auth.getSession.mockResolvedValue({ data: { session: null } });
  mocks.read.mockResolvedValue({
    household_id: "h",
    revision: 0,
    document: null,
  });
  let revision = 0;
  mocks.write.mockImplementation(async () => ++revision);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("本机上传与后续编辑依序同步，保存状态来自真实ACK", async () => {
  const { result } = renderHook(() => useWealth());
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => result.current.connectCloud("h", "upload"));
  expect(mocks.write).toHaveBeenCalledWith(
    "h",
    0,
    expect.objectContaining({ version: 3 }),
  );
  act(() => {
    result.current.commit(
      (state) => ({ ...state, goal: { ...state.goal, target: 10 } }),
      "目标",
    );
  });
  await waitFor(() =>
    expect(result.current.cloudStatus).toBe("已同步 Supabase"),
  );
  expect(mocks.write).toHaveBeenLastCalledWith(
    "h",
    1,
    expect.objectContaining({ revision: 1 }),
  );
});
it("云端加载写入本机并在刷新时可恢复", async () => {
  mocks.read.mockResolvedValue({
    household_id: "h",
    revision: 3,
    document: {
      ...emptyState(),
      revision: 7,
      members: { first: "A", second: "B" },
    },
  });
  const { result } = renderHook(() => useWealth());
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => result.current.connectCloud("h", "load"));
  expect(result.current.state.members.first).toBe("A");
  expect(JSON.parse(localStorage.getItem("together-wealth-v3")!).revision).toBe(
    7,
  );
});
it("云端写入失败保持本机数据，明确显示失败，停止覆盖", async () => {
  const { result } = renderHook(() => useWealth());
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => result.current.connectCloud("h", "upload"));
  mocks.write.mockRejectedValueOnce(new Error("revision conflict"));
  act(() =>
    result.current.commit(
      (state) => ({ ...state, goal: { ...state.goal, target: 100 } }),
      "目标",
    ),
  );
  await waitFor(() => expect(result.current.cloudStatus).toContain("同步失败"));
  expect(result.current.state.goal.target).toBe(100);
  expect(
    JSON.parse(localStorage.getItem("together-wealth-v3")!).goal.target,
  ).toBe(100);
});
