import { describe, it, expect } from "vitest";
import {
  generateDJSet,
  energyTarget,
  type PlanOptions,
} from "../lib/dj-autoplan";
import { appendAudioCues } from "../lib/dj-audio-analysis";
import { validLifestyle, REKORDBOX_ATTRIBUTES } from "../lib/lifestyle-schema";
import { changeLifestyle, lifestyleFingerprint, setDuration } from "../lib/dj";
import { exportRekordbox } from "../lib/rekordbox";
import { emptyState } from "../lib/wealth";
import { lifestyleFixture, testTrack } from "./fixtures/lifestyle";
const opts = (patch: Partial<PlanOptions> = {}): PlanOptions => ({
  name: "Synthetic set",
  minutes: 15,
  startId: "a",
  shape: "build",
  genre: "",
  maxPitch: 6,
  overlapBars: 8,
  useCues: true,
  ...patch,
});
describe("one-click DJ planning", () => {
  it("超过3MB不生成无法完整备份的方案或追加Cue", () => {
    const life = lifestyleFixture();
    life.tracks = Array.from({ length: 100 }, (_, i) =>
      testTrack(String(i), {
        rekordbox: {
          attributes: Object.fromEntries(
            REKORDBOX_ATTRIBUTES.map((k) => [k, "x".repeat(2000)]),
          ),
          tempos: [],
        },
      }),
    );
    expect(() => generateDJSet(life, opts({ startId: "0" }))).toThrow(/3MB/);
    expect(() =>
      appendAudioCues(
        life,
        "0",
        [
          {
            id: "one",
            kind: "intro",
            label: "混入",
            seconds: 10,
            reason: "test",
          },
        ],
        "memory",
        300,
        false,
      ),
    ).toThrow(/3MB/);
  });
  it("新增方案先预览，不改现有曲库、Cue或编排", () => {
    const life = lifestyleFixture(),
      before = JSON.stringify(life),
      p = generateDJSet(life, opts());
    expect(JSON.stringify(life)).toBe(before);
    expect(p.set.entries[0].trackId).toBe("a");
    expect(p.set.entries.length).toBeGreaterThan(1);
    expect(p.set.entries.length).toBe(
      new Set(p.set.entries.map((e) => e.trackId)).size,
    );
    expect(validLifestyle({ ...life, sets: [p.set] })).toBe(true);
    expect(p.duration).toEqual(setDuration(p.set, life.tracks));
  });
  it.each(["build", "steady", "arc", "cooldown"] as const)(
    "%s曲线明确、有界",
    (shape) => {
      for (const progress of [-1, 0, 0.25, 0.65, 1, 2]) {
        const e = energyTarget(shape, 5, progress);
        expect(e).toBeGreaterThanOrEqual(1);
        expect(e).toBeLessThanOrEqual(10);
      }
      expect(generateDJSet(lifestyleFixture(), opts({ shape })).shape).toBe(
        shape,
      );
    },
  );
  it("升温、稳定、降温和起伏的目标方向不同", () => {
    expect(energyTarget("build", 5, 1)).toBe(8);
    expect(energyTarget("steady", 5, 1)).toBe(5);
    expect(energyTarget("cooldown", 5, 1)).toBe(2);
    expect(energyTarget("arc", 5, 0.65)).toBeGreaterThan(
      energyTarget("arc", 5, 1),
    );
  });
  it("已知BPM受变速限制，未知数据明确提醒", () => {
    const life = lifestyleFixture();
    life.tracks.push(testTrack("fast", { bpm: 200, duration: 200 }));
    const p = generateDJSet(life, opts({ maxPitch: 0, minutes: 30 }));
    expect(p.set.entries.map((e) => e.trackId)).toEqual(["a"]);
    expect(p.warnings.join(" ")).toContain("变速限制");
    life.tracks.push(
      testTrack("unknown", { bpm: null, key: "", energy: null }),
    );
    const unknown = generateDJSet(life, opts({ maxPitch: 0, minutes: 30 }));
    expect(unknown.warnings.join(" ")).toContain("未知");
    expect(unknown.reasons.some((r) => r.reason.includes("BPM 未知"))).toBe(
      true,
    );
  });
  it("未知时长不凑数；风格范围和起始曲校验", () => {
    const life = lifestyleFixture(),
      p = generateDJSet(life, opts({ genre: "Deep House", minutes: 20 }));
    expect(
      p.set.entries.every(
        (e) =>
          life.tracks.find((t) => t.id === e.trackId)!.genre === "Deep House",
      ),
    ).toBe(true);
    expect(() => generateDJSet(life, opts({ startId: "d" }))).toThrow(/时长/);
    expect(() => generateDJSet(life, opts({ genre: "missing" }))).toThrow(
      /没有/,
    );
    expect(generateDJSet(life, opts()).warnings.join(" ")).toContain(
      "时长未知",
    );
  });
  it("联动已确认的混入混出Cue，不修改全局标记", () => {
    let life = lifestyleFixture();
    life = appendAudioCues(
      life,
      "a",
      [
        {
          id: "in",
          kind: "intro",
          label: "混入参考",
          seconds: 10,
          reason: "test",
        },
        {
          id: "out",
          kind: "outro",
          label: "混出参考",
          seconds: 300,
          reason: "test",
        },
      ],
      "memory",
      330,
      false,
    ).next;
    const p = generateDJSet(life, opts());
    expect(p.set.entries[0].cueIn).toBe(10);
    expect(p.set.entries[0].cueOut).toBe(300);
    expect(
      generateDJSet(life, opts({ useCues: false })).set.entries[0].cueIn,
    ).toBe(0);
  });
  it("重叠受前后片段约束，不裁尾曲", () => {
    const life = lifestyleFixture();
    life.tracks.forEach((t) => {
      t.duration = 12;
      t.bpm = 120;
    });
    const p = generateDJSet(life, opts({ minutes: 1, overlapBars: 16 }));
    expect(validLifestyle({ ...life, sets: [p.set] })).toBe(true);
    expect(p.set.entries.slice(1).every((e) => e.overlap <= 3)).toBe(true);
    expect(
      generateDJSet(
        life,
        opts({ minutes: 1, overlapBars: 0 }),
      ).set.entries.every((e) => e.overlap === 0),
    ).toBe(true);
    expect(p.set.entries.every((e) => e.cueOut === 12)).toBe(true);
  });
  it("无BPM不伪造重叠；自动起点尊重方向", () => {
    const life = lifestyleFixture();
    life.tracks.forEach((t) => {
      t.bpm = null;
    });
    const p = generateDJSet(life, opts({ startId: "", shape: "cooldown" }));
    expect(p.set.entries[0].trackId).toBe("e");
    expect(p.set.entries.every((e) => e.overlap === 0)).toBe(true);
  });
  it.each([
    { minutes: NaN },
    { minutes: 0 },
    { minutes: 601 },
    { name: "" },
    { maxPitch: 13 },
    { overlapBars: 3 },
  ])("拒绝无效选项：%j", (patch) => {
    expect(() => generateDJSet(lifestyleFixture(), opts(patch))).toThrow();
  });
  it("满容量不覆盖，旧预览拒绝，不改财富", () => {
    const life = lifestyleFixture(),
      p = generateDJSet(life, opts());
    const full = {
      ...life,
      sets: Array.from({ length: 60 }, (_, i) => ({ ...p.set, id: String(i) })),
    };
    expect(() => generateDJSet(full, opts())).toThrow(/60/);
    const state = {
      ...emptyState(),
      preferences: { ...emptyState().preferences, lifestyle: life },
    };
    const next = changeLifestyle(state, lifestyleFingerprint(life), (l) => ({
      ...l,
      sets: [...l.sets, p.set],
    }));
    expect(next.assets).toEqual(state.assets);
    expect(next.history).toEqual(state.history);
    expect(() =>
      changeLifestyle(next, lifestyleFingerprint(life), (l) => l),
    ).toThrow(/更新/);
  });
  it("支持导出曲序；缺音乐路径仍阻止虚假导出", () => {
    const life = lifestyleFixture(),
      p = generateDJSet(life, opts());
    life.sets.push(p.set);
    expect(() => exportRekordbox(life, p.set.id)).toThrow(/路径/);
    life.tracks.forEach((t) => {
      t.fileLocation = `file://localhost/Synthetic/${t.id}.wav`;
    });
    const result = exportRekordbox(life, p.set.id);
    expect(result.sets).toBe(1);
    expect(result.tracks).toBe(p.set.entries.length);
    expect(result.xml).toContain("Synthetic set");
  });
});
