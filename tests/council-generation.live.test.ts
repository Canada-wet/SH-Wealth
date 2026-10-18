import { it, expect } from "vitest";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
it.skipIf(process.env.RUN_COUNCIL_GENERATION_INTEGRATION !== "1")(
  "线上 Qwen Flash / Max 与 GLM 各一次固定公开生成自检；不读取私人上下文或研讨额度",
  async () => {
    loadEnvConfig(process.cwd());
    const app = "https://sh-wealth.vercel.app";
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const login = await client.auth.signInWithPassword({
      email: "henrywhy233@gmail.com",
      password: process.env.TEST_MEMBER_ONE_PASSWORD!,
    });
    expect(login.error).toBeNull();
    const selected = process.env.COUNCIL_TEST_MODELS?.split(",") ?? [
      "qwen-light",
      "qwen-flagship",
      "glm-flagship",
    ];
    expect(
      selected.every((key) =>
        ["qwen-light", "qwen-flagship", "glm-flagship"].includes(key),
      ),
    ).toBe(true);
    for (const modelKey of selected) {
      const response = await fetch(app + "/api/council", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: app,
          Authorization: `Bearer ${login.data.session!.access_token}`,
        },
        body: JSON.stringify({
          action: "check-model",
          modelKey,
          consent: true,
        }),
        signal: AbortSignal.timeout(290000),
      });
      const body = await response.json();
      expect(body.error || null, modelKey).toBeNull();
      expect(body.check.ok, modelKey).toBe(true);
      if (body.check.usage.output !== null)
        expect(body.check.usage.output, modelKey).toBeGreaterThan(0);
    }
  },
  880000,
);
