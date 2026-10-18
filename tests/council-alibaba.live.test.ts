import { it, expect } from "vitest";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
it.skipIf(process.env.RUN_COUNCIL_ALIBABA_INTEGRATION !== "1")(
  "线上百炼 Sensitive key 仅在服务端使用：可用映射与只读目录检查",
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
    expect(login.error?.message ?? null).toBeNull();
    const headers = {
      Authorization: `Bearer ${login.data.session!.access_token}`,
    };
    const response = await fetch("https://sh-wealth.vercel.app/api/council", {
      headers,
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    for (const [key, model] of [
      ["qwen-light", "qwen3.8-flash"],
      ["moonshot-flagship", "kimi-k3"],
      ["glm-flagship", "ZHIPU/GLM-5.3"],
    ]) {
      const a = data.availability.find((a: { key: string }) => a.key === key);
      expect(a?.ready).toBe(true);
      expect(a?.connection).toMatchObject({ channel: "alibaba", model });
    }
    const checked = await fetch("https://sh-wealth.vercel.app/api/council", {
      method: "POST",
      headers: {
        ...headers,
        Origin: "https://sh-wealth.vercel.app",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "check-alibaba" }),
    });
    expect(checked.status).toBe(200);
    const body = await checked.json();
    // Only our bounded/sanitized message is surfaced if the upstream cannot be verified.
    expect(
      body.check?.ok,
      body.check?.message ?? "Connection check missing",
    ).toBe(true);
    console.info(
      JSON.stringify({
        catalogueVerified: true,
        mappedModels: body.check.modelKeys,
      }),
    );
  },
  60000,
);
