import { test, expect } from "@playwright/test";
import {
  authenticate,
  cleanupAuthenticated,
  assertFixtureConnection,
} from "./auth-helper";
import { emptyState } from "../../lib/wealth";
import { REKORDBOX_FIXTURE } from "../fixtures/rekordbox";
const seed = () => {
  const s = emptyState();
  s.preferences.model = "local";
  s.preferences.proactive = false;
  return s;
};
const synced = async (page: import("@playwright/test").Page) =>
  expect(page.locator(".hobby-cloud-status")).toContainText("已同步 Supabase");
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("真实临时家庭：rekordbox路径、毫秒Cue、Loop和BeatGrid双成员共享且不改财富", async ({
  page,
  browser,
}) => {
  test.skip(process.env.RUN_SUPABASE_E2E !== "1", "Actual cloud is opt-in");
  test.setTimeout(60000);
  const home = await authenticate(page, { seed: seed() }),
    context = await browser.newContext(),
    partner = await context.newPage();
  try {
    await authenticate(partner, {
      email: "sallyxie0378@gmail.com",
      householdId: home,
    });
    await page.goto("/lifestyle#rekordbox");
    await synced(page);
    await assertFixtureConnection(page, home);
    await page
      .getByLabel("选择 rekordbox XML 文件", { exact: true })
      .setInputFiles({
        name: "synthetic.xml",
        mimeType: "application/xml",
        buffer: Buffer.from(REKORDBOX_FIXTURE),
      });
    await page
      .getByRole("button", { name: "预览 XML 导入", exact: true })
      .click();
    await page
      .getByRole("button", { name: "确认导入 rekordbox", exact: true })
      .click();
    await synced(page);
    await partner.goto("/lifestyle#library");
    await synced(partner);
    await assertFixtureConnection(partner, home);
    await partner
      .getByRole("button", { name: "编辑曲目：Soft & Warm", exact: true })
      .click();
    await expect(
      partner.getByLabel("音乐文件路径", { exact: true }),
    ).toHaveValue("file://localhost/Music/Soft%20%26%20Warm.mp3");
    await partner
      .getByText("管理时间 Cue（元数据，不控制播放器）", { exact: true })
      .click();
    await expect(
      partner.getByLabel("Loop 结束秒数 3", { exact: true }),
    ).toHaveValue("144.75");
    await partner.getByLabel("Cue 秒数 2", { exact: true }).fill("64.875");
    await partner
      .getByRole("button", { name: "保存曲目", exact: true })
      .click();
    await synced(partner);
    await page.reload();
    await synced(page);
    await assertFixtureConnection(page, home);
    const state = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("together-wealth-v3")!),
    );
    expect(state.preferences.lifestyle.tracks[0].cues[1].seconds).toBe(64.875);
    expect(state.preferences.lifestyle.tracks[0].rekordbox.tempos).toHaveLength(
      2,
    );
    expect(state.preferences.lifestyle.sets[0].entries).toHaveLength(3);
    expect(state.assets).toEqual([]);
    expect(state.history).toEqual([]);
  } finally {
    await context.close();
  }
});
test("rekordbox XML预览、按路径合并、毫秒Cue与Loop编辑、刷新和下载保持曲序", async ({
  page,
}) => {
  await authenticate(page, { seed: seed() });
  await page.goto("/lifestyle#rekordbox");
  await synced(page);
  const input = page.getByLabel("选择 rekordbox XML 文件", { exact: true });
  await input.setInputFiles({
    name: "synthetic.xml",
    mimeType: "application/xml",
    buffer: Buffer.from(REKORDBOX_FIXTURE),
  });
  await page
    .getByRole("button", { name: "预览 XML 导入", exact: true })
    .click();
  const preview = page.getByRole("region", { name: "rekordbox 导入预览" });
  await expect(preview).toContainText("新增 2 首");
  await expect(preview).toContainText("Soft & Warm");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("together-wealth-v3")!).preferences
          .lifestyle,
    ),
  ).toBeUndefined();
  await page
    .getByRole("button", { name: "确认导入 rekordbox", exact: true })
    .click();
  await synced(page);
  await page.reload();
  await synced(page);
  await expect(
    page.getByRole("region", { name: "rekordbox 交换中心" }),
  ).toContainText("2 / 2 首已关联路径");
  await input.setInputFiles({
    name: "synthetic-again.xml",
    mimeType: "application/xml",
    buffer: Buffer.from(REKORDBOX_FIXTURE),
  });
  await page
    .getByRole("button", { name: "预览 XML 导入", exact: true })
    .click();
  await expect(preview).toContainText("新增 0 首");
  await expect(preview).toContainText("保留 2 首");
  await page.getByRole("button", { name: "取消导入", exact: true }).click();
  await page.getByRole("tab", { name: "曲库", exact: true }).click();
  await page
    .getByRole("button", { name: "编辑曲目：Soft & Warm", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("音乐文件路径", { exact: true })).toHaveValue(
    "file://localhost/Music/Soft%20%26%20Warm.mp3",
  );
  await dialog
    .getByText("管理时间 Cue（元数据，不控制播放器）", { exact: true })
    .click();
  await expect(dialog.getByLabel("Cue 秒数 2", { exact: true })).toHaveValue(
    "64.451",
  );
  await expect(dialog.getByLabel("Cue 槽位 3", { exact: true })).toHaveValue(
    "7",
  );
  await expect(
    dialog.getByLabel("Loop 结束秒数 3", { exact: true }),
  ).toHaveValue("144.75");
  await dialog.getByLabel("Cue 秒数 2", { exact: true }).fill("64.625");
  await dialog.getByRole("button", { name: "保存曲目", exact: true }).click();
  await synced(page);
  await page.getByRole("tab", { name: "rekordbox", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出 rekordbox XML", exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Together-rekordbox.xml");
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const xml = Buffer.concat(chunks).toString("utf8");
  expect(xml).toContain('Start="64.625"');
  expect(xml).toContain('End="144.75"');
  expect(xml).toContain('Inizio="0.025"');
  expect(xml).toContain(
    '<TRACK Key="1"/>\n        <TRACK Key="2"/>\n        <TRACK Key="1"/>',
  );
  await expect(
    page.getByRole("region", { name: "rekordbox 交换中心" }),
  ).toContainText("已导出 2 首");
  await page.locator(".hobby-rekordbox").screenshot({
    path: `test-results/rekordbox-${test.info().project.name}.png`,
  });
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      overflow: [...document.querySelectorAll("body *")]
        .filter(
          (e) =>
            e.getBoundingClientRect().right > innerWidth + 1 &&
            getComputedStyle(e).position !== "fixed",
        )
        .slice(0, 12)
        .map((e) => ({
          tag: e.tagName,
          class: e.className,
          right: e.getBoundingClientRect().right,
        })),
    }));
    expect(layout.scroll, JSON.stringify(layout)).toBeLessThanOrEqual(
      layout.width,
    );
  }
  const state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("together-wealth-v3")!),
  );
  expect(state.assets).toEqual([]);
  expect(state.history).toEqual([]);
  expect(state.preferences.lifestyle.sets[0].entries).toHaveLength(3);
});
test("不安全XML不保存，缺少真实文件路径不生成假导出，手动路径可补齐", async ({
  page,
}) => {
  await authenticate(page, { seed: seed() });
  await page.goto("/lifestyle#rekordbox");
  await synced(page);
  await page
    .getByLabel("选择 rekordbox XML 文件", { exact: true })
    .setInputFiles({
      name: "unsafe.xml",
      mimeType: "application/xml",
      buffer: Buffer.from(
        '<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///private">]><DJ_PLAYLISTS/>',
      ),
    });
  await expect(
    page.getByRole("region", { name: "rekordbox 交换中心" }).getByRole("alert"),
  ).toContainText("外部实体");
  await page.getByRole("tab", { name: "曲库", exact: true }).click();
  await page.getByRole("button", { name: "添加曲目", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("曲名", { exact: true })
    .fill("Synthetic manual track");
  await page.getByRole("button", { name: "保存曲目", exact: true }).click();
  await synced(page);
  await page.getByRole("tab", { name: "rekordbox", exact: true }).click();
  let downloads = 0;
  page.on("download", () => downloads++);
  await page
    .getByRole("button", { name: "导出 rekordbox XML", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "rekordbox 交换中心" }).getByRole("alert"),
  ).toContainText("缺少音乐路径");
  expect(downloads).toBe(0);
  await page.getByRole("tab", { name: "曲库", exact: true }).click();
  await page
    .getByRole("button", {
      name: "编辑曲目：Synthetic manual track",
      exact: true,
    })
    .click();
  await page
    .getByLabel("音乐文件路径", { exact: true })
    .fill("/Music/Synthetic manual track.mp3");
  await page.getByRole("button", { name: "保存曲目", exact: true }).click();
  await synced(page);
  await page.getByRole("tab", { name: "rekordbox", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出 rekordbox XML", exact: true })
    .click();
  await download;
  expect(downloads).toBe(1);
});
