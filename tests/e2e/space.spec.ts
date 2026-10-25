import { test, expect, type Page } from "@playwright/test";
import { emptyState, finishChange } from "../../lib/wealth";
import {
  authenticate,
  assertFixtureConnection,
  cleanupAuthenticated,
} from "./auth-helper";

const seed = () => {
  const state = emptyState();
  state.members = { first: "SpaceAlex", second: "SpaceSam" };
  state.preferences.model = "local";
  state.assets = [
    {
      id: "space-account",
      name: "合成家庭储蓄",
      owner: "joint",
      category: "现金",
      value: 100000,
      annualReturn: 2.5,
      valuationDate: "2026-10-01",
    },
  ];
  state.debts = [
    { id: "space-debt", name: "合成贷款", owner: "joint", value: 10000 },
  ];
  state.budget = [
    {
      id: "space-income",
      name: "合成月收入",
      owner: "first",
      kind: "income",
      amount: 7000,
      essential: false,
    },
    {
      id: "space-expense",
      name: "合成月开支",
      owner: "joint",
      kind: "expense",
      amount: 2500,
      essential: true,
    },
  ];
  return finishChange(
    state,
    state,
    "合成家庭盘点",
    true,
    new Date("2026-10-01T15:00:00Z"),
  );
};

async function setup(page: Page) {
  const initial = seed();
  const household = await authenticate(page, { seed: initial });
  const paid: string[] = [];
  // Fail closed even if an integration flag is set: these scenarios must never
  // generate an advisor answer, council turn, or market briefing.
  await page.route(/\/api\/(?:advisor|council)(?:\?|$)/, (route) => {
    if (route.request().method() === "POST")
      paid.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      status: 503,
      json: { error: "Synthetic test: paid generation is disabled." },
    });
  });
  await page.route(/\/api\/market\/briefing(?:\/daily)?(?:\?|$)/, (route) => {
    if (route.request().method() === "POST")
      paid.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      json: { reports: [], today: "2026-10-18", canGenerate: false },
    });
  });
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
  await page.route("https://www.tradingview-widget.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><body>Synthetic public-market fixture</body></html>",
    }),
  );
  return { initial, household, paid };
}

async function readySpace(page: Page) {
  await expect(page.locator(".space-trust")).toContainText("已同步 Supabase");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "把今天，留给真正重要的事。",
  );
}

const savedLedger = (page: Page) =>
  page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("together-wealth-v3")!);
    return {
      revision: state.revision,
      updatedAt: state.updatedAt,
      history: state.history,
      assets: state.assets,
      debts: state.debts,
      budget: state.budget,
    };
  });

test.afterEach(async ({ page }) => cleanupAuthenticated(page));

test("家庭首页只读展示真实账本，资产编辑后摘要和云端刷新保持联动", async ({
  page,
}) => {
  const { initial, household, paid } = await setup(page);
  await page.goto("/space");
  await readySpace(page);
  await assertFixtureConnection(page, household);
  const summary = page.getByRole("region", { name: "家庭状态摘要" });
  await expect(summary.locator(".is-wealth strong")).toHaveText("$90,000.00");
  await expect(summary.getByRole("link", { name: /每月可留存/ })).toContainText(
    "$4,500.00",
  );
  await expect(summary).toContainText("来自家庭账本，非实时市值");
  await expect(summary).toContainText("已记录收支的估算，非实际储蓄");
  await expect(page.getByRole("region", { name: "家庭下一步" })).toContainText(
    "依据已保存记录整理，不是 AI 预测或实时市场建议。",
  );
  const unchanged = {
    revision: initial.revision,
    updatedAt: initial.updatedAt,
    history: initial.history,
    assets: initial.assets,
    debts: initial.debts,
    budget: initial.budget,
  };
  expect(await savedLedger(page)).toEqual(unchanged);
  await page.reload();
  await readySpace(page);
  expect(await savedLedger(page)).toEqual(unchanged);
  expect(paid).toEqual([]);

  await page
    .getByRole("region", { name: "家庭生活空间" })
    .getByRole("link", { name: "盘点资产", exact: true })
    .click();
  await expect(page).toHaveURL(/\/#assets$/);
  await expect(page.getByTestId("net-worth")).toHaveText("$90,000.00");
  await page
    .getByRole("button", { name: "编辑合成家庭储蓄", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "编辑资产" });
  await dialog.getByLabel("当前价值（CAD）", { exact: true }).fill("120000");
  const persisted = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith(
        "/rpc/save_household_document",
      ) && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "保存资产", exact: true }).click();
  expect((await persisted).ok()).toBe(true);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
  await expect(page.getByTestId("net-worth")).toHaveText("$110,000.00");

  await page.goto("/space");
  await readySpace(page);
  await expect(summary.locator(".is-wealth strong")).toHaveText("$110,000.00");
  const edited = await savedLedger(page);
  expect(edited.assets[0].value).toBe(120000);
  expect(edited.revision).toBe(initial.revision + 1);
  expect(edited.history).toHaveLength(initial.history.length + 1);
  expect(edited.history.at(-1).netWorth).toBe(110000);
  await page.reload();
  await readySpace(page);
  await expect(summary.locator(".is-wealth strong")).toHaveText("$110,000.00");
  await expect(summary.getByRole("link", { name: /每月可留存/ })).toContainText(
    "$4,500.00",
  );
  expect(await savedLedger(page)).toEqual(edited);
  expect(paid).toEqual([]);
});

test("首页与财富工作台沿用同一会话隐私偏好，隐藏成员、金额和家庭行动", async ({
  page,
}) => {
  const { paid } = await setup(page);
  await page.goto("/space");
  await readySpace(page);
  await expect(page.locator(".space-intro")).toContainText(
    "SpaceAlex & SpaceSam",
  );
  await expect(page.locator(".space-action-list")).toBeVisible();
  await page.getByRole("button", { name: "隐藏家庭数据", exact: true }).click();
  expect(
    await page.evaluate(() => sessionStorage.getItem("together-privacy")),
  ).toBe("on");
  await expect(page.locator(".space-intro")).not.toContainText("SpaceAlex");
  await expect(
    page.getByRole("region", { name: "家庭状态摘要" }),
  ).not.toContainText("$90,000.00");
  await expect(page.getByRole("region", { name: "家庭下一步" })).toContainText(
    "家庭数据已隐藏",
  );
  await expect(page.locator(".space-action")).toHaveCount(0);
  await page.reload();
  await readySpace(page);
  await expect(
    page.getByRole("button", { name: "显示家庭数据", exact: true }),
  ).toBeVisible();

  await page.goto("/#assets");
  await expect(page.locator(".privacy-curtain")).toBeVisible();
  await expect(page.getByTestId("net-worth")).not.toBeVisible();
  await expect(page.locator("body")).not.toContainText("SpaceAlex", {
    useInnerText: true,
  });
  await expect(page.locator("body")).not.toContainText("SpaceSam", {
    useInnerText: true,
  });
  await expect(page.locator("body")).not.toContainText("$90,000.00", {
    useInnerText: true,
  });
  await page.getByRole("button", { name: "显示家庭数据", exact: true }).click();
  await expect(page.getByTestId("net-worth")).toHaveText("$90,000.00");
  expect(
    await page.evaluate(() => sessionStorage.getItem("together-privacy")),
  ).toBe("off");
  await page.goto("/space");
  await readySpace(page);
  await expect(page.locator(".space-intro")).toContainText(
    "SpaceAlex & SpaceSam",
  );
  await expect(page.locator(".space-metric.is-wealth strong")).toHaveText(
    "$90,000.00",
  );
  expect(paid).toEqual([]);
});

test("六个空间与真实子功能互通，最近使用继续具体入口，窄屏锚点不被顶栏遮挡", async ({
  page,
}) => {
  test.setTimeout(90000);
  const { paid } = await setup(page);
  const originalViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.goto("/space");
  await readySpace(page);
  const navigation = page.locator(".app-space-navigation");
  await expect(navigation.getByRole("link")).toHaveCount(6);
  for (const [title, href] of [
    ["家庭首页", "/space"],
    ["财富总览", "/#overview"],
    ["市场看板", "/markets"],
    ["多模型研讨", "/council"],
    ["每日心理学", "/learn"],
    ["兴趣与生活", "/lifestyle"],
  ])
    await expect(
      navigation.getByRole("link", { name: title, exact: true }),
    ).toHaveAttribute("href", href);

  const domains = page.getByRole("region", { name: "家庭生活空间" });
  await domains.getByRole("link", { name: "家庭敞口", exact: true }).click();
  await expect(page).toHaveURL(/\/markets#market-wealth$/);
  await expect(
    page.getByRole("region", { name: "市场与家庭联动" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "管理账户关联", exact: true }),
  ).toBeEnabled();
  await page.goto("/space");
  await readySpace(page);
  let recent = page.getByRole("region", { name: "继续使用" });
  await expect(recent.locator(".space-recent").first()).toHaveAttribute(
    "href",
    "/markets#market-wealth",
  );
  await recent.getByRole("link", { name: /市场 × 家庭联动/ }).click();
  await expect(page).toHaveURL(/\/markets#market-wealth$/);
  await expect(
    page.getByRole("region", { name: "市场与家庭联动" }),
  ).toBeVisible();

  await page.goto("/space");
  await readySpace(page);
  await domains.getByRole("link", { name: "Set 编排", exact: true }).click();
  await expect(page).toHaveURL(/\/lifestyle#sets$/);
  await expect(
    page.getByRole("tab", { name: "Set Builder", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.goto("/space");
  await readySpace(page);
  recent = page.getByRole("region", { name: "继续使用" });
  await expect(recent.locator(".space-recent").first()).toHaveAttribute(
    "href",
    "/lifestyle#sets",
  );
  await recent.getByRole("link", { name: /DJ Set 编排/ }).click();
  await expect(page).toHaveURL(/\/lifestyle#sets$/);
  await expect(
    page.getByRole("tab", { name: "Set Builder", exact: true }),
  ).toHaveAttribute("aria-selected", "true");

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 920 });
    await page.goto("/space");
    await readySpace(page);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      )
      .toBe(true);
    await domains.getByRole("link", { name: "盘点资产", exact: true }).click();
    await expect(page).toHaveURL(/\/#assets$/);
    await expect(page.locator("#assets h2")).toHaveText("家庭资产负债表");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const target = document
            .querySelector("#assets h2")!
            .getBoundingClientRect();
          const bar = document.querySelector(".app-mobile-bar")!;
          const top =
            getComputedStyle(bar).display === "none"
              ? 0
              : bar.getBoundingClientRect().bottom;
          return target.top >= top && target.bottom < innerHeight;
        }),
      )
      .toBe(true);
  }
  await page.setViewportSize(originalViewport);
  await page.goto("/space");
  await readySpace(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: test.info().outputPath("together-space.png"),
  });
  expect(paid).toEqual([]);
});
