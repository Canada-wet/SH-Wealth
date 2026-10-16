import { test, expect } from "@playwright/test";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
import { emptyState } from "../../lib/wealth";
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("真实归档接口：合成家庭为空、跨家庭拒绝、匿名不可读", async ({ page }) => {
  test.skip(process.env.RUN_RESEARCH_ARCHIVE_INTEGRATION !== "1");
  await authenticate(page, { seed: emptyState() });
  await page.goto("/markets#research-archive");
  const panel = page.getByRole("region", { name: "外部研究归档" });
  await expect(panel).toContainText("尚无已保存的外部研究");
  const bad = await page.request.get(
    "/api/market/research-archive?household=00000000-0000-4000-8000-000000000099",
  );
  expect(bad.status()).toBe(403);
  await page.context().clearCookies();
  const anonymous = await page.request.get(
    "/api/market/research-archive?household=00000000-0000-4000-8000-000000000099",
  );
  expect(anonymous.status()).toBe(401);
});
test("外部研究归档可回看、刷新和安全显示来源，手机不溢出", async ({ page }) => {
  await authenticate(page, { seed: emptyState() });
  let fail = false;
  await page.route("**/api/market/research-archive?**", (r) =>
    r.fulfill(
      fail
        ? { status: 503, json: { error: "fixture failure" } }
        : {
            json: {
              reports: [
                {
                  id: "fixture",
                  source: "funda",
                  source_url: "https://funda.ai/agent-chat?c=fixture",
                  captured_at: "2026-10-16T03:30:00Z",
                  prompt: "公开市场合成测试",
                  response:
                    '**合成原文**，不是实际行情。<reference url="https://www.bea.gov/">BEA</reference>',
                  citations: [{ title: "BEA", url: "https://www.bea.gov/" }],
                  status: "complete",
                  verification: "ai-unverified",
                },
              ],
            },
          },
    ),
  );
  await page.goto("/markets#research-archive");
  const panel = page.getByRole("region", { name: "外部研究归档" });
  await expect(panel.getByLabel("选择外部研究归档")).toBeVisible();
  await panel.getByText("查看研究原文与来源", { exact: true }).click();
  await expect(panel.getByText("合成原文", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("link", { name: "BEA", exact: true }),
  ).toHaveAttribute("href", "https://www.bea.gov/");
  await expect(panel).toContainText("未启用每日自动采集");
  fail = true;
  await panel.getByRole("button", { name: "刷新研究归档" }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  fail = false;
  await panel.getByRole("button", { name: "刷新研究归档" }).click();
  await expect(panel.getByLabel("选择外部研究归档")).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "市场区块导航" })
      .getByRole("link", { name: /研究归档/ }),
  ).toHaveAttribute("href", "#research-archive");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
