import { test, expect } from "@playwright/test";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
import { emptyState, type WealthState } from "../../lib/wealth";
import { todayToronto } from "../../lib/household-workspace";
function fixture(): WealthState {
  const state = emptyState();
  state.preferences.model = "local";
  state.assets = [
    {
      id: "cash",
      name: "合成现金",
      category: "现金",
      owner: "joint",
      value: 5000,
      annualReturn: null,
      liquidity: "available",
    },
    {
      id: "fund",
      name: "合成长期账户",
      category: "投资",
      owner: "first",
      value: 10000,
      annualReturn: 9,
    },
  ];
  state.budget = [
    {
      id: "income",
      name: "合成收入",
      owner: "joint",
      kind: "income",
      amount: 10000,
      essential: false,
    },
    {
      id: "expense",
      name: "合成必要支出",
      owner: "joint",
      kind: "expense",
      amount: 2000,
      essential: true,
    },
  ];
  state.goal.year = String(Number(todayToronto().slice(0, 4)) + 2);
  state.goal.target = 100000;
  state.plan.values.emergency_months = "6";
  state.contributions = [
    {
      id: "recorded",
      assetId: "fund",
      member: "first",
      amount: 200,
      date: todayToronto(),
      kind: "deposit",
      note: "已包含在估值中，合成历史记录",
    },
    {
      id: "independent",
      assetId: null,
      member: "second",
      amount: 9000,
      date: todayToronto(),
      kind: "deposit",
      note: "独立记录不参与账户进度",
    },
  ];
  return state;
}
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("增长情景与行动跨设备保存，顾问和真实出资跟踪联动但不新增财富", async ({
  page,
}) => {
  await authenticate(page, { seed: fixture() });
  await page.goto("/#growth");
  const growth = page.getByRole("region", { name: "财富增长行动台" });
  await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
  const before = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("together-wealth-v3")!);
    return [s.assets, s.debts, s.contributions, s.history, s.budget];
  });
  await growth.getByRole("button", { name: "增长情景", exact: true }).click();
  await growth.getByLabel("计划每月留存", { exact: true }).fill("1000");
  await growth.getByLabel("其中长期月投入", { exact: true }).fill("500");
  await growth.getByLabel("假设年回报", { exact: true }).fill("5");
  await growth.getByText(/选择参与复利测算的本金/).click();
  await growth.getByLabel("增长本金：合成长期账户", { exact: true }).check();
  await expect(growth.getByLabel("增长情景测算结果")).toContainText(
    "本金 $10,000.00",
  );
  await expect(
    growth.locator(".growth-chart svg.recharts-surface"),
  ).toBeVisible();
  // A horizontal SVG line has a zero-height box; verify its painted geometry.
  await expect
    .poll(() =>
      growth.locator(".recharts-reference-line-line").evaluateAll((lines) => {
        const line = lines[0];
        if (!line) return false;
        const svg = line.closest("svg");
        const x1 = Number(line.getAttribute("x1"));
        const x2 = Number(line.getAttribute("x2"));
        const y1 = Number(line.getAttribute("y1"));
        const y2 = Number(line.getAttribute("y2"));
        return Boolean(
          svg &&
          x2 > x1 &&
          y1 === y2 &&
          y1 >= 0 &&
          y1 <= svg.viewBox.baseVal.height &&
          line.getAttribute("stroke") === "#b0915a",
        );
      }),
    )
    .toBe(true);
  await expect(growth.getByLabel("增长情景测算结果")).toContainText(
    "家庭目标 $100,000.00",
  );
  await growth.getByRole("button", { name: "保存增长情景" }).click();
  await expect(growth).toContainText("增长情景已保存");
  await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
  await growth.getByRole("button", { name: "本轮行动", exact: true }).click();
  await expect(growth.getByLabel("计划与已记录出资")).toContainText("$200.00");
  const task = growth.getByRole("article").filter({
    has: page.getByRole("heading", { name: "先守住现金缓冲", exact: true }),
  });
  await task.getByRole("button", { name: "加入本轮", exact: true }).click();
  await expect(task).toContainText("已安排");
  await task.getByRole("button", { name: "标记完成", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
  expect(
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("together-wealth-v3")!);
      return [s.assets, s.debts, s.contributions, s.history, s.budget];
    }),
  ).toEqual(before);
  const home = await page.evaluate(
    () => JSON.parse(localStorage.getItem("together-cloud-link")!).householdId,
  );
  const partner = await page.context().browser()!.newContext();
  try {
    const second = await partner.newPage();
    await authenticate(second, {
      householdId: home,
      email: "sallyxie0378@gmail.com",
    });
    await second.goto("/#growth");
    const shared = second.getByRole("region", { name: "财富增长行动台" });
    await shared.getByRole("button", { name: "增长情景", exact: true }).click();
    await expect(
      shared.getByLabel("计划每月留存", { exact: true }),
    ).toHaveValue("1000");
    await expect
      .poll(async () =>
        second.evaluate(
          () =>
            JSON.parse(localStorage.getItem("together-wealth-v3")!).preferences
              .growthPlan.tasks.buffer.status,
        ),
      )
      .toBe("done");
  } finally {
    await partner.close();
  }
  await page.reload();
  await growth.getByRole("button", { name: "增长情景", exact: true }).click();
  await expect(growth.getByLabel("假设年回报", { exact: true })).toHaveValue(
    "5",
  );
  await growth
    .getByRole("button", { name: "让顾问检视已保存的增长计划" })
    .click();
  await expect(page.getByLabel("顾问消息")).toHaveValue(/已保存的财富增长情景/);
  await page.getByRole("button", { name: "收起顾问", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await growth.screenshot({
    path: `test-results/wealth-growth-${test.info().project.name}.png`,
  });
});
test("无效金额拒绝保存，超预算警示明确，隐藏家庭数据同样隐藏增长分析", async ({
  page,
}) => {
  await authenticate(page, { seed: fixture() });
  await page.goto("/#growth");
  const growth = page.getByRole("region", { name: "财富增长行动台" });
  await growth.getByRole("button", { name: "增长情景", exact: true }).click();
  await growth.getByLabel("计划每月留存", { exact: true }).fill("100");
  await growth.getByLabel("其中长期月投入", { exact: true }).fill("200");
  await growth.getByRole("button", { name: "保存增长情景" }).click();
  await expect(growth.getByRole("alert")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("together-wealth-v3")!).preferences
          .growthPlan,
    ),
  ).toBeUndefined();
  await growth.getByLabel("计划每月留存", { exact: true }).fill("9000");
  await expect(growth.getByLabel("增长情景测算结果")).toContainText(
    "超过当前预算结余 $1,000.00",
  );
  await growth.getByRole("button", { name: "放弃草稿并载入最新" }).click();
  await page.getByRole("button", { name: "隐藏家庭数据", exact: true }).click();
  await expect(growth).not.toBeVisible();
  await page.getByRole("button", { name: "显示家庭数据", exact: true }).click();
  await expect(growth).toBeVisible();
});
