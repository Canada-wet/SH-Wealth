import { test, expect } from "@playwright/test";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
import { emptyState, saveAsset } from "../../lib/wealth";
import { allChats } from "../../lib/conversations";
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("历史会话自动保留，搜索、继续提问和刷新恢复完整上下文", async ({
  page,
}) => {
  const state = saveAsset(emptyState(), {
    id: "a",
    name: "现金",
    category: "现金",
    owner: "joint",
    value: 500,
    annualReturn: null,
  });
  state.preferences.model = "local";
  state.messages = [
    { id: "old-q", role: "user", text: "家庭养老计划" },
    { id: "old-a", role: "assistant", text: "这是已保存的养老讨论。" },
  ];
  await authenticate(page, { seed: state });
  await page.goto("/");
  await page.getByRole("button", { name: "打开财富顾问" }).click();
  await expect(page.locator(".advisor-messages")).toContainText(
    "已保存的养老讨论",
  );
  await page.getByRole("button", { name: "新建对话" }).click();
  await page.getByLabel("顾问消息").fill("目前净资产多少");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.locator(".advisor-messages")).toContainText("500");
  await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
  await page.reload();
  await page.getByRole("button", { name: "打开财富顾问" }).click();
  await page.getByRole("button", { name: "查看聊天历史" }).click();
  await page.getByLabel("搜索聊天历史").fill("养老");
  await page.getByRole("button", { name: "继续会话：家庭养老计划" }).click();
  await expect(page.locator(".advisor-messages")).toContainText(
    "已保存的养老讨论",
  );
  const outgoing = page.waitForRequest("**/api/advisor");
  await page.getByLabel("顾问消息").fill("目前净资产多少");
  await page.getByRole("button", { name: "发送消息" }).click();
  const body = (await outgoing).postDataJSON();
  expect(
    body.state.messages.some(
      (row: { text: string }) => row.text === "这是已保存的养老讨论。",
    ),
  ).toBe(true);
  await expect(page.locator(".advisor-messages")).toContainText("500");
  await expect(page.locator(".save-status")).toContainText("已同步 Supabase");
  await page.reload();
  await page.getByRole("button", { name: "打开财富顾问" }).click();
  await expect(page.locator(".advisor-messages")).toContainText(
    "已保存的养老讨论",
  );
  const data = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("together-wealth-v3")!),
  );
  expect(
    allChats(data).find((chat) => chat.title === "家庭养老计划")?.messages,
  ).toHaveLength(4);
  expect(data.chatArchives).toHaveLength(1);
  expect(data.messages).toHaveLength(2);
});
