import { test, expect } from "@playwright/test";
import { emptyState, saveAsset } from "../../lib/wealth";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
function fixture() {
  const state = saveAsset(emptyState(), {
    id: "a",
    name: "共同现金",
    owner: "joint",
    category: "现金",
    value: 2000,
    annualReturn: null,
  });
  state.preferences.model = "local";
  state.budget = [
    {
      id: "i",
      name: "工资",
      owner: "first",
      kind: "income",
      amount: 1000,
      essential: false,
    },
    {
      id: "e",
      name: "必要开支",
      owner: "joint",
      kind: "expense",
      amount: 2000,
      essential: true,
    },
  ];
  return state;
}
test("首页指标、主动提示与顾问联动；已处理和关闭偏好刷新后保持", async ({
  page,
}) => {
  await authenticate(page, { seed: fixture() });
  await page.goto("/");
  await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
  await expect(page.getByLabel("家庭关键指标")).toContainText("-$1,000.00");
  await expect(page.getByLabel("下一步建议")).toContainText("月支出超过收入");
  await page.getByRole("button", { name: "和顾问讨论" }).click();
  await expect(page.getByLabel("顾问消息")).toHaveValue(/核对月度缺口/);
  await page.getByRole("button", { name: "收起顾问", exact: true }).click();
  await page.getByRole("button", { name: "本月已处理" }).click();
  await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
  await page.reload();
  await expect(page.getByLabel("下一步建议")).not.toContainText(
    "月支出超过收入",
  );
  await page.getByRole("button", { name: "通知", exact: true }).click();
  await page.getByRole("checkbox", { name: /开启主动洞察/ }).uncheck();
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
  await page.reload();
  await expect(page.getByLabel("下一步建议")).toHaveCount(0);
  await expect(page.locator(".advisor-unread")).toHaveCount(0);
  await page.getByRole("button", { name: "打开财富顾问" }).click();
  await expect(page.getByLabel("顾问消息")).toBeEditable();
});
test("成员占比可筛选账户，现金指标可展开联动应急金，移动端无横向溢出", async ({
  page,
}) => {
  await authenticate(page, { seed: fixture() });
  await page.goto("/");
  await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
  await page.getByRole("button", { name: "查看共同持有资产" }).click();
  await expect(page.locator(".filter-chip")).toContainText("共同");
  await page.getByRole("link", { name: /现金缓冲参考/ }).click();
  await expect(page.locator("#emergency")).toHaveAttribute("open", "");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(page.locator(".advisor-nudge")).not.toBeVisible();
  await expect(page.locator(".toast")).not.toBeVisible();
  await page.screenshot({
    path: `test-results/pulse-${test.info().project.name}.png`,
    fullPage: false,
  });
});
