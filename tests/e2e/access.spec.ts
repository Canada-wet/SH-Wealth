import { test, expect } from "@playwright/test";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
import { emptyState } from "../../lib/wealth";
test("访客无法进入工作台、白名单外账号不能登录、接口拒绝匿名", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("邮箱", { exact: true }).fill("outsider@example.com");
  await page.getByLabel("密码", { exact: true }).fill("invalid-password");
  await page.getByRole("button", { name: "登录家庭空间" }).click();
  await expect(page.locator(".auth-card").getByRole("alert")).toContainText(
    "仅向已授权",
  );
  const response = await request.post("/api/advisor", {
    data: { message: "目前资产多少", state: emptyState() },
  });
  expect(response.status()).toBe(401);
  const cron = await request.get("/api/advisor/digest");
  // Offline fixtures intentionally have no cron secret; production has one.
  expect([401, 503]).toContain(cron.status());
});
test("回复标题、列表、粗体数字和表格都正确显示，不暴露Markdown标记", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/");
  await page.route("**/api/advisor", (route) =>
    route.fulfill({
      json: {
        answer:
          "整体财务较稳健。\n\n### 资产与净值\n\n- **净资产： ** **$992,410**\n- 负债率 **13.1%**\n\n| 项目 | 金额 |\n| --- | --- |\n| 月结余 | 12,769 |\n\n### 下一步\n\n1. 复盘预算\n2. 更新房屋估值",
        actions: [],
        route: { provider: "local", model: "test", reason: "test" },
      },
    }),
  );
  await page.getByRole("button", { name: "打开财富顾问" }).click();
  await page.getByLabel("顾问消息").fill("分析当前财务状况");
  await page.getByRole("button", { name: "发送消息" }).click();
  const message = page.locator(".advisor-markdown").last();
  await expect(
    message.getByRole("heading", { name: "资产与净值" }),
  ).toBeVisible();
  await expect(message.locator("strong").first()).toHaveText("净资产：");
  await expect(message.locator("table")).toBeVisible();
  const tableSize = await message
    .locator(".advisor-table-scroll")
    .evaluate((element) => ({
      width: element.clientWidth,
      content: element.scrollWidth,
    }));
  expect(tableSize.content).toBeLessThanOrEqual(tableSize.width + 1);
  await expect(message).not.toContainText("**");
  await expect(
    message.getByText("整体财务较稳健。", { exact: true }),
  ).toBeInViewport();
  await page.locator(".advisor-window").screenshot({
    path: `test-results/chat-formatted-${test.info().project.name}.png`,
  });
});
test("重置入口能发起邮件请求，过期链接不会显示修改密码成功", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "忘记密码？通过邮箱重置" }).click();
  await page.getByLabel("邮箱", { exact: true }).fill("henrywhy233@gmail.com");
  await page.route("**/auth/v1/recover*", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.getByRole("button", { name: "发送重置邮件" }).click();
  await expect(page.getByRole("status")).toContainText("重置邮件已发送");
  await page.goto("/auth/reset-password?error=access_denied");
  await expect(page.locator(".auth-card").getByRole("alert")).toContainText(
    "过期或失效",
  );
  await expect(page.getByRole("button", { name: "更新密码" })).toHaveCount(0);
});
