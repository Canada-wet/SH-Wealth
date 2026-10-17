import {
  MAX_TRACKS,
  validTrack,
  validLifestyle,
  type DJTrack,
  type Lifestyle,
} from "./lifestyle-schema";
import { normalizeKey, parseDuration } from "./dj";
import { normalizeFileLocation } from "./dj-location";
export const CSV_TEMPLATE =
  'title,artist,bpm,key,genre,energy,duration,rating,cue_notes\nExample Track,Your Artist,124,8A,House,6,5:30,4,"Intro 16 bars; check phrasing"\n';
export function parseCSV(input: string): string[][] {
  if (
    new TextEncoder().encode(input).length > 1024 * 1024 ||
    input.includes("\0")
  )
    throw new Error("请使用不超过 1MB 的 UTF-8 CSV 元数据文件。");
  const text = input.replace(/^\uFEFF/, ""),
    result: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  const cell = () => {
    if (field.length > 4000 || row.length >= 40)
      throw new Error("CSV 单元格过长或列数超过 40。");
    row.push(field);
    field = "";
    closed = false;
  };
  const line = () => {
    cell();
    if (row.some((c) => c.trim())) result.push(row);
    row = [];
    if (result.length > MAX_TRACKS + 1)
      throw new Error(`每次最多导入 ${MAX_TRACKS} 首。`);
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === ",") cell();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      line();
    } else if (c === '"') {
      if (field || closed) throw new Error("CSV 引号格式错误。");
      quoted = true;
    } else {
      if (closed) throw new Error("CSV 引号后请使用逗号或换行。");
      field += c;
    }
  }
  if (quoted) throw new Error("CSV 引号没有闭合。");
  if (field || row.length || closed) line();
  return result;
}
const aliases: Record<string, string> = {
  title: "title",
  name: "title",
  曲名: "title",
  标题: "title",
  artist: "artist",
  艺人: "artist",
  艺术家: "artist",
  bpm: "bpm",
  tempo: "bpm",
  key: "key",
  调性: "key",
  musicalkey: "key",
  genre: "genre",
  风格: "genre",
  energy: "energy",
  能量: "energy",
  duration: "duration",
  time: "duration",
  时长: "duration",
  durationseconds: "seconds",
  rating: "rating",
  personalrating: "rating",
  评分: "rating",
  cuenotes: "cueNotes",
  comments: "cueNotes",
  comment: "cueNotes",
  备注: "cueNotes",
  cues: "cues",
  filelocation: "fileLocation",
  location: "fileLocation",
  path: "fileLocation",
  文件路径: "fileLocation",
};
const fingerprint = (t: DJTrack) =>
  t.fileLocation
    ? JSON.stringify(["file", t.fileLocation])
    : JSON.stringify([
        t.title.trim().toLowerCase(),
        t.artist.trim().toLowerCase(),
        t.bpm,
        t.key,
      ]);
export function previewCSV(text: string, existing: DJTrack[]) {
  const rows = parseCSV(text),
    header = rows.shift();
  if (!header) throw new Error("CSV 是空的。");
  const columns = header.map((h) => {
    const key = h.trim().toLowerCase().replace(/[ _-]/g, "");
    return Object.prototype.hasOwnProperty.call(aliases, key)
      ? aliases[key]
      : undefined;
  });
  if (!columns.includes("title"))
    throw new Error("缺少 title / 曲名 列，请参考 CSV 模板。");
  const mapped = columns.filter(Boolean);
  if (new Set(mapped).size !== mapped.length)
    throw new Error("CSV 存在重复含义的列，请合并后重试。");
  const seen = new Set(existing.map(fingerprint));
  let duplicates = 0;
  const tracks: DJTrack[] = [];
  rows.forEach((cells, i) => {
    if (cells.length !== header.length)
      throw new Error(`第 ${i + 2} 行列数与表头不一致。`);
    const values = Object.fromEntries(
      columns.filter(Boolean).map((c) => [c, ""]),
    );
    columns.forEach((col, j) => {
      if (col) values[col] = cells[j].trim();
    });
    const number = (key: string) => {
      if (!values[key]) return null;
      if (!/^\d+(?:\.\d+)?$/.test(values[key]))
        throw new Error(`${key} 需为数字，未知留空`);
      return Number(values[key]);
    };
    try {
      const track: DJTrack = {
        id: crypto.randomUUID(),
        title: values.title,
        artist: values.artist ?? "",
        bpm: number("bpm"),
        key: normalizeKey(values.key ?? ""),
        genre: values.genre ?? "",
        energy: number("energy"),
        duration: values.seconds
          ? number("seconds")
          : parseDuration(values.duration ?? ""),
        rating: number("rating"),
        cueNotes: values.cueNotes ?? "",
        cues: values.cues ? JSON.parse(values.cues) : [],
        ...(values.fileLocation
          ? { fileLocation: normalizeFileLocation(values.fileLocation) }
          : {}),
      };
      if (!validTrack(track))
        throw new Error(
          "范围或 Cue 无效：BPM 20–300、能量 1–10、评分 1–5、时长最多 240 分钟",
        );
      const key = fingerprint(track);
      if (seen.has(key)) {
        duplicates++;
        return;
      }
      seen.add(key);
      tracks.push(track);
    } catch (e) {
      throw new Error(
        `第 ${i + 2} 行：${e instanceof Error ? e.message : "格式无效"}。未导入任何行。`,
      );
    }
  });
  if (existing.length + tracks.length > MAX_TRACKS)
    throw new Error(`曲库最多 ${MAX_TRACKS} 首；请分批整理或先导出备份。`);
  return { tracks, duplicates, ignored: header.filter((_, i) => !columns[i]) };
}
export function tracksCSV(tracks: DJTrack[]) {
  const cell = (v: unknown) => {
    let text = v === null ? "" : String(v);
    if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return (
    "\uFEFF" +
    [
      [
        "title",
        "artist",
        "bpm",
        "key",
        "genre",
        "energy",
        "duration",
        "rating",
        "cue_notes",
        "cues",
        "file_location",
      ],
      ...tracks.map((t) => [
        t.title,
        t.artist,
        t.bpm,
        t.key,
        t.genre,
        t.energy,
        t.duration === null
          ? ""
          : `${Math.floor(t.duration / 60)}:${String(t.duration % 60).padStart(2, "0")}`,
        t.rating,
        t.cueNotes,
        JSON.stringify(t.cues),
        t.fileLocation ?? "",
      ]),
    ]
      .map((r) => r.map(cell).join(","))
      .join("\r\n")
  );
}
export function readLifestyleBackup(text: string): Lifestyle {
  if (new TextEncoder().encode(text).length > 3 * 1024 * 1024)
    throw new Error("兴趣空间备份不能超过 3MB。");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("不是有效的 JSON 备份。");
  }
  if (!validLifestyle(raw))
    throw new Error("兴趣空间备份格式或关联无效，不会覆盖现有数据。");
  return raw;
}
