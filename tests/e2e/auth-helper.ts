import { expect, type Page } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import type { WealthState } from "../../lib/wealth";
const fixtures = new Map<
  Page,
  { id: string; url: string; key: string; token: string; mock: boolean }
>();
const created = new Map<string, string>();
export async function authenticate(
  page: Page,
  options: { email?: string; householdId?: string; seed?: WealthState } = {},
) {
  loadEnvConfig(process.cwd());
  const mock = process.env.E2E_USE_MOCK_AUTH === "1";
  const url = mock
    ? "http://127.0.0.1:3102"
    : process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = mock
    ? "offline-test-anon-key"
    : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const email = options.email ?? "henrywhy233@gmail.com";
  const password = mock
    ? "offline-test-password"
    : process.env[
        email === "henrywhy233@gmail.com"
          ? "TEST_MEMBER_ONE_PASSWORD"
          : "TEST_MEMBER_TWO_PASSWORD"
      ];
  if (!password)
    throw new Error(
      "Private browser tests require ignored local test credentials.",
    );
  const login = await page.request.post(
    url + "/auth/v1/token?grant_type=password",
    { headers: { apikey: key }, data: { email, password } },
  );
  expect(login.status(), "Fixture authentication failed").toBe(200);
  const session = await login.json();
  const headers = {
    apikey: key,
    Authorization: "Bearer " + session.access_token,
  };
  let home = options.householdId;
  if (home) {
    const invite = created.get(home);
    if (!invite)
      throw new Error(
        "Refusing to use a non-fixture household in browser tests.",
      );
    const join = await page.request.post(
      url + "/rest/v1/rpc/join_wealth_household",
      {
        headers,
        data: { invite_token: invite, display_name: "Fixture partner" },
      },
    );
    expect(join.ok()).toBe(true);
  } else {
    const result = await page.request.post(
      url + "/rest/v1/rpc/create_wealth_household",
      { headers, data: { display_name: "Browser test fixture" } },
    );
    expect(result.ok()).toBe(true);
    home = await result.json();
    const invite = await page.request.post(
      url + "/rest/v1/rpc/household_invite_token",
      { headers, data: { target_household: home } },
    );
    expect(invite.ok()).toBe(true);
    created.set(home!, await invite.json());
    fixtures.set(page, {
      id: home!,
      url,
      key,
      token: session.access_token,
      mock,
    });
  }
  if (options.seed && !options.householdId) {
    const save = await page.request.post(
      url + "/rest/v1/rpc/save_household_document",
      {
        headers,
        data: {
          target_household: home,
          expected_revision: 0,
          next_document: options.seed,
        },
      },
    );
    expect(save.ok()).toBe(true);
  }
  const row = await page.request.get(
    url +
      "/rest/v1/household_documents?select=revision,document&household_id=eq." +
      home,
    { headers: { ...headers, Accept: "application/vnd.pgrst.object+json" } },
  );
  expect(row.ok()).toBe(true);
  const remote = await row.json();
  await page.addInitScript(
    ({ householdId, userId, revision, seed }) => {
      if (seed && !localStorage.getItem("together-wealth-v3"))
        localStorage.setItem("together-wealth-v3", JSON.stringify(seed));
      if (!localStorage.getItem("together-cloud-link"))
        localStorage.setItem(
          "together-cloud-link",
          JSON.stringify({
            householdId,
            userId,
            remoteRevision: revision,
            localRevision: seed?.revision ?? 0,
          }),
        );
    },
    {
      householdId: home!,
      userId: session.user.id,
      revision: remote.revision,
      seed: options.seed ?? remote.document,
    },
  );
  const encoded =
    "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const name = "sb-" + new URL(url).hostname.split(".")[0] + "-auth-token";
  const origin = new URL(process.env.E2E_BASE_URL || "http://127.0.0.1:3101");
  const parts = encoded.match(/.{1,3180}/g)!;
  await page
    .context()
    .addCookies(
      parts.map((value, index) => ({
        name: parts.length === 1 ? name : name + "." + index,
        value,
        domain: origin.hostname,
        path: "/",
        sameSite: "Lax" as const,
        secure: origin.protocol === "https:",
      })),
    );
  return home!;
}
export async function cleanupAuthenticated(page: Page) {
  const fixture = fixtures.get(page);
  if (!fixture) return;
  if (!created.has(fixture.id))
    throw new Error("Cleanup target is not a generated test fixture.");
  const key = fixture.mock
    ? fixture.key
    : process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const result = await page.request.delete(
    fixture.url + "/rest/v1/households?id=eq." + fixture.id,
    { headers: { apikey: key, Authorization: "Bearer " + key } },
  );
  expect(result.ok(), "Fixture cleanup failed").toBe(true);
  created.delete(fixture.id);
  fixtures.delete(page);
}
