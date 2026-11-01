import { test, expect, type Page } from "@playwright/test";
import { emptyState } from "../../lib/wealth";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
import { defaultBacktest, backtestToday } from "../../lib/backtest-schema";
import { readFile } from "node:fs/promises";

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
    page.getByRole("button", { name: "下一步：历史数据", exact: true }),
  ).toBeEnabled();
  await step(page, /历史数据/);
}
async function step(page: Page, name: RegExp) {
  await page
    .getByRole("navigation", { name: "回测工作流" })
    .getByRole("button", { name })
    .click();
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
  await step(page, /组合设置/);
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
  await step(page, /历史数据/);
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
  await page.getByText("从CSV或研究包导入", { exact: true }).click();
  await page.getByLabel("导入历史行情或研究包", { exact: true }).setInputFiles({
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
test("Yahoo逐项预览、采用复权历史、重算与刷新缓存；只发送代码日期", async ({
  page,
}) => {
  const calls: unknown[] = [];
  await page.route("**/api/backtest/history", async (route) => {
    const q = route.request().postDataJSON();
    calls.push(q);
    await route.fulfill({
      json: {
        requested: q,
        effectiveEnd: q.end,
        results: q.symbols.map((symbol: string) => ({
          symbol,
          yahooSymbol: symbol.replace(".US", ""),
          fetchedAt: "2026-11-01T04:00:00Z",
          warnings: ["合成API夹具，不请求Yahoo"],
        })),
        data: {
          version: 1,
          capturedAt: "2026-11-01T04:00:00Z",
          synthetic: false,
          assets: q.symbols.map((symbol: string) => ({
            symbol,
            currency: "USD",
            basis: "total-return",
            dividendsKnown: false,
            source: "Yahoo Finance · 合成浏览器API夹具",
            points: ["2020-01-02", "2020-01-03", "2020-01-06"].map(
              (date, i) => ({ date, close: 100 + i, dividend: 0, split: 1 }),
            ),
          })),
        },
      },
    });
  });
  await open(page);
  expect(calls).toHaveLength(0);
  await page
    .getByRole("button", { name: "从Yahoo获取组合历史", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "已获取 2/2 项" }),
  ).toBeVisible();
  expect(Object.keys(calls[0] as object).sort()).toEqual([
    "end",
    "start",
    "symbols",
  ]);
  await expect(
    page.getByRole("button", { name: "使用这批行情", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "使用这批行情", exact: true }).click();
  await expect(page.locator(".bt-data-table")).toContainText("已含于复权价");
  await expect(page.getByLabel("标的1", { exact: true })).toHaveValue(
    defaultBacktest("2020-01-06").holdings[0].symbol,
  );
  await page.getByRole("button", { name: "运行策略比较", exact: true }).click();
  await expect(page.locator(".bt-chart .recharts-line-curve")).toHaveCount(3);
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
  await page.waitForTimeout(1000);
  await page.reload();
  await step(page, /历史数据/);
  await expect(page.locator(".bt-data-table")).toContainText("SPY.US");
  expect(calls).toHaveLength(1);
});
test("不同组合完整对照：复制改权重、同策略与基准、三种曲线、缓存和对照包往返", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  let external = 0;
  await page.route("**/api/backtest/history", (route) => {
    external++;
    return route.fulfill({
      status: 503,
      json: { error: "隔离用例不允许真实Yahoo请求" },
    });
  });
  await demo(page);
  await page.getByRole("button", { name: "加入组合对照", exact: true }).click();
  await expect(page.getByLabel("组合1名称", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "复制到工作台修改", exact: true })
    .click();
  await page
    .getByLabel("计划名称", { exact: true })
    .fill("第二组合 · 隔离30/70");
  await page.getByLabel("权重1", { exact: true }).fill("30");
  await page.getByLabel("权重2", { exact: true }).fill("70");
  await step(page, /历史数据/);
  await page.getByRole("button", { name: "运行策略比较", exact: true }).click();
  await page.getByRole("button", { name: "加入组合对照", exact: true }).click();
  await page.getByLabel("统一策略", { exact: true }).selectOption("dca");
  await page.getByRole("button", { name: "运行组合对照", exact: true }).click();
  const results = page.getByRole("region", {
    name: "组合对照结果",
    exact: true,
  });
  await expect(results.getByRole("heading", { level: 2 })).toContainText("DCA");
  const table = results.getByRole("table", {
    name: "不同组合 · 同策略、同投入、同区间",
  });
  await expect(table.locator("thead th")).toHaveCount(3);
  const initial = await table
    .getByRole("row")
    .filter({ hasText: "累计投入" })
    .locator("td")
    .allTextContents();
  expect(initial[0]).toBe(initial[1]);
  for (const chart of ["nav", "value", "drawdown"]) {
    await page
      .getByLabel("组合对照图表口径", { exact: true })
      .selectOption(chart);
    await expect(results.locator(".recharts-line-curve")).toHaveCount(2);
  }
  await results.locator(".bt-chart").hover();
  const options = page
    .getByLabel("资金与费用基准", { exact: true })
    .locator("option");
  const second = await options.nth(1).getAttribute("value");
  await page
    .getByLabel("资金与费用基准", { exact: true })
    .selectOption(second!);
  await expect(results).toContainText("请重新运行");
  await page.getByRole("button", { name: "运行组合对照", exact: true }).click();
  for (const width of info.project.name === "desktop"
    ? [768, 1440]
    : [320, 390]) {
    await page.setViewportSize({ width, height: 920 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      )
      .toBe(true);
  }
  await page.screenshot({
    path: info.outputPath("portfolio-comparison.png"),
    fullPage: true,
  });
  await expect(
    page.getByText(
      "组合快照与对照设置已缓存于本设备；跨设备请导出／导入对照包。",
      { exact: true },
    ),
  ).toBeVisible();
  await page.waitForTimeout(1000);
  await page.reload();
  await page.getByRole("button", { name: "组合对照", exact: true }).click();
  await expect(page.getByLabel("组合2名称", { exact: true })).toHaveValue(
    "第二组合 · 隔离30/70",
  );
  await expect(page.getByLabel("统一策略", { exact: true })).toHaveValue("dca");
  await page.getByRole("button", { name: "运行组合对照", exact: true }).click();
  await expect(table).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出对照包", exact: true }).click();
  const pack = await readFile((await (await downloaded).path())!, "utf8");
  expect(JSON.parse(pack).shelf.studies).toHaveLength(2);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "移除对照组合2", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "运行组合对照", exact: true }),
  ).toBeDisabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("导入组合对照包", { exact: true }).setInputFiles({
    name: "synthetic-comparison.json",
    mimeType: "application/json",
    buffer: Buffer.from(pack),
  });
  await expect(page.getByLabel("组合2名称", { exact: true })).toHaveValue(
    "第二组合 · 隔离30/70",
  );
  await page.getByRole("button", { name: "运行组合对照", exact: true }).click();
  await expect(table).toBeVisible();
  expect(external).toBe(0);
});
test("Collection配置云端往返、搜索与复制复用，官方参考仅手动用于规划", async ({
  page,
}) => {
  let marketCalls = 0;
  await page.route("**/api/market", (route) => {
    marketCalls++;
    return route.fulfill({
      json: {
        fetchedAt: new Date().toISOString(),
        fx: [
          {
            id: "FXUSDCAD",
            value: 1 / 1.38,
            date: backtestToday(),
            unit: " / CAD",
            source:
              "https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/",
          },
        ],
      },
    });
  });
  await demo(page);
  await step(page, /组合设置/);
  await page.getByLabel("计划名称", { exact: true }).fill("Collection原组合");
  await page.getByRole("button", { name: "保存计划", exact: true }).click();
  await expect(page.locator(".bt-header-tools")).toContainText(
    "已同步 Supabase",
  );
  await page
    .getByRole("button", { name: "组合Collection", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Collection原组合", exact: true }),
  ).toBeVisible();
  await page.getByLabel("搜索组合或股票代码", { exact: true }).fill("DEMO1.US");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "复制为新组合", exact: true }).click();
  await page.getByLabel("计划名称", { exact: true }).fill("Collection复制组合");
  await page.getByLabel("权重1", { exact: true }).fill("30");
  await page.getByLabel("权重2", { exact: true }).fill("70");
  await page.getByRole("button", { name: "保存计划", exact: true }).click();
  await expect(page.locator(".bt-header-tools")).toContainText(
    "已同步 Supabase",
  );
  await page
    .getByRole("button", { name: "组合Collection", exact: true })
    .click();
  await expect(page.locator(".bt-collection-card")).toHaveCount(2);
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
  await page.reload();
  await page
    .getByRole("button", { name: "组合Collection", exact: true })
    .click();
  await expect(page.locator(".bt-collection-card")).toHaveCount(2);
  await page.getByLabel("搜索组合或股票代码", { exact: true }).fill("复制");
  await expect(page.locator(".bt-collection-card")).toHaveCount(1);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "载入编辑", exact: true }).click();
  await expect(page.getByLabel("权重1", { exact: true })).toHaveValue("30");
  await page.getByText("我的投资偏好与规划", { exact: true }).click();
  expect(marketCalls).toBe(0);
  const rate = page.getByLabel("规划换算 · 1 USD = 多少 CAD", { exact: true });
  const oldRate = await rate.inputValue();
  await page
    .getByRole("button", { name: "获取最新官方参考汇率", exact: true })
    .click();
  await expect(page.getByText(/1 USD = 1.38 CAD/)).toBeVisible();
  await expect(rate).toHaveValue(oldRate);
  await page
    .getByRole("button", { name: "用于家庭规划换算", exact: true })
    .click();
  await expect(rate).toHaveValue("1.38");
  await expect(page.getByLabel("起始资金 · USD", { exact: true })).toHaveValue(
    "30000",
  );
  expect(marketCalls).toBe(1);
});
