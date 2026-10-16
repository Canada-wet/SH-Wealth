import { expect, it, vi } from "vitest";
import {
  validResearchArchive,
  safeResearchUrl,
  researchDisplayText,
} from "../lib/research-archive";
const mock = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("../lib/server-auth", () => ({ authorizeRequest: mock.auth }));
import { GET } from "../app/api/market/research-archive/route";
export const archiveFixture = {
  id: "00000000-0000-4000-8000-000000000001",
  source: "funda",
  source_url: "https://funda.ai/agent-chat?c=synthetic-fixture",
  captured_at: "2026-10-16T03:30:00Z",
  prompt: "公开市场测试",
  response: "**合成研究记录**，不是实际行情。",
  citations: [
    {
      title: "官方来源",
      url: "https://www.bea.gov/data/gdp/gross-domestic-product",
    },
  ],
  status: "complete",
  verification: "ai-unverified",
};
const household = "00000000-0000-4000-8000-000000000011";
const request = () =>
  new Request(
    `https://app.test/api/market/research-archive?household=${household}`,
  );
it("校验来源、日期、大小、引用链接，不能将AI回答伪装为核实行情", () => {
  expect(validResearchArchive(archiveFixture)).toBe(true);
  for (const patch of [
    { verification: "verified" },
    { source_url: "https://evil.test" },
    { captured_at: "bad" },
    { response: "a".repeat(50001) },
    { citations: [{ title: "bad", url: "javascript:alert(1)" }] },
  ])
    expect(validResearchArchive({ ...archiveFixture, ...patch })).toBe(false);
  expect(safeResearchUrl("https://user:password@example.com")).toBe(false);
  expect(
    researchDisplayText(
      '<reference url="https://www.bea.gov/">BEA</reference>',
    ),
  ).toBe(" [BEA](<https://www.bea.gov/>)");
  expect(
    researchDisplayText(
      '<reference url="javascript:alert(1)">恶意</reference>',
    ),
  ).toBe(" 恶意");
});
it("先验证登录与家庭权限，不为匿名或其他家庭读取研究", async () => {
  vi.clearAllMocks();
  mock.auth.mockResolvedValueOnce({ status: 401, error: "请先登录" });
  expect((await GET(request())).status).toBe(401);
  mock.auth.mockResolvedValue({
    status: 200,
    client: { rpc: mock.rpc, from: mock.from },
  });
  expect(
    (
      await GET(
        new Request(
          "https://app.test/api/market/research-archive?household=bad",
        ),
      )
    ).status,
  ).toBe(400);
  mock.rpc.mockResolvedValue({ data: false });
  expect((await GET(request())).status).toBe(403);
  expect(mock.from).not.toHaveBeenCalled();
});
it("读取只限指定家庭；禁用缓存；数据库失败和异常数据不泄漏细节", async () => {
  vi.clearAllMocks();
  mock.auth.mockResolvedValue({
    status: 200,
    client: { rpc: mock.rpc, from: mock.from },
  });
  mock.rpc.mockResolvedValue({ data: true });
  let result: { data: unknown[] | null; error: unknown } = {
    data: [archiveFixture],
    error: null,
  };
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(async () => result),
  };
  mock.from.mockReturnValue(chain);
  const r = await GET(request());
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(chain.eq).toHaveBeenCalledWith("household_id", household);
  expect(chain.limit).toHaveBeenCalledWith(90);
  expect(await r.json()).toEqual({ reports: [archiveFixture] });
  result = { data: null, error: { message: "secret-db" } };
  expect(await (await GET(request())).text()).not.toContain("secret-db");
  result = {
    data: [{ ...archiveFixture, verification: "verified" }],
    error: null,
  };
  expect((await GET(request())).status).toBe(503);
});
