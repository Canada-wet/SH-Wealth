import { test, expect } from "@playwright/test";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
import { emptyState } from "../../lib/wealth";
import { APP_VERSION } from "../../lib/releases";
import {
  EMPTY_LEARNING,
  LESSONS,
  type LearningPreferences,
} from "../../lib/learning";
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("账户关联保存、比例校验与压力测算联动但不写估值，隐私模式隐藏财务", async ({
  page,
}) => {
  const state = emptyState();
  state.assets = [
    {
      id: "account",
      name: "合成投资账户",
      owner: "first",
      category: "投资",
      value: 10000,
      annualReturn: null,
    },
  ];
  await authenticate(page, { seed: state });
  await page.route("**/api/market", (r) =>
    r.fulfill({
      json: {
        fetchedAt: new Date().toISOString(),
        fx: [],
        yields: [],
        macro: [],
        indicators: [],
        failures: [],
      },
    }),
  );
  await page.goto("/markets#market-wealth");
  const panel = page.getByRole("region", { name: "市场与家庭联动" });
  await expect(page.locator(".market-sync-status")).toContainText("已同步");
  await panel.getByRole("button", { name: "管理账户关联" }).click();
  await panel.getByRole("button", { name: "添加关联", exact: true }).click();
  await panel.getByLabel("账户配置 % 1", { exact: true }).fill("101");
  await panel.getByRole("button", { name: "保存账户关联" }).click();
  await expect(panel.getByRole("alert")).toContainText("比例");
  await panel.getByLabel("账户配置 % 1", { exact: true }).fill("50");
  await panel
    .getByRole("combobox", { name: "外币敞口 1", exact: true })
    .selectOption("USD");
  await panel.getByRole("button", { name: "保存账户关联" }).click();
  await expect(panel).toContainText("$5,000.00");
  await expect(page.locator(".market-sync-status")).toContainText("已同步");
  await panel.getByText("查看关联明细与压力试算", { exact: true }).click();
  await expect(panel.getByRole("status").last()).toContainText("-$1,200.00");
  const financial = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("together-wealth-v3")!);
    return { assets: s.assets, history: s.history };
  });
  expect(financial).toEqual({ assets: state.assets, history: [] });
  await page.reload();
  await expect(panel).toContainText("NASDAQ:NVDA");
  await panel.screenshot({
    path: `test-results/portfolio-links-${test.info().project.name}.png`,
  });
  await panel
    .getByRole("link", { name: "请顾问结合家庭计划分析 →", exact: true })
    .click();
  await expect(page.getByLabel("顾问消息")).toHaveValue(/账户与证券关联/);
  await page.getByRole("button", { name: "收起顾问", exact: true }).click();
  await page.goto("/markets#market-wealth");
  await page.evaluate(() => sessionStorage.setItem("together-privacy", "on"));
  await page.reload();
  await expect(panel).toContainText("家庭联动内容已隐藏");
  await expect(panel).not.toContainText("$5,000.00");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("每日心理学收藏、回看、失败重试与订阅明确保存；版本页验证管理员", async ({
  page,
}) => {
  await authenticate(page, { seed: emptyState() });
  let preferences: LearningPreferences = structuredClone(EMPTY_LEARNING),
    fail = false;
  await page.route("**/api/learning**", async (route) => {
    if (route.request().method() === "PUT") {
      if (fail)
        return route.fulfill({
          status: 409,
          json: { error: "另一设备已更新，请重新读取" },
        });
      const body = route.request().postDataJSON();
      preferences = { ...body.preferences, version: preferences.version + 1 };
    }
    return route.fulfill({ json: { preferences, deliveries: [] } });
  });
  await page.goto("/learn");
  const card = page.getByRole("article");
  await card.getByRole("button", { name: "收藏卡片", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "取消收藏", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await page.getByRole("button", { name: /我的收藏/ }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByLabel("搜索收藏").fill("无此结果");
  await expect(page.getByText("没有匹配收藏。")).toBeVisible();
  await page.getByLabel("搜索收藏").fill("");
  await page
    .getByRole("button", { name: "重新开启每日更新", exact: true })
    .click();
  await expect(
    page.getByText("当前设置已同步云端。", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /我的收藏/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page
    .getByRole("button", { name: "订阅我的每日提醒", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "关闭我的每日提醒", exact: true }),
  ).toBeVisible();
  fail = true;
  await card.getByRole("button", { name: "取消收藏", exact: true }).click();
  await expect(page.locator('.learning-page [role="alert"]')).toContainText(
    "另一设备已更新",
  );
  expect(preferences.favorites).toHaveLength(1);
  fail = false;
  await page.getByRole("button", { name: "重新读取收藏" }).click();
  await expect(
    card.getByRole("button", { name: "取消收藏", exact: true }),
  ).toBeEnabled();
  await card.getByText("研究来源与适用边界", { exact: true }).click();
  await expect(
    card.getByRole("link", { name: /阅读原始研究/ }),
  ).toHaveAttribute("href", /^https:\/\//);
  await page.getByRole("button", { name: "每日与回看", exact: true }).click();
  const dates = page.getByLabel("心理学回看日期");
  expect(await dates.locator("option").count()).toBeGreaterThan(0);
  await page.screenshot({
    path: `test-results/learning-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("/updates");
  await expect(page.locator(".admin-status")).toContainText("管理员");
  await expect(
    page.getByRole("heading", {
      name: new RegExp(`v${APP_VERSION.replaceAll(".", "\\.")}`),
    }),
  ).toBeVisible();
});
test("真实个人收藏跨设备保存、伴侣隔离、关闭订阅；只使用临时家庭", async ({
  page,
}) => {
  test.skip(
    process.env.RUN_LEARNING_INTEGRATION !== "1",
    "需显式启用真实私密 Supabase 收藏测试",
  );
  const home = await authenticate(page, { seed: emptyState() });
  await page.goto("/learn");
  const preferences = { version: 0, daily: false, favorites: [LESSONS[0].id] };
  const saved = await page.request.put("/api/learning", {
    data: { household: home, preferences },
  });
  expect(saved.status()).toBe(200);
  expect(
    (await page.request.get(`/api/learning?household=${home}`)).status(),
  ).toBe(200);
  const partner = await page.context().browser()!.newContext();
  try {
    const p = await partner.newPage();
    await authenticate(p, {
      householdId: home,
      email: "sallyxie0378@gmail.com",
    });
    await p.goto("/learn");
    const result = await (
      await p.request.get(`/api/learning?household=${home}`)
    ).json();
    expect(result.preferences).toEqual(EMPTY_LEARNING);
    await p.goto("/updates");
    await expect(p.locator(".admin-status")).toContainText(
      "sallyxie0378@gmail.com",
    );
  } finally {
    await partner.close();
  }
  await page.reload();
  await page.getByRole("button", { name: /我的收藏/ }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  expect(
    (
      await page.request.put("/api/learning", {
        data: { household: home, preferences },
      })
    ).status(),
  ).toBe(409);
});
