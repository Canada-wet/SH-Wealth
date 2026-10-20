import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock("../lib/server-auth", () => ({ authorizeRequest: mock.auth }));
import { POST } from "../app/api/council/library/route";
import { EMPTY_COUNCIL_MEMO } from "../lib/council-library";
import { libraryItem } from "./fixtures/council-library";
beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.mockResolvedValue({
    status: 200,
    user: { id: "synthetic-owner" },
    client: { rpc: mock.rpc },
  });
  mock.rpc.mockResolvedValue({ data: [libraryItem()], error: null });
});
const post = (body: unknown, origin = "https://app.test") =>
  POST(
    new Request("https://app.test/api/council/library", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
it("搜索只经本人RPC，无生成、账本读取或服务角色；搜索词不进入URL", async () => {
  const r = await post({ action: "search", query: "  关键  假设 " });
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(mock.rpc).toHaveBeenCalledWith("read_wealth_council_library", {
    search_text: "关键 假设",
  });
  expect((await r.json()).userId).toBe("synthetic-owner");
});
it("保存CAS以认证身份为准，完整ACK后返回；不把用户id交给RPC", async () => {
  mock.rpc.mockResolvedValueOnce({
    data: { ...EMPTY_COUNCIL_MEMO, pinned: true, version: 1 },
    error: null,
  });
  const r = await post({
    action: "save",
    id: libraryItem().id,
    memo: { ...EMPTY_COUNCIL_MEMO, pinned: true },
  });
  expect(r.status).toBe(200);
  expect(mock.rpc).toHaveBeenCalledWith("save_wealth_council_memo", {
    target_run: libraryItem().id,
    expected_version: 0,
    content: {
      title: "",
      tags: [],
      pinned: true,
      archived: false,
      note: "",
      reviewOn: "",
    },
  });
});
it("未授权、跨源、伪造身份、坏格式和有界流请求均拒绝", async () => {
  mock.auth.mockResolvedValueOnce({ status: 401, error: "login" });
  expect((await post({ action: "search", query: "" })).status).toBe(401);
  expect(
    (await post({ action: "search", query: "" }, "https://evil.test")).status,
  ).toBe(403);
  for (const body of [
    { action: "search", query: "x", userId: "partner" },
    {
      action: "save",
      id: libraryItem().id,
      memo: { ...EMPTY_COUNCIL_MEMO, userId: "partner" },
    },
    { action: "search", query: "x".repeat(16001) },
    { action: "deleteAll" },
    [],
  ])
    expect((await post(body)).status).toBe(400);
  expect(mock.rpc).not.toHaveBeenCalled();
});
it.each([
  ["library_conflict", 409],
  ["library_active", 409],
  ["library_not_found", 404],
  ["library_invalid", 400],
  ["upstream secret stack", 503],
] as const)("错误%s不泄漏上游原文", async (message, code) => {
  mock.rpc.mockResolvedValueOnce({ data: null, error: { message } });
  const r = await post({ action: "search", query: "" });
  expect(r.status).toBe(code);
  expect(await r.text()).not.toContain("upstream secret");
});
it("无效ACK不伪造保存成功，过大/坏列表不当作历史", async () => {
  mock.rpc.mockResolvedValueOnce({
    data: { ...EMPTY_COUNCIL_MEMO, version: 99 },
    error: null,
  });
  expect(
    (
      await post({
        action: "save",
        id: libraryItem().id,
        memo: EMPTY_COUNCIL_MEMO,
      })
    ).status,
  ).toBe(503);
  mock.rpc.mockResolvedValueOnce({ data: [{ id: "x" }], error: null });
  expect((await post({ action: "search", query: "" })).status).toBe(503);
});
