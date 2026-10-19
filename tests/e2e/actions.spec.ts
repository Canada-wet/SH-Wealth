import { test, expect } from "@playwright/test";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
import { emptyState } from "../../lib/wealth";
import type { ActionItem } from "../../lib/action-center";
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("行动创建、编辑、刷新回看、完成与删除闭环，手机无横向溢出", async ({
  page,
}) => {
  const home = await authenticate(page, { seed: emptyState() });
  const items = new Map<string, ActionItem>();
  await page.route("**/api/actions**", async (route) => {
    const request = route.request();
    if (request.method() === "GET")
      return route.fulfill({ json: { items: [...items.values()] } });
    const args = request.postDataJSON();
    expect(args.household).toBe(home);
    if (args.operation === "create") {
      const now = new Date().toISOString();
      const row = {
        ...args.input,
        id: args.id,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      items.set(args.id, row);
      return route.fulfill({ json: { item: row } });
    }
    const old = items.get(args.id)!;
    if (old.version !== args.version)
      return route.fulfill({ status: 409, json: { error: "另一设备已更新" } });
    if (args.operation === "delete") {
      items.delete(args.id);
      return route.fulfill({ json: { id: args.id, deleted: true } });
    }
    const row = {
      ...old,
      ...args.patch,
      version: old.version + 1,
      updatedAt: new Date().toISOString(),
    };
    items.set(row.id, row);
    return route.fulfill({ json: { item: row } });
  });
  await page.goto("/space#actions");
  const center = page.getByRole("region", { name: "统一行动中心" });
  await center.getByRole("button", { name: "添加行动" }).click();
  let dialog = page.getByRole("dialog", { name: "把想法变成下一步" });
  await expect(dialog.getByRole("radio", { name: /仅自己/ })).toBeChecked();
  await dialog.getByLabel("行动标题").fill("先核对证据，再决定下一步");
  await dialog.getByLabel("行动说明").fill("合成浏览器测试，不含真实资料");
  await dialog.getByRole("button", { name: "保存行动", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    center.getByRole("heading", { name: "先核对证据，再决定下一步" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    center.getByRole("heading", { name: "先核对证据，再决定下一步" }),
  ).toBeVisible();
  await center
    .getByRole("button", { name: "编辑行动：先核对证据，再决定下一步" })
    .click();
  dialog = page.getByRole("dialog", { name: "跟进行动" });
  await dialog.getByLabel("行动标题").fill("证据已经核对");
  await dialog.getByLabel("行动进度").selectOption("doing");
  await dialog.getByRole("button", { name: "保存修改" }).click();
  await expect(
    center.getByRole("heading", { name: "证据已经核对" }),
  ).toBeVisible();
  await center.getByRole("button", { name: "完成行动：证据已经核对" }).click();
  await center.getByLabel("筛选行动进度").selectOption("done");
  await expect(
    center.getByRole("heading", { name: "证据已经核对" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  for (const name of ["筛选行动进度", "筛选行动可见范围"]) {
    const box = await center.getByLabel(name).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(42);
  }
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    )
    .toBe(true);
  await center.screenshot({
    path: `/tmp/together-actions-${test.info().project.name}.png`,
  });
  page.once("dialog", (d) => d.accept());
  await center.getByRole("button", { name: "删除行动：证据已经核对" }).click();
  await expect(
    center.getByRole("heading", { name: "证据已经核对" }),
  ).toHaveCount(0);
  expect(items.size).toBe(0);
});
test("共享行动显式确认；冲突保留草稿", async ({ page }) => {
  await authenticate(page, { seed: emptyState() });
  let record: ActionItem | null = null;
  await page.route("**/api/actions**", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { items: record ? [record] : [] } });
    const args = route.request().postDataJSON();
    if (args.operation === "update")
      return route.fulfill({
        status: 409,
        json: { error: "另一设备已更新此行动，请刷新后重新修改。" },
      });
    const at = new Date().toISOString();
    record = {
      ...args.input,
      id: args.id,
      version: 1,
      createdAt: at,
      updatedAt: at,
    };
    return route.fulfill({ json: { item: record } });
  });
  await page.goto("/space#actions");
  await page.getByRole("button", { name: "添加行动" }).click();
  await page.getByLabel("行动标题").fill("共同核对下一步");
  await page.getByRole("radio", { name: /家庭共享/ }).check();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "保存行动", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "共同核对下一步" }),
  ).toBeVisible();
  expect(record!.visibility).toBe("household");
  await page.getByRole("button", { name: "编辑行动：共同核对下一步" }).click();
  await page.getByLabel("行动标题").fill("保留我的草稿");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "另一设备已更新",
  );
  await expect(page.getByLabel("行动标题")).toHaveValue("保留我的草稿");
  expect(record!.title).toBe("共同核对下一步");
});

test("市场研究准备行动后可回家庭首页继续，不复制研究正文", async ({ page }) => {
  const home = await authenticate(page, { seed: emptyState() });
  let record: ActionItem | null = null;
  await page.route("**/rest/v1/household_members?**", (route) =>
    route.fulfill({ json: [{ household_id: home }] }),
  );
  await page.route("**/api/market", (route) =>
    route.fulfill({
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
  await page.route("**/api/actions**", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { items: record ? [record] : [] } });
    const args = route.request().postDataJSON();
    expect(args.input.sourceFeature).toBe("investment-desk");
    expect(args.input.sourceRef).toBe("");
    expect(args.input.note).toBe("");
    const at = new Date().toISOString();
    record = {
      ...args.input,
      id: args.id,
      version: 1,
      createdAt: at,
      updatedAt: at,
    };
    return route.fulfill({ json: { item: record } });
  });
  await page.goto("/markets#investment-desk");
  await page.getByRole("button", { name: "安排研究行动" }).click();
  const dialog = page.getByRole("dialog", { name: "把想法变成下一步" });
  await expect(dialog.getByLabel("行动标题")).toHaveValue(
    /核对 .* 的投资逻辑与失效条件/,
  );
  await expect(dialog.getByLabel("行动说明")).toHaveValue("");
  await dialog.getByRole("button", { name: "保存行动", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.goto("/space#actions");
  await expect(
    page.getByRole("heading", { name: record!.title }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /来源：投资研究/ }),
  ).toHaveAttribute("href", "/markets#investment-desk");
});

test("跨模块数据包真实下载并提示部分导出，不可直接导入财富账本", async ({
  page,
}) => {
  const home = await authenticate(page, { seed: emptyState() });
  const bundle = {
    kind: "together-user-visible-export",
    schemaVersion: 1,
    status: "partial",
    sections: {},
    scope: {
      householdId: home,
      userId: "00000000-0000-4000-8000-000000000001",
    },
  };
  await page.route("**/api/backup", (route) => route.fulfill({ json: bundle }));
  await page.goto("/#settings");
  const settings = page.getByRole("dialog", { name: "备份与家庭同步" });
  const button = settings.getByRole("button", { name: "导出跨模块数据包" });
  await expect(button).toBeEnabled();
  page.once("dialog", (d) => d.accept());
  const download = page.waitForEvent("download");
  await button.click();
  expect((await download).suggestedFilename()).toMatch(
    /^Together-visible-data-.*\.json$/,
  );
  await expect(settings.getByRole("status")).toContainText("已下载部分数据包");
  await settings.locator('input[type="file"]').setInputFiles({
    name: "visible-bundle.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(bundle)),
  });
  await expect(settings.getByRole("alert")).toContainText(
    "不是家庭账本导入格式",
  );
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("together-wealth-v3")!).assets,
    ),
  ).toEqual([]);
});
