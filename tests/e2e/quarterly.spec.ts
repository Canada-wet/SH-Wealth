import { test, expect } from "@playwright/test";
import { authenticate, cleanupAuthenticated, assertFixtureConnection } from "./auth-helper";
import { emptyState, finishChange } from "../../lib/wealth";
import {
  latestCompletedQuarter,
  quarterPeriod,
  torontoDay,
} from "../../lib/quarterly-review";
import { REVIEW_CHECKS } from "../../lib/quarterly-schema";

const key = latestCompletedQuarter(),
  period = quarterPeriod(key);
function fixture() {
  const s = emptyState();
  s.preferences.model = "local";
  s.members = { first: "Alex", second: "Sam" };
  s.assets = [
    {
      id: "a",
      name: "模拟家庭储蓄",
      owner: "joint",
      category: "现金",
      value: 10000,
      annualReturn: null,
    },
  ];
  const opening = new Date(`${period.start}T12:00:00Z`);
  opening.setUTCDate(opening.getUTCDate() - 1);
  const first = finishChange(emptyState(), s, "合成期初", true, opening);
  return finishChange(
    first,
    { ...first, assets: [{ ...s.assets[0], value: 12000 }] },
    "合成期末",
    true,
    new Date(`${period.end}T12:00:00Z`),
  );
}
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("季度复盘：提醒、核对、行动、归档、继续跟进和刷新持久化", async ({
  page,
}) => {
  await authenticate(page, { seed: fixture() });
  await page.goto("/");
  await page.bringToFront();
  await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
  await expect(page.locator(".quarter-reminder")).toBeVisible();
  await page.locator(".quarter-reminder").click();
  const review = page.getByRole("region", { name: "家庭季度复盘" });
  await expect(review).toBeVisible();
  await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
  await expect(review).toContainText("$10,000.00");
  await expect(review).toContainText("$12,000.00");
  await expect(review).toContainText("$2,000.00");
  await expect(
    review.getByRole("button", { name: "完成并归档复盘" }),
  ).toBeDisabled();
  for (const label of Object.values(REVIEW_CHECKS))
    await review.getByLabel(label, { exact: true }).check();
  await review
    .getByLabel("季度复盘笔记")
    .fill("先核实应急资金用途，再确认下季的共同安排。");
  await review
    .getByLabel("下季度行动", { exact: true })
    .fill("核实定存赎回条件");
  await review.getByLabel("行动负责人").selectOption("second");
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + 14);
  await review.getByLabel("行动到期日").fill(torontoDay(due));
  await review.getByRole("button", { name: "添加行动", exact: true }).click();
  await expect(review).toContainText("核实定存赎回条件");
  await review
    .getByRole("button", { name: "编辑行动：核实定存赎回条件", exact: true })
    .click();
  await review.getByLabel("行动负责人").selectOption("joint");
  await review
    .getByRole("button", { name: "保存行动修改", exact: true })
    .click();
  await review.getByRole("button", { name: "完成并归档复盘" }).click();
  await expect(review).toContainText("复盘已归档");
  await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
  await expect(page.locator(".quarter-reminder")).toHaveCount(0);
  await expect(review.getByLabel("季度复盘笔记")).toBeDisabled();
  await review.getByLabel("完成行动：核实定存赎回条件").check();
  await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
  await page.reload();
  await expect(review.getByLabel("完成行动：核实定存赎回条件")).toBeChecked();
  await expect(review.getByLabel("季度复盘笔记")).toHaveValue(
    "先核实应急资金用途，再确认下季的共同安排。",
  );
  const state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("together-wealth-v3")!),
  );
  expect(state.assets[0].value).toBe(12000);
  expect(state.history).toHaveLength(2);
  expect(state.preferences.quarterlyReviews.records[key].actions[0].owner).toBe(
    "joint",
  );
  expect(
    state.preferences.quarterlyReviews.records[key].evidence.closing.netWorth,
  ).toBe(12000);
  await review.getByRole("button", { name: "让 AI 带我们复盘" }).click();
  await expect(page.getByLabel("顾问消息")).toHaveValue(
    /只做分析，不修改数据或执行交易/,
  );
  await page.getByRole("button", { name: "收起顾问", exact: true }).click();
  await review.scrollIntoViewIfNeeded();
  await review.screenshot({
    path: `test-results/quarterly-review-${test.info().project.name}.png`,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("延后、取消和外部提醒偏好保存，导出不修改账本", async ({ page }) => {
  await authenticate(page, { seed: fixture() });
  await page.goto("/#quarterly-review");
  const review = page.getByRole("region", { name: "家庭季度复盘" });
  await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
  await review.getByText("提醒与下次安排", { exact: true }).click();
  await review.getByRole("button", { name: "7 天后再提醒" }).click();
  await expect(page.locator(".quarter-reminder")).toHaveCount(0);
  await review.getByRole("checkbox", { name: /同时发到/ }).check();
  await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
  await page.reload();
  await review.getByText("提醒与下次安排", { exact: true }).click();
  await expect(
    review.getByRole("checkbox", { name: /同时发到/ }),
  ).toBeChecked();
  await review.getByRole("button", { name: "恢复提醒", exact: true }).click();
  await expect(page.locator(".quarter-reminder")).toHaveCount(1);
  await review.getByRole("checkbox", { name: /同时发到/ }).uncheck();
  const download = page.waitForEvent("download");
  await review.getByRole("button", { name: "导出草稿", exact: true }).click();
  expect((await download).suggestedFilename()).toBe(
    `Together-${key}-review.json`,
  );
});
test("缺少历史时保留未知、不展示虚构季末数据，隐私模式也隐藏复盘", async ({
  page,
}) => {
  const s = fixture();
  s.history = [];
  await authenticate(page, { seed: s });
  await page.goto("/#quarterly-review");
  const review = page.getByRole("region", { name: "家庭季度复盘" });
  await expect(review).toContainText("暂不可比较");
  await expect(review).toContainText("缺少期初记录");
  await expect(review.locator(".quarter-metrics")).not.toContainText("$12,000");
  await page.getByRole("button", { name: "隐藏家庭数据", exact: true }).click();
  await expect(review).not.toBeVisible();
  await expect(page.locator(".quarter-reminder")).not.toBeVisible();
});
test("真实Supabase临时家庭：双方共享季度笔记与行动，刷新后仍可回看", async ({
  page,
  browser,
}) => {
  test.skip(
    process.env.RUN_SUPABASE_E2E !== "1",
    "Actual household round-trip is opt-in",
  );
  test.setTimeout(60000);
  const seed = fixture();
  seed.preferences.proactive = false;
  const home = await authenticate(page, { seed });
  const partnerContext = await browser.newContext(),
    partner = await partnerContext.newPage();
  try {
    await authenticate(partner, {
      email: "sallyxie0378@gmail.com",
      householdId: home,
    });
    await page.goto("/#quarterly-review");
    const review = page.getByRole("region", { name: "家庭季度复盘" });
    await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
    await assertFixtureConnection(page, home);
    await review
      .getByLabel("季度复盘笔记")
      .fill("合成云端复盘笔记，不是真实家庭信息。");
    await review.getByLabel("下季度行动", { exact: true }).fill("合成共同核对");
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 14);
    await review.getByLabel("行动到期日").fill(torontoDay(date));
    await review.getByRole("button", { name: "添加行动", exact: true }).click();
    await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
    await partner.goto("/#quarterly-review");
    await expect(partner.locator(".save-status")).toContainText("已同步 Supabase");
    await assertFixtureConnection(partner, home);
    const partnerReview = partner.getByRole("region", { name: "家庭季度复盘" });
    await expect(partnerReview.getByLabel("季度复盘笔记")).toHaveValue(
      "合成云端复盘笔记，不是真实家庭信息。",
    );
    await partnerReview.getByLabel("完成行动：合成共同核对").check();
    await expect(partner.locator(".save-status")).toContainText(
      "已同步 Supabase",
    );
    await page.reload();
    await expect(review.getByLabel("完成行动：合成共同核对")).toBeChecked();
  } finally {
    await partnerContext.close();
  }
});
