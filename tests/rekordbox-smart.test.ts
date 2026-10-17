// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  readRekordboxXML,
  previewRekordboxSmart,
  suggestedRekordboxScope,
} from "../lib/rekordbox";
import { EMPTY_LIFESTYLE } from "../lib/lifestyle-schema";
import { REKORDBOX_FIXTURE } from "./fixtures/rekordbox";
const catalog = (text = REKORDBOX_FIXTURE) => readRekordboxXML(text);
const life = () => structuredClone(EMPTY_LIFESTYLE);
describe("guided rekordbox import", () => {
  it("完整自动预览不修改源数据，保留路径、拍点和重复曲序", () => {
    const initial = life(),
      json = JSON.stringify(initial);
    const result = previewRekordboxSmart(catalog(), initial, "all");
    expect(result.added).toBe(2);
    expect(result.issues).toEqual([]);
    expect(result.next.sets[0].entries.map((e) => e.trackId)).toEqual([
      result.next.tracks[0].id,
      result.next.tracks[1].id,
      result.next.tracks[0].id,
    ]);
    expect(result.next.tracks[0].rekordbox?.tempos).toHaveLength(2);
    expect(JSON.stringify(initial)).toBe(json);
  });
  it("一首坏BPM不阻止其他曲目，受影响歌单明确报告", () => {
    const result = previewRekordboxSmart(
      catalog(
        REKORDBOX_FIXTURE.replace('AverageBpm="124"', 'AverageBpm="bad"'),
      ),
      life(),
      "all",
    );
    expect(result.added).toBe(1);
    expect(result.skippedTracks).toBe(1);
    expect(result.skippedPlaylists).toBe(1);
    expect(result.next.sets[0].entries).toHaveLength(2);
    expect(
      result.issues.some(
        (i) => i.kind === "reference" && i.reason.includes("移除 1"),
      ),
    ).toBe(true);
    expect(
      result.issues.some(
        (i) => i.name === "Golden Hour" && i.reason.includes("BPM"),
      ),
    ).toBe(true);
  });
  it("同路径歧义全部跳过，不任意选择Cue版本", () => {
    const text = REKORDBOX_FIXTURE.replace(
      "file://localhost/C:/Music/Golden%20Hour.flac",
      "file:///Music/Soft%20%26%20Warm.mp3",
    );
    const result = previewRekordboxSmart(catalog(text), life(), "all");
    expect(result.added).toBe(0);
    expect(result.skippedTracks).toBe(2);
    expect(result.next.sets).toHaveLength(0);
  });
  it("缺失引用明确列出，其余曲序保持", () => {
    const result = previewRekordboxSmart(
      catalog(
        REKORDBOX_FIXTURE.replace('<TRACK Key="20"/>', '<TRACK Key="404"/>'),
      ),
      life(),
      "0",
    );
    expect(result.added).toBe(1);
    expect(result.next.sets[0].entries).toHaveLength(2);
    expect(result.issues.some((i) => i.reason.includes("404"))).toBe(true);
  });
  it("超长歌单整张跳过，不截断200项", () => {
    const c = catalog();
    c.playlists[0].keys = Array(201).fill("10");
    const result = previewRekordboxSmart(c, life(), "all");
    expect(result.skippedPlaylists).toBe(1);
    expect(result.next.sets).toHaveLength(1);
    expect(result.added).toBe(2);
    expect(result.issues[0].reason).toContain("不截断");
  });
  it("全部不兼容仍给出零新增与报告，不虚构曲目", () => {
    const c = catalog();
    c.tracks.forEach((t) =>
      t.setAttribute("Location", "https://stream.invalid/song"),
    );
    const result = previewRekordboxSmart(c, life(), "all");
    expect(result.skippedTracks).toBe(2);
    expect(result.added).toBe(0);
    expect(result.next.tracks).toEqual([]);
  });
  it("未选中的坏曲目不影响单歌单", () => {
    const c = catalog();
    c.tracks[0].setAttribute("AverageBpm", "bad");
    const result = previewRekordboxSmart(c, life(), "1");
    expect(result.added).toBe(1);
    expect(result.issues).toEqual([]);
  });
  it("匹配现有路径默认保留，明确更新才更改，不覆盖Set编排", () => {
    const c = catalog(),
      previous = previewRekordboxSmart(c, life(), "all").next;
    previous.tracks[0].title = "My title";
    previous.tracks[0].energy = 9;
    previous.sets[0].entries[0].note = "My transition";
    const kept = previewRekordboxSmart(c, previous, "all"),
      updated = previewRekordboxSmart(c, previous, "all", true);
    expect(kept.next.tracks[0].title).toBe("My title");
    expect(updated.next.tracks[0].title).toBe("Soft & Warm");
    expect(updated.next.tracks[0].energy).toBe(9);
    expect(updated.next.sets[0].entries[0].note).toBe("My transition");
  });
  it("容量溢出不静默截断，非法范围拒绝", () => {
    const c = catalog(),
      p = previewRekordboxSmart(c, life(), "all").next;
    p.tracks = Array.from({ length: 1000 }, (_, i) => ({
      ...p.tracks[0],
      id: `local-${i}`,
      fileLocation: `file://localhost/Other/${i}.mp3`,
    }));
    p.sets = [];
    expect(() => previewRekordboxSmart(c, p, "all")).toThrow(/容量/);
    expect(() => previewRekordboxSmart(c, life(), "missing")).toThrow(/有效/);
  });
  it("全库超过1000首显式预选小歌单，不偷偷裁掉多余曲目", () => {
    const c = catalog();
    c.tracks = Array(1001).fill(c.tracks[0]);
    const suggested = suggestedRekordboxScope(c, life());
    expect(suggested.scope).toBe("0");
    expect(suggested.note).toContain("仅导入这张歌单");
  });
  it("Set容量不足建议仅曲库；正常建议全部", () => {
    expect(suggestedRekordboxScope(catalog(), life()).scope).toBe("all");
    const previous = previewRekordboxSmart(catalog(), life(), "all").next;
    previous.sets = Array.from({ length: 60 }, (_, i) => ({
      ...previous.sets[0],
      id: String(i),
      rekordboxSource: undefined,
    }));
    expect(suggestedRekordboxScope(catalog(), previous).scope).toBe(
      "collection",
    );
  });
  it("文件级不安全XML仍然整体拒绝", () => {
    expect(() =>
      catalog(
        '<!DOCTYPE DJ_PLAYLISTS [<!ENTITY x SYSTEM "file:///etc/passwd">]>' +
          REKORDBOX_FIXTURE,
      ),
    ).toThrow(/DTD/);
    expect(() =>
      catalog(REKORDBOX_FIXTURE.replace('TrackID="20"', 'TrackID="10"')),
    ).toThrow(/TrackID/);
  });
});
