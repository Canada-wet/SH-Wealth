import { describe, it, expect } from "vitest";
import {
  changeLifestyle,
  formatDuration,
  lifestyleFingerprint,
  moveEntry,
  normalizeKey,
  parseDuration,
  recommendNext,
  removeTrack,
  setDuration,
} from "../lib/dj";
import {
  parseCSV,
  previewCSV,
  readLifestyleBackup,
  tracksCSV,
} from "../lib/dj-import";
import {
  EMPTY_LIFESTYLE,
  validLifestyle,
  type DJSet,
} from "../lib/lifestyle-schema";
import { emptyState, finishChange, validateState } from "../lib/wealth";
import { connectionPlan, hasSavedData } from "../lib/cloud-plan";
import { lifestyleFixture, testTrack } from "./fixtures/lifestyle";
const settings = () => structuredClone(EMPTY_LIFESTYLE.settings);
const setFixture = (): DJSet => ({
  id: "set",
  name: "Synthetic set",
  owner: "joint",
  targetMinutes: 10,
  entries: [
    {
      id: "e1",
      trackId: "a",
      cueIn: 0,
      cueOut: null,
      overlap: 0,
      note: "Intro",
    },
    {
      id: "e2",
      trackId: "b",
      cueIn: 0,
      cueOut: null,
      overlap: 30,
      note: "Blend A→B",
    },
  ],
});
describe("DJ启发推荐", () => {
  it.each([
    ["Am", "8A"],
    ["A minor", "8A"],
    ["C major", "8B"],
    ["C Minor", "5A"],
    ["F# MAJOR", "2B"],
    ["d MiN", "7A"],
    ["F# min", "11A"],
    ["Gb minor", "11A"],
    ["Bb", "6B"],
    ["12a", "12A"],
    ["", ""],
  ])("规范调性 %s", (input, key) => expect(normalizeKey(input)).toBe(key));
  it.each(["13A", "0B", "Am nonsense", "undefined", "1m"])(
    "无效调性不猜测 %s",
    (k) => expect(() => normalizeKey(k)).toThrow(),
  );
  it("同调/相邻/相对大小调含12→1循环，但不宣称音频过渡保证", () => {
    const rows = recommendNext(
      testTrack("a", { key: "12A" }),
      [
        testTrack("b", { key: "1A" }),
        testTrack("c", { key: "12B" }),
        testTrack("d", { key: "4B" }),
        testTrack("e", { key: "12A" }),
      ],
      settings(),
    );
    expect(rows.find((r) => r.track.id === "b")!.parts.key).toBe(0.9);
    expect(rows.find((r) => r.track.id === "c")!.parts.key).toBe(0.9);
    expect(rows.find((r) => r.track.id === "d")!.parts.key).toBe(0.15);
    expect(rows.find((r) => r.track.id === "e")!.parts.key).toBe(1);
  });
  it("分项加权归一化、偏好和排序可解释；排除起始曲及已用曲", () => {
    const s = settings();
    s.genres = ["house"];
    const a = testTrack("a"),
      b = testTrack("b", { energy: 6, rating: 5 }),
      c = testTrack("c", {
        bpm: 150,
        key: "3B",
        energy: 1,
        rating: 1,
        genre: "Techno",
      });
    const ranked = recommendNext(a, [a, b, c], s);
    expect(ranked[0].track.id).toBe("b");
    expect(ranked[0].score).toBe(100);
    expect(ranked[0].confidence).toBe(100);
    expect(recommendNext(a, [a, b, c], s, ["b"])).toHaveLength(1);
    s.weights = { bpm: 60, key: 60, energy: 50, preference: 30 };
    expect(recommendNext(a, [b], s)[0].score).toBe(100);
  });
  it("半/双拍须明确开启，关闭保调时不把原始调性当作变速后的调性", () => {
    const a = testTrack("a", { bpm: 140 }),
      b = testTrack("b", { bpm: 70 }),
      s = settings();
    expect(recommendNext(a, [b], s)[0].parts.bpm).toBe(0);
    s.halfDouble = true;
    expect(recommendNext(a, [b], s)[0].tempo!.factor).toBe(2);
    expect(recommendNext(a, [b], s)[0].parts.bpm).toBe(1);
    s.keyLock = false;
    expect(
      recommendNext(a, [testTrack("c", { bpm: 138 })], s)[0].keyReason,
    ).toContain("未计算");
  });
  it("未知数据取中性而非兼容；覆盖率按已知因子与偏好子项计算", () => {
    const a = testTrack("a", { bpm: null, key: "", energy: null }),
      b = testTrack("b", {
        bpm: null,
        key: "",
        energy: null,
        rating: null,
        genre: "",
      });
    const s = settings();
    s.genres = ["House"];
    const r = recommendNext(a, [b], s)[0];
    expect(r.score).toBe(50);
    expect(r.confidence).toBe(0);
    expect(r.tempo).toBeNull();
    expect(recommendNext(a, [{ ...b, rating: 5 }], s)[0].confidence).toBe(
      Math.round(15 * 0.65),
    );
  });
  it("目标能量限制1–10，评分有界且结果确定", () => {
    const s = settings();
    s.energyDelta = 2;
    const r = recommendNext(
      testTrack("a", { energy: 10 }),
      [testTrack("b", { energy: 10 })],
      s,
    )[0];
    expect(r.parts.energy).toBe(1);
    expect(r.targetEnergy).toBe(10);
    const life = lifestyleFixture();
    for (const t of life.tracks)
      for (const r of recommendNext(t, life.tracks, s)) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
      }
    expect(recommendNext(life.tracks[0], life.tracks, s)).toEqual(
      recommendNext(life.tracks[0], life.tracks, s),
    );
  });
});
describe("Set/元数据与持久化", () => {
  it("Cue减重叠时长与未知时长分开，不把目标当实际播放", () => {
    const set = setFixture(),
      tracks = [testTrack("a"), testTrack("b")];
    expect(setDuration(set, tracks)).toEqual({
      seconds: 570,
      unknown: 0,
      remaining: 30,
    });
    expect(
      setDuration(set, [tracks[0], { ...tracks[1], duration: null }]).unknown,
    ).toBe(1);
    expect(
      setDuration(set, [tracks[0], { ...tracks[1], duration: null }]).remaining,
    ).toBeNull();
    expect(parseDuration("5:30")).toBe(330);
    expect(parseDuration("")).toBeNull();
    expect(formatDuration(59.8)).toBe("1:00");
    expect(() => parseDuration("5:99")).toThrow();
  });
  it("重排/删除只清理受影响的混入备注，保留曲目与练习，不留悬空关联", () => {
    const life = lifestyleFixture();
    life.sets = [setFixture()];
    const moved = moveEntry(life.sets[0], 1, -1);
    expect(moved.entries[0].trackId).toBe("b");
    expect(moved.entries.every((e) => e.overlap === 0 && e.note === "")).toBe(
      true,
    );
    const removed = removeTrack(life, "a");
    expect(removed.sets[0].entries).toHaveLength(1);
    expect(removed.sets[0].entries[0].note).toBe("");
    expect(validLifestyle(removed)).toBe(true);
  });
  it.each([
    "too-long-overlap",
    "both-overlaps",
    "bad-cue",
    "duplicate-entry",
    "dangling",
  ])("拒绝错误Set关联 %s", (mode) => {
    const life = lifestyleFixture();
    life.sets = [setFixture()];
    if (mode === "too-long-overlap") life.sets[0].entries[1].overlap = 500;
    if (mode === "both-overlaps") {
      life.sets[0].entries[1].cueOut = 40;
      life.sets[0].entries.push({
        id: "e3",
        trackId: "c",
        cueIn: 0,
        cueOut: null,
        overlap: 30,
        note: "",
      });
    }
    if (mode === "bad-cue") life.sets[0].entries[0].cueIn = 400;
    if (mode === "duplicate-entry") life.sets[0].entries[1].trackId = "a";
    if (mode === "dangling") life.sets[0].entries[0].trackId = "missing";
    expect(validLifestyle(life)).toBe(false);
  });
  it("禁止全零或额外权重、坏日期、Cue越界及超容量", () => {
    const s = lifestyleFixture();
    s.settings.weights = { bpm: 0, key: 0, energy: 0, preference: 0 };
    expect(validLifestyle(s)).toBe(false);
    const bad = lifestyleFixture();
    Object.assign(bad.settings.weights, { other: 50 });
    expect(validLifestyle(bad)).toBe(false);
    const cue = lifestyleFixture();
    cue.tracks[0].cues = [{ id: "c", label: "end", seconds: 999 }];
    expect(validLifestyle(cue)).toBe(false);
  });
  it("元数据改动进入本机/云端与备份但不造财务历史，旧版本兼容", () => {
    const state = emptyState();
    validateState(state);
    const next = finishChange(
      state,
      changeLifestyle(state, lifestyleFingerprint(EMPTY_LIFESTYLE), () =>
        lifestyleFixture(),
      ),
      "兴趣曲库",
      false,
    );
    validateState(next);
    expect(next.assets).toEqual(state.assets);
    expect(next.history).toEqual(state.history);
    expect(next.revision).toBe(state.revision + 1);
    expect(hasSavedData(next)).toBe(true);
    expect(
      connectionPlan(next, {
        ...emptyState(),
        members: { first: "X", second: "Y" },
      }),
    ).toBe("choice");
    expect(
      readLifestyleBackup(JSON.stringify(next.preferences.lifestyle)),
    ).toEqual(lifestyleFixture());
  });
  it("只检查兴趣空间冲突，保存保留同期财富修改，不覆盖伴侣兴趣变更", () => {
    const state = emptyState(),
      baseline = lifestyleFingerprint(EMPTY_LIFESTYLE);
    const concurrent = { ...state, goal: { ...state.goal, target: 999 } };
    expect(
      changeLifestyle(concurrent, baseline, () => lifestyleFixture()).goal
        .target,
    ).toBe(999);
    const updated = changeLifestyle(state, baseline, () => lifestyleFixture());
    expect(() => changeLifestyle(updated, baseline, (l) => l)).toThrow(
      "另一页面",
    );
    expect(() => readLifestyleBackup('{"version":3,"assets":[]}')).toThrow();
  });
});
describe("合法元数据CSV", () => {
  it("正确处理BOM、引号、逗号和字段内换行，规范调性并仅预览", () => {
    const csv =
      '\uFEFFtitle,artist,bpm,key,duration,cue_notes\r\n"Hello, world","A ""B""",124,Am,5:30,"Intro\n16 bars"\r\n';
    const result = previewCSV(csv, []);
    expect(result.tracks[0]).toMatchObject({
      title: "Hello, world",
      artist: 'A "B"',
      key: "8A",
      duration: 330,
      cueNotes: "Intro\n16 bars",
    });
  });
  it("相同元数据不重复加入，未知列显示忽略；无效行拒绝整批", () => {
    const track = testTrack("a");
    expect(
      previewCSV(
        "title,artist,bpm,key,extra\nTrack a,Synthetic artist,124,8A,x\nTrack b,Artist,125,9A,x",
        [track],
      ),
    ).toMatchObject({ duplicates: 1, ignored: ["extra"] });
    expect(() => previewCSV("title,bpm\nValid,124\nInvalid,NaN", [])).toThrow(
      "第 3 行",
    );
    expect(() => previewCSV("title,bpm\nInvalid,-2", [])).toThrow();
  });
  it.each([
    "title,title\na,b",
    "artist\na",
    "title,bpm\na,1,2",
    'title\n"unterminated',
    'title\n"a"extra',
    "title\na\0b",
  ])("拒绝坏CSV不猜测 %s", (csv) =>
    expect(() => previewCSV(csv, [])).toThrow(),
  );
  it("导出合法字段可回读，公式字符防注入，JSON保留精确原始内容", () => {
    const tracks = lifestyleFixture().tracks;
    expect(
      previewCSV(tracksCSV(tracks), []).tracks.map(({ id, ...t }) => t),
    ).toEqual(tracks.map(({ id, ...t }) => t));
    expect(
      parseCSV(
        tracksCSV([testTrack("formula", { title: '=HYPERLINK("evil")' })]),
      )[1][0],
    ).toBe('\'=HYPERLINK("evil")');
    expect(() => parseCSV("a".repeat(1024 * 1024 + 1))).toThrow("1MB");
  });
});
