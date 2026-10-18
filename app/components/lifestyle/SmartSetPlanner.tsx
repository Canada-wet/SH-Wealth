"use client";
import { useState } from "react";
import Dialog from "../Dialog";
import {
  generateDJSet,
  SHAPE_NAMES,
  type EnergyShape,
  type PlanOptions,
} from "@/lib/dj-autoplan";
import { lifestyleFingerprint, formatDuration } from "@/lib/dj";
import type { Lifestyle } from "@/lib/lifestyle-schema";
import type { SaveLifestyle } from "./shared";
export default function SmartSetPlanner({
  life,
  save,
  disabled,
  onClose,
  onSaved,
}: {
  life: Lifestyle;
  save: SaveLifestyle;
  disabled: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [options, setOptions] = useState<PlanOptions>({
    name: "我的智能 Set",
    minutes: 45,
    startId: "",
    shape: "build",
    genre: "",
    maxPitch: 6,
    overlapBars: 8,
    useCues: true,
  });
  const [preview, setPreview] = useState<
      (ReturnType<typeof generateDJSet> & { expected: string }) | null
    >(null),
    [error, setError] = useState("");
  const patch = (next: Partial<PlanOptions>) => {
    setOptions({ ...options, ...next });
    setPreview(null);
    setError("");
  };
  const stale = !!preview && preview.expected !== lifestyleFingerprint(life);
  return (
    <Dialog
      title="一键智能编排"
      wide
      onSubmit={(e) => e.preventDefault()}
      onClose={onClose}
      error={error}
    >
      <p className="hobby-notice">
        生成一套新的 Set，不改旧编排或曲目
        Cue。基于曲库元数据，不使用付费模型、不上传音频；结果必须试听。
      </p>
      <div className="hobby-smart-fields">
        <label>
          Set 名称
          <input
            aria-label="智能 Set 名称"
            maxLength={120}
            value={options.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>
        <label>
          目标分钟
          <input
            aria-label="智能 Set 目标分钟"
            type="number"
            min={1}
            max={600}
            step={1}
            value={options.minutes}
            onChange={(e) => patch({ minutes: Number(e.target.value) })}
          />
        </label>
        <label>
          能量走向
          <select
            aria-label="智能 Set 能量走向"
            value={options.shape}
            onChange={(e) => patch({ shape: e.target.value as EnergyShape })}
          >
            {Object.entries(SHAPE_NAMES).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          风格范围
          <select
            aria-label="智能 Set 风格"
            value={options.genre}
            onChange={(e) => patch({ genre: e.target.value, startId: "" })}
          >
            <option value="">不限风格</option>
            {[...new Set(life.tracks.map((t) => t.genre).filter(Boolean))]
              .sort()
              .map((g) => (
                <option key={g}>{g}</option>
              ))}
          </select>
        </label>
        <label>
          起始曲
          <select
            aria-label="智能 Set 起始曲"
            value={options.startId}
            onChange={(e) => patch({ startId: e.target.value })}
          >
            <option value="">自动选择合适起点</option>
            {life.tracks
              .filter((t) => !options.genre || t.genre === options.genre)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} ·{" "}
                  {t.duration === null
                    ? "时长未知"
                    : formatDuration(t.duration)}
                </option>
              ))}
          </select>
        </label>
        <label>
          已知 BPM 的最大估算变速 %
          <input
            aria-label="智能 Set 最大变速"
            type="number"
            min={0}
            max={12}
            step={0.5}
            value={options.maxPitch}
            onChange={(e) => patch({ maxPitch: Number(e.target.value) })}
          />
        </label>
        <label>
          建议混入重叠
          <select
            aria-label="智能 Set 重叠"
            value={options.overlapBars}
            onChange={(e) => patch({ overlapBars: Number(e.target.value) })}
          >
            <option value={0}>不自动设置重叠</option>
            {[4, 8, 16].map((n) => (
              <option key={n} value={n}>
                {n} 小节估算（按 4/4，非识别乐句）
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="hobby-smart-check">
        <input
          type="checkbox"
          checked={options.useCues}
          onChange={(e) => patch({ useCues: e.target.checked })}
        />
        优先采用已保存、名称含混入 / Intro、混出 / Outro 的 Cue 片段
      </label>
      <button
        type="button"
        className="primary"
        disabled={disabled}
        onClick={() => {
          setError("");
          try {
            setPreview({
              ...generateDJSet(life, options),
              expected: lifestyleFingerprint(life),
            });
          } catch (e) {
            setPreview(null);
            setError(e instanceof Error ? e.message : "未生成编排。");
          }
        }}
      >
        生成编排预览
      </button>
      {preview && (
        <section className="hobby-smart-preview" aria-label="智能编排预览">
          <h3>
            {preview.set.name} · {preview.set.entries.length} 首
          </h3>
          <p>
            计划净时长 {formatDuration(preview.duration.seconds)} ·{" "}
            {preview.duration.remaining! >= 0
              ? `距目标还差 ${formatDuration(preview.duration.remaining)}`
              : `超目标 ${formatDuration(-preview.duration.remaining!)}`}{" "}
            · {SHAPE_NAMES[preview.shape]}
          </p>
          <p className="hobby-caption">
            不硬切末曲凑时长；重叠是计划，不代表自动混音。速度、调性、乐句与人声冲突需在播放器核对。
          </p>
          <ol className="hobby-smart-sequence">
            {preview.set.entries.map((e, i) => {
              const t = life.tracks.find((t) => t.id === e.trackId);
              return (
                <li key={e.id}>
                  <strong>{t?.title ?? "曲目已改变"}</strong>
                  <span>
                    {t?.bpm ?? "?"} BPM · {t?.key || "调性未知"} · 能量{" "}
                    {t?.energy ?? "?"}/10
                  </span>
                  <span>
                    片段 {formatDuration(e.cueIn)} → {formatDuration(e.cueOut)}{" "}
                    · 混入重叠 {e.overlap.toFixed(1)}s
                  </span>
                  <p>{preview.reasons[i].reason}</p>
                </li>
              );
            })}
          </ol>
          <details>
            <summary>假设与不足（{preview.warnings.length}）</summary>
            <ul>
              {preview.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
          {stale && (
            <p role="alert" className="form-error">
              曲库或设置已变，请重新生成，不会覆盖新的记录。
            </p>
          )}
          <button
            type="button"
            className="primary"
            disabled={disabled || stale}
            onClick={() => {
              if (
                save(
                  (l) => ({ ...l, sets: [...l.sets, preview.set] }),
                  "确认智能 DJ 编排",
                  preview.expected,
                )
              ) {
                onSaved(preview.set.id);
                onClose();
              } else setError("保存未完成，请核对同步或重新生成预览。");
            }}
          >
            确认保存为新 Set
          </button>
        </section>
      )}
    </Dialog>
  );
}
