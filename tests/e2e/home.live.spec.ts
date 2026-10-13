import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { money, totals } from "../../lib/wealth";
import { allChats } from "../../lib/conversations";
test("全新浏览器登录两位账号自动读取同一家庭，验证不改写真实数据", async ({
  browser,
}) => {
  test.skip(
    process.env.RUN_SUPABASE_E2E !== "1",
    "Read-only private cloud check is opt-in",
  );
  test.setTimeout(60000);
  loadEnvConfig(process.cwd());
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const first = await client.auth.signInWithPassword({
    email: "henrywhy233@gmail.com",
    password: process.env.TEST_MEMBER_ONE_PASSWORD!,
  });
  if (first.error) throw first.error;
  const home = await client.rpc("ensure_shared_wealth_household");
  if (home.error) throw home.error;
  const initial = await client
    .from("household_documents")
    .select("revision,document")
    .eq("household_id", home.data)
    .single();
  if (initial.error) throw initial.error;
  for (const [email, passwordKey] of [
    ["henrywhy233@gmail.com", "TEST_MEMBER_ONE_PASSWORD"],
    ["sallyxie0378@gmail.com", "TEST_MEMBER_TWO_PASSWORD"],
  ]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(
        (process.env.E2E_BASE_URL || "http://127.0.0.1:3101") + "/login",
      );
      await page.getByLabel("邮箱", { exact: true }).fill(email);
      await page
        .getByLabel("密码", { exact: true })
        .fill(process.env[passwordKey]!);
      await page.getByRole("button", { name: "登录家庭空间" }).click();
      await expect(page.getByTestId("net-worth")).toHaveText(
        money(totals(initial.data.document).netWorth),
      );
      await expect(page.locator(".save-status")).toContainText(
        "已同步 Supabase",
      );
      await page.getByRole("button", { name: "打开财富顾问" }).click();
      await page.getByRole("button", { name: "查看聊天历史" }).click();
      await expect(page.locator(".advisor-history-item")).toHaveCount(
        allChats(initial.data.document).length,
      );
    } finally {
      await context.close();
    }
  }
  const after = await client
    .from("household_documents")
    .select("revision,document")
    .eq("household_id", home.data)
    .single();
  expect(after.data).toEqual(initial.data);
  await client.auth.signOut({ scope: "local" });
});
