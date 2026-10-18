import { test, expect, type Page } from "@playwright/test";
import {
  authenticate,
  cleanupAuthenticated,
  assertFixtureConnection,
} from "./auth-helper";
import { emptyState } from "../../lib/wealth";
import { lifestyleFixture } from "../fixtures/lifestyle";
const seed = (withTracks = false) => {
  const s = emptyState();
  s.members = { first: "Alex", second: "Sam" };
  s.preferences.model = "local";
  s.preferences.proactive = false;
  s.assets = [
    {
      id: "wealth-fixture",
      name: "合成财富账户",
      category: "现金",
      owner: "joint",
      value: 1000,
      annualReturn: null,
    },
  ];
  if (withTracks) s.preferences.lifestyle = lifestyleFixture();
  return s;
};
const saved = (page: Page) =>
  expect(page.locator(".hobby-cloud-status")).toContainText("已同步 Supabase");
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("从曲库、可解释推荐、Cue时长到练习完整联动，刷新保持且不改财富", async ({
  page,
}) => {
  await authenticate(page, { seed: seed() });
  await page.goto("/lifestyle");
  await saved(page);
  for (const [title, bpm, key, energy, duration] of [
    ["Soft Arrival", "122", "Am", "4", "5:30"],
    ["Golden Hour", "124", "9A", "5", "6:00"],
  ]) {
    await page.getByRole("button", { name: "添加曲目", exact: true }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel("曲名", { exact: true }).fill(title);
    await d.getByLabel("艺人", { exact: true }).fill("Synthetic artist");
    await d.getByLabel("BPM", { exact: true }).fill(bpm);
    await d.getByLabel("调性", { exact: true }).fill(key);
    await d.getByLabel("能量（1–10）", { exact: true }).fill(energy);
    await d.getByLabel("时长（分:秒）", { exact: true }).fill(duration);
    await d.getByLabel("个人评分（1–5）", { exact: true }).fill("4");
    await d.getByRole("button", { name: "保存曲目", exact: true }).click();
    await expect(d).toHaveCount(0);
    await saved(page);
  }
  await page
    .getByRole("button", { name: "编辑曲目：Soft Arrival", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByText("管理时间 Cue（元数据，不控制播放器）", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "添加 Cue 标记", exact: true })
    .click();
  await page.getByLabel("Cue 秒数 1", { exact: true }).fill("16");
  await page.getByRole("button", { name: "保存曲目", exact: true }).click();
  await saved(page);
  await page.getByRole("tab", { name: "Set Builder", exact: true }).click();
  await page.getByRole("button", { name: "新建 Set", exact: true }).click();
  await page.getByLabel("Set 名称", { exact: true }).fill("Friday · 客厅暖场");
  await page.getByLabel("Set 目标分钟", { exact: true }).fill("12");
  await page.getByRole("button", { name: "保存 Set", exact: true }).click();
  await saved(page);
  const first = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("together-wealth-v3")!).preferences
        .lifestyle.tracks[0].id,
  );
  await page.getByLabel("选择起始曲目", { exact: true }).selectOption(first);
  await page.getByRole("button", { name: "用这首开始", exact: true }).click();
  await expect(page.locator(".hobby-candidates")).toContainText("相邻调性");
  await page
    .getByRole("button", { name: "加入下一首：Golden Hour", exact: true })
    .click();
  await expect(page.locator(".hobby-duration")).toContainText("11:30");
  await page
    .getByRole("button", { name: "编辑转场：Golden Hour", exact: true })
    .click();
  await page.getByLabel("混入重叠秒数", { exact: true }).fill("30");
  await page
    .getByLabel("转场备注", { exact: true })
    .fill("16 bars blend, check vocal overlap");
  await page.getByRole("button", { name: "保存转场", exact: true }).click();
  await expect(page.locator(".hobby-duration")).toContainText("11:00");
  await saved(page);
  await page.reload();
  await saved(page);
  await expect(page.locator(".hobby-set-entries")).toContainText(
    "16 bars blend",
  );
  await page
    .getByRole("button", { name: "上移：Golden Hour", exact: true })
    .click();
  await expect(page.locator(".hobby-set-entries")).not.toContainText(
    "16 bars blend",
  );
  await expect(page.locator(".hobby-duration")).toContainText("11:30");
  await page.getByRole("button", { name: "去记一次练习", exact: true }).click();
  await page.getByRole("button", { name: "记录一次练习", exact: true }).click();
  await page.getByLabel("练习主题", { exact: true }).fill("尝试一次放松的暖场");
  await page.getByLabel("练习成员", { exact: true }).selectOption("second");
  await page.getByLabel("练习分钟", { exact: true }).fill("25");
  await page
    .getByLabel("练习笔记", { exact: true })
    .fill("没有追求完美，玩得开心。");
  await page.getByRole("button", { name: "保存练习", exact: true }).click();
  await saved(page);
  await page.reload();
  await saved(page);
  await expect(page.locator(".hobby-practice-list")).toContainText(
    "Friday · 客厅暖场",
  );
  await expect(page.locator(".hobby-practice-list")).toContainText("Sam");
  const state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("together-wealth-v3")!),
  );
  expect(state.assets).toEqual(seed().assets);
  expect(state.history).toEqual([]);
  expect(state.preferences.lifestyle.practices[0].trackCount).toBe(2);
  await page.getByRole("tab", { name: "Set Builder", exact: true }).click();
  await page.locator(".hobby-builder").screenshot({
    path: `test-results/lifestyle-set-${test.info().project.name}.png`,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("/");
  await page.getByRole("button", { name: "打开财富顾问", exact: true }).click();
  await page.getByLabel("顾问消息").fill("目前净资产多少");
  const request = page.waitForRequest(
    (r) => r.url().endsWith("/api/advisor") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  expect(
    (await request).postDataJSON().state.preferences.lifestyle,
  ).toBeUndefined();
});
test("CSV先预览再提交，整批校验、去重、备份、删除撤销和隐私功能可用", async ({
  page,
}) => {
  await authenticate(page, { seed: seed() });
  await page.goto("/lifestyle");
  await saved(page);
  const input = page.getByLabel("选择曲库 CSV", { exact: true });
  await input.setInputFiles({
    name: "bad.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("title,bpm\nGood,122\nBad,NaN"),
  });
  await expect(
    page
      .getByRole("region", { name: "DJ 曲库", exact: true })
      .getByRole("alert"),
  ).toContainText("第 3 行");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("together-wealth-v3")!).preferences
          .lifestyle?.tracks.length ?? 0,
    ),
  ).toBe(0);
  const csv =
    "title,artist,bpm,key,genre,energy,duration,rating\nSoft Arrival,Synthetic,122,Am,House,4,5:30,4\nSoft Arrival,Synthetic,122,Am,House,4,5:30,4\nGolden Hour,Synthetic,124,9A,House,5,6:00,5";
  await input.setInputFiles({
    name: "tracks.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(
    page.getByRole("region", { name: "曲库导入预览" }),
  ).toContainText("跳过 1 首");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("together-wealth-v3")!).preferences
          .lifestyle?.tracks.length ?? 0,
    ),
  ).toBe(0);
  await page
    .getByRole("button", { name: "确认导入 2 首", exact: true })
    .click();
  await saved(page);
  await page.reload();
  await saved(page);
  await expect(page.getByRole("region", { name: "DJ 曲库" })).toContainText(
    "2 / 2 首",
  );
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "删除曲目：Golden Hour", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "编辑曲目：Golden Hour", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "撤销移除", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "编辑曲目：Golden Hour", exact: true }),
  ).toBeVisible();
  await page.getByText("备份与数据", { exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出兴趣备份", exact: true }).click();
  expect((await download).suggestedFilename()).toBe(
    "Together-lifestyle-backup.json",
  );
  await page.getByLabel("选择兴趣备份", { exact: true }).setInputFiles({
    name: "synthetic-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(lifestyleFixture())),
  });
  await expect(page.getByRole("dialog")).toContainText("5 首曲目");
  await page
    .getByRole("button", { name: "确认替换兴趣空间", exact: true })
    .click();
  await saved(page);
  await expect(page.getByRole("region", { name: "DJ 曲库" })).toContainText(
    "5 / 5 首",
  );
  await page.getByRole("button", { name: "隐藏兴趣空间", exact: true }).click();
  await expect(page.getByRole("region", { name: "DJ 曲库" })).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "兴趣空间已隐藏", exact: true }),
  ).toBeVisible();
});
test("过期编辑不覆盖另一页兴趣数据；推荐偏好保存且未知时长明确", async ({
  page,
}) => {
  await authenticate(page, { seed: seed(true) });
  await page.goto("/lifestyle");
  await saved(page);
  await page
    .getByRole("button", { name: "编辑曲目：Soft Arrival", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("曲名", { exact: true })
    .fill("Unsaved old draft");
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("together-wealth-v3")!);
    s.preferences.lifestyle.tracks[0].title = "Partner updated";
    s.revision++;
    const raw = JSON.stringify(s);
    localStorage.setItem("together-wealth-v3", raw);
    dispatchEvent(
      new StorageEvent("storage", { key: "together-wealth-v3", newValue: raw }),
    );
  });
  await page.getByRole("button", { name: "保存曲目", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("尚未保存");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("together-wealth-v3")!).preferences
          .lifestyle.tracks[0].title,
    ),
  ).toBe("Partner updated");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page.getByRole("tab", { name: "Set Builder", exact: true }).click();
  await page.getByRole("button", { name: "新建 Set", exact: true }).click();
  await page
    .getByLabel("Set 名称", { exact: true })
    .fill("Unknown duration practice");
  await page.getByRole("button", { name: "保存 Set", exact: true }).click();
  await page.getByLabel("选择起始曲目", { exact: true }).selectOption("d");
  await page.getByRole("button", { name: "用这首开始", exact: true }).click();
  await expect(page.locator(".hobby-duration")).toContainText("1 首时长未完整");
  await page.getByRole("button", { name: "调整推荐", exact: true }).click();
  await page.getByLabel("目标能量变化", { exact: true }).selectOption("-1");
  await page.getByLabel("偏好风格", { exact: true }).fill("House, Disco");
  await page.getByRole("button", { name: "保存推荐偏好", exact: true }).click();
  await saved(page);
  await page.reload();
  await saved(page);
  await expect(page.locator(".hobby-recipe")).toContainText("目标能量 -1");
  await expect(page.locator(".hobby-candidates")).toContainText("BPM 缺失");
  await page.getByRole("tab", { name: "曲库", exact: true }).click();
  await page.locator(".hobby-page").screenshot({
    path: `test-results/lifestyle-library-${test.info().project.name}.png`,
  });
});
test("家庭导航进入兴趣空间，推荐在桌面和手机完整可见且返回财富不改账", async ({
  page,
}) => {
  await authenticate(page, { seed: seed(true) });
  await page.goto("/");
  await page
    .getByRole("region", { name: "我的家庭工作台" })
    .getByRole("link", { name: /兴趣与生活/ })
    .click();
  await saved(page);
  await expect(page).toHaveURL(/\/lifestyle$/);
  await expect(
    page.getByRole("heading", { name: "兴趣与生活", exact: true }),
  ).toBeVisible();
  await page.locator(".hobby-page").screenshot({
    path: `test-results/lifestyle-overview-${test.info().project.name}.png`,
  });
  await page.getByRole("tab", { name: "Set Builder", exact: true }).click();
  await page.getByRole("button", { name: "新建 Set", exact: true }).click();
  await page
    .getByLabel("Set 名称", { exact: true })
    .fill("Sunday · Slow listening");
  await page.getByRole("button", { name: "保存 Set", exact: true }).click();
  await page.getByLabel("选择起始曲目", { exact: true }).selectOption("a");
  await page.getByRole("button", { name: "用这首开始", exact: true }).click();
  const candidates = page.locator(".hobby-candidates");
  await expect(candidates).toContainText("Golden Hour");
  await expect(candidates).toContainText("相邻调性");
  await expect(candidates).toContainText("调性未记录");
  await page.locator(".hobby-builder").screenshot({
    path: `test-results/lifestyle-recommendations-${test.info().project.name}.png`,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator('a[href="/#overview"]:visible').first().click();
  await expect(page.locator("#assets")).toBeVisible();
  const state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("together-wealth-v3")!),
  );
  expect(state.assets).toEqual(seed().assets);
  expect(state.history).toEqual([]);
});
test("真实临时家庭：两位成员可继续维护同一曲库与Set，刷新后保持", async ({
  page,
  browser,
}) => {
  test.skip(
    process.env.RUN_SUPABASE_E2E !== "1",
    "Real shared cloud test is opt-in",
  );
  test.setTimeout(60000);
  const home = await authenticate(page, { seed: seed(true) }),
    context = await browser.newContext(),
    partner = await context.newPage();
  try {
    await authenticate(partner, {
      email: "sallyxie0378@gmail.com",
      householdId: home,
    });
    await page.goto("/lifestyle");
    await saved(page);
    await assertFixtureConnection(page, home);
    await page
      .getByRole("button", { name: "编辑曲目：Soft Arrival", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("个人评分（1–5）", { exact: true })
      .fill("5");
    await page.getByRole("button", { name: "保存曲目", exact: true }).click();
    await saved(page);
    await partner.goto("/lifestyle");
    await saved(partner);
    await assertFixtureConnection(partner, home);
    await partner
      .getByRole("button", { name: "编辑曲目：Soft Arrival", exact: true })
      .click();
    await expect(
      partner
        .getByRole("dialog")
        .getByLabel("个人评分（1–5）", { exact: true }),
    ).toHaveValue("5");
    await partner
      .getByRole("dialog")
      .getByLabel("Cue 与个人备注", { exact: true })
      .fill("Synthetic partner cue note");
    await partner
      .getByRole("button", { name: "保存曲目", exact: true })
      .click();
    await saved(partner);
    await page.reload();
    await saved(page);
    await page
      .getByRole("button", { name: "编辑曲目：Soft Arrival", exact: true })
      .click();
    await expect(
      page.getByRole("dialog").getByLabel("Cue 与个人备注", { exact: true }),
    ).toHaveValue("Synthetic partner cue note");
  } finally {
    await context.close();
  }
});
