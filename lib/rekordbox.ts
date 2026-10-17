import { normalizeFileLocation } from "./dj-location";
import { KEY_NAMES, normalizeKey } from "./dj";
import {
  MAX_TRACKS,
  REKORDBOX_ATTRIBUTES,
  validTrack,
  validLifestyle,
  type DJTrack,
  type DJCue,
  type Lifestyle,
  type DJSet,
} from "./lifestyle-schema";
export const REKORDBOX_XML_LIMIT = 12 * 1024 * 1024;
type Playlist = {
  id: string;
  path: string[];
  keys: string[];
  byLocation: boolean;
};
export type RekordboxCatalog = { tracks: Element[]; playlists: Playlist[] };
const children = (e: Element, tag: string) =>
  Array.from(e.children).filter((c) => c.tagName === tag);
const attr = (e: Element, name: string) => e.getAttribute(name) ?? "";
const decimal = (v: string, field: string, fallback?: number) => {
  if (!v && fallback !== undefined) return fallback;
  if (!/^\d+(?:\.\d+)?$/.test(v) || !Number.isFinite(Number(v)))
    throw new Error(`${field} 数字无效`);
  return Number(v);
};
export function readRekordboxXML(text: string): RekordboxCatalog {
  if (new TextEncoder().encode(text).length > REKORDBOX_XML_LIMIT)
    throw new Error("XML 不能超过 12MB；请先整理曲库或分组。");
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(text) || text.includes("\0"))
    throw new Error("不接受含 DTD / 外部实体的 XML。");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.tagName !== "DJ_PLAYLISTS" ||
    doc.documentElement.namespaceURI
  )
    throw new Error("不是有效的 rekordbox DJ_PLAYLISTS XML。");
  if (attr(doc.documentElement, "Version") !== "1.0.0")
    throw new Error("当前支持 rekordbox XML 1.0.0；未知版本不会猜测导入。");
  const collections = children(doc.documentElement, "COLLECTION");
  if (collections.length !== 1)
    throw new Error("XML 必须包含一个 COLLECTION。");
  const tracks = children(collections[0], "TRACK");
  if (tracks.length > 20000 || doc.getElementsByTagName("*").length > 150000)
    throw new Error("XML 内容过多，请缩小导出范围。");
  const ids = tracks.map((t) => attr(t, "TrackID"));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
    throw new Error("TrackID 缺失或重复，无法安全关联歌单。");
  const playlists: Playlist[] = [];
  let nodes = 0;
  const visit = (parent: Element, path: string[], depth: number) => {
    if (depth > 12 || ++nodes > 2000)
      throw new Error("歌单文件夹层级或数量过多。");
    for (const node of children(parent, "NODE")) {
      const name = attr(node, "Name"),
        type = attr(node, "Type");
      if (!name || name.length > 200 || !["0", "1"].includes(type))
        throw new Error("歌单名称或 NODE 类型无效。");
      const next =
        depth === 0 && name === "ROOT" && type === "0" ? path : [...path, name];
      if (JSON.stringify(next).length > 2000) throw new Error("歌单路径过长。");
      if (type === "0") visit(node, next, depth + 1);
      else {
        const keyType = attr(node, "KeyType");
        if (!["0", "1"].includes(keyType))
          throw new Error("不支持的歌单 KeyType。");
        playlists.push({
          id: String(playlists.length),
          path: next,
          keys: children(node, "TRACK").map((t) => attr(t, "Key")),
          byLocation: keyType === "1",
        });
      }
    }
  };
  for (const p of children(doc.documentElement, "PLAYLISTS")) visit(p, [], 0);
  if (playlists.length > 1000)
    throw new Error("歌单超过 1000 个，请缩小文件范围。");
  return { tracks, playlists };
}
function readTrack(e: Element, warnings: Set<string>): DJTrack {
  const name = attr(e, "Name");
  try {
    const rawKey = attr(e, "Tonality");
    let key = "";
    try {
      key = normalizeKey(rawKey);
    } catch {
      warnings.add("部分调性无法转换，原始 Tonality 已保留，推荐中显示未知。");
    }
    const time = decimal(attr(e, "TotalTime"), "TotalTime", 0),
      bpm = decimal(attr(e, "AverageBpm"), "BPM", 0),
      rating = decimal(attr(e, "Rating"), "Rating", 0);
    if (![0, 51, 102, 153, 204, 255].includes(rating))
      throw new Error("Rating 必须为 0、51、102、153、204 或 255");
    const cues: DJCue[] = children(e, "POSITION_MARK").map((c, i) => {
      const type = decimal(attr(c, "Type"), "Cue Type"),
        rawNum = attr(c, "Num");
      const num = rawNum === "-1" || !rawNum ? -1 : decimal(rawNum, "Cue Num");
      const start = decimal(attr(c, "Start"), "Cue Start");
      const end = attr(c, "End")
        ? decimal(attr(c, "End"), "Cue End")
        : undefined;
      const colors = ["Red", "Green", "Blue"].map((k) => attr(c, k));
      return {
        id: crypto.randomUUID(),
        label:
          attr(c, "Name") ||
          (num >= 0
            ? `Hot Cue ${String.fromCharCode(65 + num)}`
            : `Memory Cue ${i + 1}`),
        seconds: start,
        type: type as DJCue["type"],
        num,
        ...(end !== undefined ? { end } : {}),
        ...(colors.every(Boolean)
          ? {
              color: colors.map((v) => decimal(v, "Cue color")) as [
                number,
                number,
                number,
              ],
            }
          : {}),
      };
    });
    const track: DJTrack = {
      id: crypto.randomUUID(),
      title: name,
      artist: attr(e, "Artist"),
      genre: attr(e, "Genre"),
      bpm: bpm || null,
      key,
      duration: time || null,
      energy: null,
      rating: rating ? rating / 51 : null,
      cueNotes: attr(e, "Comments"),
      cues,
      fileLocation: normalizeFileLocation(attr(e, "Location")),
      rekordbox: {
        attributes: Object.fromEntries(
          REKORDBOX_ATTRIBUTES.filter((k) => e.hasAttribute(k)).map((k) => [
            k,
            attr(e, k),
          ]),
        ),
        tempos: children(e, "TEMPO").map((g) => ({
          start: decimal(attr(g, "Inizio"), "BeatGrid Inizio"),
          bpm: decimal(attr(g, "Bpm"), "BeatGrid Bpm"),
          meter: attr(g, "Metro"),
          beat: decimal(attr(g, "Battito"), "BeatGrid Battito"),
        })),
      },
    };
    if (!validTrack(track))
      throw new Error(
        "字段超出范围（64 Cue / 512 BeatGrid、时长 240 分钟、曲名 160 字符）；或 Loop / Hot Cue 槽位无效",
      );
    if (children(e, "TEMPO").length)
      warnings.add("原 BeatGrid 保留；编辑 BPM 不会重算或拉伸拍点。");
    return track;
  } catch (error) {
    throw new Error(
      `曲目「${name || attr(e, "TrackID")}」：${error instanceof Error ? error.message : "格式无效"}。未导入。`,
    );
  }
}
export function previewRekordbox(
  catalog: RekordboxCatalog,
  life: Lifestyle,
  selection: string,
  updateExisting = false,
) {
  const warnings = new Set<string>(),
    byId = new Map(catalog.tracks.map((t) => [attr(t, "TrackID"), t])),
    byLocation = new Map<string, Element>();
  for (const t of catalog.tracks) {
    try {
      const location = normalizeFileLocation(attr(t, "Location"));
      if (byLocation.has(location))
        throw new Error("XML 有多项引用同一路径，不能确定 Cue 版本。");
      byLocation.set(location, t);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("XML 有"))
        throw error;
      // Unselected unsupported / streaming entries do not block a local playlist.
    }
  }
  const playlists =
    selection === "all"
      ? catalog.playlists
      : selection === "collection"
        ? []
        : catalog.playlists.filter((p) => p.id === selection);
  if (!["all", "collection"].includes(selection) && !playlists.length)
    throw new Error("请选择有效的导入范围。");
  const references = new Map<Playlist, Element[]>();
  for (const p of playlists)
    references.set(
      p,
      p.keys.map((key) => {
        const e = p.byLocation
          ? byLocation.get(normalizeFileLocation(key))
          : byId.get(key);
        if (!e)
          throw new Error(
            `歌单「${p.path.join(" / ")}」有无法解析的曲目引用；可改选仅曲库或其他歌单。`,
          );
        return e;
      }),
    );
  const elements = ["all", "collection"].includes(selection)
    ? catalog.tracks
    : [...new Set([...references.values()].flat())];
  if (elements.length > MAX_TRACKS)
    throw new Error("本次范围超过 1000 首，请在下方选择单个歌单导入。");
  const next = structuredClone(life),
    resolved = new Map<Element, string>();
  let added = 0,
    kept = 0,
    updated = 0,
    setsAdded = 0,
    setsKept = 0;
  const existing = new Map(
    life.tracks.filter((t) => t.fileLocation).map((t) => [t.fileLocation!, t]),
  );
  if (existing.size !== life.tracks.filter((t) => t.fileLocation).length)
    throw new Error("当前曲库存在重复文件路径，请先整理再导入。");
  for (const element of elements) {
    const track = readTrack(element, warnings),
      previous = existing.get(track.fileLocation!);
    if (previous) {
      resolved.set(element, previous.id);
      if (updateExisting) {
        next.tracks = next.tracks.map((t) =>
          t.id === previous.id
            ? { ...track, id: previous.id, energy: previous.energy }
            : t,
        );
        updated++;
      } else kept++;
    } else {
      next.tracks.push(track);
      resolved.set(element, track.id);
      added++;
    }
  }
  for (const playlist of playlists) {
    const source = JSON.stringify(playlist.path);
    if (next.sets.some((s) => s.rekordboxSource === source)) {
      setsKept++;
      continue;
    }
    const refs = references.get(playlist)!;
    if (refs.length > 200)
      throw new Error(
        `歌单「${playlist.path.join(" / ")}」超过每套 200 首；可改选仅曲库。`,
      );
    const title = playlist.path.join(" / ");
    if (title.length > 120)
      warnings.add("较长歌单名称已缩短显示；原文件夹路径保留在导入标识中。");
    const knownSeconds = refs.reduce(
      (n, e) =>
        n + (next.tracks.find((t) => t.id === resolved.get(e))?.duration ?? 0),
      0,
    );
    next.sets.push({
      id: crypto.randomUUID(),
      name: title.slice(0, 120),
      owner: "joint",
      targetMinutes: Math.min(
        600,
        Math.max(1, Math.ceil(knownSeconds / 60) || 45),
      ),
      rekordboxSource: source,
      entries: refs.map((e) => ({
        id: crypto.randomUUID(),
        trackId: resolved.get(e)!,
        cueIn: 0,
        cueOut: null,
        overlap: 0,
        note: "",
      })),
    });
    setsAdded++;
  }
  if (setsKept)
    warnings.add(
      "同路径的已导入歌单保留现有编排，不覆盖；如需替换，请先备份，再删除对应 Set 后导入。",
    );
  if (kept)
    warnings.add(
      "相同音乐路径保留本机元数据。需要以 XML 更新时，请明确勾选更新选项。",
    );
  if (!validLifestyle(next))
    throw new Error(
      "导入将超过曲库 / Set 容量，或更新时长与现有转场冲突。未导入；请缩小范围或先调整 Cue / 重叠。",
    );
  if (new TextEncoder().encode(JSON.stringify(next)).length > 3 * 1024 * 1024)
    throw new Error("兴趣数据超过 3MB；请缩小导入范围。");
  return {
    next,
    added,
    kept,
    updated,
    setsAdded,
    setsKept,
    warnings: [...warnings],
    sample: elements.slice(0, 5).map((e) => attr(e, "Name")),
  };
}
const escape = (text: string | number) =>
  String(text).replace(
    /[&<>"'\t\r\n]/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
        "\t": "&#9;",
        "\r": "&#13;",
        "\n": "&#10;",
      })[c]!,
  );
const attributes = (attrs: Record<string, string | number>) =>
  Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escape(v)}"`)
    .join("");
export function exportRekordbox(life: Lifestyle, setId?: string) {
  if (!validLifestyle(life)) throw new Error("兴趣数据无效，未生成 XML。");
  let sets = life.sets;
  if (setId) {
    sets = sets.filter((s) => s.id === setId);
    if (!sets.length) throw new Error("Set 已不存在，请重新选择。");
  }
  const used = new Set(sets.flatMap((s) => s.entries.map((e) => e.trackId)));
  const tracks = setId
    ? life.tracks.filter((t) => used.has(t.id))
    : life.tracks;
  if (!tracks.length) throw new Error("当前范围没有曲目。");
  const missing = tracks.filter((t) => !t.fileLocation);
  if (missing.length)
    throw new Error(
      `${missing.length} 首缺少音乐路径：${missing
        .slice(0, 3)
        .map((t) => t.title)
        .join("、")}。请在曲目编辑中填写真实路径；不会生成虚假文件地址。`,
    );
  if (new Set(tracks.map((t) => t.fileLocation)).size !== tracks.length)
    throw new Error(
      "存在重复音乐路径，请合并后再导出，以免 rekordbox 误关联。",
    );
  const ids = new Map(tracks.map((t, i) => [t.id, i + 1]));
  const warnings = [
    "XML 不包含音频；文件需在 rekordbox 所在电脑的相同路径，网页不能确认文件存在。",
    "能量、目标时长、转场备注、Set Cue In/Out 与重叠保留在本 App，不写成自动混音或曲目 Cue。",
  ];
  if (tracks.some((t) => t.rating !== null && !Number.isInteger(t.rating)))
    warnings.push(
      "rekordbox 采用整数星级，小数评分已四舍五入；App 原评分不变。",
    );
  if (tracks.some((t) => !t.rekordbox?.tempos.length))
    warnings.push(
      "无来源 BeatGrid 的曲目不生成拍点；请在 rekordbox 分析或手动校准。",
    );
  const trackXML = tracks
    .map((t) => {
      const { Tonality: originalKey, ...extras } =
        t.rekordbox?.attributes ?? {};
      let unknownOriginalKey = "";
      try {
        normalizeKey(originalKey ?? "");
      } catch {
        unknownOriginalKey = originalKey ?? "";
      }
      const key = t.key
        ? KEY_NAMES[t.key]
            .replaceAll("♯", "#")
            .replaceAll("♭", "b")
            .replace(" minor", "m")
            .replace(" major", "")
        : unknownOriginalKey;
      const attrs: Record<string, string | number> = {
        ...extras,
        TrackID: ids.get(t.id)!,
        Name: t.title,
        Artist: t.artist,
        Genre: t.genre,
        Location: t.fileLocation!,
        Tonality: key,
        Comments: t.cueNotes,
        Rating: t.rating === null ? 0 : Math.round(t.rating) * 51,
      };
      if (t.bpm !== null) attrs.AverageBpm = t.bpm;
      if (t.duration !== null) attrs.TotalTime = t.duration;
      return (
        `    <TRACK${attributes(attrs)}>\n` +
        (t.rekordbox?.tempos ?? [])
          .map(
            (g) =>
              `      <TEMPO${attributes({ Inizio: g.start, Bpm: g.bpm, Metro: g.meter, Battito: g.beat })}/>\n`,
          )
          .join("") +
        t.cues
          .map(
            (c) =>
              `      <POSITION_MARK${attributes({ Name: c.label, Type: c.type ?? 0, Start: c.seconds, Num: c.num ?? -1, ...(c.end !== undefined ? { End: c.end } : {}), ...(c.color ? { Red: c.color[0], Green: c.color[1], Blue: c.color[2] } : {}) })}/>\n`,
          )
          .join("") +
        "    </TRACK>"
      );
    })
    .join("\n");
  const names = new Set<string>();
  const playlistXML = (name: string, entries: DJSet["entries"]) => {
    let unique = name,
      suffix = 2;
    while (names.has(unique)) unique = `${name} (${suffix++})`;
    names.add(unique);
    return (
      `      <NODE${attributes({ Type: 1, Name: unique, Entries: entries.length, KeyType: 0 })}>\n` +
      entries
        .map((e) => `        <TRACK Key="${ids.get(e.trackId)!}"/>`)
        .join("\n") +
      "\n      </NODE>"
    );
  };
  const playlists = sets.map((s) => playlistXML(s.name, s.entries));
  if (!setId)
    playlists.push(
      playlistXML(
        "Together · All Tracks",
        tracks.map((t) => ({
          id: t.id,
          trackId: t.id,
          note: "",
          cueIn: 0,
          cueOut: null,
          overlap: 0,
        })),
      ),
    );
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<DJ_PLAYLISTS Version="1.0.0">\n  <PRODUCT Name="Together Wealth DJ" Version="1.0" Company="Together"/>\n  <COLLECTION Entries="${tracks.length}">\n${trackXML}\n  </COLLECTION>\n  <PLAYLISTS>\n    <NODE Type="0" Name="ROOT" Count="${playlists.length}">\n${playlists.join("\n")}\n    </NODE>\n  </PLAYLISTS>\n</DJ_PLAYLISTS>\n`;
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(xml))
    throw new Error("曲目文本含 XML 不允许的控制字符，请先清理。");
  return { xml, warnings, tracks: tracks.length, sets: sets.length };
}
