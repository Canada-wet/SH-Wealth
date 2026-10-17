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
test("拖入自动预览、部分错误清单、确认及刷新；不上传音频或改财富", async ({
  page,
}) => {
  const home = await authenticate(page, { seed: seed() });
  await page.goto("/lifestyle#rekordbox");
  await synced(page);
  await assertFixtureConnection(page, home);
  const transfer = await page.evaluateHandle(
    (text) => {
      const data = new DataTransfer();
      data.items.add(
        new File([text], "synthetic-partial.xml", { type: "application/xml" }),
      );
      return data;
    },
    REKORDBOX_FIXTURE.replace('AverageBpm="124"', 'AverageBpm="bad"'),
  );
  await page
    .getByRole("region", { name: "拖入 rekordbox XML", exact: true })
    .dispatchEvent("drop", { dataTransfer: transfer });
  const preview = page.getByRole("region", { name: "rekordbox 导入预览" });
  await expect(preview).toContainText("新增 1 首");
  await expect(preview).toContainText("跳过 1 首 / 1 张歌单");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("together-wealth-v3")!).preferences
          .lifestyle,
    ),
  ).toBeUndefined();
  await preview.getByText("查看跳过原因与歌单变化", { exact: true }).click();
  await expect(preview).toContainText("Golden Hour");
  await expect(preview).toContainText("BPM");
  const downloaded = page.waitForEvent("download");
  await preview.getByRole("button", { name: "下载完整检查清单" }).click();
  expect((await downloaded).suggestedFilename()).toBe(
    "rekordbox-import-report.json",
  );
  await preview
    .getByRole("button", { name: "确认导入 rekordbox", exact: true })
    .click();
  await synced(page);
  await page.reload();
  await synced(page);
  const state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("together-wealth-v3")!),
  );
  expect(state.preferences.lifestyle.tracks).toHaveLength(1);
  expect(state.preferences.lifestyle.sets[0].entries).toHaveLength(2);
  expect(state.assets).toEqual([]);
  expect(state.history).toEqual([]);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
});
test("记住XML真实句柄跨刷新；文件变化只预览、明确更新后保存、忘记文件不删曲库", async ({
  page,
}) => {
  test.skip(
    test.info().project.name !== "desktop",
    "Native picker enhancement is desktop Chromium only; Safari uses file input.",
  );
  const home = await authenticate(page, { seed: seed() });
  // Browser-owned isolated OPFS fixture: never access user music or machine files.
  await page.addInitScript((text) => {
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: async () => {
        const root = await navigator.storage.getDirectory(),
          handle = await root.getFileHandle("synthetic-connected.xml", {
            create: true,
          });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        return [handle];
      },
    });
  }, REKORDBOX_FIXTURE);
  await page.goto("/lifestyle#rekordbox");
  await synced(page);
  await assertFixtureConnection(page, home);
  await page
    .getByRole("button", { name: "连接并记住 XML", exact: true })
    .click();
  const preview = page.getByRole("region", { name: "rekordbox 导入预览" });
  await expect(preview).toContainText("新增 2 首");
  await preview
    .getByRole("button", { name: "确认导入 rekordbox", exact: true })
    .click();
  await synced(page);
  await page.reload();
  await synced(page);
  await expect(
    page.getByText("已连接：synthetic-connected.xml", { exact: true }),
  ).toBeVisible();
  await expect(preview).toHaveCount(0);
  await page.evaluate(async (text) => {
    const root = await navigator.storage.getDirectory(),
      handle = await root.getFileHandle("synthetic-connected.xml");
    const writer = await handle.createWritable();
    await writer.write(
      text.replace('Name="Golden Hour"', 'Name="Golden Glow"'),
    );
    await writer.close();
    window.dispatchEvent(new Event("focus"));
  }, REKORDBOX_FIXTURE);
  await expect(preview).toContainText("Golden Glow");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("together-wealth-v3")!).preferences
          .lifestyle.tracks[1].title,
    ),
  ).toBe("Golden Hour");
  await page.getByText("同路径匹配与更新选项", { exact: true }).click();
  await page
    .getByLabel("以 XML 更新相同音乐路径的曲目和 Cue（保留本地能量）", {
      exact: true,
    })
    .check();
  await expect(preview).toContainText("更新 2 首");
  await preview
    .getByRole("button", { name: "确认导入 rekordbox", exact: true })
    .click();
  await synced(page);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("together-wealth-v3")!).preferences
          .lifestyle.tracks[1].title,
    ),
  ).toBe("Golden Glow");
  await page.getByRole("button", { name: "忘记文件", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "连接并记住 XML", exact: true }),
  ).toBeVisible();
  await page.reload();
  await synced(page);
  await expect(
    page.getByRole("button", { name: "连接并记住 XML", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("together-wealth-v3")!).preferences
          .lifestyle.tracks,
    ),
  ).toHaveLength(2);
  const json = await page.evaluate(() =>
    localStorage.getItem("together-wealth-v3")!,
  );
  expect(json).not.toContain("synthetic-connected.xml");
  expect(json).not.toContain("lastImportedHash");
});
