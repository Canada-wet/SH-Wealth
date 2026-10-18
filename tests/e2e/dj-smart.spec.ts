import { test, expect } from "@playwright/test";
import {
  authenticate,
  cleanupAuthenticated,
  assertFixtureConnection,
} from "./auth-helper";
import { emptyState } from "../../lib/wealth";
import { lifestyleFixture } from "../fixtures/lifestyle";
import { syntheticDJWave } from "../fixtures/dj-audio";
const seed = () => {
  const s = emptyState();
  s.preferences.model = "local";
  s.preferences.proactive = false;
  const life = lifestyleFixture();
  life.tracks.forEach((t, i) => {
    t.fileLocation = `file://localhost/Synthetic/${t.id}.wav`;
    if (t.duration !== null) t.duration = [64, 90, 100, 0, 80][i];
  });
  life.tracks[0].bpm = 120;
  life.tracks[0].rekordbox = {
    attributes: {},
    tempos: [{ start: 0, bpm: 120, meter: "4/4", beat: 1 }],
  };
  life.tracks[0].cues = [
    { id: "original-hot", label: "Original A", seconds: 0.25, type: 0, num: 0 },
  ];
  life.sets = [
    {
      id: "original-set",
      name: "Existing order",
      owner: "joint",
      targetMinutes: 5,
      entries: [
        {
          id: "original-entry",
          trackId: "a",
          cueIn: 0,
          cueOut: null,
          overlap: 0,
          note: "Keep this",
        },
      ],
    },
  ];
  s.preferences.lifestyle = life;
  return s;
};
const synced = async (page: import("@playwright/test").Page) =>
  expect(page.locator(".hobby-cloud-status")).toContainText("已同步 Supabase");
const state = async (page: import("@playwright/test").Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("together-wealth-v3")!));
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("本机真实WAV解码与Worker：试听确认Cue、智能Set、新旧共存、刷新及XML导出", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const home = await authenticate(page, { seed: seed() });
  await page.goto("/lifestyle#library");
  await synced(page);
  await assertFixtureConnection(page, home);
  const leaks: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "media" && /^https?:/.test(request.url()))
      leaks.push("remote media");
    if (
      request.method() === "POST" &&
      request.postDataBuffer()?.includes(Buffer.from("RIFF"))
    )
      leaks.push("audio upload");
    if (/\/api\/(?:advisor|voice)/.test(request.url()))
      leaks.push("AI endpoint");
  });
  await page
    .getByRole("button", { name: "分析音频：Soft Arrival", exact: true })
    .click();
  const dialog = page.getByRole("dialog"),
    confirm = dialog.getByRole("button", {
      name: "确认追加所选 Cue",
      exact: true,
    });
  await dialog
    .getByLabel("选择智能 Cue 本地音频", { exact: true })
    .setInputFiles({
      name: "synthetic-local.wav",
      mimeType: "audio/wav",
      buffer: syntheticDJWave(),
    });
  const preview = dialog.getByRole("region", { name: "音频 Cue 预览" });
  await expect(preview).toBeVisible({ timeout: 20000 });
  await expect(preview).toContainText("能量上升候选");
  await expect(preview).toContainText("4 小节 Loop 参考");
  expect((await state(page)).preferences.lifestyle.tracks[0].cues).toHaveLength(
    1,
  );
  await expect(confirm).toBeDisabled();
  await page.evaluate(() => {
    document.querySelector("audio")!.muted = true;
  });
  await dialog
    .getByRole("button", { name: "试听：4 小节 Loop 参考", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("audio")!.currentTime),
    )
    .toBeGreaterThan(4.05);
  await page.evaluate(() => document.querySelector("audio")!.pause());
  await dialog
    .getByLabel("我确认这个音频对应「Soft Arrival」的正确版本", { exact: true })
    .check();
  await dialog
    .getByLabel(
      "我已试听、核对所选候选位置，理解它们不是已识别的 Drop / 副歌",
      { exact: true },
    )
    .check();
  await expect(confirm).toBeEnabled();
  await dialog.screenshot({
    path: `test-results/dj-audio-${test.info().project.name}.png`,
  });
  await confirm.click();
  await synced(page);
  await page.reload();
  await synced(page);
  const afterCue = await state(page);
  expect(afterCue.preferences.lifestyle.tracks[0].cues[0]).toEqual(
    seed().preferences.lifestyle!.tracks[0].cues[0],
  );
  expect(
    afterCue.preferences.lifestyle.tracks[0].cues.some(
      (c: { type: number; end: number; seconds: number }) =>
        c.type === 4 && c.end > c.seconds,
    ),
  ).toBe(true);
  expect(JSON.stringify(afterCue)).not.toContain("synthetic-local.wav");
  expect(JSON.stringify(afterCue)).not.toContain("waveform");
  expect(JSON.stringify(afterCue)).not.toContain("blob:");
  await page.getByRole("tab", { name: "Set Builder", exact: true }).click();
  await page.getByRole("button", { name: "一键智能编排", exact: true }).click();
  await page
    .getByLabel("智能 Set 名称", { exact: true })
    .fill("Synthetic AI flow");
  await page.getByLabel("智能 Set 目标分钟", { exact: true }).fill("3");
  await page.getByLabel("智能 Set 起始曲", { exact: true }).selectOption("a");
  await page
    .getByLabel("智能 Set 能量走向", { exact: true })
    .selectOption("arc");
  await page.getByRole("button", { name: "生成编排预览", exact: true }).click();
  const plan = page.getByRole("region", { name: "智能编排预览" });
  await expect(plan).toContainText("Synthetic AI flow");
  await expect(plan).toContainText("片段");
  expect((await state(page)).preferences.lifestyle.sets).toHaveLength(1);
  await dialog.screenshot({
    path: `test-results/dj-plan-${test.info().project.name}.png`,
  });
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
  await page
    .getByRole("button", { name: "确认保存为新 Set", exact: true })
    .click();
  await synced(page);
  await page.reload();
  await synced(page);
  const after = await state(page);
  expect(after.preferences.lifestyle.sets).toHaveLength(2);
  expect(after.preferences.lifestyle.sets[0]).toEqual(
    seed().preferences.lifestyle!.sets[0],
  );
  const set = after.preferences.lifestyle.sets[1];
  expect(set.entries.length).toBeGreaterThan(1);
  expect(set.entries[0].cueIn).toBeGreaterThan(0);
  expect(set.entries[0].cueOut).toBeLessThan(64);
  expect(after.assets).toEqual([]);
  expect(after.history).toEqual([]);
  expect(leaks).toEqual([]);
  await page.getByRole("tab", { name: "rekordbox", exact: true }).click();
  await page
    .getByLabel("rekordbox 导出范围", { exact: true })
    .selectOption(set.id);
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出 rekordbox XML", exact: true })
    .click();
  const download = await downloading,
    stream = await download.createReadStream(),
    chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const xml = Buffer.concat(chunks).toString("utf8");
  expect(xml).toContain("Synthetic AI flow");
  expect(xml).toContain("音频候选");
  expect(xml).toContain('Type="4"');
  expect(xml).toContain('Name="Original A"');
  if (process.env.RUN_SUPABASE_E2E === "1") {
    const context = await browser.newContext(),
      partner = await context.newPage();
    try {
      await authenticate(partner, {
        email: "sallyxie0378@gmail.com",
        householdId: home,
      });
      await partner.goto("/lifestyle#library");
      await synced(partner);
      await assertFixtureConnection(partner, home);
      const shared = await state(partner);
      expect(shared.preferences.lifestyle.tracks[0].cues).toEqual(
        after.preferences.lifestyle.tracks[0].cues,
      );
      expect(shared.preferences.lifestyle.sets[1]).toEqual(set);
      expect(shared.assets).toEqual([]);
      expect(shared.history).toEqual([]);
    } finally {
      await context.close();
    }
  }
});
test("损坏音频、错版本时长、静音及取消不改Cue", async ({ page }) => {
  const home = await authenticate(page, { seed: seed() });
  await page.goto("/lifestyle#library");
  await synced(page);
  await assertFixtureConnection(page, home);
  await page
    .getByRole("button", { name: "分析音频：Soft Arrival", exact: true })
    .click();
  const input = page.getByLabel("选择智能 Cue 本地音频", { exact: true }),
    dialog = page.getByRole("dialog");
  await input.setInputFiles({
    name: "bad.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("invalid synthetic audio"),
  });
  await expect(dialog.getByRole("alert")).toContainText("音频");
  await input.setInputFiles({
    name: "wrong-version.wav",
    mimeType: "audio/wav",
    buffer: syntheticDJWave(20),
  });
  await expect(dialog.getByRole("alert")).toContainText("可能不是同一版本", {
    timeout: 20000,
  });
  await input.setInputFiles({
    name: "silent.wav",
    mimeType: "audio/wav",
    buffer: syntheticDJWave(64, true),
  });
  await expect(
    dialog.getByRole("region", { name: "音频 Cue 预览" }),
  ).toContainText("实测", { timeout: 20000 });
  await expect(
    dialog.getByRole("button", { name: "确认追加所选 Cue", exact: true }),
  ).toBeDisabled();
  page.once("dialog", (d) => d.accept());
  await dialog.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  expect((await state(page)).preferences.lifestyle.tracks[0].cues).toHaveLength(
    1,
  );
});
