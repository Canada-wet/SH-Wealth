import { test, expect } from "@playwright/test";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
import { emptyState, saveAsset } from "../../lib/wealth";
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
const fixture = () => {
  const state = saveAsset(emptyState(), {
    id: "a",
    name: "共同储蓄",
    value: 100000,
    category: "现金",
    owner: "joint",
    annualReturn: 2,
  });
  state.assets.push({
    id: "b",
    name: "投资",
    value: 20000,
    category: "投资",
    owner: "first",
    annualReturn: null,
  });
  state.preferences.model = "local";
  return state;
};
test("草稿刷新恢复，待确认修改取消不写入，重新确认才保存", async ({ page }) => {
  await authenticate(page, { seed: fixture() });
  await page.goto("/");
  await page.getByRole("button", { name: "打开财富顾问" }).click();
  await page.getByLabel("顾问消息").fill("把共同储蓄本年回报改为 -3%");
  await page.reload();
  await page.getByRole("button", { name: "打开财富顾问" }).click();
  await expect(page.getByLabel("顾问消息")).toHaveValue(
    "把共同储蓄本年回报改为 -3%",
  );
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(
    page.getByRole("region", { name: "数据修改预览" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "编辑共同储蓄本年回报" }),
  ).toHaveText("+2%");
  await page
    .locator(".advisor-window")
    .screenshot({
      path: `test-results/advisor-preview-${test.info().project.name}.png`,
    });
  await page.getByRole("button", { name: "取消修改" }).click();
  await expect(
    page.getByRole("button", { name: "编辑共同储蓄本年回报" }),
  ).toHaveText("+2%");
  await page.getByLabel("顾问消息").fill("把共同储蓄本年回报改为 -3%");
  await page.getByRole("button", { name: "发送消息" }).click();
  await page.getByRole("button", { name: "确认并保存修改" }).click();
  await expect(
    page.getByRole("button", { name: "编辑共同储蓄本年回报" }),
  ).toHaveText("-3%");
});
test("语音仅形成可编辑草稿，原数据保持直到明确确认", async ({ page }) => {
  await page.addInitScript(() => {
    class Recognition {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        this.onresult?.({
          results: [
            Object.assign([{ transcript: "把共同储蓄本年回报改为 -5%" }], {
              isFinal: true,
            }),
          ],
        });
        this.onend?.();
      }
      stop() {
        this.onend?.();
      }
      abort() {
        this.onend?.();
      }
    }
    Object.defineProperty(window, "SpeechRecognition", {
      value: Recognition,
      configurable: true,
    });
  });
  await authenticate(page, { seed: fixture() });
  await page.goto("/");
  await page.getByRole("button", { name: "打开财富顾问" }).click();
  await page.locator(".voice-controls > summary").click();
  await page.locator(".voice-controls input[type=checkbox]").check();
  await page.getByRole("button", { name: "开始语音输入" }).click();
  await expect(page.getByLabel("顾问消息")).toHaveValue(
    "把共同储蓄本年回报改为 -5%",
  );
  await expect(
    page.getByRole("button", { name: "编辑共同储蓄本年回报" }),
  ).toHaveText("+2%");
  await page.getByRole("button", { name: "发送消息" }).click();
  await page.getByRole("button", { name: "确认并保存修改" }).click();
  await expect(
    page.getByRole("button", { name: "编辑共同储蓄本年回报" }),
  ).toHaveText("-5%");
});
test("资产排序筛选小计准确，假设与复盘不改变真实财富", async ({ page }) => {
  await authenticate(page, { seed: fixture() });
  await page.goto("/");
  await page.getByLabel("资产排序").selectOption("value-desc");
  await expect(page.locator("#assets tbody .name-button").first()).toHaveText(
    "共同储蓄",
  );
  await page.getByLabel("搜索资产").fill("投资");
  await expect(page.getByTestId("filtered-assets-total")).toHaveText(
    "$20,000.00",
  );
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(page.locator("#assets tbody .name-button")).toHaveCount(2);
  await page.locator(".household-scenario > summary").click();
  await page.getByLabel("假设月储蓄（CAD）").fill("1000");
  await page.getByLabel("一次性支出（CAD）").fill("5000");
  await expect(page.locator(".scenario-result")).toContainText("$127,000.00");
  await expect(page.getByTestId("net-worth")).toHaveText("$120,000.00");
  await page.locator(".household-review > summary").click();
  await page
    .locator(".household-tools")
    .screenshot({
      path: `test-results/household-tools-${test.info().project.name}.png`,
    });
  await expect(page.locator(".household-review")).toContainText(
    "1 项资产未填本年回报",
  );
  await page.getByRole("button", { name: "与顾问讨论这个假设" }).click();
  await expect(page.getByLabel("顾问消息")).toHaveValue(/只做分析/);
});
