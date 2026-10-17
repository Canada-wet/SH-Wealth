// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { normalizeFileLocation } from "../lib/dj-location";
import {
  readRekordboxXML,
  previewRekordbox,
  exportRekordbox,
} from "../lib/rekordbox";
import {
  EMPTY_LIFESTYLE,
  validLifestyle,
  validTrack,
} from "../lib/lifestyle-schema";
import { changeLifestyle, lifestyleFingerprint } from "../lib/dj";
import { previewCSV, tracksCSV, readLifestyleBackup } from "../lib/dj-import";
import { emptyState, finishChange, validateState } from "../lib/wealth";
import { REKORDBOX_FIXTURE } from "./fixtures/rekordbox";
const imported = () =>
  previewRekordbox(
    readRekordboxXML(REKORDBOX_FIXTURE),
    structuredClone(EMPTY_LIFESTYLE),
    "all",
  ).next;
describe("rekordbox XML and local locations", () => {
  it("不猜测未知版本，拒绝超大XML及重复路径", () => {
    expect(() =>
      readRekordboxXML(
        REKORDBOX_FIXTURE.replace('Version="1.0.0"', 'Version="2.0.0"'),
      ),
    ).toThrow(/未知版本/);
    expect(() => readRekordboxXML(" ".repeat(12 * 1024 * 1024 + 1))).toThrow(
      /12MB/,
    );
    expect(() =>
      previewRekordbox(
        readRekordboxXML(
          REKORDBOX_FIXTURE.replace(
            "file://localhost/C:/Music/Golden%20Hour.flac",
            "file:///Music/Soft%20%26%20Warm.mp3",
          ),
        ),
        EMPTY_LIFESTYLE,
        "collection",
      ),
    ).toThrow(/同一路径/);
  });
  it("清空已识别调性不让原始调性重新出现；未记录拍点绝不伪造", () => {
    const life = imported();
    life.tracks[0].key = "";
    for (const t of life.tracks) if (t.rekordbox) t.rekordbox.tempos = [];
    const output = exportRekordbox(life);
    expect(output.xml).toContain('Tonality=""');
    expect(output.xml).not.toContain("<TEMPO");
    expect(output.warnings.join(" ")).toContain("不生成拍点");
  });
  it("已满Set时仍可只导曲库；无效时长更新不损坏已有片段", () => {
    const life = imported();
    life.sets = Array.from({ length: 60 }, (_, i) => ({
      ...structuredClone(life.sets[1]),
      id: String(i),
      rekordboxSource: undefined,
    }));
    expect(() =>
      previewRekordbox(readRekordboxXML(REKORDBOX_FIXTURE), life, "all"),
    ).toThrow(/容量/);
    expect(
      previewRekordbox(readRekordboxXML(REKORDBOX_FIXTURE), life, "collection")
        .next.sets,
    ).toHaveLength(60);
    life.sets[0].entries[0].cueIn = 200;
    expect(() =>
      previewRekordbox(
        readRekordboxXML(
          REKORDBOX_FIXTURE.replace('TotalTime="360"', 'TotalTime="100"'),
        ),
        life,
        "collection",
        true,
      ),
    ).toThrow(/冲突/);
  });
  it("同名不同文件不自动合并；导出同名Set自动区分名称", () => {
    const catalog = readRekordboxXML(
      REKORDBOX_FIXTURE.replace('Name="Golden Hour"', 'Name="Soft &amp; Warm"'),
    );
    const life = previewRekordbox(catalog, EMPTY_LIFESTYLE, "all").next;
    expect(life.tracks).toHaveLength(2);
    life.sets[1].name = life.sets[0].name;
    const output = readRekordboxXML(exportRekordbox(life).xml);
    expect(new Set(output.playlists.map((p) => p.path.join(" / "))).size).toBe(
      output.playlists.length,
    );
  });
  it.each([
    ["/Music/A & B #1.mp3", "file://localhost/Music/A%20%26%20B%20%231.mp3"],
    ["C:\\Music\\中文.mp3", "file://localhost/C:/Music/%E4%B8%AD%E6%96%87.mp3"],
    [
      "file:///Music/Hello%20World.mp3",
      "file://localhost/Music/Hello%20World.mp3",
    ],
    ["/Music/100%.mp3", "file://localhost/Music/100%25.mp3"],
  ])("规范本机路径 %s", (input, result) =>
    expect(normalizeFileLocation(input)).toBe(result),
  );
  it.each([
    "https://example.com/a.mp3",
    "file://server/music/a.mp3",
    "track.mp3",
    "/Music/",
    "file:///Music/a.mp3?token=abc",
    "file:///Music/a%2fb.mp3",
    "file:///a%00.mp3",
    "file:///bad%ZZ.mp3",
  ])("拒绝非本机或歧义路径 %s", (input) =>
    expect(() => normalizeFileLocation(input)).toThrow(),
  );
  it("读取原始小数 Cue、Memory/Hot A–H、Loop、BeatGrid、评分和嵌套歌单，保留重复曲序", () => {
    const next = imported();
    expect(validLifestyle(next)).toBe(true);
    expect(next.tracks[0]).toMatchObject({
      title: "Soft & Warm",
      key: "8A",
      bpm: 122.5,
      rating: 4,
      energy: null,
      cueNotes: "Intro\nKeep vocals clear",
    });
    expect(next.tracks[0].cues[1]).toMatchObject({
      seconds: 64.451,
      num: 0,
      type: 0,
      color: [255, 120, 0],
    });
    expect(next.tracks[0].cues[2]).toMatchObject({
      seconds: 128.25,
      end: 144.75,
      num: 7,
      type: 4,
    });
    expect(next.tracks[0].rekordbox?.tempos).toEqual([
      { start: 0.025, bpm: 122.5, meter: "4/4", beat: 1 },
      { start: 64.125, bpm: 123, meter: "4/4", beat: 2 },
    ]);
    expect(next.sets.map((s) => s.name)).toEqual([
      "Weekend / Warmup",
      "Weekend / By Location",
    ]);
    expect(next.sets[0].entries.map((e) => e.trackId)).toEqual([
      next.tracks[0].id,
      next.tracks[1].id,
      next.tracks[0].id,
    ]);
  });
  it("XML往返保留已支持元数据，不生成假BeatGrid，转场不成为曲目Cue，XML转义和引用一致", () => {
    const life = imported();
    life.sets[0].entries[1].note = "Only set transition";
    life.sets[0].entries[1].cueIn = 5;
    const output = exportRekordbox(life);
    expect(output.xml).toContain("Soft &amp; Warm");
    expect(output.xml).toContain("Intro&#10;Keep vocals clear");
    expect(output.xml).not.toContain("Only set transition");
    const next = previewRekordbox(
      readRekordboxXML(output.xml),
      structuredClone(EMPTY_LIFESTYLE),
      "collection",
    ).next;
    for (let i = 0; i < 2; i++) {
      const { id: a, cues: ca, ...ta } = life.tracks[i],
        { id: b, cues: cb, ...tb } = next.tracks[i];
      expect(tb).toEqual({
        ...ta,
        rekordbox: {
          ...ta.rekordbox!,
          attributes: {
            ...ta.rekordbox!.attributes,
            Tonality: i === 0 ? "Am" : "Em",
          },
        },
      });
      expect(cb.map(({ id, ...c }) => c)).toEqual(ca.map(({ id, ...c }) => c));
    }
    expect((output.xml.match(/<TEMPO /g) ?? []).length).toBe(2);
    const parsed = readRekordboxXML(output.xml);
    expect(parsed.playlists[0].keys).toEqual(["1", "2", "1"]);
  });
  it("单Set只带引用曲目；缺真实路径、重复路径、空范围不伪造导出", () => {
    const life = imported();
    const output = exportRekordbox(life, life.sets[1].id);
    expect(output.tracks).toBe(1);
    expect(output.xml).not.toContain("Soft &amp; Warm");
    delete life.tracks[0].fileLocation;
    expect(() => exportRekordbox(life)).toThrow(/缺少音乐路径/);
    life.tracks[0].fileLocation = life.tracks[1].fileLocation;
    expect(() => exportRekordbox(life)).toThrow(/重复音乐路径/);
    expect(() => exportRekordbox(EMPTY_LIFESTYLE)).toThrow(/没有曲目/);
  });
  it("重导默认保留本地编辑，显式更新才替换元数据，能量保留且Set不重复覆盖", () => {
    const life = imported();
    life.tracks[0].title = "Local title";
    life.tracks[0].energy = 7;
    life.sets[0].entries.reverse();
    const catalog = readRekordboxXML(REKORDBOX_FIXTURE);
    const keep = previewRekordbox(catalog, life, "all");
    expect(keep).toMatchObject({
      added: 0,
      kept: 2,
      setsKept: 2,
      setsAdded: 0,
    });
    expect(keep.next).toEqual(life);
    const update = previewRekordbox(catalog, life, "all", true);
    expect(update.updated).toBe(2);
    expect(update.next.tracks[0]).toMatchObject({
      id: life.tracks[0].id,
      title: "Soft & Warm",
      energy: 7,
    });
    expect(update.next.sets).toEqual(life.sets);
  });
  it("按指定歌单只导入引用曲目，不把流媒体或未选坏曲目拖进来", () => {
    const text = REKORDBOX_FIXTURE.replace(
      'Location="file://localhost/Music/Soft%20%26%20Warm.mp3"',
      'Location="https://example.com/stream"',
    );
    const catalog = readRekordboxXML(text);
    expect(
      previewRekordbox(catalog, EMPTY_LIFESTYLE, "1").next.tracks,
    ).toHaveLength(1);
    expect(() => previewRekordbox(catalog, EMPTY_LIFESTYLE, "all")).toThrow(
      /仅支持本机/,
    );
  });
  it.each([
    "<!DOCTYPE x [<!ENTITY x SYSTEM 'file:///private'>]><DJ_PLAYLISTS/>",
    "<not-rekordbox/>",
    "<DJ_PLAYLISTS><COLLECTION></DJ_PLAYLISTS>",
    REKORDBOX_FIXTURE.replace('TrackID="20"', 'TrackID="10"'),
    REKORDBOX_FIXTURE.replace('<TRACK Key="10"/>', '<TRACK Key="99"/>'),
    REKORDBOX_FIXTURE.replace('End="144.75"', 'End="120"'),
    REKORDBOX_FIXTURE.replace('Num="7"', 'Num="0"'),
    REKORDBOX_FIXTURE.replace('Rating="204"', 'Rating="999"'),
  ])("坏XML/不安全或歧义数据整批拒绝", (text) =>
    expect(() =>
      previewRekordbox(readRekordboxXML(text), EMPTY_LIFESTYLE, "all"),
    ).toThrow(),
  );
  it("未知调性保留原始值但不猜测，普通CSV保留路径/Cue，JSON保留BeatGrid", () => {
    const life = previewRekordbox(
      readRekordboxXML(
        REKORDBOX_FIXTURE.replace('Tonality="Am"', 'Tonality="Unknown Key"'),
      ),
      EMPTY_LIFESTYLE,
      "all",
    ).next;
    expect(life.tracks[0].key).toBe("");
    expect(exportRekordbox(life).xml).toContain('Tonality="Unknown Key"');
    const csv = previewCSV(tracksCSV(life.tracks), []);
    expect(csv.tracks[0].fileLocation).toBe(life.tracks[0].fileLocation);
    expect(csv.tracks[0].cues).toEqual(life.tracks[0].cues);
    expect(readLifestyleBackup(JSON.stringify(life))).toEqual(life);
  });
  it("64个标记上限、Hot槽位唯一、Loop结束校验，旧格式Cue仍兼容", () => {
    const t = imported().tracks[0];
    t.cues = Array.from({ length: 64 }, (_, i) => ({
      id: String(i),
      label: "Memory",
      seconds: i,
    }));
    expect(validTrack(t)).toBe(true);
    t.cues.push({ id: "65", label: "Too many", seconds: 1 });
    expect(validTrack(t)).toBe(false);
    t.cues = [{ id: "l", label: "Loop", seconds: 4, type: 4, end: 3 }];
    expect(validTrack(t)).toBe(false);
  });
  it("保存和备份兼容；导入不改财富、不造财务快照，过期导入拒绝覆盖", () => {
    const state = emptyState(),
      life = imported(),
      expected = lifestyleFingerprint(EMPTY_LIFESTYLE);
    const next = finishChange(
      state,
      changeLifestyle(state, expected, () => life),
      "XML",
      false,
    );
    validateState(next);
    expect(next.assets).toEqual(state.assets);
    expect(next.history).toEqual([]);
    expect(() => changeLifestyle(next, expected, () => life)).toThrow(
      /另一页面/,
    );
  });
});
