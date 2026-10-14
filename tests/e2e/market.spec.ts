import { test, expect } from "@playwright/test";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
import { emptyState, saveAsset } from "../../lib/wealth";
import { MACRO, TREASURIES, type MarketData } from "../../lib/market";
const synthetic: MarketData = {
  fetchedAt: "2026-10-14T12:00:00Z",
  failures: [],
  fx: [
    ["FXCNYCAD", "人民币 CNY", 5],
    ["FXUSDCAD", "美元 USD", 0.8],
    ["FXJPYCAD", "日元 JPY", 100],
  ].map(([id, label, value]) => ({
    id: String(id),
    label: String(label),
    value: Number(value),
    date: "2026-10-13",
    unit: " / CAD",
    frequency: "daily",
    source: "https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/",
    trend: [],
    note: "合成日均参考，仅用于测试",
  })),
  yields: TREASURIES.map(([id, label], i) => ({
    id,
    label,
    value: 4 + i * 0.1,
    date: "2026-10-13",
    unit: "%",
    frequency: "daily",
    source: `https://fred.stlouisfed.org/series/${id}`,
    trend: [],
    note: "合成收益率",
  })),
  macro: MACRO.map((row) => ({
    ...row,
    value: row.id === "PAYEMS" ? 29 : 2.2,
    date: row.frequency === "quarterly" ? "2026-04-01" : "2026-09-01",
    source: `https://fred.stlouisfed.org/series/${row.id}`,
    trend: [],
  })),
};
test.beforeEach(async ({ page }) => {
  const state = saveAsset(emptyState(), {
    id: "a",
    name: "合成账户",
    category: "现金",
    owner: "joint",
    value: 500,
    annualReturn: null,
  });
  await authenticate(page, { seed: state });
  await page.route("**/api/market", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(synthetic),
    }),
  );
  await page.route("https://www.tradingview-widget.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><body>隔离的行情测试窗口</body></html>",
    }),
  );
});
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("研究图表按共同期间绘制，窗口可切换，缺预期不编造惊喜指标", async ({
  page,
}) => {
  const rich = structuredClone(synthetic);
  rich.yields.forEach((row) => {
    row.trend = Array.from({ length: 24 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 8, 20 + index)).toISOString().slice(0, 10),
      value: row.value! - 0.23 + index * 0.01,
    }));
  });
  rich.macro.forEach((row) => {
    row.trend = Array.from(
      { length: row.frequency === "quarterly" ? 8 : 24 },
      (_, index) => ({
        date: new Date(
          Date.UTC(
            2024,
            row.frequency === "quarterly" ? 6 + index * 3 : 9 + index,
            1,
          ),
        )
          .toISOString()
          .slice(0, 10),
        value: row.id === "PAYEMS" ? 10 + index : 1.5 + index * 0.03,
      }),
    );
    row.trend.at(-1)!.value = row.value!;
  });
  await page.route("**/api/market", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(rich),
    }),
  );
  await page.goto("/markets");
  await expect(page.getByRole("img", { name: /通胀同比趋势/ })).toHaveAttribute(
    "aria-label",
    /2025-10-01至2026-09-01/,
  );
  await page.getByLabel("宏观历史窗口").selectOption("6");
  await expect(page.getByRole("img", { name: /通胀同比趋势/ })).toHaveAttribute(
    "aria-label",
    /2026-04-01至2026-09-01/,
  );
  await page.getByLabel("宏观历史窗口").selectOption("24");
  await expect(page.getByRole("img", { name: /通胀同比趋势/ })).toHaveAttribute(
    "aria-label",
    /2024-10-01至2026-09-01/,
  );
  await expect(
    page.getByRole("img", { name: /美国国债收益率曲线/ }),
  ).toBeVisible();
  await expect(page.locator("#rates-research")).toContainText("2026-09-23");
  await expect(page.locator(".research-average")).toContainText("+30.7 千人");
  await expect(
    page.getByRole("table", {
      name: "宏观指标监测 · 变化以自身前期为基准，不是市场预期差",
    }),
  ).toContainText("百分点");
  await expect(page.locator(".research-note")).toContainText(
    "未接入市场一致预期",
  );
  await page
    .locator("#macro-research .research-history-data")
    .first()
    .locator("summary")
    .click();
  await expect(
    page
      .locator("#macro-research .research-history-data")
      .first()
      .locator("tbody tr"),
  ).toHaveCount(24);
  await page.locator("#rates-research .research-history-data summary").click();
  await expect(
    page.locator("#rates-research .research-history-data tbody tr"),
  ).toHaveCount(6);
  await expect(
    page.locator("#rates-research .research-history-data"),
  ).toContainText("+20");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator(".market-shell").screenshot({
    path: `test-results/research-${test.info().project.name}.png`,
  });
});
test("独立看板保留导航和当前页状态，返回家庭资产定位正确且不改变账本", async ({
  page,
}) => {
  await page.goto("/markets");
  const mobile = test.info().project.name === "mobile";
  await expect(
    page.locator(
      mobile
        ? '.market-mobile-nav a[aria-current="page"]'
        : '.market-sidebar a[aria-current="page"]',
    ),
  ).toHaveText("市场看板");
  if (mobile)
    await page
      .locator(".market-mobile-nav")
      .getByRole("link", { name: "家庭财富" })
      .click();
  else
    await page
      .locator(".market-sidebar")
      .getByRole("link", { name: "资产与负债" })
      .click();
  await expect(page).toHaveURL(mobile ? /#overview$/ : /#assets$/);
  await expect(page.locator(mobile ? "#overview" : "#assets")).toBeInViewport();
  await expect(page.getByTestId("net-worth")).toContainText("500");
});
test("市场看板入口、币种方向、宏观口径和来源都明确，手机无溢出", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("link", {
      name: test.info().project.name === "mobile" ? "市场" : "市场看板",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "市场看板", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".market-watchlist>div")).toHaveCount(30);
  await expect(page.locator(".market-fx-grid")).toContainText("5 / CAD");
  await page.getByLabel("试算加币金额").fill("100");
  await expect(page.locator(".market-conversion")).toContainText(
    "人民币 CNY：500",
  );
  await expect(page.locator("#macro-research")).toContainText("+29千人");
  await expect(page.locator("#macro-research")).toContainText("2026 Q2");
  await expect(page.locator("#macro-research")).toContainText("环比折年率");
  expect(
    await page.locator(".market-reading a").first().getAttribute("href"),
  ).toContain("bankofcanada.ca");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator(".markets-page").screenshot({
    path: `test-results/market-${test.info().project.name}.png`,
  });
});
test("自选去重、添加删除、刷新保持，并不把行情写入资产", async ({ page }) => {
  await page.goto("/markets");
  await page.getByRole("button", { name: "移除自选TSX:ZSP" }).click();
  await page.getByLabel("新增证券代码").fill("CLS");
  await page.getByLabel("新增证券交易所").selectOption("TSX");
  await page.getByLabel("新增证券名称").fill("Celestica CAD");
  await page.getByRole("button", { name: "加入自选" }).click();
  await expect(
    page.getByRole("button", { name: "查看TSX:CLS图表" }),
  ).toBeVisible();
  await page.getByLabel("新增证券代码").fill("CLS");
  await page.getByRole("button", { name: "加入自选" }).click();
  await expect(page.locator(".market-watchlist>div")).toHaveCount(30);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "移除自选TSX:ZSP" }),
  ).toHaveCount(0);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("together-wealth-v3")!),
  );
  expect(saved.assets[0].value).toBe(500);
  expect(saved.preferences.marketWatchlist).toHaveLength(30);
});
test("外部行情按明确开关加载，隔离URL仅含代码，暂停移除窗口", async ({
  page,
}) => {
  await page.goto("/markets");
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "启用自动更新行情" }).click();
  await expect(page.locator("iframe")).toHaveCount(2);
  const src = await page.getByTitle("自选股票ETF行情").getAttribute("src");
  expect(src).toContain("tradingview-widget.com");
  expect(src).not.toMatch(/apikey|household|assets|messages/);
  await page.getByRole("button", { name: "查看NASDAQ:SPCX图表" }).click();
  await expect(page.getByTitle("所选证券历史图表")).toHaveCount(1);
  await expect(page.getByLabel("选择证券图表")).toHaveValue("NASDAQ:SPCX");
  await page.getByRole("button", { name: "暂停外部行情" }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
});
test("官方数据刷新失败保留原结果和源日期，明确显示旧数据提示", async ({
  page,
}) => {
  await page.goto("/markets");
  await expect(page.locator(".market-fx-grid")).toContainText("2026-10-13");
  await page.route("**/api/market", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "合成数据源暂不可用" }),
    }),
  );
  await page.getByRole("button", { name: "刷新官方数据" }).click();
  await expect(
    page.locator(".markets-page .error-banner[role=alert]"),
  ).toContainText("保留上次成功");
  await expect(page.locator(".market-fx-grid")).toContainText("2026-10-13");
});
