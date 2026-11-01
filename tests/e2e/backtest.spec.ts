import { test, expect, type Page } from "@playwright/test";
import { emptyState } from "../../lib/wealth";
import { authenticate, cleanupAuthenticated } from "./auth-helper";

test.beforeEach(async ({ page }) => {
  await authenticate(page, { seed: emptyState() });
});
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
async function open(page: Page) {
  await page.goto("/backtest");
  await expect(page.locator(".bt-header-tools")).toContainText(
    "已同步 Supabase",
  );
  await expect(
    page.getByRole("button", { name: "运行策略比较", exact: true }),
  ).toBeEnabled();
}
async function demo(page: Page) {
  await open(page);
  await page.getByRole("button", { name: "试用合成演示", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "同样的外部投入，不同的部署方式" }),
  ).toBeVisible();
}

test("三种图表与事件可用，保存和刷新后组合及行情仍在，窄屏不溢出", async ({
  page,
}) => {
  await demo(page);
  const metrics = page.getByRole("table", {
    name: "同样的外部投入，不同的部署方式",
  });
  await expect(
    metrics.getByText("最大净值回撤", { exact: true }),
  ).toBeVisible();
  for (const mode of ["nav", "value", "drawdown"]) {
    await page.getByLabel("图表口径", { exact: true }).selectOption(mode);
    await expect(page.locator(".bt-chart .recharts-line-curve")).toHaveCount(3);
  }
  await page.getByRole("tab", { name: "历史冲击", exact: true }).click();
  await expect(page.locator(".bt-event h3").first()).toHaveText("全球金融危机");
  await expect(page.locator(".bt-event").last()).toContainText("未覆盖");
  await page.getByLabel("计划名称", { exact: true }).fill("隔离回测计划");
  await page.getByRole("button", { name: "保存计划", exact: true }).click();
  await expect(page.locator(".bt-builder")).toContainText(
    "计划已存到本机家庭文档",
  );
  await expect(page.locator(".bt-header-tools")).toContainText(
    "已同步 Supabase",
  );
  await expect(page.locator(".bt-builder")).toContainText(
    "草稿、行情与最近对话已缓存于此设备",
  );
  await page.waitForTimeout(1000); // IndexedDB draft uses a 700ms debounce.
  await page.reload();
  await expect(page.getByLabel("已存家庭计划", { exact: true })).toContainText(
    "隔离回测计划",
  );
  await expect(page.getByLabel("计划名称", { exact: true })).toHaveValue(
    "隔离回测计划",
  );
  await page.getByRole("button", { name: "运行策略比较", exact: true }).click();
  await expect(metrics).toContainText("年化回报 CAGR");
  for (const width of test.info().project.name.startsWith("mobile")
    ? [320, 390]
    : [768, 1440]) {
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

test("CSV拆股与分红按口径重算，短样本警告可见，AI仅在提交时触发并支持追问", async ({
  page,
}) => {
  let calls: Record<string, unknown>[] = [];
  await page.route("**/api/backtest/advisor", (route) => {
    calls.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        answer: "合成研究回答：拆股不创造财富，分红不能重复加计。",
        route: { provider: "fixture", model: "no-paid-generation" },
      },
    });
  });
  await open(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "symbol,date,close,dividend,split\nTEST.US,2020-01-02,100,0,1\nTEST.US,2020-01-03,50,0,2\nTEST.US,2020-01-06,49,1,1\nTEST.US,2020-01-07,52,0,1\nTEST.US,2020-01-08,50,0,1\n",
    ),
  });
  await expect(page.locator(".bt-data-table")).toContainText("TEST.US");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "按文件标的建立等权组合", exact: true })
    .click();
  await expect(page.getByLabel("标的1", { exact: true })).toHaveValue(
    "TEST.US",
  );
  await page.getByRole("button", { name: "运行策略比较", exact: true }).click();
  await expect(page.locator(".bt-critical-warnings")).toContainText("不足一年");
  await expect(page.locator(".bt-critical-warnings")).toContainText("少于60");
  await page.getByRole("tab", { name: "AI 与家庭适配", exact: true }).click();
  expect(calls).toHaveLength(0);
  for (const [index, question] of [
    "解释分红与拆股的区别",
    "如何验证这个结论？",
  ].entries()) {
    await page.getByLabel("继续研究或追问", { exact: true }).fill(question);
    await page.getByRole("button", { name: "提问", exact: true }).click();
    await expect(page.locator(".bt-message-assistant")).toHaveCount(index + 1);
    await expect(
      page.getByLabel("继续研究或追问", { exact: true }),
    ).toBeEnabled();
  }
  expect(calls).toHaveLength(2);
  expect(calls[0].includeHousehold).toBe(false);
  expect(calls[0].state).toBeUndefined();
  expect(calls[1].history).toHaveLength(2);
  await page.waitForTimeout(1000); // Flush the bounded conversation cache.
  await page.reload();
  await page.getByRole("tab", { name: "AI 与家庭适配", exact: true }).click();
  await expect(page.locator(".bt-message-assistant")).toHaveCount(2);
  expect(calls).toHaveLength(2);
});
