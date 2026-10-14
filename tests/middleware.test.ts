import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
const fixture = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: fixture.user } }),
}));
import { middleware } from "../middleware";
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture");
  fixture.user.mockResolvedValue({ data: { user: null } });
});
it("匿名请求页面跳转登录，但恢复入口保持可访问", async () => {
  const result = await middleware(new NextRequest("https://example.test/"));
  expect(result.status).toBe(307);
  expect(result.headers.get("location")).toContain("/login");
  for (const path of ["/login", "/auth/reset-password", "/api/advisor/digest"])
    expect(
      (await middleware(new NextRequest(`https://example.test${path}`))).status,
    ).toBe(200);
});
it("登录跳转保留原页面的查询参数", async () => {
  const response = await middleware(
    new NextRequest("https://example.test/markets?view=quotes"),
  );
  expect(
    new URL(response.headers.get("location")!).searchParams.get("next"),
  ).toBe("/markets?view=quotes");
});
it("服务端只接受已验证的允许账号，不接受其他账号或未确认邮箱", async () => {
  for (const [email, confirmed, status] of [
    ["henrywhy233@gmail.com", true, 200],
    ["sallyxie0378@gmail.com", true, 200],
    ["other@gmail.com", true, 307],
    ["henrywhy233@gmail.com", false, 307],
  ] as const) {
    fixture.user.mockResolvedValueOnce({
      data: {
        user: { email, email_confirmed_at: confirmed ? "2026-01-01" : null },
      },
    });
    expect(
      (await middleware(new NextRequest("https://example.test/"))).status,
    ).toBe(status);
  }
});
