import { expect, type Page } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
export async function authenticate(page: Page) {
  loadEnvConfig(process.cwd());
  const mock = process.env.E2E_USE_MOCK_AUTH === "1";
  const url = mock
    ? "http://127.0.0.1:3102"
    : process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = mock
    ? "offline-test-anon-key"
    : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const password = mock
    ? "offline-test-password"
    : process.env.TEST_MEMBER_ONE_PASSWORD;
  if (!password)
    throw new Error(
      "Private browser tests require TEST_MEMBER_ONE_PASSWORD; never commit credentials.",
    );
  const response = await page.request.post(
    `${url}/auth/v1/token?grant_type=password`,
    {
      headers: { apikey: key },
      data: { email: "henrywhy233@gmail.com", password },
    },
  );
  expect(response.status(), "Fixture authentication failed").toBe(200);
  const session = await response.json();
  const encoded =
    "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const name = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const origin = new URL(process.env.E2E_BASE_URL || "http://127.0.0.1:3101");
  const parts = encoded.match(/.{1,3180}/g)!;
  await page
    .context()
    .addCookies(
      parts.map((value, index) => ({
        name: parts.length === 1 ? name : `${name}.${index}`,
        value,
        domain: origin.hostname,
        path: "/",
        sameSite: "Lax" as const,
        secure: origin.protocol === "https:",
      })),
    );
}
