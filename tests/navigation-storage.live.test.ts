import { it, expect } from "vitest";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { validNavEntries } from "../lib/navigation";
it.skipIf(process.env.RUN_NAVIGATION_READ_INTEGRATION !== "1")(
  "生产两位成员的导航读取、本人隔离与匿名拒绝；不修改真实置顶或使用时间",
  async () => {
    loadEnvConfig(process.cwd());
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
      key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    expect(new URL(url).hostname).toBe("xyfppmqnlmbruimsloqo.supabase.co");
    const sessions = [];
    for (const [email, password] of [
      ["henrywhy233@gmail.com", "TEST_MEMBER_ONE_PASSWORD"],
      ["sallyxie0378@gmail.com", "TEST_MEMBER_TWO_PASSWORD"],
    ]) {
      const c = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const login = await c.auth.signInWithPassword({
        email,
        password: process.env[password]!,
      });
      expect(login.error).toBeNull();
      sessions.push({ c, session: login.data.session! });
    }
    for (const [index, { c, session }] of sessions.entries()) {
      const result = await fetch(
        "https://sh-wealth.vercel.app/api/navigation",
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      expect(result.status).toBe(200);
      expect(result.headers.get("cache-control")).toBe("private, no-store");
      const data = await result.json();
      expect(data.userId).toBe(session.user.id);
      expect(validNavEntries(data.entries)).toBe(true);
      // Render the real private home without executing client-side visit effects.
      // Credentials stay in memory; no real navigation preference is changed.
      const encoded =
        "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
      const parts = encoded.match(/.{1,3180}/g)!;
      const cookieName = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
      const cookie = parts
        .map(
          (value, i) =>
            `${cookieName}${parts.length > 1 ? `.${i}` : ""}=${value}`,
        )
        .join("; ");
      const home = await fetch("https://sh-wealth.vercel.app/space", {
        headers: { Cookie: cookie },
        redirect: "manual",
      });
      expect(home.status).toBe(200);
      expect(home.headers.get("cache-control")).toContain("private");
      expect(await home.text()).toContain("把今天，留给真正重要的事。");
      const other = await c
        .from("wealth_navigation_preferences")
        .select("feature_id")
        .eq("user_id", sessions[1 - index].session.user.id);
      expect(other.error).toBeNull();
      expect(other.data).toEqual([]);
    }
    expect(
      (await fetch("https://sh-wealth.vercel.app/api/navigation")).status,
    ).toBe(401);
    const deniedHome = await fetch("https://sh-wealth.vercel.app/space", {
      redirect: "manual",
    });
    expect(deniedHome.status).toBe(307);
    expect(deniedHome.headers.get("location")).toContain("/login");
  },
  60000,
);
