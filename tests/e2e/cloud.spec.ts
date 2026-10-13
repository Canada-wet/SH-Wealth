import { test, expect } from "@playwright/test";
import { emptyState, saveAsset } from "../../lib/wealth";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
test("双成员自动恢复、资产与聊天跨设备同步，刷新后继续旧对话", async ({
  page,
  browser,
}) => {
  test.skip(process.env.RUN_SUPABASE_E2E !== "1", "Live cloud test is opt-in");
  test.setTimeout(60000);
  const state = saveAsset(emptyState(), {
    id: "fixture",
    name: "共享测试储蓄",
    owner: "joint",
    category: "现金",
    value: 500,
    annualReturn: 2,
  });
  state.preferences.model = "local";
  state.messages = [
    { id: "old-user", role: "user", text: "家庭现金安排" },
    { id: "old-answer", role: "assistant", text: "这是已保存的历史讨论。" },
  ];
  const home = await authenticate(page, { seed: state });
  const partnerContext = await browser.newContext();
  const partner = await partnerContext.newPage();
  try {
    await authenticate(partner, {
      email: "sallyxie0378@gmail.com",
      householdId: home,
    });
    await page.goto("/");
    await partner.goto("/");
    await expect(page.getByTestId("net-worth")).toHaveText("$500.00");
    await expect(partner.locator(".save-status")).toContainText(
      "已同步 Supabase",
    );
    await partner
      .getByRole("button", { name: "编辑共享测试储蓄本年回报" })
      .click();
    await partner.getByRole("dialog").getByLabel("本年回报（%）").fill("-4.5");
    await partner.getByRole("button", { name: "保存资产" }).click();
    await expect(partner.locator(".save-status")).toContainText(
      "已同步 Supabase",
    );
    await page.bringToFront();
    await expect(
      page.getByRole("button", { name: "编辑共享测试储蓄本年回报" }),
    ).toContainText("-4.5%");
    await page.getByRole("button", { name: "打开财富顾问" }).click();
    await expect(page.locator(".advisor-messages")).toContainText(
      "已保存的历史讨论",
    );
    await page.getByRole("button", { name: "新建对话" }).click();
    await page.getByLabel("顾问消息").fill("目前净资产多少");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.locator(".advisor-messages")).toContainText("500");
    await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
    await partner.reload();
    await partner.getByRole("button", { name: "打开财富顾问" }).click();
    await partner.getByRole("button", { name: "查看聊天历史" }).click();
    await expect(
      partner.getByRole("button", { name: "继续会话：家庭现金安排" }),
    ).toBeVisible();
    await partner
      .getByRole("button", { name: "继续会话：家庭现金安排" })
      .click();
    await expect(partner.locator(".advisor-messages")).toContainText(
      "已保存的历史讨论",
    );
    await partner.getByLabel("顾问消息").fill("目前净资产多少");
    await partner.getByRole("button", { name: "发送消息" }).click();
    await expect(partner.locator(".advisor-messages")).toContainText("500");
    await expect(partner.locator(".save-status")).toContainText(
      "已同步 Supabase",
    );
    await partner.reload();
    await partner.getByRole("button", { name: "打开财富顾问" }).click();
    await expect(partner.locator(".advisor-messages")).toContainText(
      "已保存的历史讨论",
    );
    await expect(
      partner.getByRole("button", { name: "编辑共享测试储蓄本年回报" }),
    ).toContainText("-4.5%");
  } finally {
    await partnerContext.close();
    await cleanupAuthenticated(page);
  }
});
