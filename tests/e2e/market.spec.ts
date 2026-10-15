import { test, expect } from "@playwright/test";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
import { emptyState, saveAsset } from "../../lib/wealth";
import {
  DEFAULT_WATCHLIST,
  MACRO,
  TREASURIES,
  type MarketData,
} from "../../lib/market";
import { readFile } from "node:fs/promises";
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
      body: '<html><meta charset="utf-8"><body>隔离的行情测试窗口</body></html>',
    }),
  );
});
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("工作台固定导航、独立搜索和密度切换适配手机并保留偏好", async ({
  page,
}) => {
  await page.goto("/markets");
  const pulse = page.getByRole("region", { name: "自选涨跌速览" });
  await pulse.getByRole("button", { name: "开启自选涨跌速览" }).click();
  await pulse.getByLabel("搜索涨跌速览").fill("META");
  await expect(pulse.getByRole("article")).toHaveCount(1);
  await expect(page.locator(".market-watchlist>div")).toHaveCount(30);
  await pulse.getByLabel("搜索涨跌速览").press("Escape");
  await expect(pulse.getByRole("article")).toHaveCount(30);
  await pulse.getByRole("button", { name: "舒适", exact: true }).click();
  await page.reload();
  await expect(pulse).toHaveAttribute("data-density", "comfortable");
  await pulse.getByRole("button", { name: "紧凑", exact: true }).click();
  await pulse.getByLabel("搜索涨跌速览").fill("no-match-xyz");
  await expect(pulse).toContainText("没有匹配的自选");
  await pulse.getByRole("button", { name: "重置速览筛选" }).click();
  await expect(pulse.getByRole("article")).toHaveCount(30);
  const nav = page.getByRole("navigation", { name: "市场区块导航" });
  await nav.getByRole("link", { name: "宏观研究" }).click();
  await expect(nav.getByRole("link", { name: "宏观研究" })).toHaveAttribute(
    "aria-current",
    "location",
  );
  const position = await nav.boundingBox();
  expect(position!.y).toBeGreaterThanOrEqual(-1);
  expect(position!.y).toBeLessThan(20);
  await nav.getByRole("link", { name: "自选涨跌" }).click();
  await expect(
    pulse.getByRole("heading", { name: "自选涨跌速览" }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await pulse.getByLabel("搜索涨跌速览").fill("NVDA");
  for (let index = 0; index < 2; index++) {
    await pulse
      .getByRole("button", { name: "速览打开NASDAQ:NVDA图表" })
      .click();
    await expect(page.getByLabel("选择证券图表")).toBeInViewport();
    await page.getByRole("link", { name: "↑ 返回涨跌速览" }).click();
    await expect(
      pulse.getByRole("heading", { name: "自选涨跌速览" }),
    ).toBeInViewport();
  }
  await page.screenshot({
    path: `test-results/market-workspace-${test.info().project.name}.png`,
  });
});
test("涨跌速览显示全部自选，不受下方搜索影响，筛选选图与清单增删联动", async ({
  page,
}) => {
  await page.goto("/markets");
  const pulse = page.getByRole("region", { name: "自选涨跌速览" });
  await expect(pulse).toContainText("显示 30 / 30");
  await expect(pulse.locator("iframe")).toHaveCount(0);
  await pulse.getByRole("button", { name: "开启自选涨跌速览" }).click();
  const symbols = async () => {
    const urls = await pulse
      .locator("iframe")
      .evaluateAll((frames) =>
        frames.map((frame) => frame.getAttribute("src")!),
      );
    return urls.flatMap(
      (src) =>
        JSON.parse(decodeURIComponent(new URL(src).hash.slice(1))).symbol,
    );
  };
  expect(await symbols()).toHaveLength(29);
  await page.getByLabel("搜索市场自选").fill("NVDA");
  expect(await symbols()).toHaveLength(29);
  await pulse.getByRole("button", { name: "加拿大 · CAD" }).click();
  expect(
    (await symbols()).every((symbol: string) => symbol.startsWith("TSX:")),
  ).toBe(true);
  await expect(pulse.getByText("当前源暂无覆盖，不表示零涨跌。")).toBeVisible();
  await pulse.getByLabel("从速览查看图表").selectOption("TSX:ZSP");
  await expect(page.getByLabel("选择证券图表")).toHaveValue("TSX:ZSP");
  await page.getByLabel("搜索市场自选").fill("");
  await page.getByRole("button", { name: "移除自选TSX:ZSP" }).click();
  await expect(pulse).toContainText("/ 29 个自选");
  await page.getByRole("button", { name: "撤销移除" }).click();
  await expect(pulse).toContainText("/ 30 个自选");
  await page.getByRole("button", { name: "暂停外部行情" }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("编辑期间另一页更新自选时拒绝覆盖新数据", async ({ page }) => {
  await page.goto("/markets");
  await page.getByRole("button", { name: "编辑自选NASDAQ:NVDA" }).click();
  await page.getByLabel("显示名称", { exact: true }).fill("尚未保存的旧草稿");
  await page.evaluate(
    (rows) => {
      const state = JSON.parse(localStorage.getItem("together-wealth-v3")!);
      state.preferences.marketWatchlist = rows;
      state.revision++;
      const raw = JSON.stringify(state);
      localStorage.setItem("together-wealth-v3", raw);
      dispatchEvent(
        new StorageEvent("storage", {
          key: "together-wealth-v3",
          newValue: raw,
        }),
      );
    },
    DEFAULT_WATCHLIST.map((row, index) =>
      index === 0 ? { ...row, name: "来自另一页的新名称" } : row,
    ),
  );
  await page.getByRole("button", { name: "保存自选修改" }).click();
  await expect(page.getByRole("dialog")).toContainText("已被更新");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("together-wealth-v3")!).preferences
          .marketWatchlist[0].name,
    ),
  ).toBe("来自另一页的新名称");
});
test("点证券后可在原位置开启图表，重试实际重建窗口", async ({ page }) => {
  await page.goto("/markets");
  await page.getByRole("button", { name: "查看NASDAQ:META图表" }).click();
  await expect(
    page.getByRole("heading", { name: "图表尚未连接行情服务" }),
  ).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "开启行情并加载所选图表" }).click();
  await expect(page.locator("iframe")).toHaveCount(32);
  const frame = page.getByTitle("所选证券历史图表"),
    old = await frame.elementHandle();
  await page.getByRole("button", { name: "重试所选证券历史图表" }).click();
  expect(await old!.evaluate((element) => element.isConnected)).toBe(false);
  await expect(page.getByLabel("选择证券图表")).toHaveValue("NASDAQ:META");
});
test("无报价的ZGIN有官方替代入口，不再展开死的图表窗口", async ({ page }) => {
  await page.goto("/markets");
  await page.getByRole("button", { name: "查看TSX:ZGIN图表" }).click();
  await expect(
    page.getByRole("heading", { name: "当前行情源暂不覆盖 ZGIN" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "查看 ZGIN 官方价格与净值 ↗" }),
  ).toHaveAttribute("href", /bmoetfs\.ca/);
  await expect(page.getByTitle("所选证券历史图表")).toHaveCount(0);
});
test("已有自选可编辑，重复拒绝；删减可撤销且刷新持久化", async ({ page }) => {
  await page.goto("/markets");
  await page.getByRole("button", { name: "编辑自选NASDAQ:NVDA" }).click();
  await page.getByLabel("证券代码", { exact: true }).fill("META");
  await page.getByRole("button", { name: "保存自选修改" }).click();
  await expect(page.getByRole("dialog")).toContainText("重复");
  await page.getByLabel("证券代码", { exact: true }).fill("NVDA");
  await page.getByLabel("显示名称", { exact: true }).fill("合成的自选显示名称");
  await page.getByRole("button", { name: "保存自选修改" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "移除自选NASDAQ:NVDA" }).click();
  await expect(page.locator(".market-watchlist>div")).toHaveCount(29);
  await page.getByRole("button", { name: "撤销移除" }).click();
  await expect(page.locator(".market-watchlist>div")).toHaveCount(30);
  await page.reload();
  const state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("together-wealth-v3")!),
  );
  expect(state.preferences.marketWatchlist[0].name).toBe("合成的自选显示名称");
  expect(state.assets[0].value).toBe(500);
  expect(state.history).toHaveLength(0);
});
test("断网刷新恢复上次快照与真实时间，重试恢复新读取", async ({ page }) => {
  await page.goto("/markets");
  await expect(page.locator(".market-fx-grid")).toContainText("5 / CAD");
  await page.route("**/api/market", (route) =>
    route.fulfill({ status: 503, json: { error: "offline" } }),
  );
  await page.reload();
  await expect(page.locator(".market-cache-note")).toContainText(
    "上次缓存快照",
  );
  await expect(page.locator(".market-fx-grid")).toContainText("2026-10-13");
  await page.route("**/api/market", (route) =>
    route.fulfill({ json: synthetic }),
  );
  await page.getByRole("button", { name: "重试官方数据" }).click();
  await expect(page.locator(".market-cache-note")).toHaveCount(0);
  await page.route("**/api/market", (route) =>
    route.fulfill({
      json: {
        ...synthetic,
        fx: synthetic.fx.map((row, index) =>
          index === 0 ? { ...row, value: null, date: null } : row,
        ),
        failures: ["合成外汇源失效"],
      },
    }),
  );
  await page.getByRole("button", { name: "刷新官方数据" }).click();
  await expect(page.locator(".market-fx-grid")).toContainText(
    "保留上次有效观测",
  );
  await expect(page.locator(".market-fx-grid")).toContainText("5 / CAD");
});
test("官方快照真正下载，排除家庭账本、聊天和自定义名称", async ({ page }) => {
  await page.goto("/markets");
  await expect(
    page.getByRole("button", { name: "导出官方快照" }),
  ).toBeEnabled();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出官方快照" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("market-snapshot-2026-10-14.json");
  const snapshot = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(snapshot.kind).toBe("public-market-snapshot");
  expect(snapshot.fx).toHaveLength(3);
  expect(snapshot).not.toHaveProperty("assets");
  expect(snapshot).not.toHaveProperty("messages");
  expect(snapshot.watchlist[0]).not.toHaveProperty("name");
});
test("API会话失效时给出重新登录回看板入口", async ({ page }) => {
  await page.route("**/api/market", (route) =>
    route.fulfill({ status: 401, json: { error: "expired" } }),
  );
  await page.goto("/markets");
  await expect(
    page.getByRole("link", { name: "重新登录市场看板 ↗" }),
  ).toHaveAttribute("href", /next=%2Fmarkets.*reauth=1/);
});
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
  await expect(page.locator("iframe")).toHaveCount(31);
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
