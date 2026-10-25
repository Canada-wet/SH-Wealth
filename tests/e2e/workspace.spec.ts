import { test, expect } from "@playwright/test";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
import { emptyState, finishChange } from "../../lib/wealth";
import { todayToronto } from "../../lib/household-workspace";
const fixture = () => {
  const s = emptyState();
  s.preferences.model = "local";
  s.assets = [
    {
      id: "a",
      name: "共同储蓄",
      owner: "joint",
      category: "现金",
      value: 100000,
      annualReturn: 2,
      note: "应急用途",
      liquidity: "available",
    },
    {
      id: "b",
      name: "期限储蓄",
      owner: "first",
      category: "现金",
      value: 20000,
      annualReturn: null,
      liquidity: "locked",
      valuationDate: "2000-01-01",
    },
  ];
  s.debts = [
    {
      id: "d",
      name: "测试贷款",
      owner: "joint",
      value: 10000,
      annualRate: 5,
      monthlyPayment: 100,
    },
  ];
  s.budget = [
    {
      id: "i1",
      name: "收入一",
      owner: "first",
      amount: 4000,
      kind: "income",
      essential: false,
    },
    {
      id: "i2",
      name: "收入二",
      owner: "second",
      amount: 6000,
      kind: "income",
      essential: false,
    },
    {
      id: "e",
      name: "共同开支",
      owner: "joint",
      amount: 2000,
      kind: "expense",
      essential: true,
    },
    {
      id: "p",
      name: "个人开支",
      owner: "first",
      amount: 1000,
      kind: "expense",
      essential: true,
    },
  ];
  s.goal = { name: "测试目标", target: 200000, year: "2032" };
  return finishChange(emptyState(), s, "合成盘点", true);
};
test.beforeEach(async ({ page }) => {
  await authenticate(page, { seed: fixture() });
  await page.goto("/");
});
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("批量价值与回报原子保存、保留资料、历史差异与安全撤销", async ({
  page,
}) => {
  await page.getByRole("button", { name: "批量核对", exact: true }).click();
  await page.getByLabel("批量价值共同储蓄").fill("125000");
  await page.getByLabel("批量回报共同储蓄").fill("-2");
  await page.getByRole("button", { name: "保存勾选估值" }).click();
  await expect(page.getByTestId("net-worth")).toHaveText("$135,000.00");
  let s = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("together-wealth-v3")!),
  );
  expect(s.assets[0].note).toBe("应急用途");
  expect(s.assets[0].valuationDate).toBe(todayToronto());
  expect(s.assets[1].value).toBe(20000);
  expect(s.history).toHaveLength(2);
  await page
    .locator(".chart-card")
    .getByRole("button", { name: "历史", exact: true })
    .click();
  await page.locator(".history-comparison > summary").click();
  await expect(page.locator(".history-comparison")).toContainText("$25,000.00");
  await page.getByLabel("关闭弹窗").click();
  await page.getByRole("button", { name: "撤销上次修改" }).click();
  await expect(page.getByTestId("net-worth")).toHaveText("$110,000.00");
  s = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("together-wealth-v3")!),
  );
  expect(s.history).toHaveLength(3);
  await page.reload();
  await expect(page.getByTestId("net-worth")).toHaveText("$110,000.00");
});
test("共同分摊、目标节奏与负债成本都联动，选择刷新保留", async ({ page }) => {
  await page.locator(".household-next > summary").click();
  await expect(page.locator(".household-next")).toContainText("$500.00/年");
  await page.getByLabel("共同开支分摊方式").selectOption("income");
  const sharing = page.locator(".household-next .planning-metrics").nth(1);
  await expect(sharing).toContainText("$800.00");
  await expect(sharing).toContainText("$1,200.00");
  await page.getByRole("button", { name: "核对测试贷款利率与还款" }).click();
  await page.getByLabel("年利率（%）").fill("0");
  await page.getByRole("button", { name: "保存负债" }).click();
  await expect(page.locator(".household-next")).toContainText("$0.00/年");
  await page.reload();
  await page.locator(".household-next > summary").click();
  await expect(page.getByLabel("共同开支分摊方式")).toHaveValue("income");
  const s = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("together-wealth-v3")!),
  );
  expect(s.budget).toHaveLength(4);
  expect(s.debts[0].annualRate).toBe(0);
  await page.locator(".household-next").screenshot({
    path: `test-results/planning-${test.info().project.name}.png`,
  });
});
test("账户核对日期与流动性联动首页，拒绝丢弃表单可继续编辑", async ({
  page,
}) => {
  await page.locator(".valuation-review > summary").click();
  await expect(page.locator(".valuation-review")).toContainText("日期未知");
  await page.getByRole("button", { name: "编辑共同储蓄", exact: true }).click();
  await page.getByLabel("估值核对日期").fill(todayToronto());
  await page.getByLabel("资金可动用情况").selectOption("locked");
  await page.getByLabel("账户备注").fill("明年到期");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByLabel("关闭弹窗").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "保存资产" }).click();
  await expect(page.locator(".valuation-review")).not.toContainText("日期未知");
  await expect(page.locator(".pulse-metrics")).toContainText("0.0 个月");
  await page.reload();
  const s = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("together-wealth-v3")!),
  );
  expect(s.assets[0]).toMatchObject({
    note: "明年到期",
    liquidity: "locked",
    valuationDate: todayToronto(),
  });
});
test("隐私模式隐藏财务与顾问，刷新仍隐藏，恢复不改账本", async ({ page }) => {
  const before = await page.evaluate(() =>
    localStorage.getItem("together-wealth-v3"),
  );
  await page.getByRole("button", { name: "隐藏家庭数据" }).click();
  await expect(page.getByTestId("net-worth")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "打开财富顾问" })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(page.getByText("家庭数据已隐藏")).toBeVisible();
  await page.getByRole("button", { name: "显示家庭数据" }).click();
  await expect(page.getByTestId("net-worth")).toHaveText("$110,000.00");
  expect(
    await page.evaluate(() => localStorage.getItem("together-wealth-v3")),
  ).toBe(before);
});
