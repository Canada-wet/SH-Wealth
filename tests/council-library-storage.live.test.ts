import { it, expect } from "vitest";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { validCouncilLibraryItems } from "../lib/council-library";
it.skipIf(process.env.RUN_COUNCIL_LIBRARY_READ_INTEGRATION !== "1")(
  "生产双账号研讨整理只读隔离、版本与匿名拒绝；不写研讨/笔记/配额/财富，不调用模型",
  async () => {
    loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
      key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    expect(new URL(url).hostname === "xyfppmqnlmbruimsloqo.supabase.co").toBe(
      true,
    );
    const origin = "https://sh-wealth.vercel.app",
      seen = new Set<string>();
    const options = {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    };
    for (const [email, varName] of [
      ["henrywhy233@gmail.com", "TEST_MEMBER_ONE_PASSWORD"],
      ["sallyxie0378@gmail.com", "TEST_MEMBER_TWO_PASSWORD"],
    ]) {
      const client = createClient(url, key, options),
        login = await client.auth.signInWithPassword({
          email,
          password: process.env[varName]!,
        });
      expect(login.error?.code ?? null).toBeNull();
      expect(!!login.data.session).toBe(true);
      const session = login.data.session!;
      const list = await client.rpc("read_wealth_council_library", {
        search_text: "",
      });
      expect(list.error?.code ?? null).toBeNull();
      expect(validCouncilLibraryItems(list.data)).toBe(true);
      // Only booleans/error codes are asserted: a failing diff cannot print private bodies.
      for (const row of list.data) {
        expect(!seen.has(row.id)).toBe(true);
        seen.add(row.id);
      }
      const other = await client
        .from("wealth_council_library")
        .select("run_id")
        .neq("user_id", session.user.id);
      expect(other.error?.code ?? null).toBeNull();
      expect(other.data?.length === 0).toBe(true);
      const headers = {
        Authorization: `Bearer ${session.access_token}`,
        Origin: origin,
        "Content-Type": "application/json",
      };
      const response = await fetch(origin + "/api/council/library", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "search", query: "" }),
        signal: AbortSignal.timeout(20000),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const body = await response.json();
      expect(body.userId === session.user.id).toBe(true);
      expect(validCouncilLibraryItems(body.items)).toBe(true);
      const version = await fetch(origin + "/api/releases", {
        headers: { Authorization: headers.Authorization },
        signal: AbortSignal.timeout(20000),
      });
      expect(version.status).toBe(200);
      const release = await version.json();
      expect(release.version).toBe("0.12.0");
      expect(release.role).toBe("admin");
    }
    const anon = await createClient(url, key, options).rpc(
      "read_wealth_council_library",
      { search_text: "" },
    );
    expect(anon.error?.code).toBe("42501");
    const denied = await fetch(origin + "/api/council/library", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "search", query: "" }),
    });
    expect(denied.status).toBe(401);
  },
  60000,
);
