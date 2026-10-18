import { describe, it, expect } from "vitest";
import {
  analyzePCM,
  appendAudioCues,
  type CueCandidate,
} from "../lib/dj-audio-analysis";
import { validLifestyle } from "../lib/lifestyle-schema";
import { lifestyleFixture } from "./fixtures/lifestyle";
const signal = (seconds = 64, sr = 8000) =>
  Float32Array.from({ length: seconds * sr }, (_, i) => {
    const t = i / sr;
    return (
      (t < 2 || t > 60 ? 0 : t < 30 ? 0.12 : t < 45 ? 0.65 : 0.08) *
      Math.sin(2 * Math.PI * 220 * t)
    );
  });
const cue = (patch: Partial<CueCandidate> = {}): CueCandidate => ({
  id: "one",
  kind: "intro",
  label: "混入参考",
  seconds: 10,
  reason: "synthetic",
  ...patch,
});
describe("local signal evidence and conservative Cue append", () => {
  it("能量变化是候选而非已识别Drop，时间在范围内", () => {
    const r = analyzePCM(signal(), 8000);
    expect(r.duration).toBe(64);
    expect(r.waveform).toHaveLength(360);
    expect(r.waveform.every((n) => n >= 0 && n <= 1)).toBe(true);
    expect(
      r.candidates.some(
        (c) => c.kind === "rise" && Math.abs(c.seconds - 30) < 3,
      ),
    ).toBe(true);
    expect(
      r.candidates.some(
        (c) => c.kind === "quiet" && Math.abs(c.seconds - 45) < 3,
      ),
    ).toBe(true);
    expect(r.candidates.every((c) => c.seconds >= 0 && c.seconds < 64)).toBe(
      true,
    );
    expect(r.warnings.join(" ")).toContain("不等于 Drop");
  });
  it("只有来源4/4网格才建议拍点Loop", () => {
    expect(
      analyzePCM(signal(), 8000).candidates.some((c) => c.kind === "loop"),
    ).toBe(false);
    const r = analyzePCM(signal(), 8000, [
        { start: 0, bpm: 120, meter: "4/4", beat: 1 },
      ]),
      loop = r.candidates.find((c) => c.kind === "loop")!;
    expect(loop).toBeDefined();
    expect(loop.seconds % 2).toBe(0);
    expect(loop.end! - loop.seconds).toBe(8);
  });
  it("Loop不跨拍速段，未知拍号不编造", () => {
    const r = analyzePCM(signal(), 8000, [
      { start: 0, bpm: 120, meter: "4/4", beat: 1 },
      { start: 5, bpm: 124, meter: "3/4", beat: 1 },
      { start: 6, bpm: NaN, meter: "4/4", beat: 1 },
    ]);
    expect(r.candidates.some((c) => c.kind === "loop")).toBe(false);
  });
  it("静音无Cue；短片段不伪造结构", () => {
    const r = analyzePCM(new Float32Array(8000 * 10), 8000);
    expect(r.candidates).toEqual([]);
    expect(r.warnings.join(" ")).toContain("没有足够");
    expect(
      analyzePCM(new Float32Array(8000).fill(0.1), 8000).candidates.length,
    ).toBeLessThanOrEqual(1);
  });
  it("拒绝损坏、过短与无效采样", () => {
    expect(() => analyzePCM(new Float32Array(1), 8000)).toThrow();
    expect(() => analyzePCM(new Float32Array(8000), NaN)).toThrow();
    const bad = new Float32Array(8000);
    bad[4] = Infinity;
    expect(() => analyzePCM(bad, 8000)).toThrow();
    expect(() => analyzePCM(new Float32Array(8000), 100)).toThrow();
  });
  it("追加Memory不覆盖旧Cue，重复位置跳过", () => {
    const life = lifestyleFixture();
    life.tracks[0].cues = [
      { id: "existing", label: "My cue", seconds: 10, num: 0, type: 0 },
    ];
    const result = appendAudioCues(
      life,
      "a",
      [cue(), cue({ id: "two", seconds: 30 })],
      "memory",
      330,
      false,
    );
    expect(result.added).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.next.tracks[0].cues[0]).toEqual(life.tracks[0].cues[0]);
    expect(result.next.tracks[0].cues[1].num).toBe(-1);
    expect(life.tracks[0].cues).toHaveLength(1);
  });
  it("HotCue只占空闲槽；满槽停止，Memory仍可用", () => {
    const life = lifestyleFixture();
    life.tracks[0].cues = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      label: String(i),
      seconds: i,
      num: i,
      type: 0,
    }));
    expect(() =>
      appendAudioCues(life, "a", [cue()], "hot", 330, false),
    ).toThrow(/空闲/);
    expect(
      appendAudioCues(life, "a", [cue()], "memory", 330, false).next.tracks[0]
        .cues,
    ).toHaveLength(9);
    life.tracks[0].cues.splice(3, 1);
    expect(
      appendAudioCues(
        life,
        "a",
        [cue()],
        "hot",
        330,
        false,
      ).next.tracks[0].cues.at(-1)?.num,
    ).toBe(3);
  });
  it("错曲时长拒绝；空白时长可选择填入", () => {
    const life = lifestyleFixture();
    expect(() =>
      appendAudioCues(life, "a", [cue()], "memory", 60, false),
    ).toThrow(/不匹配/);
    life.tracks[0].duration = null;
    expect(
      appendAudioCues(life, "a", [cue()], "memory", 64.3, true).next.tracks[0]
        .duration,
    ).toBe(64);
    expect(
      appendAudioCues(life, "a", [cue()], "memory", 64.3, false).next.tracks[0]
        .duration,
    ).toBeNull();
  });
  it.each([
    { seconds: NaN },
    { seconds: -1 },
    { seconds: 330 },
    { kind: "loop" as const, end: 9 },
    { kind: "loop" as const, end: 400 },
    { label: "" },
    { kind: "intro" as const, end: 20 },
  ])("无效Cue原子拒绝%j", (patch) => {
    const life = lifestyleFixture(),
      before = JSON.stringify(life);
    expect(() =>
      appendAudioCues(life, "a", [cue(patch)], "memory", 330, false),
    ).toThrow();
    expect(JSON.stringify(life)).toBe(before);
  });
  it("保护重复ID、空选择与64标记容量", () => {
    const life = lifestyleFixture();
    expect(() =>
      appendAudioCues(life, "a", [], "memory", 330, false),
    ).toThrow();
    expect(() =>
      appendAudioCues(life, "a", [cue(), cue()], "memory", 330, false),
    ).toThrow();
    life.tracks[0].cues = Array.from({ length: 64 }, (_, i) => ({
      id: String(i),
      label: String(i),
      seconds: i,
      num: -1,
    }));
    expect(() =>
      appendAudioCues(life, "a", [cue({ seconds: 100 })], "memory", 330, false),
    ).toThrow(/64/);
  });
  it("Loop保留小数末点与类型，Grid和能量不变", () => {
    const life = lifestyleFixture();
    life.tracks[0].rekordbox = {
      attributes: {},
      tempos: [{ start: 0.1, bpm: 122, meter: "4/4", beat: 1 }],
    };
    const result = appendAudioCues(
      life,
      "a",
      [cue({ kind: "loop", end: 17.875 })],
      "memory",
      330,
      false,
    );
    expect(result.next.tracks[0].cues[0]).toMatchObject({
      seconds: 10,
      end: 17.875,
      type: 4,
    });
    expect(result.next.tracks[0].rekordbox).toEqual(life.tracks[0].rekordbox);
    expect(result.next.tracks[0].energy).toBe(4);
    expect(validLifestyle(result.next)).toBe(true);
  });
});
