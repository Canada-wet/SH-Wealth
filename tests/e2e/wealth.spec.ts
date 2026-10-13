import { test, expect, type Page } from "@playwright/test";
import { emptyState, saveAsset } from "../../lib/wealth";
import { authenticate } from "./auth-helper";
test.beforeEach(async ({ page }) => authenticate(page));
const document = () =>
  saveAsset(emptyState(), {
    id: "a",
    name: "共同储蓄",
    category: "现金",
    owner: "joint",
    value: 100000,
    annualReturn: 2,
  });
async function seed(page: Page) {
  await page.addInitScript((state) => {
    if (!localStorage.getItem("together-wealth-v3"))
      localStorage.setItem("together-wealth-v3", JSON.stringify(state));
  }, document());
  await page.goto("/");
  await expect(page.getByTestId("net-worth")).toHaveText("$100,000.00");
}
async function openAsset(page: Page) {
  await page.getByRole("button", { name: "编辑共同储蓄", exact: true }).click();
  return page.getByRole("dialog");
}
test("回报可直接编辑为负数、零和清空，刷新后保留", async ({ page }) => {
  await seed(page);
  for (const value of ["-5.25", "0", ""]) {
    await page.getByRole("button", { name: "编辑共同储蓄本年回报" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("本年回报（%）").fill(value);
    await dialog.getByRole("button", { name: "保存资产" }).click();
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "编辑共同储蓄本年回报" }),
    ).toHaveText(value === "" ? "填写回报" : `${value}%`);
  }
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("together-wealth-v3")!),
  );
  expect(saved.assets[0].annualReturn).toBeNull();
  expect(saved.history).toHaveLength(3);
});
test("贡献、负债、目标、改名和图表完整联动，跨页刷新持久化", async ({
  page,
}) => {
  await seed(page);
  await page
    .locator("#assets")
    .getByRole("button", { name: "负债", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("负债名称").fill("房贷");
  await dialog.getByLabel("当前余额（CAD）").fill("10000");
  await dialog.getByRole("button", { name: "保存负债" }).click();
  await expect(page.getByTestId("net-worth")).toHaveText("$90,000.00");
  for (const [member, amount] of [
    ["first", "2000"],
    ["second", "3000"],
  ]) {
    await page.getByRole("button", { name: "记录贡献", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("贡献成员").selectOption(member);
    await dialog.getByLabel("金额（CAD）").fill(amount);
    await dialog.getByLabel("关联资产账户").selectOption("a");
    await dialog.getByRole("button", { name: "保存贡献" }).click();
    await expect(dialog).not.toBeVisible();
  }
  await expect(page.getByTestId("net-worth")).toHaveText("$95,000.00");
  await expect(page.locator(".contribution-summary")).toContainText("40.0%");
  await expect(page.locator(".contribution-summary")).toContainText("60.0%");
  await expect(page.locator(".ownership-strip")).toContainText("100.0%");
  await page
    .locator("#contributions")
    .getByRole("button", { name: /编辑贡献/ })
    .first()
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("金额（CAD）").fill("2500");
  await dialog.getByRole("button", { name: "保存贡献" }).click();
  await expect(page.getByTestId("net-worth")).toHaveText("$95,500.00");
  if (await page.locator(".sidebar .people").isVisible())
    await page.locator(".sidebar .people").click();
  else
    await page
      .locator(".mobile-nav")
      .getByRole("button", { name: "成员" })
      .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("成员一显示名").fill("Alice");
  await dialog.getByLabel("成员二显示名").fill("Bob");
  await dialog.getByRole("button", { name: "保存名称" }).click();
  await expect(page.locator(".ownership-strip")).toContainText("Alice持有");
  await expect(page.locator(".contribution-summary")).toContainText("Alice");
  await page.getByRole("button", { name: "编辑财富目标" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("目标净资产（CAD）").fill("200000");
  await dialog.getByRole("button", { name: "保存目标" }).click();
  await expect(page.locator(".goal-top")).toContainText("47.8%");
  await page.locator("#emergency>summary").click();
  await page.getByLabel("每月必要开支（CAD）").fill("5000");
  await page.getByLabel("目标覆盖月数").fill("6");
  await expect(page.locator(".emergency-result")).toContainText("$30,000");
  await page.reload();
  await expect(page.getByTestId("net-worth")).toHaveText("$95,500.00");
  await expect(page.locator(".contribution-summary")).toContainText("Alice");
  await page.locator("#emergency>summary").click();
  await expect(page.getByLabel("每月必要开支（CAD）")).toHaveValue("5000");
  const actual = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("together-wealth-v3")!),
  );
  expect(actual.assets[0].value).toBe(105500);
  expect(actual.debts[0].value).toBe(10000);
  expect(actual.contributions).toHaveLength(2);
  expect(actual.history.at(-1).netWorth).toBe(95500);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: `test-results/wealth-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.screenshot({
    path: `test-results/wealth-preview-${test.info().project.name}.png`,
  });
});
test("现金流表格驱动应急金目标，编辑、删除和刷新保存", async ({ page }) => {
  await seed(page);
  await page
    .locator("#cashflow")
    .getByRole("button", { name: "添加项目" })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("项目名称").fill("房租");
  await dialog.getByLabel("每月金额（CAD）").fill("3000");
  await dialog.getByRole("button", { name: "保存现金流" }).click();
  await page.locator("#emergency>summary").click();
  await page.getByLabel("目标覆盖月数").fill("6");
  await expect(page.getByLabel("每月必要开支（CAD）")).toHaveValue("3000");
  await expect(page.locator(".emergency-result")).toContainText("$18,000");
  await page.getByRole("button", { name: "编辑现金流房租" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("每月金额（CAD）").fill("4000");
  await dialog.getByRole("button", { name: "保存现金流" }).click();
  await expect(page.locator(".emergency-result")).toContainText("$24,000");
  await page.reload();
  await expect(page.locator("#cashflow")).toContainText("$4,000.00");
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除现金流房租" }).click();
  await expect(
    page.getByRole("button", { name: "编辑现金流房租" }),
  ).toHaveCount(0);
});
test("有效备份导入后恢复数据，坏备份拒绝，主数据损坏可恢复上一版本", async ({
  page,
}) => {
  await seed(page);
  await page.getByRole("button", { name: "备份与同步", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const imported = {
    ...document(),
    members: { first: "BackupA", second: "BackupB" },
    assets: [{ ...document().assets[0], annualReturn: -7 }],
  };
  page.on("dialog", (dialog) => dialog.accept());
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect(dialog).toContainText("备份已恢复并保存");
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":3}'),
  });
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "关闭弹窗" }).click();
  await expect(
    page.getByRole("button", { name: "编辑共同储蓄本年回报" }),
  ).toContainText("-7%");
  await page.reload();
  await expect(page.locator(".ownership-strip")).toContainText("BackupA");
  await page.evaluate(() =>
    localStorage.setItem("together-wealth-v3", "broken"),
  );
  await page.reload();
  await expect(page.locator(".error-banner")).toContainText("无法读取");
  await page.getByRole("button", { name: "查看数据设置" }).click();
  await page.getByRole("button", { name: "恢复上一版本" }).click();
  await expect(page.getByRole("dialog")).toContainText("已恢复上一份本机备份");
});
test("本地聊天实际修改页面数据并保存对话及模型偏好", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "打开财富顾问" }).click();
  await page.getByLabel("顾问模型策略").selectOption("local");
  await page.getByLabel("顾问消息").fill("把共同储蓄本年回报改为 -2.5%");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.locator(".advisor-messages")).toContainText(
    "已保存 1 项变更",
  );
  await expect(
    page.getByRole("button", { name: "编辑共同储蓄本年回报" }),
  ).toHaveText("-2.5%");
  await page.reload();
  await page.getByRole("button", { name: "打开财富顾问" }).click();
  await expect(page.getByLabel("顾问模型策略")).toHaveValue("local");
  await expect(page.locator(".advisor-messages")).toContainText(
    "已保存 1 项变更",
  );
  await page.getByRole("button", { name: "收起顾问", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "家庭财富顾问" }),
  ).not.toBeVisible();
});
test("可增删自定义资产，删除后重开无示例数据复活，备份导出完整", async ({
  page,
}) => {
  await seed(page);
  await page.getByRole("button", { name: "添加资产", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("资产名称").fill("艺术品");
  await dialog.getByLabel("当前价值（CAD）").fill("1234.56");
  await dialog.getByLabel("类别", { exact: true }).fill("收藏品");
  await dialog.getByRole("button", { name: "保存资产" }).click();
  await expect(page.getByTestId("net-worth")).toHaveText("$101,234.56");
  await expect(page.locator(".legend")).toContainText("收藏品");
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除艺术品", exact: true }).click();
  await page.getByRole("button", { name: "删除共同储蓄", exact: true }).click();
  await page.reload();
  await expect(page.getByTestId("net-worth")).toHaveText("$0.00");
  await expect(page.locator("#assets")).toContainText("还没有资产记录");
  await page.getByRole("button", { name: "备份与同步", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整备份" }).click();
  expect((await download).suggestedFilename()).toMatch(
    /together-wealth-.*\.json/,
  );
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "关闭弹窗" }).click();
  await expect(dialog).not.toBeVisible();
});
