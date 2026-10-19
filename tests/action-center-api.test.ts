import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock("../lib/server-auth", () => ({ authorizeRequest: mock.auth }));
import { GET, POST } from "../app/api/actions/route";
const id = "10000000-0000-4000-8000-000000000001",
  household = "20000000-0000-4000-8000-000000000001";
const item = {
  id,
  title: "核对账户",
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
  vi.clearAllMocks();
  mock.auth.mockResolvedValue({
    status: 200,
    user: { id: "verified-person" },
    client: { rpc: mock.rpc },
  });
  mock.rpc.mockResolvedValue({ data: item, error: null });
});
const post = (raw: unknown, origin = "https://app.test") =>
  POST(
    new Request("https://app.test/api/actions", {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify(raw),
    }),
  );
it("先授权；GET只调用本人可见列表，不创建家庭或修改账本", async () => {
  mock.auth.mockResolvedValueOnce({ status: 401, error: "登录" });
  expect(
    (
      await GET(
        new Request(`https://app.test/api/actions?household=${household}`),
      )
    ).status,
  ).toBe(401);
  expect(mock.rpc).not.toHaveBeenCalled();
  mock.rpc.mockResolvedValueOnce({ data: [item], error: null });
  const result = await GET(
    new Request(`https://app.test/api/actions?household=${household}`),
  );
  expect(result.status).toBe(200);
  expect(mock.rpc).toHaveBeenCalledWith("list_wealth_actions", {
    target_household: household,
  });
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(await result.json()).toEqual({ items: [item] });
});
it("创建默认私有，身份不取客户端；坏可见范围、外源与大请求均拒绝", async () => {
  const raw = {
    operation: "create",
    household,
    id,
    input: { title: "核对账户" },
  };
  expect((await post(raw)).status).toBe(200);
  expect(mock.rpc).toHaveBeenCalledWith("mutate_wealth_action", {
    operation: "create",
    target_household: household,
    target_id: id,
    expected_version: null,
    payload: {
      title: "核对账户",
      note: "",
      owner: "joint",
      status: "planned",
      due: "",
      visibility: "private",
      sourceFeature: "",
      sourceRef: "",
    },
  });
  mock.rpc.mockClear();
  expect((await post(raw, "https://evil.test")).status).toBe(403);
  expect((await post(raw, "")).status).toBe(403);
  for (const payload of [
    { ...raw, target_user: "partner" },
    {
      ...raw,
      input: {
        title: "x",
        visibility: "household",
        sourceFeature: "council",
        sourceRef: id,
      },
    },
    { ...raw, input: { title: "x".repeat(17000) } },
    { ...raw, household: "https://evil.test" },
  ])
    expect((await post(payload)).status).toBe(400);
  expect(mock.rpc).not.toHaveBeenCalled();
});
it("版本CAS与明确删除，不接受visibility/source权限更改", async () => {
  mock.rpc.mockResolvedValueOnce({
    data: { ...item, status: "done", version: 2 },
    error: null,
  });
  expect(
    (
      await post({
        operation: "update",
        household,
        id,
        version: 1,
        patch: { status: "done" },
      })
    ).status,
  ).toBe(200);
  expect(mock.rpc).toHaveBeenLastCalledWith(
    "mutate_wealth_action",
    expect.objectContaining({
      expected_version: 1,
      payload: { status: "done" },
    }),
  );
  expect(
    (
      await post({
        operation: "update",
        household,
        id,
        version: 1,
        patch: { visibility: "household" },
      })
    ).status,
  ).toBe(400);
  expect((await post({ operation: "delete", household, id })).status).toBe(400);
  mock.rpc.mockResolvedValueOnce({ data: { id, deleted: true }, error: null });
  expect(
    (await post({ operation: "delete", household, id, version: 2 })).status,
  ).toBe(200);
});
it("冲突、存储失败与无效确认不会伪造成功，内部错误不暴露", async () => {
  const raw = {
    operation: "update",
    household,
    id,
    version: 1,
    patch: { status: "doing" },
  };
  mock.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "action_conflict" },
  });
  expect((await post(raw)).status).toBe(409);
  mock.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "SECRET_DATABASE" },
  });
  const failed = await post(raw);
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain("SECRET_DATABASE");
  mock.rpc.mockResolvedValueOnce({ data: item, error: null });
  expect((await post(raw)).status).toBe(503);
  mock.rpc.mockResolvedValueOnce({
    data: { ...item, version: 2, createdBy: "partner" },
    error: null,
  });
  expect((await post(raw)).status).toBe(503);
  mock.rpc.mockResolvedValueOnce({ data: { deleted: false, id }, error: null });
  expect(
    (await post({ operation: "delete", household, id, version: 1 })).status,
  ).toBe(503);
});
