import type { WealthState } from "./wealth";
import {
  EMPTY_LIFESTYLE,
  validLifestyle,
  type DJTrack,
  type Lifestyle,
  type DJSettings,
  type DJSet,
} from "./lifestyle-schema";
export { EMPTY_LIFESTYLE } from "./lifestyle-schema";
export const KEY_NAMES: Record<string, string> = {
  "1A": "G♯ minor",
  "2A": "D♯ minor",
  "3A": "B♭ minor",
  "4A": "F minor",
  "5A": "C minor",
  "6A": "G minor",
  "7A": "D minor",
  "8A": "A minor",
  "9A": "E minor",
  "10A": "B minor",
  "11A": "F♯ minor",
  "12A": "C♯ minor",
  "1B": "B major",
  "2B": "F♯ major",
  "3B": "D♭ major",
  "4B": "A♭ major",
  "5B": "E♭ major",
  "6B": "B♭ major",
  "7B": "F major",
  "8B": "C major",
  "9B": "G major",
  "10B": "D major",
  "11B": "A major",
  "12B": "E major",
};
export function normalizeKey(input: string) {
  const raw = input.trim();
  if (!raw) return "";
  if (/^(?:[1-9]|1[0-2])[aAbB]$/.test(raw)) return raw.toUpperCase();
  const match = /^([A-Ga-g])([#b♯♭]?)(?:\s*([Mm][Aa][Jj](?:[Oo][Rr])?|[Mm][Ii][Nn](?:[Oo][Rr])?|m))?$/.exec(
    raw,
  );
  if (!match)
    throw new Error("调性请用 1A–12B，或 Am、C major、F# minor；未知可留空。");
  const note =
      match[1].toUpperCase() + match[2].replace("♯", "#").replace("♭", "b"),
    minor = ["m", "min", "minor"].includes((match[3] ?? "").toLowerCase());
  const pitches: Record<string, number> = {
    C: 0,
    "B#": 0,
    "C#": 1,
    Db: 1,
    D: 2,
    "D#": 3,
    Eb: 3,
    E: 4,
    Fb: 4,
    F: 5,
    "E#": 5,
    "F#": 6,
    Gb: 6,
    G: 7,
    "G#": 8,
    Ab: 8,
    A: 9,
    "A#": 10,
    Bb: 10,
    B: 11,
    Cb: 11,
  };
  const map = minor
    ? [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10]
    : [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
  return `${map[pitches[note]]}${minor ? "A" : "B"}`;
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function recommendNext(
  current: DJTrack,
  tracks: DJTrack[],
  settings: DJSettings,
  used: string[] = [],
) {
  return tracks
    .filter((t) => t.id !== current.id && !used.includes(t.id))
    .map((track) => {
      const factors = settings.halfDouble ? [1, 0.5, 2] : [1];
      const tempo =
        current.bpm !== null && track.bpm !== null
          ? factors
              .map((f) => ({
                factor: f,
                pitch: (current.bpm! / (track.bpm! * f) - 1) * 100,
              }))
              .sort((a, b) => Math.abs(a.pitch) - Math.abs(b.pitch))[0]
          : null;
      const b = tempo ? clamp(1 - Math.abs(tempo.pitch) / 12) : 0.5;
      let k = 0.5,
        keyReason = "调性未记录";
      if (
        current.key &&
        track.key &&
        (settings.keyLock || (tempo && Math.abs(tempo.pitch) < 0.01))
      ) {
        const a = Number(current.key.slice(0, -1)),
          n = Number(track.key.slice(0, -1)),
          distance = Math.min(Math.abs(a - n), 12 - Math.abs(a - n));
        if (current.key === track.key) {
          k = 1;
          keyReason = "同调性";
        } else if (a === n) {
          k = 0.9;
          keyReason = "相对大小调";
        } else if (distance === 1 && current.key.at(-1) === track.key.at(-1)) {
          k = 0.9;
          keyReason = "相邻调性";
        } else {
          k = 0.15;
          keyReason = "不在基础相容路径；试听判断";
        }
      } else if (current.key && track.key && !settings.keyLock)
        keyReason = "未启用保调假设；变速后的调性未计算";
      const targetEnergy =
        current.energy === null
          ? null
          : Math.max(1, Math.min(10, current.energy + settings.energyDelta));
      const energy =
        current.energy !== null && track.energy !== null
          ? clamp(1 - Math.abs(track.energy - targetEnergy!) / 4)
          : 0.5;
      const rating = track.rating === null ? 0.5 : (track.rating - 1) / 4;
      const genre =
        settings.genres.length && track.genre
          ? settings.genres.some(
              (g) => g.toLowerCase() === track.genre.toLowerCase(),
            )
            ? 1
            : 0
          : 0.5;
      const preference = 0.65 * rating + 0.35 * genre;
      const parts = { bpm: b, key: k, energy, preference },
        weights = settings.weights,
        sum = Object.values(weights).reduce((a, b) => a + b, 0);
      const score = Math.round(
        (Object.entries(parts).reduce(
          (v, [name, n]) => v + n * weights[name as keyof typeof weights],
          0,
        ) /
          sum) *
          100,
      );
      const evidence = {
        bpm: tempo !== null ? 1 : 0,
        key:
          !!current.key &&
          !!track.key &&
          (settings.keyLock || (!!tempo && Math.abs(tempo.pitch) < 0.01))
            ? 1
            : 0,
        energy: current.energy !== null && track.energy !== null ? 1 : 0,
        preference:
          (track.rating !== null ? 0.65 : 0) +
          (settings.genres.length > 0 && !!track.genre ? 0.35 : 0),
      };
      const confidence = Math.round(
        (Object.entries(evidence).reduce(
          (v, [name, known]) =>
            v + known * weights[name as keyof typeof weights],
          0,
        ) /
          sum) *
          100,
      );
      return {
        track,
        score,
        confidence,
        parts,
        keyReason,
        tempo,
        energyChange:
          current.energy !== null && track.energy !== null
            ? track.energy - current.energy
            : null,
        targetEnergy,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.confidence - a.confidence ||
        a.track.title.localeCompare(b.track.title) ||
        a.track.id.localeCompare(b.track.id),
    );
}
export function lifestyleFingerprint(life: Lifestyle) {
  return JSON.stringify(life);
}
export function changeLifestyle(
  state: WealthState,
  expected: string,
  update: (life: Lifestyle) => Lifestyle,
): WealthState {
  const previous = state.preferences.lifestyle ?? EMPTY_LIFESTYLE;
  if (lifestyleFingerprint(previous) !== expected)
    throw new Error(
      "兴趣空间已在另一页面或设备更新，请保留草稿并重新打开，不覆盖新记录。",
    );
  const next = update(structuredClone(previous));
  if (!validLifestyle(next))
    throw new Error(
      "请核对数字、调性、Cue 与重叠时长；内容无效或超过容量，未保存。",
    );
  return { ...state, preferences: { ...state.preferences, lifestyle: next } };
}
export function removeTrack(life: Lifestyle, id: string): Lifestyle {
  return {
    ...life,
    tracks: life.tracks.filter((t) => t.id !== id),
    sets: life.sets.map((s) => ({
      ...s,
      entries: repairEntries(
        s.entries.filter((e) => e.trackId !== id),
        s.entries,
      ),
    })),
  };
}
export function repairEntries(
  entries: DJSet["entries"],
  previous: DJSet["entries"],
) {
  const incoming = new Map(
    previous.map((e, i) => [e.id, previous[i - 1]?.trackId ?? null]),
  );
  return entries.map((e, i) =>
    incoming.get(e.id) === (entries[i - 1]?.trackId ?? null)
      ? e
      : { ...e, overlap: 0, note: "" },
  );
}
export function moveEntry(set: DJSet, index: number, step: -1 | 1): DJSet {
  const to = index + step;
  if (to < 0 || to >= set.entries.length) return set;
  const entries = [...set.entries];
  [entries[index], entries[to]] = [entries[to], entries[index]];
  // Transitions describe an incoming pair; reordering invalidates both notes and overlaps.
  return { ...set, entries: repairEntries(entries, set.entries) };
}
export function setDuration(set: DJSet, tracks: DJTrack[]) {
  let seconds = 0,
    unknown = 0;
  const map = new Map(tracks.map((t) => [t.id, t]));
  for (const e of set.entries) {
    const end = e.cueOut ?? map.get(e.trackId)?.duration ?? null;
    if (end === null) unknown++;
    else seconds += end - e.cueIn - e.overlap;
  }
  return {
    seconds,
    unknown,
    remaining: unknown ? null : Math.round(set.targetMinutes * 60 - seconds),
  };
}
export function formatDuration(seconds: number | null) {
  const n = Math.round(seconds ?? 0);
  return seconds === null
    ? "未知"
    : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}
export function parseDuration(input: string) {
  if (!input.trim()) return null;
  const raw = input.trim();
  if (/^\d{1,3}:[0-5]\d$/.test(raw)) {
    const [m, s] = raw.split(":").map(Number);
    return m * 60 + s;
  }
  throw new Error("时长请用 分:秒，例如 5:30；未知留空。");
}
