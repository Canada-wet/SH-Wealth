import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
test("两位成员通过页面登录、共享家庭、同步编辑并在重开后恢复", async ({
  page,
  browser,
}) => {
  test.skip(
    process.env.RUN_SUPABASE_E2E !== "1",
    "真实Supabase UI测试单独启用",
  );
  test.setTimeout(60000);
  loadEnvConfig(process.cwd());
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const fixtures: { id: string; email: string; password: string }[] = [];
  let householdId = "";
  const partnerContext = await browser.newContext();
  const partner = await partnerContext.newPage();
  const account = async () => {
    const email = `together-ui-test-${crypto.randomUUID()}@example.com`;
    const password = crypto.randomUUID() + "Aa1!";
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    const fixture = { id: data.user.id, email, password };
    fixtures.push(fixture);
    return fixture;
  };
  const login = async (
    target: Page,
    fixture: { email: string; password: string },
  ) => {
    target.on("dialog", (dialog) => dialog.accept());
    await target.goto("/");
    await target
      .getByRole("button", { name: "备份与同步", exact: true })
      .click();
    const dialog = target.getByRole("dialog");
    await dialog.getByLabel("邮箱", { exact: true }).fill(fixture.email);
    await dialog.getByLabel("密码", { exact: true }).fill(fixture.password);
    await dialog.getByRole("button", { name: "登录", exact: true }).click();
    await expect(dialog).toContainText("已登录");
  };
  try {
    const first = await account();
    const second = await account();
    await login(page, first);
    let dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "新建家庭", exact: true }).click();
    await expect(dialog).toContainText("家庭空间已创建");
    householdId = await dialog.getByLabel("选择家庭").inputValue();
    await dialog
      .getByRole("button", { name: "上传本机数据", exact: true })
      .click();
    await expect(dialog).toContainText("本机数据已上传");
    await dialog
      .getByRole("button", { name: "显示邀请代码", exact: true })
      .click();
    const invite = await dialog.locator(".invite-code code").innerText();
    await dialog.getByRole("button", { name: "关闭弹窗" }).click();
    await page.getByRole("button", { name: "添加资产", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("资产名称").fill("共享测试储蓄");
    await dialog.getByLabel("当前价值（CAD）").fill("500");
    await dialog.getByRole("button", { name: "保存资产" }).click();
    await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
    await login(partner, second);
    dialog = partner.getByRole("dialog");
    await dialog.getByLabel("伴侣邀请代码").fill(invite);
    await dialog.getByRole("button", { name: "加入家庭", exact: true }).click();
    await expect(dialog).toContainText("已加入家庭空间");
    await dialog
      .getByRole("button", { name: "加载云端数据", exact: true })
      .click();
    await expect(dialog).toContainText("云端家庭已连接");
    await dialog.getByRole("button", { name: "关闭弹窗" }).click();
    await expect(partner.getByTestId("net-worth")).toHaveText("$500.00");
    await partner
      .getByRole("button", { name: "编辑共享测试储蓄本年回报" })
      .click();
    dialog = partner.getByRole("dialog");
    await dialog.getByLabel("本年回报（%）").fill("-4.5");
    await dialog.getByRole("button", { name: "保存资产" }).click();
    await expect(partner.locator(".save-status")).toContainText(
      "已同步 Supabase",
    );
    await page.bringToFront();
    await expect(
      page.getByRole("button", { name: "编辑共享测试储蓄本年回报" }),
    ).toContainText("-4.5%");
    await partner.reload();
    await expect(partner.getByTestId("net-worth")).toHaveText("$500.00");
    await expect(partner.locator(".save-status")).toContainText(
      "已同步 Supabase",
    );
    await expect(
      partner.getByRole("button", { name: "编辑共享测试储蓄本年回报" }),
    ).toContainText("-4.5%");
  } finally {
    await partnerContext.close();
    if (householdId) {
      const deleted = await admin
        .from("households")
        .delete()
        .eq("id", householdId);
      if (deleted.error) throw deleted.error;
    }
    for (const fixture of fixtures) {
      const removed = await admin.auth.admin.deleteUser(fixture.id);
      if (removed.error) throw removed.error;
    }
  }
});
