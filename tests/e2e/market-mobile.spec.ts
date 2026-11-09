import { test, expect } from "@playwright/test";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
import { emptyState } from "../../lib/wealth";
test.beforeEach(async ({ page }) => {
  await authenticate(page, { seed: emptyState() });
  await page.route("**/api/market", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: new Date().toISOString(),
        fx: [],
        yields: [],
        macro: [],
        failures: [],
      }),
    }),
  );
  await page.route("https://www.tradingview-widget.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><body>Isolated quote fixture</body></html>",
    }),
  );
});
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("新手机明确提示本机行情开关，自选不消失；可见加载、返回和断网恢复重连", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/markets#watchlist-pulse");
  const pulse = page.getByRole("region", { name: "自选涨跌速览" });
  const enable = pulse.getByRole("button", { name: "开启自选涨跌速览" });
  await expect(enable).toBeInViewport();
  await expect(pulse).toContainText("电脑上的开关不会自动同步");
  await expect(pulse.getByRole("article")).toHaveCount(30);
  await expect(pulse.getByRole("article").first()).toHaveAttribute(
    "data-state",
    "paused",
  );
  await expect(pulse.locator("iframe")).toHaveCount(0);
  await enable.click();
  const first = page.getByTitle("当前涨跌NASDAQ:NVDA", { exact: true });
  const last = page.getByTitle("当前涨跌TSX:ZSP", { exact: true });
  await expect(first).toBeInViewport();
  await first.scrollIntoViewIfNeeded();
  await expect(first).toHaveAttribute("src", /single-quote/);
  await expect(first).toHaveAttribute("loading", "eager");
  await expect(last).not.toHaveAttribute("src");
  await last.scrollIntoViewIfNeeded();
  await expect(last).toHaveAttribute("src", /single-quote/);
  await expect(first).not.toHaveAttribute("src");
  await first.scrollIntoViewIfNeeded();
  await expect(first).toHaveAttribute("src", /single-quote/);
  const handle = await first.elementHandle();
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  await expect
    .poll(async () => handle!.evaluate((node) => node.isConnected))
    .toBe(false);
  const second = await first.elementHandle();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(async () => second!.evaluate((node) => node.isConnected))
    .toBe(false);
  await page.getByRole("button", { name: "暂停外部行情" }).click();
  await expect(pulse.locator("iframe")).toHaveCount(0);
  await page.reload();
  await expect(enable).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("报价一直无响应会显示超时，不把文档加载当作报价成功", async ({ page }) => {
  await page.clock.install();
  await page.goto("/markets#watchlist-pulse");
  await page.getByRole("button", { name: "开启自选涨跌速览" }).click();
  const first = page.getByTitle("当前涨跌NASDAQ:NVDA", { exact: true });
  await first.scrollIntoViewIfNeeded();
  await expect(first).toHaveAttribute("src", /single-quote/);
  await page.clock.fastForward(16000);
  const card = page.getByRole("article", {
    name: "NASDAQ:NVDA涨跌",
    exact: true,
  });
  await expect(card).toHaveAttribute("data-state", "slow");
  await expect(card).toContainText("连接超时或被浏览器拦截");
  await card.getByRole("button", { name: "重试涨跌NASDAQ:NVDA" }).click();
  await expect(card).toHaveAttribute("data-state", "waiting");
});
test("整组刷新覆盖卡片与行情表，保留筛选和已选图表且不写账本", async ({
  page,
}) => {
  await page.goto("/markets#watchlist-pulse");
  await page.getByRole("button", { name: "开启自选涨跌速览" }).click();
  const search = page.getByLabel("搜索涨跌速览");
  await search.fill("nvda");
  await page.getByLabel("从速览查看图表").selectOption("NASDAQ:NVDA");
  const titles = [
    "当前涨跌NASDAQ:NVDA",
    "自选股票ETF行情",
    "加币盘中外汇参考",
    "所选证券历史图表",
  ];
  for (const name of ["刷新自选行情", "重新连接行情", "刷新市场数据"]) {
    const old = await Promise.all(
      titles.map((title) =>
        page.getByTitle(title, { exact: true }).elementHandle(),
      ),
    );
    await page.getByRole("button", { name, exact: true }).click();
    for (const handle of old) {
      expect(handle).not.toBeNull();
      await expect
        .poll(() => handle!.evaluate((node) => node.isConnected))
        .toBe(false);
    }
    await expect(search).toHaveValue("nvda");
    await expect(page.getByLabel("选择证券图表")).toHaveValue("NASDAQ:NVDA");
    await expect(page.locator(".market-chart")).toHaveAttribute("open", "");
    await expect(page.locator(".market-pulse-count")).toContainText(
      "非报价更新时间",
    );
  }
  const state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("together-wealth-v3")!),
  );
  expect(state.assets).toHaveLength(0);
  expect(state.history).toHaveLength(0);
  await page.getByRole("button", { name: "暂停外部行情" }).click();
  await expect(page.locator(".market-pulse iframe")).toHaveCount(0);
});
