import { expect, it } from "vitest";
import { loadEnvConfig } from "@next/env";
import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { validActionId, validActionItems } from "../lib/action-center";

it.skipIf(process.env.RUN_ACTIONS_READ_INTEGRATION !== "1")(
  "生产双账号行动只读验证：已有共同家庭、受限列、匿名拒绝与私密SSR；不写行动或财富",
  async () => {
    // Credentials live only in this opt-in process. Never print env, sessions,
    // action bodies, household documents, Supabase errors, or response bodies.
    loadEnvConfig(process.cwd(), false, { info: () => {}, error: () => {} });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(
      Boolean(url && key),
      "Read-only integration configuration exists",
    ).toBe(true);
    let databaseTarget = false;
    try {
      const target = new URL(url!);
      databaseTarget =
        target.protocol === "https:" &&
        target.hostname === "xyfppmqnlmbruimsloqo.supabase.co" &&
        !target.port &&
        !target.username &&
        !target.password &&
        target.pathname === "/" &&
        !target.search &&
        !target.hash;
    } catch {}
    expect(databaseTarget, "Exact production Supabase target guard").toBe(true);
    const app = process.env.ACTIONS_BASE_URL ?? "https://sh-wealth.vercel.app";
    let applicationTarget = false;
    try {
      const target = new URL(app);
      applicationTarget =
        target.protocol === "https:" &&
        !target.port &&
        !target.username &&
        !target.password &&
        target.pathname === "/" &&
        !target.search &&
        !target.hash &&
        (target.hostname === "sh-wealth.vercel.app" ||
          /^sh-wealth-[a-z0-9]+-henrywhy233-8756s-projects\.vercel\.app$/.test(
            target.hostname,
          ));
    } catch {}
    expect(
      applicationTarget,
      "Only the canonical app or this project's deployment URL is allowed",
    ).toBe(true);
    const appOrigin = new URL(app).origin;
    const options = {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    };
    const members: {
      client: SupabaseClient;
      session: Session;
      homes: string[];
    }[] = [];
    for (const [email, passwordName] of [
      ["henrywhy233@gmail.com", "TEST_MEMBER_ONE_PASSWORD"],
      ["sallyxie0378@gmail.com", "TEST_MEMBER_TWO_PASSWORD"],
    ]) {
      const password = process.env[passwordName];
      expect(
        Boolean(password),
        "Member test password is present in memory",
      ).toBe(true);
      const client = createClient(url!, key!, options);
      const login = await client.auth.signInWithPassword({
        email,
        password: password!,
      });
      expect(
        login.error?.code ?? null,
        "Member authentication error code",
      ).toBeNull();
      expect(
        Boolean(login.data.session),
        "Member authentication has a session",
      ).toBe(true);
      const session = login.data.session!;
      // persistence.sql names this relation household_members. Read only IDs;
      // do not call ensure/create/join, or read household_documents.document.
      const membership = await client
        .from("household_members")
        .select("household_id")
        .eq("user_id", session.user.id);
      expect(
        membership.error?.code ?? null,
        "Membership read error code",
      ).toBeNull();
      const ids = membership.data?.map((row) => row.household_id) ?? [];
      expect(
        ids.every(validActionId),
        "Membership IDs have the expected shape",
      ).toBe(true);
      members.push({ client, session, homes: ids });
    }
    const common = [...new Set(members[0].homes)].filter((home) =>
      members[1].homes.includes(home),
    );
    expect(
      common.length === 1,
      "Exactly one existing common household is unambiguous",
    ).toBe(true);
    const household = common[0];
    const http = (path: string, headers: Record<string, string> = {}) =>
      fetch(appOrigin + path, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      });
    for (const [index, { client, session }] of members.entries()) {
      const listed = await client.rpc("list_wealth_actions", {
        target_household: household,
      });
      expect(
        listed.error?.code ?? null,
        "Action list read error code",
      ).toBeNull();
      // Assert only the validation boolean, never an action object in a diff.
      expect(validActionItems(listed.data), "Visible action list schema").toBe(
        true,
      );
      const outside = await client.rpc("list_wealth_actions", {
        target_household: crypto.randomUUID(),
      });
      expect(
        outside.error?.code ?? null,
        "Unjoined random household is denied",
      ).toBe("P0001");
      const harmless = await client
        .from("wealth_action_items")
        .select("id")
        .limit(0);
      expect(
        harmless.error?.code ?? null,
        "Allowed column read error code",
      ).toBeNull();
      expect(
        harmless.data?.length === 0,
        "Zero-row column check returned no private records",
      ).toBe(true);
      const source = await client
        .from("wealth_action_items")
        .select("source_ref")
        .limit(0);
      expect(
        source.error?.code ?? null,
        "Raw source reference column is not granted",
      ).toBe("42501");
      const creator = await client
        .from("wealth_action_items")
        .select("created_by")
        .eq("created_by", members[1 - index].session.user.id)
        .limit(0);
      expect(
        creator.error?.code ?? null,
        "Partner creator column is not granted",
      ).toBe("42501");

      const response = await http(
        `/api/actions?household=${encodeURIComponent(household)}`,
        { Authorization: `Bearer ${session.access_token}` },
      );
      expect(response.status, "Authenticated read-only action API status").toBe(
        200,
      );
      const caching = response.headers.get("cache-control") ?? "";
      expect(
        caching.includes("private") &&
          caching.includes("no-store") &&
          !/public|s-maxage/i.test(caching),
        "Action API has no shared cache",
      ).toBe(true);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw Error("Action API did not return valid JSON; response omitted.");
      }
      expect(
        Boolean(
          body &&
          typeof body === "object" &&
          validActionItems((body as { items?: unknown }).items),
        ),
        "Action API visible item schema",
      ).toBe(true);

      const encoded =
        "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
      const parts = encoded.match(/.{1,3180}/g)!;
      const cookieName = `sb-${new URL(url!).hostname.split(".")[0]}-auth-token`;
      const cookie = parts
        .map(
          (value, part) =>
            `${cookieName}${parts.length > 1 ? `.${part}` : ""}=${value}`,
        )
        .join("; ");
      // Plain HTTP SSR read: no browser/client JS, navigation visits, hydration,
      // action list effects, backup export, model calls, or mutation RPCs run.
      const page = await http("/space", { Cookie: cookie });
      expect(page.status, "Authenticated private home SSR status").toBe(200);
      const pageCache = page.headers.get("cache-control") ?? "";
      expect(
        pageCache.includes("private") &&
          pageCache.includes("no-store") &&
          !/public|s-maxage/i.test(pageCache),
        "Private SSR has no shared cache",
      ).toBe(true);
      const html = await page.text();
      expect(
        html.includes("统一行动中心") &&
          html.includes("把想清楚的事，做下去。"),
        "SSR includes the action-center shell without running its client effects",
      ).toBe(true);
    }
    const anonymous = createClient(url!, key!, options);
    const denied = await anonymous.rpc("list_wealth_actions", {
      target_household: household,
    });
    expect(
      denied.error?.code ?? null,
      "Anonymous action RPC is not granted",
    ).toBe("42501");
    expect(
      (await http(`/api/actions?household=${encodeURIComponent(household)}`))
        .status,
      "Anonymous action API status",
    ).toBe(401);
    const deniedPage = await http("/space");
    expect(deniedPage.status, "Anonymous private page redirects").toBe(307);
    expect(
      (deniedPage.headers.get("location") ?? "").includes("/login"),
      "Anonymous redirect target is the login page",
    ).toBe(true);
  },
  120000,
);
