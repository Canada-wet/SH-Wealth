import {
  MAX_CUES,
  validLifestyle,
  type Lifestyle,
  type DJTempo,
  type DJCue,
} from "./lifestyle-schema";
export type CueCandidate = {
  id: string;
  kind: "intro" | "outro" | "rise" | "quiet" | "loop";
  label: string;
  seconds: number;
  end?: number;
  reason: string;
};
export type AudioAnalysis = {
  duration: number;
  waveform: number[];
  candidates: CueCandidate[];
  warnings: string[];
};
export const AUDIO_MAX_SECONDS = 720;
export function analyzePCM(
  samples: Float32Array,
  sampleRate: number,
  grid: DJTempo[] = [],
): AudioAnalysis {
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 48000 ||
    samples.length > sampleRate * AUDIO_MAX_SECONDS ||
    samples.length < sampleRate ||
    samples.some((n) => !Number.isFinite(n))
  )
    throw new Error("音频采样或时长超出分析范围（1 秒–12 分钟）。");
  const duration = samples.length / sampleRate,
    hop = Math.round(sampleRate / 10),
    frames: number[] = [];
  for (let i = 0; i < samples.length; i += hop) {
    let sum = 0;
    const count = Math.min(hop, samples.length - i);
    for (let j = 0; j < count; j++) sum += samples[i + j] ** 2;
    frames.push(Math.sqrt(sum / count));
  }
  const peak = Math.max(...frames),
    quantiles = [...frames].sort((a, b) => a - b);
  const warnings = [
    "本机能量包络启发式，不是曲式 / 人声识别模型；上升或安静段不等于 Drop / Breakdown。请逐点试听。",
  ];
  const waveform = Array.from(
    { length: Math.min(360, frames.length) },
    (_, i) => {
      const lo = Math.floor((i * frames.length) / Math.min(360, frames.length)),
        hi = Math.max(
          lo + 1,
          Math.floor(((i + 1) * frames.length) / Math.min(360, frames.length)),
        );
      return peak ? Math.max(...frames.slice(lo, hi)) / peak : 0;
    },
  );
  if (peak < 0.0001)
    return {
      duration,
      waveform,
      candidates: [],
      warnings: [...warnings, "没有足够可用的声音，未生成 Cue。"],
    };
  const floor = Math.max(
    0.0001,
    quantiles[Math.floor(quantiles.length * 0.85)] * 0.12,
  );
  let begin = frames.findIndex(
    (x, i) => x > floor && frames[i + 1] > floor && frames[i + 2] > floor,
  );
  let finish = frames.length - 1;
  while (finish > begin && frames[finish] < floor) finish--;
  begin = Math.max(0, begin);
  const start = Math.max(0, begin / 10 - 0.1),
    end = Math.min(Math.floor(duration * 1000) / 1000, (finish + 1) / 10);
  const candidates: CueCandidate[] = [];
  const add = (
    kind: CueCandidate["kind"],
    label: string,
    seconds: number,
    reason: string,
    loopEnd?: number,
  ) => {
    const t =
      Math.round(Math.max(0, Math.min(duration - 0.01, seconds)) * 1000) / 1000;
    if (
      !candidates.some(
        (c) =>
          Math.abs(c.seconds - t) < 1 && c.kind !== "loop" && kind !== "loop",
      )
    )
      candidates.push({
        id: `audio-${kind}-${candidates.length}`,
        kind,
        label,
        seconds: t,
        ...(loopEnd !== undefined
          ? { end: Math.round(loopEnd * 1000) / 1000 }
          : {}),
        reason,
      });
  };
  add("intro", "混入参考", start, "连续有效声音开始附近；未判断人声或乐句。");
  if (end - start > 16)
    add(
      "outro",
      "混出参考",
      Math.max(start + 8, end - 8),
      "有效声音结束前约 8 秒，供试听选择离场位置，不代表标准 Outro。",
    );
  const prefix = [0];
  for (const f of frames) prefix.push(prefix.at(-1)! + f);
  const average = (a: number, b: number) => (prefix[b] - prefix[a]) / (b - a);
  const changes: { i: number; strength: number; quiet: boolean }[] = [];
  for (let i = 80; i < frames.length - 80; i += 5) {
    const before = average(i - 40, i),
      after = average(i, i + 40),
      delta = (after - before) / peak;
    if (delta > 0.2) changes.push({ i, strength: delta, quiet: false });
    if (
      delta < -0.2 &&
      after < quantiles[Math.floor(quantiles.length * 0.5)] * 0.7
    )
      changes.push({ i, strength: -delta, quiet: true });
  }
  let rises = 0,
    quiets = 0;
  for (const c of changes.sort((a, b) => b.strength - a.strength)) {
    if (c.quiet ? quiets >= 1 : rises >= 2) continue;
    if (
      c.i / 10 < start + 8 ||
      c.i / 10 > end - 8 ||
      candidates.some(
        (p) =>
          Math.abs(p.seconds - c.i / 10) <
          (p.kind === "intro" || p.kind === "outro" ? 4 : 10),
      )
    )
      continue;
    add(
      c.quiet ? "quiet" : "rise",
      c.quiet ? "安静段候选" : "能量上升候选",
      c.i / 10,
      "前后各 4 秒的音量能量有明显变化；不是已识别的副歌 / Drop，需试听微调。",
    );
    if (c.quiet) quiets++;
    else rises++;
  }
  // A beat-aligned loop is only proposed from a single, actual source 4/4 grid segment.
  const sorted = [...grid].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const g = sorted[i];
    if (
      g.meter !== "4/4" ||
      !Number.isFinite(g.bpm) ||
      g.bpm < 20 ||
      g.bpm > 300 ||
      !Number.isFinite(g.start) ||
      !Number.isInteger(g.beat) ||
      g.beat < 1 ||
      g.beat > 4
    )
      continue;
    const beat = 60 / g.bpm,
      bar = beat * 4,
      origin = g.start - (g.beat - 1) * beat;
    const at =
        origin + Math.ceil((Math.max(g.start, start + 4) - origin) / bar) * bar,
      stop = at + bar * 4;
    if (stop >= Math.min(end - 2, sorted[i + 1]?.start ?? Infinity)) continue;
    const lo = Math.max(0, Math.floor(at * 10)),
      hi = Math.min(frames.length, Math.floor(stop * 10));
    const mean = average(lo, hi);
    if (mean < floor) continue;
    add(
      "loop",
      "4 小节 Loop 参考",
      at,
      "依据来源 4/4 BeatGrid 的小节起点估算 4 小节，未保证无缝或无人声；请反复试听。",
      stop,
    );
    break;
  }
  if (!candidates.some((c) => c.kind === "loop"))
    warnings.push(
      "没有足够可用的来源 4/4 BeatGrid / 区间，未编造节拍同步 Loop。",
    );
  return {
    duration,
    waveform,
    candidates: candidates.sort((a, b) => a.seconds - b.seconds),
    warnings,
  };
}
export function appendAudioCues(
  life: Lifestyle,
  trackId: string,
  selected: CueCandidate[],
  mode: "memory" | "hot",
  measuredSeconds: number,
  fillDuration: boolean,
) {
  if (!validLifestyle(life) || !["memory", "hot"].includes(mode))
    throw new Error("曲库或 Cue 模式无效。");
  const track = life.tracks.find((t) => t.id === trackId);
  if (
    !track ||
    !selected.length ||
    selected.length > 8 ||
    new Set(selected.map((c) => c.id)).size !== selected.length ||
    !Number.isFinite(measuredSeconds) ||
    measuredSeconds < 1 ||
    measuredSeconds > AUDIO_MAX_SECONDS
  )
    throw new Error("请重新选择曲目与 Cue 候选。");
  if (
    track.duration !== null &&
    Math.abs(track.duration - measuredSeconds) >
      Math.max(2, track.duration * 0.01)
  )
    throw new Error("音频时长与记录不匹配，请先核对曲目。");
  const limit = Math.min(
    track.duration ?? Math.floor(measuredSeconds),
    Math.floor(measuredSeconds),
  );
  for (const c of selected)
    if (
      !Number.isFinite(c.seconds) ||
      c.seconds < 0 ||
      c.seconds >= limit ||
      !c.label.trim() ||
      c.label.length > 60 ||
      (c.kind === "loop" &&
        (c.end === undefined ||
          !Number.isFinite(c.end) ||
          c.end <= c.seconds ||
          c.end > limit)) ||
      (c.kind !== "loop" && c.end !== undefined)
    )
      throw new Error("Cue 时间或 Loop 结束无效，须在音频时长内。");
  const fresh = selected.filter(
    (c, i) =>
      !track.cues.some(
        (e) =>
          Math.abs(e.seconds - c.seconds) < 0.15 &&
          (c.kind === "loop"
            ? e.type === 4 && Math.abs((e.end ?? -1) - c.end!) < 0.15
            : e.type !== 4),
      ) &&
      !selected
        .slice(0, i)
        .some(
          (e) =>
            Math.abs(e.seconds - c.seconds) < 0.15 &&
            (e.kind === "loop") === (c.kind === "loop"),
        ),
  );
  if (!fresh.length)
    throw new Error("所选位置已有 Cue，没有新增；现有标记保持不变。");
  if (track.cues.length + fresh.length > MAX_CUES)
    throw new Error("每曲最多 64 个 Cue，请减少所选点；不会替换旧标记。");
  const used = new Set(track.cues.map((c) => c.num ?? -1)),
    slots = Array.from({ length: 8 }, (_, i) => i).filter((i) => !used.has(i));
  if (mode === "hot" && fresh.length > slots.length)
    throw new Error(
      "空闲 Hot Cue 槽位不足，请减少候选或使用 Memory Cue；不会覆盖已有槽位。",
    );
  const cues: DJCue[] = fresh.map((c, i) => ({
    id: crypto.randomUUID(),
    label: `音频候选·${c.label}`,
    seconds: c.seconds,
    type: c.kind === "loop" ? 4 : 0,
    num: mode === "hot" ? slots[i] : -1,
    ...(c.end !== undefined ? { end: c.end } : {}),
  }));
  const next = {
    ...life,
    tracks: life.tracks.map((t) =>
      t.id === trackId
        ? {
            ...t,
            duration:
              t.duration === null && fillDuration
                ? Math.floor(measuredSeconds)
                : t.duration,
            cues: [...t.cues, ...cues],
          }
        : t,
    ),
  };
  if (!validLifestyle(next)) throw new Error("Cue 超出保存约束，未修改曲库。");
  if (new TextEncoder().encode(JSON.stringify(next)).length > 3 * 1024 * 1024)
    throw new Error("兴趣数据将超过 3MB，请先备份整理；Cue 未保存。");
  return {
    next,
    added: cues.length,
    duplicates: selected.length - fresh.length,
  };
}
