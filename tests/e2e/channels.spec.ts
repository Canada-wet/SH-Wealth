import { test, expect } from "@playwright/test";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("消息渠道的订阅同意、验证深链、真实状态与断开流程", async ({ page }) => {
  await authenticate(page);
  let rows: {
    id: string;
    channel: string;
    destination_label: string;
    enabled: boolean;
    advisor_enabled: boolean;
    last_status: string | null;
  }[] = [];
  const configuration = {
    email: { ready: true },
    telegram: { ready: true },
    whatsapp: { ready: false, reason: "等待 Business 模板与账号配置。" },
  };
  const actions: Record<string, unknown>[] = [];
  await page.route("**/api/notifications/channels**", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { channels: rows, configuration, whatsappAdvisor: false },
      });
    const body = route.request().postDataJSON();
    actions.push(body);
    if (body.action === "test")
      return route.fulfill({
        status: 502,
        json: { error: "平台拒绝测试通知。" },
      });
    if (body.action === "disconnect")
      rows = rows.map((row) =>
        row.channel === body.channel ? { ...row, enabled: false } : row,
      );
    else if (body.channel === "email")
      rows.push({
        id: "email",
        channel: "email",
        destination_label: "m•••@example.test",
        enabled: true,
        advisor_enabled: false,
        last_status: null,
      });
    else
      return route.fulfill({
        json: {
          ok: true,
          url: "https://t.me/fixture_bot?start=" + "A".repeat(32),
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          message: "请在平台完成验证。",
        },
      });
    return route.fulfill({ json: { ok: true, message: "订阅状态已保存。" } });
  });
  await page.goto("/");
  await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
  await page.getByRole("button", { name: "通知", exact: true }).click();
  await page.getByRole("tab", { name: "消息渠道", exact: true }).click();
  const settings = page.getByLabel("消息渠道连接");
  await expect(
    settings.getByRole("button", { name: "启用Email通知" }),
  ).toBeDisabled();
  await settings
    .getByRole("checkbox", { name: "同意接收Email通知，可随时取消。" })
    .check();
  await settings.getByRole("button", { name: "启用Email通知" }).click();
  await expect(settings).toContainText("m•••@example.test");
  await settings.getByRole("button", { name: "测试Email通知" }).click();
  await expect(settings.getByRole("alert")).toContainText("平台拒绝");
  await settings.getByRole("button", { name: "断开Email" }).click();
  await expect(
    settings.getByRole("button", { name: "启用Email通知" }),
  ).toBeEnabled();
  await settings
    .getByRole("checkbox", { name: "同意接收Telegram通知，可随时取消。" })
    .check();
  await settings
    .getByRole("checkbox", { name: /另开启平台内只读顾问/ })
    .check();
  await settings
    .getByRole("button", { name: "连接Telegram", exact: true })
    .click();
  await expect(
    settings.getByRole("link", { name: "打开Telegram完成验证" }),
  ).toHaveAttribute("href", /https:\/\/t.me\/fixture_bot\?start=/);
  expect(actions.at(-1)).toMatchObject({
    channel: "telegram",
    consent: true,
    advisor: true,
  });
  rows.push({
    id: "telegram",
    channel: "telegram",
    destination_label: "Telegram 私聊 · •••1234",
    enabled: true,
    advisor_enabled: true,
    last_status: null,
  });
  await settings.getByRole("button", { name: "检查连接状态" }).click();
  await expect(settings).toContainText("通知＋只读顾问");
  await expect(
    settings.getByRole("button", { name: "连接WhatsApp", exact: true }),
  ).toBeDisabled();
  await settings.getByText("微信可行性 · 尚未接入").click();
  await expect(settings).toContainText("个人微信");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/channels-${test.info().project.name}.png`,
    fullPage: false,
  });
});
