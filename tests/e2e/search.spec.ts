import { test, expect } from "@playwright/test";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
import { emptyState } from "../../lib/wealth";
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("联网策略与主题持久化，回复来源链接可点击并随聊天恢复", async ({
  page,
}) => {
  const state = emptyState();
  state.preferences.model = "auto";
  await authenticate(page, { seed: state });
  let requested = false;
  await page.route("**/api/advisor", async (route) => {
    const body = route.request().postDataJSON();
    requested = true;
    expect(body.state.preferences.webSearch).toBe("on");
    expect(body.state.preferences.searchTopic).toBe("rates");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        answer:
          "已查证公开政策利率。\n\n[加拿大央行](https://www.bankofcanada.ca/)\n\n检索时间：2026-10-14 00:00（Toronto）",
        actions: [],
        route: {
          provider: "deepseek",
          model: "deepseek-flash",
          reason: "省钱优先",
        },
        web: { status: "searched" },
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "打开财富顾问" }).click();
  await page.locator(".search-controls > summary").click();
  await page.getByLabel("联网搜索策略").selectOption("on");
  await page.getByLabel("公开搜索主题").selectOption("rates");
  await page.getByLabel("顾问消息").fill("最新央行政策利率是多少");
  await expect(page.locator(".search-query")).toContainText("Bank of Canada");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.locator(".advisor-messages")).toContainText("检索时间");
  expect(requested).toBe(true);
  await expect(
    page.getByRole("link", { name: "加拿大央行", exact: true }),
  ).toHaveAttribute("href", "https://www.bankofcanada.ca/");
  await page.reload();
  await page.getByRole("button", { name: "打开财富顾问" }).click();
  await page.locator(".search-controls > summary").click();
  await expect(page.getByLabel("联网搜索策略")).toHaveValue("on");
  await expect(page.getByLabel("公开搜索主题")).toHaveValue("rates");
  await expect(page.locator(".advisor-messages")).toContainText("检索时间");
  await page.getByLabel("联网搜索策略").selectOption("off");
  await page.reload();
  await page.getByRole("button", { name: "打开财富顾问" }).click();
  await expect(page.locator(".search-controls")).toContainText("已关闭");
});
