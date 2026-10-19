import { test, expect, type Page } from "@playwright/test";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
import { emptyState } from "../../lib/wealth";
const mobile = () => test.info().project.name.startsWith("mobile");
const launch = async (page: Page) => {
  await page
    .getByRole("button", {
      name: mobile() ? "打开页面与功能搜索" : "搜索页面与功能",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog", { name: "想去哪里？" })).toBeVisible();
};
test.beforeEach(async ({ page }) => {
  await authenticate(page, { seed: emptyState() });
  await page.route("**/api/market", (route) =>
    route.fulfill({
      json: {
        fetchedAt: "2026-10-18T12:00:00Z",
        fx: [],
        yields: [],
        macro: [],
        indicators: [],
        failures: [],
      },
    }),
  );
  await page.route("**/api/learning?**", (route) =>
    route.fulfill({
      json: {
        preferences: { version: 1, daily: false, favorites: [] },
        deliveries: [],
      },
    }),
  );
  await page.route("https://www.tradingview-widget.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><body>Synthetic quotes</body></html>",
    }),
  );
});
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("统一搜索精确进入子功能，分类与空结果有效；手机和桌面均无溢出", async ({
  page,
}) => {
  await page.goto("/updates");
  await launch(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("搜索页面与功能", { exact: true }).fill("CPI");
  await expect(dialog.getByRole("listitem")).toHaveCount(1);
  await expect(dialog.getByRole("link", { name: /宏观研究/ })).toHaveAttribute(
    "href",
    "/markets#macro-research",
  );
  await dialog.getByRole("button", { name: "兴趣生活", exact: true }).click();
  await expect(dialog.getByText("没有找到这个入口")).toBeVisible();
  await dialog.getByRole("button", { name: "查看全部功能" }).click();
  await dialog.getByLabel("搜索页面与功能", { exact: true }).fill("DJ 编排");
  await dialog.getByRole("link", { name: /DJ Set 编排/ }).click();
  await expect(page).toHaveURL(/\/lifestyle#sets$/);
  await expect(
    page.getByRole("tab", { name: "Set Builder", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "关联功能" })).toBeVisible();
  for (const width of mobile() ? [320, 390] : [768, 1440]) {
    await page.setViewportSize({ width, height: 920 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      )
      .toBe(true);
  }
});
test("置顶子功能刷新与跨页面保留，置顶排在最近使用之前且可取消", async ({
  page,
}) => {
  await page.goto("/space");
  await expect(
    page.getByRole("region", { name: "家庭状态摘要" }),
  ).toBeVisible();
  await page.screenshot({
    path: `/private/tmp/together-home-${test.info().project.name}.png`,
  });
  await launch(page);
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("搜索页面与功能", { exact: true }).fill("加币汇率");
  await dialog
    .getByRole("button", { name: "置顶加币汇率", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "取消置顶加币汇率" }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "关闭功能搜索" }).click();
  await page.goto("/updates");
  await page.reload();
  const quick = page
    .locator(mobile() ? ".app-mobile-shortcuts" : ".app-nav-section")
    .first();
  await expect(quick.getByRole("link").first()).toHaveText("加币汇率");
  await launch(page);
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("listitem").first()).toContainText("加币汇率");
  await dialog.getByRole("button", { name: "取消置顶加币汇率" }).click();
  await expect(
    dialog.getByRole("button", { name: "置顶加币汇率", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await dialog.getByRole("button", { name: "关闭功能搜索" }).click();
  await page.goto("/lifestyle#practice");
  await expect(page.getByRole("tab", { name: "练习与快乐" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await launch(page);
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("listitem").first()).toContainText("练习记录");
  const names = await dialog.getByRole("listitem").allTextContents();
  expect(names.findIndex((n) => n.includes("兴趣与生活"))).toBeLessThan(
    names.findIndex((n) => n.includes("版本更新")),
  );
  await page.screenshot({
    path: `/private/tmp/together-navigation-${test.info().project.name}.png`,
  });
});
test("功能深链接可打开设置与顾问、收藏视图；同一顾问入口可反复打开", async ({
  page,
}) => {
  await page.goto("/#settings");
  await expect(
    page.getByRole("dialog", { name: "备份与家庭同步" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await launch(page);
  await page
    .getByRole("dialog")
    .getByLabel("搜索页面与功能", { exact: true })
    .fill("语音");
  await page
    .getByRole("dialog")
    .getByRole("link", { name: /财富顾问/ })
    .click();
  await expect(
    page.getByRole("region", { name: "家庭财富顾问", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "收起顾问", exact: true }).click();
  await launch(page);
  await page
    .getByRole("dialog")
    .getByLabel("搜索页面与功能", { exact: true })
    .fill("语音");
  await page
    .getByRole("dialog")
    .getByRole("link", { name: /财富顾问/ })
    .click();
  await expect(
    page.getByRole("region", { name: "家庭财富顾问", exact: true }),
  ).toBeVisible();
  await page.goto("/learn#favorites");
  await expect(page.getByRole("button", { name: /我的收藏/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
test("保存失败保留未置顶状态，不自动重发；快捷键与搜索仍可用", async ({
  page,
}) => {
  let pins = 0;
  await page.route("**/api/navigation", (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON().action === "pin"
    ) {
      pins++;
      return route.fulfill({
        status: 503,
        json: { error: "尚未确认导航保存，请重试；未修改其他数据。" },
      });
    }
    return route.fulfill({
      json: { userId: "00000000-0000-4000-8000-000000000001", entries: [] },
    });
  });
  await page.goto("/updates");
  if (mobile()) await launch(page);
  else await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("搜索页面与功能", { exact: true }).fill("汇率");
  await dialog
    .getByRole("button", { name: "置顶加币汇率", exact: true })
    .click();
  await expect(
    dialog.getByText("尚未确认导航保存，请重试；未修改其他数据。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "置顶加币汇率", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await dialog.getByRole("button", { name: "重新连接", exact: true }).click();
  expect(pins).toBe(1);
  await dialog.getByLabel("搜索页面与功能", { exact: true }).fill("xyzunknown");
  await expect(dialog.getByText("没有找到这个入口")).toBeVisible();
  if (mobile()) {
    await page.route("**/auth/v1/logout**", (route) =>
      route.request().method() === "OPTIONS"
        ? route.continue()
        : route.fulfill({
            status: 503,
            headers: { "Access-Control-Allow-Origin": "*" },
            json: { message: "Synthetic logout failure" },
          }),
    );
    await dialog
      .getByRole("button", { name: "退出当前设备登录", exact: true })
      .click();
    // The installed auth SDK clears this device's session even if revocation is
    // unavailable. SIGNED_OUT must still take the user to the private login page.
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
  }
});
