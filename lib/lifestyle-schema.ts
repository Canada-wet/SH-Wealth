export type HobbyMember = "first" | "second" | "joint";
export type DJTrack = {
  id: string;
  title: string;
  artist: string;
  bpm: number | null;
  key: string;
  genre: string;
  energy: number | null;
  duration: number | null;
  cueNotes: string;
  rating: number | null;
  cues: { id: string; label: string; seconds: number }[];
};
export type SetEntry = {
  id: string;
  trackId: string;
  note: string;
  cueIn: number;
  cueOut: number | null;
  overlap: number;
};
export type DJSet = {
  id: string;
  name: string;
  owner: HobbyMember;
  targetMinutes: number;
  entries: SetEntry[];
};
export type Practice = {
  id: string;
  date: string;
  member: HobbyMember;
  minutes: number;
  enjoyment: number;
  setId: string | null;
  setName: string;
  trackCount: number;
  focus: string;
  note: string;
};
export type DJSettings = {
  weights: { bpm: number; key: number; energy: number; preference: number };
  energyDelta: number;
  genres: string[];
  halfDouble: boolean;
  keyLock: boolean;
};
export type Lifestyle = {
  version: 1;
  tracks: DJTrack[];
  sets: DJSet[];
  practices: Practice[];
  settings: DJSettings;
};
export const MAX_TRACKS = 1000;
export const EMPTY_LIFESTYLE: Lifestyle = {
  version: 1,
  tracks: [],
  sets: [],
  practices: [],
  settings: {
    weights: { bpm: 30, key: 30, energy: 25, preference: 15 },
    energyDelta: 1,
    genres: [],
    halfDouble: false,
    keyLock: true,
  },
};
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown, max: number, required = false) =>
  typeof x === "string" && x.length <= max && (!required || !!x.trim());
const num = (x: unknown, lo: number, hi: number) =>
  typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
const nullable = (x: unknown, lo: number, hi: number) =>
  x === null || num(x, lo, hi);
const member = (v: unknown) =>
  ["first", "second", "joint"].includes(v as string);
const rows = (v: unknown, max: number): v is { id: string }[] =>
  Array.isArray(v) &&
  v.length <= max &&
  v.every((x) => object(x) && text(x.id, 100, true)) &&
  new Set(v.map((x) => x.id)).size === v.length;
const date = (v: unknown) =>
  typeof v === "string" &&
  /^20\d{2}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
export function validTrack(t: DJTrack): boolean {
  return (
    object(t) &&
    text(t.id, 100, true) &&
    text(t.title, 160, true) &&
    text(t.artist, 160) &&
    nullable(t.bpm, 20, 300) &&
    text(t.key, 3) &&
    (t.key === "" || /^(?:[1-9]|1[0-2])[AB]$/.test(t.key)) &&
    text(t.genre, 80) &&
    nullable(t.energy, 1, 10) &&
    nullable(t.duration, 1, 14400) &&
    (t.duration === null || Number.isInteger(t.duration)) &&
    text(t.cueNotes, 1000) &&
    nullable(t.rating, 1, 5) &&
    rows(t.cues, 16) &&
    t.cues.every(
      (c) => text(c.label, 80, true) && num(c.seconds, 0, t.duration ?? 14400),
    )
  );
}
export function validLifestyle(raw: unknown): raw is Lifestyle {
  try {
    if (!object(raw)) return false;
    const v = raw as unknown as Lifestyle;
    if (
      v.version !== 1 ||
      !rows(v.tracks, MAX_TRACKS) ||
      !v.tracks.every(validTrack) ||
      !rows(v.sets, 60) ||
      !rows(v.practices, 300) ||
      !object(v.settings)
    )
      return false;
    const tracks = new Map(v.tracks.map((t) => [t.id, t]));
    if (
      !v.sets.every(
        (s) =>
          text(s.name, 120, true) &&
          member(s.owner) &&
          num(s.targetMinutes, 1, 600) &&
          rows(s.entries, 200) &&
          new Set(s.entries.map((e) => e.trackId)).size === s.entries.length &&
          s.entries.every((e, i) => {
            const t = tracks.get(e.trackId),
              previous = i ? s.entries[i - 1] : null;
            if (
              !t ||
              !text(e.note, 600) ||
              !num(e.cueIn, 0, 14400) ||
              !nullable(e.cueOut, 0, 14400) ||
              !num(e.overlap, 0, 600) ||
              (!i && e.overlap !== 0)
            )
              return false;
            const end = e.cueOut ?? t.duration;
            if (
              (t.duration !== null && e.cueIn >= t.duration) ||
              (end !== null && (end <= e.cueIn || end > (t.duration ?? 14400)))
            )
              return false;
            const priorEnd = previous
              ? (previous.cueOut ??
                tracks.get(previous.trackId)?.duration ??
                null)
              : null;
            if (
              e.overlap > 0 &&
              (end === null ||
                !previous ||
                priorEnd === null ||
                e.overlap > end - e.cueIn ||
                e.overlap > priorEnd - previous.cueIn)
            )
              return false;
            // Incoming + outgoing overlaps cannot exceed the track's playable segment.
            const outgoing = s.entries[i + 1]?.overlap ?? 0;
            return end === null
              ? e.overlap === 0 && outgoing === 0
              : e.overlap + outgoing <= end - e.cueIn;
          }),
      )
    )
      return false;
    if (
      !v.practices.every(
        (p) =>
          date(p.date) &&
          member(p.member) &&
          num(p.minutes, 1, 600) &&
          Number.isInteger(p.minutes) &&
          num(p.enjoyment, 1, 5) &&
          Number.isInteger(p.enjoyment) &&
          (p.setId === null || v.sets.some((s) => s.id === p.setId)) &&
          text(p.setName, 120) &&
          num(p.trackCount, 0, 200) &&
          Number.isInteger(p.trackCount) &&
          text(p.focus, 160, true) &&
          text(p.note, 1000),
      )
    )
      return false;
    const s = v.settings;
    return (
      object(s.weights) &&
      Object.keys(s.weights).length === 4 &&
      ["bpm", "key", "energy", "preference"].every((k) =>
        num(s.weights[k as keyof DJSettings["weights"]], 0, 100),
      ) &&
      Object.values(s.weights).reduce((a, b) => a + b, 0) > 0 &&
      num(s.energyDelta, -2, 2) &&
      Array.isArray(s.genres) &&
      s.genres.length <= 20 &&
      s.genres.every((g) => text(g, 80, true)) &&
      typeof s.halfDouble === "boolean" &&
      typeof s.keyLock === "boolean"
    );
  } catch {
    return false;
  }
}
