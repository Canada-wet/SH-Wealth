"use client";
import { useEffect, useRef, useState } from "react";
import { Headphones, Upload, Square, Play } from "lucide-react";
import Dialog from "../Dialog";
import { analyzeLocalAudio, AUDIO_MAX_BYTES } from "@/lib/dj-audio-client";
import {
  appendAudioCues,
  type AudioAnalysis,
  type CueCandidate,
} from "@/lib/dj-audio-analysis";
import { lifestyleFingerprint, formatDuration } from "@/lib/dj";
import type { Lifestyle } from "@/lib/lifestyle-schema";
import type { SaveLifestyle } from "./shared";
type Draft = {
  analysis: AudioAnalysis;
  candidates: CueCandidate[];
  expected: string;
  selected: string[];
  filename: string;
  trackId: string;
};
export default function AudioCueStudio({
  life,
  trackId,
  save,
  disabled,
  onClose,
}: {
  life: Lifestyle;
  trackId: string;
  save: SaveLifestyle;
  disabled: boolean;
  onClose: () => void;
}) {
  const track = life.tracks.find((t) => t.id === trackId);
  const [draft, setDraft] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [url, setUrl] = useState(""),
    [matched, setMatched] = useState(false),
    [listened, setListened] = useState(false),
    [mode, setMode] = useState<"memory" | "hot">("memory"),
    [fillDuration, setFillDuration] = useState(true);
  const input = useRef<HTMLInputElement>(null),
    player = useRef<HTMLAudioElement>(null),
    abort = useRef<AbortController | null>(null),
    version = useRef(0),
    live = useRef(life),
    mediaURL = useRef(""),
    stopAt = useRef<number | null>(null);
  live.current = life;
  const disposeAudio = () => {
    player.current?.pause();
    stopAt.current = null;
    if (mediaURL.current) {
      URL.revokeObjectURL(mediaURL.current);
      mediaURL.current = "";
    }
  };
  useEffect(
    () => () => {
      version.current++;
      abort.current?.abort();
      disposeAudio();
    },
    [],
  );
  const analyze = async (file: File) => {
    if (disabled || busy || !track) return;
    setError("");
    setDraft(null);
    setMatched(false);
    setListened(false);
    setStatus("");
    disposeAudio();
    setUrl("");
    if (file.size > AUDIO_MAX_BYTES) {
      setError(
        "文件超过 64MB，请用压缩练习副本或较短音频；不上传、不自动转码。",
      );
      return;
    }
    const n = ++version.current,
      expected = lifestyleFingerprint(live.current),
      controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    try {
      const result = await analyzeLocalAudio(
        file,
        track.rekordbox?.tempos ?? [],
        controller.signal,
        (message) => {
          if (n === version.current) setStatus(message);
        },
      );
      if (n !== version.current || controller.signal.aborted) return;
      if (
        track.duration !== null &&
        Math.abs(result.duration - track.duration) >
          Math.max(2, track.duration * 0.01)
      )
        throw new Error(
          `实测 ${formatDuration(result.duration)}，记录为 ${formatDuration(track.duration)}，可能不是同一版本。请先核对音频或修改记录时长，再分析。`,
        );
      const limit = Math.min(
        track.duration ?? Math.floor(result.duration),
        Math.floor(result.duration),
      );
      const candidates = result.candidates.filter(
        (c) => c.seconds < limit && (c.end === undefined || c.end <= limit),
      );
      mediaURL.current = URL.createObjectURL(file);
      setUrl(mediaURL.current);
      setDraft({
        analysis: result,
        candidates,
        expected,
        selected: candidates.map((c) => c.id),
        filename: file.name,
        trackId: track.id,
      });
      setStatus(
        candidates.length
          ? `已找到 ${candidates.length} 个候选点，尚未修改曲库。`
          : "未找到可用候选点，可使用本机播放器试听后手动添加 Cue。",
      );
    } catch (e) {
      if (n === version.current) {
        if (e instanceof DOMException && e.name === "AbortError")
          setStatus("已取消，曲库没有改变。");
        else setError(e instanceof Error ? e.message : "未完成音频分析。");
      }
    } finally {
      if (n === version.current) {
        setBusy(false);
        abort.current = null;
      }
    }
  };
  const stale = !!draft && draft.expected !== lifestyleFingerprint(life);
  const alter = (id: string, patch: Partial<CueCandidate>) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            candidates: d.candidates.map((c) =>
              c.id === id ? { ...c, ...patch } : c,
            ),
          }
        : null,
    );
    setListened(false);
    setError("");
  };
  const listen = async (c: CueCandidate) => {
    if (!player.current || !draft) return;
    setError("");
    const at = Math.max(0, c.seconds - (c.kind === "loop" ? 0 : 2));
    stopAt.current = Math.min(draft.analysis.duration, c.end ?? at + 8);
    player.current.currentTime = at;
    try {
      await player.current.play();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setError("浏览器未允许播放，请直接点击下方播放器的播放按钮。");
    }
  };
  return (
    <Dialog
      title={`本机音频 · 智能 Cue${track ? ` · ${track.title}` : ""}`}
      wide
      onSubmit={(e) => e.preventDefault()}
      onClose={onClose}
      error={error}
    >
      <p className="hobby-notice">
        <Headphones size={17} /> 音频仅在这个浏览器解码与分析，不上传、不调用 AI
        服务、不进入云端或备份。只保存你确认的 Cue
        元数据；刷新后试听需重新选择文件。
      </p>
      {!track ? (
        <p role="alert">曲目已不存在，请关闭后重新选择。</p>
      ) : (
        <>
          <div className="hobby-smart-actions">
            <button
              className="primary"
              type="button"
              disabled={disabled || busy}
              onClick={() => input.current?.click()}
            >
              <Upload size={16} />
              {busy ? "正在本机分析…" : "选择本地音频并分析"}
            </button>
            {busy && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  abort.current?.abort();
                  setStatus(
                    "已请求取消；原生解码若已开始，需等待它结束后释放资源。",
                  );
                }}
              >
                <Square size={14} />
                取消分析
              </button>
            )}
          </div>
          <p className="hobby-caption">
            一次一首 · 64MB / 12 分钟以内 · MP3 / WAV 等浏览器支持的无 DRM
            文件。大文件建议在电脑分析；不会根据文件名猜测关联。
          </p>
          <input
            ref={input}
            type="file"
            hidden
            accept=".mp3,.wav,.flac,.m4a,.aac,.ogg,.aif,.aiff,audio/*"
            aria-label="选择智能 Cue 本地音频"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void analyze(f);
            }}
          />
          {status && (
            <p role="status" className="hobby-caption">
              {status}
            </p>
          )}
          {draft && (
            <section className="hobby-smart-preview" aria-label="音频 Cue 预览">
              <h3>{draft.filename}</h3>
              <p>
                对应记录：{track.title} — {track.artist || "艺人未知"} · 实测{" "}
                {formatDuration(draft.analysis.duration)}
              </p>
              <div className="hobby-audio-envelope">
                <svg
                  viewBox="0 0 720 100"
                  role="img"
                  aria-label="音频相对能量包络，非节拍或曲式识别"
                  preserveAspectRatio="none"
                >
                  {draft.analysis.waveform.map((v, i) => (
                    <rect
                      key={i}
                      x={(i * 720) / draft.analysis.waveform.length}
                      y={50 - v * 46}
                      width={Math.max(
                        1,
                        720 / draft.analysis.waveform.length - 1,
                      )}
                      height={Math.max(1, v * 92)}
                    />
                  ))}
                  {draft.candidates.map((c) => (
                    <line
                      key={c.id}
                      x1={(720 * c.seconds) / draft.analysis.duration}
                      x2={(720 * c.seconds) / draft.analysis.duration}
                      y1={0}
                      y2={100}
                    />
                  ))}
                </svg>
                <span>0:00</span>
                <span>{formatDuration(draft.analysis.duration)}</span>
              </div>
              {url && (
                <audio
                  ref={player}
                  className="hobby-audio-player"
                  controls
                  preload="metadata"
                  src={url}
                  aria-label="本地音频试听"
                  onSeeked={() => {
                    if (
                      stopAt.current !== null &&
                      player.current &&
                      player.current.currentTime > stopAt.current
                    )
                      stopAt.current = null;
                  }}
                  onTimeUpdate={() => {
                    if (
                      stopAt.current !== null &&
                      player.current &&
                      player.current.currentTime >= stopAt.current
                    ) {
                      player.current.pause();
                      stopAt.current = null;
                    }
                  }}
                />
              )}
              <p className="hobby-caption">
                这是音量能量变化，不是精准节拍、人声分离或结构识别。“能量上升”不保证是
                Drop；编辑后请重新试听。
              </p>
              <div className="hobby-cue-candidates">
                {draft.candidates.map((c) => (
                  <article key={c.id}>
                    <label className="hobby-smart-check">
                      <input
                        type="checkbox"
                        aria-label={`保留候选：${c.label}`}
                        checked={draft.selected.includes(c.id)}
                        onChange={(e) => {
                          setDraft({
                            ...draft,
                            selected: e.target.checked
                              ? [...draft.selected, c.id]
                              : draft.selected.filter((id) => id !== c.id),
                          });
                          setListened(false);
                        }}
                      />
                      {c.label}
                    </label>
                    <p>{c.reason}</p>
                    <div className="hobby-smart-fields">
                      <label>
                        名称
                        <input
                          aria-label={`候选名称：${c.id}`}
                          maxLength={60}
                          value={c.label}
                          onChange={(e) =>
                            alter(c.id, { label: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        开始秒数
                        <input
                          aria-label={`候选开始：${c.id}`}
                          type="number"
                          min={0}
                          max={draft.analysis.duration}
                          step={0.001}
                          value={c.seconds}
                          onChange={(e) =>
                            alter(c.id, { seconds: Number(e.target.value) })
                          }
                        />
                      </label>
                      {c.kind === "loop" && (
                        <label>
                          Loop 结束秒数
                          <input
                            aria-label={`候选结束：${c.id}`}
                            type="number"
                            min={c.seconds}
                            max={draft.analysis.duration}
                            step={0.001}
                            value={c.end}
                            onChange={(e) =>
                              alter(c.id, { end: Number(e.target.value) })
                            }
                          />
                        </label>
                      )}
                    </div>
                    <button
                      className="secondary"
                      type="button"
                      disabled={
                        !Number.isFinite(c.seconds) ||
                        c.seconds < 0 ||
                        c.seconds >= draft.analysis.duration
                      }
                      onClick={() => void listen(c)}
                    >
                      <Play size={14} />
                      试听：{c.label}
                    </button>
                  </article>
                ))}
              </div>
              <details>
                <summary>分析边界与提醒</summary>
                <ul>
                  {draft.analysis.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </details>
              <label>
                保存方式
                <select
                  aria-label="智能 Cue 保存方式"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "memory" | "hot")}
                >
                  <option value="memory">
                    新增 Memory Cue（不占 Hot Cue 槽）
                  </option>
                  <option value="hot">依序填入空闲 Hot Cue A–H</option>
                </select>
              </label>
              {track.duration === null && (
                <label className="hobby-smart-check">
                  <input
                    type="checkbox"
                    checked={fillDuration}
                    onChange={(e) => setFillDuration(e.target.checked)}
                  />
                  将实测时长填入当前空白时长，不改已有 BPM / 调性 / 能量
                </label>
              )}
              <label className="hobby-smart-check">
                <input
                  type="checkbox"
                  checked={matched}
                  onChange={(e) => setMatched(e.target.checked)}
                />
                我确认这个音频对应「{track.title}」的正确版本
              </label>
              <label className="hobby-smart-check">
                <input
                  type="checkbox"
                  checked={listened}
                  onChange={(e) => setListened(e.target.checked)}
                />
                我已试听、核对所选候选位置，理解它们不是已识别的 Drop / 副歌
              </label>
              <p className="hobby-caption">
                新增到现有 Cue 旁边；相同位置去重，Hot
                槽位不足会停止，不覆盖已有标记。保存后在 rekordbox 页签导出
                XML。
              </p>
              {stale && (
                <p role="alert" className="form-error">
                  曲库已在其他页面或设备改变，请重新分析后再保存；不会覆盖新记录。
                </p>
              )}
              <button
                type="button"
                className="primary"
                disabled={
                  disabled ||
                  stale ||
                  !matched ||
                  !listened ||
                  !draft.selected.length
                }
                onClick={() => {
                  setError("");
                  try {
                    const result = appendAudioCues(
                      life,
                      track.id,
                      draft.candidates.filter((c) =>
                        draft.selected.includes(c.id),
                      ),
                      mode,
                      draft.analysis.duration,
                      fillDuration,
                    );
                    if (
                      save(
                        () => result.next,
                        "确认本机音频 Cue 候选",
                        draft.expected,
                      )
                    )
                      onClose();
                    else setError("保存未完成，请核对同步后重新分析。");
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Cue 未保存。");
                  }
                }}
              >
                确认追加所选 Cue
              </button>
            </section>
          )}
        </>
      )}
    </Dialog>
  );
}
