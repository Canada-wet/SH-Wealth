// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { emptyState } from "../lib/wealth";
import { MIGRATION_KEY, STATE_KEY } from "../lib/storage";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  home: vi.fn(),
  client: { auth: { getUser: vi.fn(), getSession: vi.fn() } },
}));
vi.mock("../lib/cloud", () => ({
  cloudClient: () => mocks.client,
  cloudRead: mocks.read,
  cloudWrite: mocks.write,
  sharedHousehold: mocks.home,
}));
import useWealth from "../lib/useWealth";
const cloud = () => ({
  ...emptyState(),
  revision: 4,
  assets: [
    {
      id: "a",
      name: "云端现金",
      category: "现金",
      owner: "joint",
      value: 500,
      annualReturn: null,
    },
  ],
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "localStorage",
    new JSDOM("", { url: "http://localhost" }).window.localStorage,
  );
  mocks.client.auth.getUser.mockResolvedValue({ data: { user: { id: "u" } } });
  mocks.client.auth.getSession.mockResolvedValue({
    data: { session: { user: { id: "u" } } },
  });
  mocks.home.mockResolvedValue("home");
  mocks.read.mockResolvedValue({
    household_id: "home",
    revision: 7,
    document: cloud(),
  });
  mocks.write.mockResolvedValue(8);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("没有本机家庭链接的新浏览器自动加载云端，不上传空数据", async () => {
  const { result } = renderHook(() => useWealth());
  await waitFor(() => expect(result.current.state.assets[0]?.value).toBe(500));
  expect(result.current.cloudHousehold).toBe("home");
  expect(mocks.write).not.toHaveBeenCalled();
});
it("本机与云端都有财务数据时保留本机，选择加载后保留迁移前副本", async () => {
  const local = { ...cloud(), assets: [{ ...cloud().assets[0], value: 600 }] };
  localStorage.setItem(STATE_KEY, JSON.stringify(local));
  const { result } = renderHook(() => useWealth());
  await waitFor(() => expect(result.current.cloudChoice).not.toBeNull());
  expect(result.current.state.assets[0].value).toBe(600);
  expect(mocks.write).not.toHaveBeenCalled();
  await act(async () => result.current.connectCloud("home", "load"));
  expect(result.current.state.assets[0].value).toBe(500);
  expect(JSON.parse(localStorage.getItem(MIGRATION_KEY)!).assets[0].value).toBe(
    600,
  );
});
it("损坏本机数据不会作为空文档覆盖云端", async () => {
  localStorage.setItem(STATE_KEY, "corrupt");
  const { result } = renderHook(() => useWealth());
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.error).toContain("无法读取");
  expect(mocks.home).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
  expect(localStorage.getItem(STATE_KEY)).toBe("corrupt");
});
it("本机仅有聊天时自动归档保留，财务仍使用云端", async () => {
  localStorage.setItem(
    STATE_KEY,
    JSON.stringify({
      ...emptyState(),
      messages: [{ id: "m", role: "user", text: "本机问题" }],
    }),
  );
  const { result } = renderHook(() => useWealth());
  await waitFor(() =>
    expect(result.current.cloudStatus).toBe("已同步 Supabase"),
  );
  expect(result.current.state.assets[0].value).toBe(500);
  expect(result.current.state.chatArchives?.[0].messages[0].text).toBe(
    "本机问题",
  );
  expect(mocks.write).toHaveBeenCalled();
});
it("刷新时丢失ACK但云端内容一致，安全恢复而非制造冲突", async () => {
  localStorage.setItem(STATE_KEY, JSON.stringify(cloud()));
  localStorage.setItem(
    "together-cloud-link",
    JSON.stringify({
      householdId: "home",
      userId: "u",
      remoteRevision: 6,
      localRevision: 3,
    }),
  );
  const { result } = renderHook(() => useWealth());
  await waitFor(() =>
    expect(result.current.cloudStatus).toBe("已同步 Supabase"),
  );
  expect(result.current.error).toBe("");
  expect(mocks.write).not.toHaveBeenCalled();
});
