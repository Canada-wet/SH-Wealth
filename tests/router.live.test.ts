import { it, expect } from "vitest";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { emptyState, saveAsset } from "../lib/wealth";
import { applyAssistantActions } from "../lib/advisor-actions";

it.skipIf(process.env.RUN_ROUTER_INTEGRATION !== "1").each([
  {
    question: "目前家庭净资产多少？一句话回答。",
    provider: "deepseek",
    mutation: false,
  },
  {
    question: "把合成测试现金账户余额改为600 CAD，只准备这项修改。",
    provider: "deepseek",
    mutation: true,
  },
  {
    question:
      "只做分析，不执行数据变更。以这份合成快照解释退休规划与情景压力测试需要补充哪些信息，最多三个要点，不给个性化投资建议。",
    provider: "openai",
    mutation: false,
  },
])(
  "生产路由真实调用：$provider / $mutation",
  async ({ question, provider, mutation }) => {
    loadEnvConfig(process.cwd());
    const base = process.env.AI_BASE_URL;
    if (base !== "https://sh-wealth.vercel.app")
      throw new Error(
        "Live routing tests require the known production app URL.",
      );
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
      throw new Error("Private integration login failed");
    try {
      const state = saveAsset(emptyState(), {
        id: "synthetic-route",
        name: "合成测试现金账户",
        value: 500,
        owner: "joint",
        category: "现金",
        annualReturn: null,
      });
      const response = await fetch(base + "/api/advisor", {
        method: "POST",
        signal: AbortSignal.timeout(70000),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${login.data.session.access_token}`,
        },
        body: JSON.stringify({ message: question, preference: "auto", state }),
      });
      const result = await response.json();
      expect(response.status, result.error || "model response failed").toBe(
        200,
      );
      expect(result.route.provider).toBe(provider);
      expect(result.answer.length).toBeGreaterThan(0);
      if (mutation)
        expect(
          applyAssistantActions(state, result.actions).assets[0].value,
        ).toBe(600);
      else expect(result.actions).toEqual([]);
      expect(state.assets[0].value).toBe(500); // No real or synthetic DB document is written.
    } finally {
      await client.auth.signOut({ scope: "local" });
    }
  },
  75000,
);
