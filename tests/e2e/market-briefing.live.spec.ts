import { test, expect } from "@playwright/test";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
test.skip(
  process.env.RUN_MARKET_BRIEFING_INTEGRATION !== "1",
  "Explicit real briefing verification only",
);
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("真实每日简报可认证读取、引用核对且重复请求不再生成", async ({ page }) => {
  test.setTimeout(60000);
  await authenticate(page);
  await page.goto("/markets#market-intelligence");
  const section = page.getByRole("region", { name: "每日市场简报与指标" });
  await expect(section.getByLabel("查看历史市场简报")).toBeVisible();
  const response = await page.request.get("/api/market/briefing");
  expect(response.status()).toBe(200);
  const result = await response.json();
  const today = result.reports.find(
    (row: { day: string }) => row.day === result.today,
  );
  expect(today).toBeTruthy();
  expect(["ai", "rules"]).toContain(today.mode);
  expect(today.points).toHaveLength(3);
  expect(
    today.facts.some((row: { id: string }) => row.id.startsWith("FX")),
  ).toBe(false);
  const repeat = await page.request.post("/api/market/briefing", { data: {} });
  expect(repeat.status()).toBe(200);
  expect((await repeat.json()).created).toBe(false);
  const saved = await (await page.request.get("/api/market/briefing")).json();
  expect(saved.reports[0].generatedAt).toBe(result.reports[0].generatedAt);
  if (today.mode === "rules")
    await expect(section).toContainText("规则摘要 · 非 AI");
  else await expect(section).toContainText(`AI · ${today.provider}`);
  await section.getByRole("button", { name: "AI 产业供需代理" }).click();
  await expect(
    section.getByRole("heading", { name: "计算机与电子产品新订单" }),
  ).toBeVisible();
  await section.getByRole("button", { name: "情绪与波动" }).click();
  await page
    .getByRole("navigation", { name: "市场区块导航" })
    .getByRole("link", { name: "每日简报" })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/daily-market-live-${test.info().project.name}.png`,
  });
});
