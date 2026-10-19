import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { emptyState } from "../lib/wealth";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({ rpc: mocks.rpc }),
}));
import { cloudWrite, CloudConflictError } from "../lib/cloud";
beforeEach(() => {
  mocks.rpc.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-fixture");
});
afterEach(() => vi.unstubAllEnvs());
it("仅数据库明确的版本拒绝标记为可三向核对的 typed conflict", async () => {
  mocks.rpc.mockResolvedValue({
    error: { code: "P0001", message: "revision conflict" },
  });
  await expect(cloudWrite("h", 7, emptyState())).rejects.toBeInstanceOf(
    CloudConflictError,
  );
});
it("网络或任意 conflict 错误不标记为可自动合并", async () => {
  for (const error of [
    { code: "FETCH_ERROR", message: "revision conflict" },
    { code: "P0001", message: "another conflict" },
    { message: "revision conflict" },
  ]) {
    mocks.rpc.mockResolvedValue({ error });
    const caught = await cloudWrite("h", 7, emptyState()).catch(
      (reason) => reason,
    );
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(CloudConflictError);
  }
});
it("无效云端 ACK 不会被当作已保存的版本", async () => {
  for (const data of [
    null,
    "",
    0,
    -1,
    1.5,
    "not-a-number",
    Number.MAX_SAFE_INTEGER + 1,
    true,
    {},
    [],
    7,
    9,
  ]) {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(cloudWrite("h", 7, emptyState())).rejects.toThrow(
      "云端保存响应无效",
    );
  }
});
it("真实正整数 ACK 正常返回", async () => {
  for (const data of [8, "8"]) {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(cloudWrite("h", 7, emptyState())).resolves.toBe(8);
  }
});
