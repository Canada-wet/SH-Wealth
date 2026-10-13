import { it, expect } from "vitest";
import { loadEnvConfig } from "@next/env";
import { emptyState, saveAsset } from "../lib/wealth";
import { createClient } from "@supabase/supabase-js";
it.skipIf(process.env.RUN_OPENAI_INTEGRATION !== "1")(
  "真实OpenAI：模型调用与结构化回复",
  async () => {
    loadEnvConfig(process.cwd());
    const { POST } = await import("../app/api/advisor/route");
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
      throw new Error("Private integration account login failed");
    const state = saveAsset(emptyState(), {
      id: "fixture",
      name: "测试现金账户",
      category: "现金",
      owner: "joint",
      value: 500,
      annualReturn: null,
    });
    const response = await POST(
      new Request("http://localhost/api/advisor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${login.data.session.access_token}`,
        },
        body: JSON.stringify({
          message: "目前家庭净资产多少？用一句话回答。",
          preference: "openai-fast",
          state,
        }),
      }),
    );
    const data = await response.json();
    expect(response.status, JSON.stringify({ error: data.error })).toBe(200);
    expect(data.route.provider).toBe("openai");
    expect(data.answer).toMatch(/500/);
    expect(data.actions).toEqual([]);
  },
  75000,
);
it.skipIf(process.env.RUN_OPENAI_INTEGRATION !== "1")(
  "真实OpenAI：主动周报使用合成数据、快速模型并保留来源标记",
  async () => {
    loadEnvConfig(process.cwd());
    const { weeklyReview } = await import("../lib/ai/review");
    const state = saveAsset(emptyState(), {
      id: "review-fixture",
      name: "合成现金",
      category: "现金",
      owner: "joint",
      value: 500,
      annualReturn: null,
    });
    const review = await weeklyReview(state);
    expect(review).toContain("AI 周度复盘 · openai");
    expect(review).toMatch(/500/);
    expect(state.assets).toHaveLength(1);
    expect(state.messages).toEqual([]);
  },
  75000,
);
it.skipIf(process.env.RUN_OPENAI_INTEGRATION !== "1")(
  "真实OpenAI：外部渠道只读顾问回答合成快照，资产保持不变",
  async () => {
    loadEnvConfig(process.cwd());
    const { channelAdvice } = await import("../lib/channel-advisor");
    const state = saveAsset(emptyState(), {
      id: "channel-fixture",
      name: "合成现金",
      category: "现金",
      owner: "joint",
      value: 500,
      annualReturn: null,
    });
    state.preferences.model = "openai-fast";
    const original = JSON.stringify(state);
    const answer = await channelAdvice(
      "目前家庭净资产多少？用一句话回答。",
      state,
    );
    expect(answer).toContain("500");
    expect(answer).toContain("只读顾问");
    expect(JSON.stringify(state)).toBe(original);
  },
  75000,
);
