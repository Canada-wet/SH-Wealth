import { it, expect } from "vitest";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { emptyState, saveAsset } from "../lib/wealth";
it.skipIf(process.env.RUN_VOICE_INTEGRATION !== "1")(
  "真实自然语音：中英文自动识别、神经播报、DeepSeek口语回复与安全修改计划",
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
    const base = process.env.AI_BASE_URL;
    if (base && base !== "https://sh-wealth.vercel.app")
      throw new Error("Known app URL required");
    const { POST: audio } = await import("../app/api/voice/route");
    const { POST: advisor } = await import("../app/api/advisor/route");
    const headers = {
      authorization: `Bearer ${login.data.session.access_token}`,
    };
    const call = async (path: string, body: FormData | string) => {
      const request = new Request(`${base || "http://localhost"}/api/${path}`, {
        method: "POST",
        headers: {
          ...headers,
          ...(typeof body === "string"
            ? { "content-type": "application/json" }
            : {}),
        },
        body,
      });
      return base
        ? fetch(request, { signal: AbortSignal.timeout(65000) })
        : path === "voice"
          ? audio(request)
          : advisor(request);
    };
    try {
      for (const text of [
        "把共同储蓄的本年回报改为负百分之三。",
        "What is the current household net worth?",
      ]) {
        const speech = await call("voice", JSON.stringify({ text }));
        expect(speech.status).toBe(200);
        const bytes = await speech.arrayBuffer();
        expect(bytes.byteLength).toBeGreaterThan(100);
        const form = new FormData();
        form.set(
          "audio",
          new Blob([bytes], { type: "audio/mpeg" }),
          "synthetic.mp3",
        );
        const transcript = await call("voice", form);
        expect(transcript.status).toBe(200);
        const result = await transcript.json();
        expect(result.text.length).toBeGreaterThan(8);
        expect(result.text).toMatch(
          text.startsWith("What") ? /net worth/i : /回报/,
        );
      }
      const state = saveAsset(emptyState(), {
        id: "synthetic",
        name: "共同储蓄",
        category: "现金",
        owner: "joint",
        value: 500,
        annualReturn: 2,
      });
      const response = await call(
        "advisor",
        JSON.stringify({
          message: "把共同储蓄的本年回报改为负百分之三",
          preference: "auto",
          state,
          voice: true,
        }),
      );
      const result = await response.json();
      expect(response.status).toBe(200);
      expect(result.route.provider).toBe("deepseek");
      expect(result.spokenAnswer.length).toBeGreaterThan(5);
      expect(result.spokenAnswer.length).toBeLessThanOrEqual(450);
      expect(result.actions[0].annualReturn).toBe(-3);
      expect(state.assets[0].annualReturn).toBe(2);
    } finally {
      await client.auth.signOut({ scope: "local" });
    }
  },
  150000,
);
