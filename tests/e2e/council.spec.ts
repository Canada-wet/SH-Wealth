import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
import {
  COUNCIL_MODELS,
  councilPlan,
  type CouncilRun,
} from "../../lib/council";
async function councilFixture(
  page: Page,
  { storage = true, interrupt = false } = {},
) {
  let run: CouncilRun | null = null;
  let calls = 0;
  await page.route("**/api/council**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      if (new URL(request.url()).searchParams.get("id"))
        return route.fulfill({ json: { run } });
      return route.fulfill({
        json: {
          models: COUNCIL_MODELS,
          availability: COUNCIL_MODELS.map((m) => ({
            key: m.key,
            ready: [
              "deepseek-light",
              "openai-light",
              "openai-flagship",
            ].includes(m.key),
            detail: "Synthetic configured state",
          })),
          storageReady: storage,
          runs: run
            ? [
                {
                  id: run.id,
                  question: run.question,
                  status: run.status,
                  created_at: run.created_at,
                },
              ]
            : [],
          ...(!storage
            ? { storageError: "研讨历史尚未连接，未启动付费调用。" }
            : {}),
        },
      });
    }
    const body = request.postDataJSON();
    expect(body).not.toHaveProperty("assets");
    expect(body).not.toHaveProperty("household");
    if (body.action === "create") {
      run = {
        id: body.id,
        question: body.question,
        participants: body.participants,
        judge: body.judge,
        status: "active",
        created_at: new Date().toISOString(),
        models: COUNCIL_MODELS.filter(
          (m) => body.participants.includes(m.key) || body.judge === m.key,
        ),
        steps: councilPlan(body.participants, body.judge).map((s) => ({
          ...s,
          status: "pending",
          answer: "",
          error: "",
          usage: { input: null, output: null },
          started_at: null,
          finished_at: null,
        })),
      };
    } else if (body.action === "advance" && run) {
      calls++;
      const s = run.steps.find((s) => s.status === "pending");
      if (s) {
        s.started_at = new Date(Date.now() - 130000).toISOString();
        if (interrupt) {
          s.status = "running";
          return route.abort();
        }
        s.status = "succeeded";
        s.answer = `## 合成测试结论\n\n**阶段 ${s.stage}**：比较机会成本，保留分歧。\n\n- 核验假设\n- 先做小规模试验`;
        s.finished_at = new Date().toISOString();
        s.usage = { input: 20, output: 40 };
      }
      if (
        run.steps.every(
          (s) => s.status === "succeeded" || s.status === "failed",
        )
      )
        run.status = "complete";
    } else if (body.action === "pause" && run) run.status = "paused";
    else if (body.action === "resume" && run) run.status = "active";
    else if (body.action === "cancel" && run) run.status = "cancelled";
    else if (body.action === "abandon" && run) {
      run.steps[body.seq].status = "failed";
      run.steps[body.seq].error = "提交结果不确定；用户选择跳过，未重新调用。";
    } else if (body.action === "delete") {
      run = null;
      return route.fulfill({ json: { deleted: true } });
    }
    return route.fulfill({ json: { run } });
  });
  return { calls: () => calls, run: () => run };
}
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("圆桌完整流程、可选裁判、刷新回看与导出，桌面和手机不溢出", async ({
  page,
}, info) => {
  test.setTimeout(45000);
  await authenticate(page);
  const fixture = await councilFixture(page);
  await page.goto("/council");
  await expect(
    page.getByRole("heading", { name: "多模型研讨", exact: true }),
  ).toBeVisible();
  const start = page.getByRole("button", { name: "开始研讨", exact: true });
  await expect(start).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: /DeepSeek V4.1 Flash/ }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "查看全部 8 家服务与待配置型号" })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /Qwen 3.8 Flash/ }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "只看已配置服务" }).click();
  await page
    .getByLabel("问题与已知条件")
    .fill("合成问题：比较继续工作与低成本创业的机会成本。");
  await page.getByLabel("裁判模型").selectOption("openai-flagship");
  await expect(page.locator(".council-composer")).toContainText("7 次付费调用");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 920 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `/private/tmp/council-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("checkbox", { name: /我同意把问题及发言/ }).check();
  await start.click();
  await expect(page.locator(".council-session")).toContainText("7/7 步已归档", {
    timeout: 20000,
  });
  expect(fixture.calls()).toBe(7);
  await expect(
    page.locator(".council-stage-nav button[aria-current=step]"),
  ).toContainText("裁判汇总");
  await expect(page.locator(".council-answer")).toContainText("合成测试结论");
  await page.getByRole("button", { name: "交叉质询" }).click();
  await expect(page.locator(".council-answer")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".council-session")).toContainText("7/7 步已归档");
  await page.waitForTimeout(1500);
  expect(fixture.calls()).toBe(7);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/Together-研讨-.*\.md/);
  const path = await download.path();
  expect(await readFile(path!, "utf8")).toContain("裁判汇总");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "删除历史" }).click();
  await expect(page.getByLabel("问题与已知条件")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("无法恢复");
});
test("中断后刷新不会重扣请求；明确跳过与无裁判结论", async ({ page }) => {
  await authenticate(page);
  const fixture = await councilFixture(page, { interrupt: true });
  await page.goto("/council");
  await page
    .getByLabel("问题与已知条件")
    .fill("合成问题：给一个可验证的比较框架。");
  await page.getByRole("checkbox", { name: /我同意把问题及发言/ }).check();
  await page.getByRole("button", { name: "开始研讨", exact: true }).click();
  await expect(page.locator(".council-page > [role=alert]")).toBeVisible();
  expect(fixture.calls()).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "继续研讨", exact: true }),
  ).toBeDisabled();
  await page.waitForTimeout(1800);
  expect(fixture.calls()).toBe(1);
  await expect(
    page.getByRole("button", { name: "标记中断并跳过" }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "标记中断并跳过" }).click();
  await expect(
    page.getByRole("button", { name: "继续研讨", exact: true }),
  ).toBeEnabled();
  expect(fixture.calls()).toBe(1);
  await page.getByRole("button", { name: "修订结论" }).click();
  await expect(page.locator(".council-no-judge")).toContainText("不生成虚假的");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "结束本场" }).click();
  await expect(page.locator(".council-status")).toHaveText("已停止");
});
test("云端未安装时不允许启动，配置与型号解释仍可查看", async ({ page }) => {
  await authenticate(page);
  const fixture = await councilFixture(page, { storage: false });
  await page.goto("/council");
  await page
    .getByLabel("问题与已知条件")
    .fill("合成问题：不应发起真实收费请求。");
  await page.getByRole("checkbox", { name: /我同意把问题及发言/ }).check();
  await expect(
    page.getByRole("button", { name: "开始研讨", exact: true }),
  ).toBeDisabled();
  await page.getByText(/模型来源与连接设置/).click();
  await expect(page.locator(".council-config")).toContainText(
    "K2.6 仅作在售备选",
  );
  expect(fixture.calls()).toBe(0);
});
