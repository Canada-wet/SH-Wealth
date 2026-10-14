import { test, expect } from "@playwright/test";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
import { emptyState } from "../../lib/wealth";
import { DEFAULT_WATCHLIST } from "../../lib/market";

test.skip(
  process.env.RUN_MARKET_WIDGETS !== "1",
  "Explicit opt-in for external public quote windows",
);
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("真实公开行情窗口：外汇、美股和所选历史图表", async ({ page }) => {
  test.setTimeout(60000);
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
  await page.goto("/markets");
  await page.getByRole("button", { name: "启用自动更新行情" }).click();
  const fx = page.frameLocator('iframe[title="加币盘中外汇参考"]');
  const quotes = page.frameLocator('iframe[title="自选股票ETF行情"]');
  await expect(fx.locator("body")).toContainText(/\d+\.\d+/, {
    timeout: 30000,
  });
  await expect(quotes.locator("body")).toContainText(/\d+\.\d+/, {
    timeout: 30000,
  });
  for (const { ticker: code } of DEFAULT_WATCHLIST.filter(
    (row) => row.ticker !== "ZGIN",
  )) {
    await expect
      .poll(
        async () =>
          new RegExp(
            `${code.replaceAll(".", "\\.")}[^\\n]*\\n\\s*\\d+\\.\\d+`,
          ).test(await quotes.locator("body").innerText()),
        { timeout: 15000, message: `Public quote must be numeric for ${code}` },
      )
      .toBe(true);
  }
  await page.getByRole("button", { name: "查看NASDAQ:NVDA图表" }).click();
  await expect(
    page.frameLocator('iframe[title="所选证券历史图表"]').locator("body"),
  ).toContainText(/NVIDIA|NVDA/, { timeout: 30000 });
  await expect(
    page
      .frameLocator('iframe[title="所选证券历史图表"]')
      .locator("canvas")
      .first(),
  ).toBeVisible();
  await page.locator(".markets-page").screenshot({
    path: `test-results/market-live-${test.info().project.name}.png`,
  });
});
