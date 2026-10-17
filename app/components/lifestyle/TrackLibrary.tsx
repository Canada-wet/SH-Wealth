"use client";
import { useState, useRef } from "react";
import {
  Plus,
  Search,
  Upload,
  Download,
  Pencil,
  Trash2,
  Music2,
} from "lucide-react";
import Dialog from "../Dialog";
import {
  KEY_NAMES,
  normalizeKey,
  formatDuration,
  parseDuration,
  lifestyleFingerprint,
  removeTrack,
} from "@/lib/dj";
import {
  MAX_TRACKS,
  MAX_CUES,
  validTrack,
  type DJTrack,
  type Lifestyle,
} from "@/lib/lifestyle-schema";
import { CSV_TEMPLATE, previewCSV, tracksCSV } from "@/lib/dj-import";
import { normalizeFileLocation } from "@/lib/dj-location";
import { downloadText, type SaveLifestyle } from "./shared";

export default function TrackLibrary({
  life,
  save,
  disabled,
  onBuild,
}: {
  life: Lifestyle;
  save: SaveLifestyle;
  disabled: boolean;
  onBuild: () => void;
}) {
  const [query, setQuery] = useState(""),
    [genre, setGenre] = useState("all"),
    [sort, setSort] = useState("title");
  const [editor, setEditor] = useState<{
    track: DJTrack;
    expected: string;
  } | null>(null);
  const [preview, setPreview] = useState<
      (ReturnType<typeof previewCSV> & { expected: string }) | null
    >(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [undo, setUndo] = useState<{
    before: Lifestyle;
    expected: string;
  } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const genres = [
    ...new Set(life.tracks.map((t) => t.genre).filter(Boolean)),
  ].sort();
  const tracks = life.tracks
    .filter(
      (t) =>
        (genre === "all" || t.genre === genre) &&
        `${t.title} ${t.artist} ${t.genre} ${t.key} ${t.cueNotes}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "bpm"
        ? (a.bpm ?? Infinity) - (b.bpm ?? Infinity) ||
          a.title.localeCompare(b.title)
        : sort === "rating"
          ? (b.rating ?? -1) - (a.rating ?? -1) ||
            a.title.localeCompare(b.title)
          : a.title.localeCompare(b.title),
    );
  const open = (track?: DJTrack) => {
    setError("");
    setEditor({
      track: track
        ? structuredClone(track)
        : {
            id: crypto.randomUUID(),
            title: "",
            artist: "",
            bpm: null,
            key: "",
            genre: "",
            energy: null,
            duration: null,
            cueNotes: "",
            rating: null,
            cues: [],
          },
      expected: lifestyleFingerprint(life),
    });
  };
  return (
    <section className="card hobby-library" aria-label="DJ 曲库">
      <div className="hobby-section-head">
        <div>
          <span className="hobby-kicker">YOUR OWN COLLECTION</span>
          <h2>每一首，都有自己的位置</h2>
          <p>只保存元数据，不上传音频。空白字段表示未知。</p>
        </div>
        <button
          className="primary"
          disabled={disabled || life.tracks.length >= MAX_TRACKS}
          onClick={() => open()}
        >
          <Plus size={16} /> 添加曲目
        </button>
      </div>
      <div className="hobby-toolbar">
        <label className="hobby-search">
          <Search size={16} />
          <input
            aria-label="搜索 DJ 曲库"
            placeholder="曲名、艺人、风格、调性、备注…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="曲库风格筛选"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
        >
          <option value="all">所有风格</option>
          {genres.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <select
          aria-label="曲库排序"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="title">按曲名</option>
          <option value="bpm">BPM 由低到高</option>
          <option value="rating">个人评分优先</option>
        </select>
      </div>
      <div className="hobby-import-bar">
        <span>
          显示 {tracks.length} / {life.tracks.length} 首 · 最多 {MAX_TRACKS} 首
        </span>
        <button
          className="text-button"
          disabled={disabled || loading}
          onClick={() => file.current?.click()}
        >
          <Upload size={14} />
          {loading ? "正在检查…" : "导入 CSV"}
        </button>
        <button
          className="text-button"
          disabled={!life.tracks.length}
          onClick={() =>
            downloadText(
              "Together-track-library.csv",
              tracksCSV(life.tracks),
              "text/csv;charset=utf-8",
            )
          }
        >
          <Download size={14} /> 导出曲库
        </button>
        <button
          className="text-button"
          onClick={() =>
            downloadText(
              "Together-track-template.csv",
              CSV_TEMPLATE,
              "text/csv;charset=utf-8",
            )
          }
        >
          下载模板
        </button>
        <input
          ref={file}
          type="file"
          accept=".csv,text/csv"
          aria-label="选择曲库 CSV"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setError("");
            setPreview(null);
            if (f.size > 1024 * 1024) {
              setError("CSV 不能超过 1MB。");
              return;
            }
            const expected = lifestyleFingerprint(life);
            setLoading(true);
            try {
              setPreview({
                ...previewCSV(await f.text(), life.tracks),
                expected,
              });
            } catch (err) {
              setError(err instanceof Error ? err.message : "CSV 读取失败。");
            } finally {
              setLoading(false);
            }
          }}
        />
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {preview && (
        <div
          className="hobby-import-preview"
          role="region"
          aria-label="曲库导入预览"
        >
          <h3>先确认，再加入曲库</h3>
          <p>
            {preview.tracks.length} 首新曲目 · 跳过 {preview.duplicates}{" "}
            首重复项（有路径按路径，无路径按标题 / 艺人 / BPM / 调性）。
            {preview.ignored.length
              ? `忽略不支持的列：${preview.ignored.join("、")}。`
              : ""}
          </p>
          <ul>
            {preview.tracks.slice(0, 5).map((t) => (
              <li key={t.id}>
                {t.title} · {t.artist || "艺人未知"} · {t.bpm ?? "?"} BPM ·{" "}
                {t.key || "调性未知"}
              </li>
            ))}
          </ul>
          <p className="hobby-caption">
            仅导入有权使用的元数据；不会获取音乐、匹配流媒体或调用外部 API。
          </p>
          <div className="button-row">
            <button
              className="primary"
              disabled={disabled || !preview.tracks.length}
              onClick={() => {
                if (
                  save(
                    (l) => ({ ...l, tracks: [...l.tracks, ...preview.tracks] }),
                    "导入 DJ 曲库",
                    preview.expected,
                  )
                )
                  setPreview(null);
              }}
            >
              确认导入 {preview.tracks.length} 首
            </button>
            <button className="secondary" onClick={() => setPreview(null)}>
              取消导入
            </button>
          </div>
        </div>
      )}
      {undo && (
        <p className="hobby-notice" role="status">
          曲目已移除；受影响的转场备注与重叠已重置。
          <button
            className="text-button"
            disabled={disabled}
            onClick={() => {
              if (save(() => undo.before, "撤销曲目移除", undo.expected))
                setUndo(null);
            }}
          >
            撤销移除
          </button>
        </p>
      )}
      {!life.tracks.length ? (
        <div className="hobby-empty">
          <Music2 size={34} />
          <h3>从你最想放的那一首开始</h3>
          <p>手动填一首，或导入 UTF-8 CSV。BPM、调性和时长都可以以后补齐。</p>
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => open()}
          >
            录入第一首曲目
          </button>
        </div>
      ) : !tracks.length ? (
        <div className="hobby-empty">
          <p>没有匹配曲目。</p>
          <button
            className="secondary"
            onClick={() => {
              setQuery("");
              setGenre("all");
            }}
          >
            清除曲库筛选
          </button>
        </div>
      ) : (
        <div className="hobby-table-scroll">
          <table className="hobby-track-table">
            <thead>
              <tr>
                <th>曲目 / 艺人</th>
                <th>BPM</th>
                <th>调性</th>
                <th>风格</th>
                <th>能量</th>
                <th>时长</th>
                <th>个人评分</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((t) => (
                <tr key={t.id}>
                  <td data-label="曲目">
                    <b>{t.title}</b>
                    <small>{t.artist || "艺人未记录"}</small>
                    {t.cues.length > 0 && (
                      <small>{t.cues.length} 个 Cue 标记</small>
                    )}
                  </td>
                  <td data-label="BPM">{t.bpm ?? "—"}</td>
                  <td data-label="调性">
                    <span className="hobby-key" title={KEY_NAMES[t.key]}>
                      {t.key || "?"}
                    </span>
                  </td>
                  <td data-label="风格">{t.genre || "—"}</td>
                  <td data-label="能量">
                    <span
                      className="hobby-energy"
                      style={
                        {
                          "--energy": `${(t.energy ?? 0) * 10}%`,
                        } as React.CSSProperties
                      }
                    >
                      {t.energy === null ? "未知" : `${t.energy}/10`}
                    </span>
                  </td>
                  <td data-label="时长">{formatDuration(t.duration)}</td>
                  <td data-label="评分">
                    {t.rating === null ? "—" : `${t.rating}/5`}
                  </td>
                  <td className="hobby-row-actions">
                    <button
                      className="icon-button"
                      aria-label={`编辑曲目：${t.title}`}
                      disabled={disabled}
                      onClick={() => open(t)}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`删除曲目：${t.title}`}
                      disabled={disabled}
                      onClick={() => {
                        if (
                          !confirm(
                            `从曲库删除「${t.title}」？它也会从 Set 中移除，受影响的转场会重置；保存后可撤销。`,
                          )
                        )
                          return;
                        const next = removeTrack(life, t.id);
                        if (save(() => next, "移除 DJ 曲目"))
                          setUndo({
                            before: structuredClone(life),
                            expected: lifestyleFingerprint(next),
                          });
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!life.tracks.length && (
        <button className="secondary hobby-next" onClick={onBuild}>
          挑一首，开始编排 Set →
        </button>
      )}
      {editor && (
        <TrackEditor
          initial={editor.track}
          disabled={disabled}
          onClose={() => setEditor(null)}
          onSave={(track) => {
            if (
              save(
                (l) => ({
                  ...l,
                  tracks: l.tracks.some((t) => t.id === track.id)
                    ? l.tracks.map((t) => (t.id === track.id ? track : t))
                    : [...l.tracks, track],
                }),
                "保存 DJ 曲目",
                editor.expected,
              )
            ) {
              setEditor(null);
              return true;
            }
            return false;
          }}
        />
      )}
    </section>
  );
}
function TrackEditor({
  initial,
  disabled,
  onSave,
  onClose,
}: {
  initial: DJTrack;
  disabled: boolean;
  onSave: (t: DJTrack) => boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({
      ...initial,
      bpm: initial.bpm?.toString() ?? "",
      key: initial.key,
      energy: initial.energy?.toString() ?? "",
      rating: initial.rating?.toString() ?? "",
      duration:
        initial.duration === null ? "" : formatDuration(initial.duration),
      fileLocation: initial.fileLocation ?? "",
    }),
    [error, setError] = useState("");
  const numeric = (s: string) => (s.trim() ? Number(s) : null);
  return (
    <Dialog
      title={initial.title ? "编辑 DJ 曲目" : "添加 DJ 曲目"}
      wide
      error={error}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        try {
          const track: DJTrack = {
            ...draft,
            title: draft.title.trim(),
            artist: draft.artist.trim(),
            genre: draft.genre.trim(),
            bpm: numeric(draft.bpm),
            key: normalizeKey(draft.key),
            energy: numeric(draft.energy),
            rating: numeric(draft.rating),
            duration: parseDuration(draft.duration),
            fileLocation: draft.fileLocation.trim()
              ? normalizeFileLocation(draft.fileLocation)
              : undefined,
          };
          if (!validTrack(track))
            throw new Error(
              "请检查数值范围、时长和 Cue：Cue 不能超出曲目时长。",
            );
          if (!onSave(track))
            setError(
              "尚未保存。请核对页面同步提示；缩短时长前，先调整 Set 中的 Cue / 重叠。",
            );
        } catch (e) {
          setError(e instanceof Error ? e.message : "无法保存。");
        }
      }}
    >
      <fieldset disabled={disabled} className="hobby-form">
        <div className="form-grid">
          {(
            [
              ["title", "曲名"],
              ["artist", "艺人"],
              ["bpm", "BPM"],
              ["key", "调性"],
              ["genre", "风格"],
              ["energy", "能量（1–10）"],
              ["duration", "时长（分:秒）"],
              ["rating", "个人评分（1–5）"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                aria-label={label}
                required={key === "title"}
                maxLength={
                  key === "title" || key === "artist"
                    ? 160
                    : key === "genre"
                      ? 80
                      : 20
                }
                type={
                  ["bpm", "energy", "rating"].includes(key) ? "number" : "text"
                }
                min={key === "bpm" ? 20 : 1}
                max={key === "bpm" ? 300 : key === "energy" ? 10 : 5}
                step="any"
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                placeholder={
                  key === "key"
                    ? "8A / Am / C major"
                    : key === "duration"
                      ? "5:30"
                      : key === "title"
                        ? "必填"
                        : "未知可留空"
                }
              />
            </label>
          ))}
        </div>
        <label>
          音乐文件路径（仅用于 rekordbox）
          <input
            aria-label="音乐文件路径"
            maxLength={2048}
            value={draft.fileLocation}
            onChange={(e) =>
              setDraft({ ...draft, fileLocation: e.target.value })
            }
            placeholder="/Users/…/Music/track.mp3 或 C:\Music\track.mp3"
          />
        </label>
        <p className="hobby-caption">
          只记录路径，不上传或读取音频；路径会对家庭另一位成员可见。浏览器无法验证文件存在。
        </p>
        <label>
          Cue 与个人备注
          <textarea
            aria-label="Cue 与个人备注"
            maxLength={1000}
            rows={3}
            value={draft.cueNotes}
            onChange={(e) => setDraft({ ...draft, cueNotes: e.target.value })}
            placeholder="例如：32 小节 intro；副歌人声不要叠加。"
          />
        </label>
        <details>
          <summary>管理时间 Cue（元数据，不控制播放器）</summary>
          {draft.cues.map((c, i) => (
            <div className="hobby-cue-row" key={c.id}>
              <label>
                标记名
                <input
                  aria-label={`Cue 名称 ${i + 1}`}
                  maxLength={80}
                  value={c.label}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      cues: draft.cues.map((x) =>
                        x.id === c.id ? { ...x, label: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
              <label>
                位置（秒）
                <input
                  aria-label={`Cue 秒数 ${i + 1}`}
                  type="number"
                  min="0"
                  max="14400"
                  step="any"
                  value={Number.isFinite(c.seconds) ? c.seconds : ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      cues: draft.cues.map((x) =>
                        x.id === c.id
                          ? {
                              ...x,
                              seconds:
                                e.target.value === ""
                                  ? NaN
                                  : Number(e.target.value),
                            }
                          : x,
                      ),
                    })
                  }
                />
              </label>
              <label>
                标记类型
                <select
                  aria-label={`Cue 类型 ${i + 1}`}
                  value={c.type ?? 0}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      cues: draft.cues.map((x) =>
                        x.id === c.id
                          ? {
                              ...x,
                              type: Number(e.target.value) as 0 | 1 | 2 | 3 | 4,
                              end:
                                e.target.value === "4"
                                  ? (x.end ?? x.seconds + 4)
                                  : undefined,
                            }
                          : x,
                      ),
                    })
                  }
                >
                  <option value="0">Cue</option>
                  <option value="4">Loop</option>
                  <option value="1">Fade In</option>
                  <option value="2">Fade Out</option>
                  <option value="3">Load</option>
                </select>
              </label>
              <label>
                槽位
                <select
                  aria-label={`Cue 槽位 ${i + 1}`}
                  value={c.num ?? -1}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      cues: draft.cues.map((x) =>
                        x.id === c.id
                          ? { ...x, num: Number(e.target.value) }
                          : x,
                      ),
                    })
                  }
                >
                  <option value="-1">Memory</option>
                  {Array.from({ length: 8 }, (_, n) => (
                    <option key={n} value={n}>
                      Hot Cue {String.fromCharCode(65 + n)}
                    </option>
                  ))}
                </select>
              </label>
              {c.type === 4 && (
                <label>
                  Loop 结束秒数
                  <input
                    aria-label={`Loop 结束秒数 ${i + 1}`}
                    type="number"
                    min="0"
                    max="14400"
                    step="any"
                    value={c.end ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        cues: draft.cues.map((x) =>
                          x.id === c.id
                            ? {
                                ...x,
                                end:
                                  e.target.value === ""
                                    ? undefined
                                    : Number(e.target.value),
                              }
                            : x,
                        ),
                      })
                    }
                  />
                </label>
              )}
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    cues: draft.cues.filter((x) => x.id !== c.id),
                  })
                }
              >
                移除 Cue {i + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary"
            disabled={draft.cues.length >= MAX_CUES}
            onClick={() =>
              setDraft({
                ...draft,
                cues: [
                  ...draft.cues,
                  {
                    id: crypto.randomUUID(),
                    label: `Cue ${draft.cues.length + 1}`,
                    seconds: 0,
                  },
                ],
              })
            }
          >
            添加 Cue 标记
          </button>
        </details>
        <p className="hobby-caption">
          调性自动转为 Camelot
          编码。更改元数据不会分析音频；评分和能量由你判断。
        </p>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary">
            保存曲目
          </button>
        </div>
      </fieldset>
    </Dialog>
  );
}
