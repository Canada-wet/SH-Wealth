// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  storage: vi.fn(),
  read: vi.fn(),
}));
vi.mock("../lib/cloud", () => ({
  cloudClient: () => ({
    auth: { getUser: mocks.getUser, onAuthStateChange: mocks.subscribe },
  }),
}));
vi.mock("../lib/rekordbox-source", async (original) => ({
  ...(await original<object>()),
  sourceStorage: mocks.storage,
  readXMLSource: mocks.read,
}));
import { useRekordboxSource } from "../app/components/lifestyle/useRekordboxSource";
const source = () => ({
  handle: { kind: "file", name: "fixture.xml", getFile: vi.fn() },
  lastImportedHash: "old",
  autoCheck: true,
});
const data = () => ({
  file: new File(["xml"], "fixture.xml"),
  text: "xml",
  hash: "new",
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  mocks.subscribe.mockReturnValue({
    data: { subscription: { unsubscribe: mocks.unsubscribe } },
  });
  mocks.storage.mockResolvedValue(source());
  mocks.read.mockResolvedValue(data());
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "showOpenFilePicker");
});
it("恢复本机句柄时校验账号并被动检查，只提供预览不保存版本", async () => {
  const offer = vi.fn(
    async (_data: unknown, _token: number, _current: () => boolean) => true,
  );
  const { result } = renderHook(() => useRekordboxSource("h1", false, offer));
  await waitFor(() => expect(offer).toHaveBeenCalledTimes(1));
  expect(mocks.storage).toHaveBeenCalledWith(
    JSON.stringify(["u1", "h1"]),
    "get",
  );
  expect(mocks.read).toHaveBeenCalledWith(expect.anything(), false);
  expect(mocks.storage.mock.calls.some((c) => c[1] === "put")).toBe(false);
  expect(result.current.status).toContain("尚未修改曲库");
});
it("已有预览时被动检查不覆盖，用户明确检查才能重读", async () => {
  const offer = vi.fn(
    async (_data: unknown, _token: number, _current: () => boolean) => true,
  );
  const { result } = renderHook(() => useRekordboxSource("h1", true, offer));
  await waitFor(() => expect(result.current.source).not.toBeNull());
  expect(mocks.read).not.toHaveBeenCalled();
  await act(async () => result.current.check());
  expect(offer).toHaveBeenCalledTimes(1);
});
it("只有确认导入才写入内容哈希，同内容自动检查不反复弹预览", async () => {
  mocks.read.mockResolvedValue({ ...data(), hash: "old" });
  const offer = vi.fn(
    async (_data: unknown, _token: number, _current: () => boolean) => true,
  );
  const { result } = renderHook(() => useRekordboxSource("h1", false, offer));
  await waitFor(() => expect(mocks.read).toHaveBeenCalled());
  expect(offer).not.toHaveBeenCalled();
  // Explicit check allows choosing another playlist from the unchanged file.
  await act(async () => result.current.check());
  expect(offer).toHaveBeenCalledTimes(1);
  const token = offer.mock.calls[0][1];
  await act(async () => result.current.markImported("old", token));
  expect(mocks.storage).toHaveBeenCalledWith(
    JSON.stringify(["u1", "h1"]),
    "put",
    expect.objectContaining({ lastImportedHash: "old" }),
  );
});
it("卸载后未完成读取不能弹预览，不留下监听", async () => {
  let resolve!: (value: ReturnType<typeof data>) => void;
  mocks.read.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const offer = vi.fn(
      async (_data: unknown, _token: number, _current: () => boolean) => true,
    ),
    { unmount } = renderHook(() => useRekordboxSource("h1", false, offer));
  await waitFor(() => expect(mocks.read).toHaveBeenCalled());
  unmount();
  await act(async () => resolve(data()));
  expect(offer).not.toHaveBeenCalled();
  expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
});
it("忘记文件后旧预览的保存回调不能恢复授权", async () => {
  const offer = vi.fn(
    async (_data: unknown, _token: number, _current: () => boolean) => true,
  );
  const { result } = renderHook(() => useRekordboxSource("h1", false, offer));
  await waitFor(() => expect(offer).toHaveBeenCalledTimes(1));
  const token = offer.mock.calls[0][1];
  await act(async () => result.current.disconnect());
  await act(async () => result.current.markImported("new", token));
  expect(result.current.source).toBeNull();
  expect(mocks.storage).toHaveBeenCalledWith(
    JSON.stringify(["u1", "h1"]),
    "delete",
  );
  expect(mocks.storage.mock.calls.some((c) => c[1] === "put")).toBe(false);
});
it("未验证账号不恢复授权；家庭切换不沿用句柄", async () => {
  mocks.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: new Error("expired"),
  });
  const offer = vi.fn(
    async (_data: unknown, _token: number, _current: () => boolean) => true,
  );
  const { result, rerender } = renderHook(
    ({ home }) => useRekordboxSource(home, true, offer),
    { initialProps: { home: "h1" } },
  );
  await waitFor(() => expect(mocks.getUser).toHaveBeenCalled());
  expect(mocks.storage).not.toHaveBeenCalled();
  rerender({ home: "h2" });
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(mocks.storage).toHaveBeenCalledWith(
    JSON.stringify(["u1", "h2"]),
    "get",
  );
});
it("文件存储不可用仍明确降级，不假装已连接", async () => {
  mocks.storage.mockRejectedValue(new Error("blocked"));
  const { result } = renderHook(() =>
    useRekordboxSource(
      "h1",
      false,
      vi.fn(
        async (_data: unknown, _token: number, _current: () => boolean) => true,
      ),
    ),
  );
  await waitFor(() =>
    expect(result.current.status).toContain("仍可选择或拖入 XML"),
  );
  expect(result.current.source).toBeNull();
  expect(mocks.read).not.toHaveBeenCalled();
});
it("不能记住授权时仍能把刚选的XML直接预览，避免要求重新选文件", async () => {
  mocks.storage.mockRejectedValue(new Error("blocked"));
  Object.defineProperty(window, "showOpenFilePicker", {
    configurable: true,
    value: vi.fn(async () => [source().handle]),
  });
  const offer = vi.fn(
    async (_data: unknown, _token: number, _current: () => boolean) => true,
  );
  const { result } = renderHook(() => useRekordboxSource("h1", false, offer));
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => result.current.connect());
  expect(offer).toHaveBeenCalledTimes(1);
  expect(result.current.source).toBeNull();
  expect(result.current.status).toContain("无法记住文件授权");
});
