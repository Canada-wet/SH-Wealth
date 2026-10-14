import { it, expect } from "vitest";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { emptyState, saveAsset } from "../lib/wealth";
it.skipIf(process.env.RUN_SEARCH_INTEGRATION !== "1")(
  "真实联网：公共央行主题实际搜索，官方引用与检索时间可回看",
  async () => {
    loadEnvConfig(process.cwd());
    const { webResearch, researchMarkdown } = await import("../lib/web-search");
    const result = await webResearch("查询今天加拿大央行政策利率");
    expect(result.status).toBe("searched");
    expect(result.sources.length).toBeGreaterThan(0);
    expect(
      result.sources.some((source) =>
        new URL(source.url).hostname.endsWith("bankofcanada.ca"),
      ),
    ).toBe(true);
    expect(Number.isNaN(Date.parse(result.checkedAt!))).toBe(false);
    expect(researchMarkdown(result)).toContain("https://");
  },
  30000,
);
it.skipIf(process.env.RUN_SEARCH_INTEGRATION !== "1")(
  "真实联网顾问：沿用账号限流，DeepSeek解读，引用完整且不修改合成账本",
  async () => {
    loadEnvConfig(process.cwd());
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const login = await client.auth.signInWithPassword({
      email: "henrywhy233@gmail.com",
      password: process.env.TEST_MEMBER_ONE_PASSWORD!,
    });
    if (login.error || !login.data.session)
      throw new Error("Integration login failed");
    try {
      const { POST } = await import("../app/api/advisor/route");
      const state = saveAsset(emptyState(), {
        id: "synthetic-search",
        name: "合成测试现金",
        category: "现金",
        value: 500,
        owner: "joint",
        annualReturn: null,
      });
      const base = process.env.AI_BASE_URL;
      if (base && base !== "https://sh-wealth.vercel.app")
        throw new Error("Live test requires the known app URL");
      const request = new Request(`${base || "http://localhost"}/api/advisor`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${login.data.session.access_token}`,
        },
        body: JSON.stringify({
          message:
            "查最新央行政策利率，简短解读对日常现金储蓄的影响，不要修改任何数据。",
          preference: "auto",
          state,
        }),
      });
      const response = base
        ? await fetch(request, { signal: AbortSignal.timeout(58000) })
        : await POST(request);
      const result = await response.json();
      expect(response.status).toBe(200);
      expect(result.web.status).toBe("searched");
      expect(result.route.provider).toBe("deepseek");
      expect(result.answer).toContain("检索时间");
      expect(result.actions).toEqual([]);
      expect(state.assets[0].value).toBe(500);
    } finally {
      await client.auth.signOut({ scope: "local" });
    }
  },
  60000,
);
