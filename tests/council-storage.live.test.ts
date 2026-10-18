import { it, expect } from "vitest";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { APP_VERSION } from "../lib/releases";
it.skipIf(process.env.RUN_COUNCIL_READ_INTEGRATION !== "1")(
  "真实存储与线上两位管理员只读核验；不建研讨、不消费每日限额",
  async () => {
    loadEnvConfig(process.cwd());
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
      key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    expect(new URL(url).hostname).toBe("xyfppmqnlmbruimsloqo.supabase.co");
    const app =
      process.env.COUNCIL_VERIFY_URL ?? "https://sh-wealth.vercel.app";
    if (
      !["https://sh-wealth.vercel.app", "http://127.0.0.1:3151"].includes(app)
    )
      throw Error(
        "Only the verified app or owned local test server is permitted",
      );
    const anon = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect(
      (await anon.from("wealth_council_runs").select("id").limit(0)).error,
    ).toBeTruthy();
    const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const [email, passwordKey] of [
      ["henrywhy233@gmail.com", "TEST_MEMBER_ONE_PASSWORD"],
      ["sallyxie0378@gmail.com", "TEST_MEMBER_TWO_PASSWORD"],
    ]) {
      const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const login = await client.auth.signInWithPassword({
        email,
        password: process.env[passwordKey]!,
      });
      expect(login.error?.message ?? null).toBeNull();
      const owner = login.data.user!.id;
      expect(
        (await client.from("wealth_council_runs").select("id").limit(0)).error,
      ).toBeNull();
      const denied = await client.rpc("wealth_council_command", {
        action: "claim",
        target_user: owner,
        run_id: crypto.randomUUID(),
        payload: { claim: crypto.randomUUID() },
      });
      expect(denied.error?.code).toBe("42501");
      const missing = await admin.rpc("wealth_council_command", {
        action: "claim",
        target_user: owner,
        run_id: crypto.randomUUID(),
        payload: { claim: crypto.randomUUID() },
      });
      expect(missing.error?.message).toContain("council_not_found");
      const response = await fetch(app + "/api/council", {
        headers: {
          Authorization: `Bearer ${login.data.session!.access_token}`,
        },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("private");
      const body = await response.json();
      expect(body.storageReady).toBe(true);
      expect(body.models).toHaveLength(16);
      expect(
        body.availability.find(
          (m: { key: string }) => m.key === "deepseek-light",
        )?.ready,
      ).toBe(true);
      const releases = await fetch(app + "/api/releases", {
        headers: {
          Authorization: `Bearer ${login.data.session!.access_token}`,
        },
      });
      expect((await releases.json()).version).toBe(APP_VERSION);
    }
    const unauth = await fetch(app + "/api/council");
    expect(unauth.status).toBe(401);
    const privatePage = await fetch(app + "/council", { redirect: "manual" });
    expect(privatePage.status).toBe(307);
    expect(privatePage.headers.get("location")).toContain("/login");
    const cmap = await fetch(
      app + "/vendor/pdfjs/6.4.299/cmaps/UniGB-UCS2-H.bcmap",
      { redirect: "manual" },
    );
    expect(cmap.status).toBe(200);
    expect(cmap.headers.get("content-type")).not.toContain("text/html");
    expect((await cmap.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  },
  60000,
);
