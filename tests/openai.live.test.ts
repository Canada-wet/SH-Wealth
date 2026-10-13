import { it, expect } from "vitest";
import { loadEnvConfig } from "@next/env";
import { emptyState, saveAsset } from "../lib/wealth";
it.skipIf(process.env.RUN_OPENAI_INTEGRATION !== "1")(
  "真实OpenAI：模型调用与结构化回复",
  async () => {
    loadEnvConfig(process.cwd());
    const { POST } = await import("../app/api/advisor/route");
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
        headers: { "Content-Type": "application/json" },
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
