import { recommendNext, setDuration } from "./dj";
import {
  validLifestyle,
  type Lifestyle,
  type DJTrack,
  type DJSet,
  type SetEntry,
} from "./lifestyle-schema";
export type EnergyShape = "build" | "steady" | "arc" | "cooldown";
export type PlanOptions = {
  name: string;
  minutes: number;
  startId: string;
  shape: EnergyShape;
  genre: string;
  maxPitch: number;
  overlapBars: number;
  useCues: boolean;
};
export const SHAPE_NAMES: Record<EnergyShape, string> = {
  build: "逐步升温",
  steady: "稳定巡航",
  arc: "起伏后收束",
  cooldown: "慢慢降温",
};
export function energyTarget(
  shape: EnergyShape,
  start: number,
  progress: number,
) {
  const p = Math.max(0, Math.min(1, progress));
  return Math.max(
    1,
    Math.min(
      10,
      start +
        (shape === "build"
          ? 3 * p
          : shape === "cooldown"
            ? -3 * p
            : shape === "arc"
              ? p < 0.65
                ? (3 * p) / 0.65
                : 3 - (2 * (p - 0.65)) / 0.35
              : 0),
    ),
  );
}
function segment(track: DJTrack, useCues: boolean) {
  if (track.duration === null || track.duration < 10) return null;
  let cueIn = 0,
    cueOut = track.duration;
  if (useCues) {
    const starts = track.cues.filter(
      (c) =>
        c.type !== 4 &&
        /混入|mix.?in|intro/i.test(c.label) &&
        c.seconds < track.duration! - 10,
    );
    const ends = track.cues.filter(
      (c) =>
        c.type !== 4 &&
        /混出|mix.?out|outro/i.test(c.label) &&
        c.seconds > cueIn + 10,
    );
    if (starts.length) cueIn = Math.min(...starts.map((c) => c.seconds));
    const validEnds = ends.filter((c) => c.seconds > cueIn + 10);
    if (validEnds.length) cueOut = Math.max(...validEnds.map((c) => c.seconds));
  }
  return { cueIn, cueOut, length: cueOut - cueIn };
}
export function generateDJSet(life: Lifestyle, options: PlanOptions) {
  if (!validLifestyle(life)) throw new Error("曲库数据无效，请先核对。");
  if (
    !options.name.trim() ||
    options.name.length > 120 ||
    !Number.isFinite(options.minutes) ||
    options.minutes < 1 ||
    options.minutes > 600 ||
    !Object.keys(SHAPE_NAMES).includes(options.shape) ||
    ![0, 4, 8, 16].includes(options.overlapBars) ||
    !Number.isFinite(options.maxPitch) ||
    options.maxPitch < 0 ||
    options.maxPitch > 12
  )
    throw new Error("请核对名称、目标时长、能量曲线与变速限制。");
  if (life.sets.length >= 60)
    throw new Error("Set 已满 60 套，请先整理；不会覆盖已有编排。");
  const genrePool = life.tracks.filter(
    (t) => !options.genre || t.genre === options.genre,
  );
  const pool = genrePool.filter((t) => segment(t, options.useCues));
  const warnings = new Set<string>();
  if (pool.length < genrePool.length)
    warnings.add(
      `${genrePool.length - pool.length} 首时长未知或不足 10 秒，未用于时长规划。`,
    );
  if (!pool.length)
    throw new Error(
      "这个范围没有已知时长至少 10 秒的曲目，请补齐时长或先分析音频。",
    );
  const start = options.startId
    ? pool.find((t) => t.id === options.startId)
    : [...pool].sort(
        (a, b) =>
          (options.shape === "cooldown"
            ? (b.energy ?? -1) - (a.energy ?? -1)
            : (a.energy ?? 11) - (b.energy ?? 11)) ||
          (b.rating ?? 0) - (a.rating ?? 0) ||
          a.id.localeCompare(b.id),
      )[0];
  if (!start) throw new Error("起始曲不在所选风格内，或没有可规划的时长。");
  const first = segment(start, options.useCues)!;
  const entries: SetEntry[] = [
    {
      id: crypto.randomUUID(),
      trackId: start.id,
      cueIn: first.cueIn,
      cueOut: first.cueOut,
      overlap: 0,
      note: "起始曲；已选片段仍须试听确认。",
    },
  ];
  const reasons = [
    {
      trackId: start.id,
      reason: "指定 / 自动选择的起点",
      score: null as number | null,
      evidence: null as number | null,
    },
  ];
  let seconds = first.length,
    current = start;
  const total = options.minutes * 60,
    baseEnergy = start.energy ?? 5;
  while (
    seconds < total &&
    entries.length < 100 &&
    entries.length < pool.length
  ) {
    const target = energyTarget(options.shape, baseEnergy, seconds / total);
    const ranked = recommendNext(
      current,
      pool,
      {
        ...life.settings,
        energyDelta: Math.max(
          -2,
          Math.min(2, target - (current.energy ?? target)),
        ),
      },
      entries.map((e) => e.trackId),
    );
    const candidates = ranked
      .filter((r) => !r.tempo || Math.abs(r.tempo.pitch) <= options.maxPitch)
      .map((r) => {
        const part = segment(r.track, options.useCues)!;
        const previous = entries.at(-1)!;
        const prevLength = previous.cueOut! - previous.cueIn;
        const overlap =
          options.overlapBars && current.bpm && r.track.bpm
            ? Math.round(
                Math.min(
                  (options.overlapBars * 4 * 60) / current.bpm,
                  prevLength / 4,
                  part.length / 4,
                  120,
                ) * 1000,
              ) / 1000
            : 0;
        const nextSeconds = seconds + part.length - overlap;
        const shapeScore =
          r.track.energy === null
            ? 0.5
            : Math.max(0, 1 - Math.abs(r.track.energy - target) / 5);
        return {
          ...r,
          part,
          overlap,
          nextSeconds,
          rank: 0.8 * r.score + 20 * shapeScore,
        };
      })
      .filter(
        (c) => Math.abs(total - c.nextSeconds) < Math.abs(total - seconds),
      )
      .sort(
        (a, b) =>
          b.rank - a.rank ||
          Math.abs(a.nextSeconds - total) - Math.abs(b.nextSeconds - total) ||
          a.track.id.localeCompare(b.track.id),
      );
    const next = candidates[0];
    if (!next) {
      warnings.add(
        "没有更接近目标时长且符合变速限制的剩余曲目；未重复放歌或硬切尾曲凑时长。",
      );
      break;
    }
    const pitch = next.tempo
      ? `相邻原速比较需 ${next.tempo.pitch >= 0 ? "+" : ""}${next.tempo.pitch.toFixed(1)}%（${next.tempo.factor === 1 ? "正常拍速" : "半 / 双拍解释"}）`
      : "BPM 未知，无法判断变速";
    const reason = `${pitch}；${next.keyReason}；${next.track.energy === null ? "能量未知" : `能量 ${next.track.energy}/10，目标 ${target.toFixed(1)}`}；评分 ${next.score}/100，资料覆盖 ${next.confidence}%。`;
    entries.push({
      id: crypto.randomUUID(),
      trackId: next.track.id,
      cueIn: next.part.cueIn,
      cueOut: next.part.cueOut,
      overlap: next.overlap,
      note: `${reason}${next.overlap ? ` 建议重叠 ${next.overlap.toFixed(1)} 秒，按 4/4 与 BPM 估算，并非乐句 / 自动对拍。` : " 未自动设置重叠。"}`,
    });
    reasons.push({
      trackId: next.track.id,
      reason,
      score: next.score,
      evidence: next.confidence,
    });
    seconds = next.nextSeconds;
    current = next.track;
  }
  if (entries.length === 100 && seconds < total)
    warnings.add("本次最多编排 100 首，未达到目标时长；可分为两套 Set。");
  if (
    entries.some((e) => {
      const t = pool.find((t) => t.id === e.trackId)!;
      return t.bpm === null || !t.key || t.energy === null;
    })
  )
    warnings.add(
      "部分 BPM / 调性 / 能量未知，排序使用中性值，不能视为已验证相容。",
    );
  warnings.add(
    `调性比较沿用你的${life.settings.keyLock ? "保调" : "不保调"}假设。相邻原速比较不代表整场固定 BPM；时长未按变速缩放，实际连播须重新校拍、试听。`,
  );
  const set: DJSet = {
    id: crypto.randomUUID(),
    name: options.name.trim(),
    owner: "joint",
    targetMinutes: options.minutes,
    entries,
  };
  if (!validLifestyle({ ...life, sets: [...life.sets, set] }))
    throw new Error("生成结果不满足 Cue / 重叠约束，未保存。");
  if (
    new TextEncoder().encode(
      JSON.stringify({ ...life, sets: [...life.sets, set] }),
    ).length >
    3 * 1024 * 1024
  )
    throw new Error("兴趣数据将超过 3MB，请先备份整理；未覆盖旧编排。");
  return {
    set,
    reasons,
    warnings: [...warnings],
    duration: setDuration(set, life.tracks),
    shape: options.shape,
  };
}
