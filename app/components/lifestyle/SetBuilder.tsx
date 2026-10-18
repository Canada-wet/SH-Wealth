"use client";
import { useState } from "react";
import {
  Plus,
  ArrowUp,
  ArrowDown,
  Pencil,
  Trash2,
  Download,
  SlidersHorizontal,
  Headphones,
  WandSparkles,
} from "lucide-react";
import Dialog from "../Dialog";
import { ownerLabel } from "@/lib/wealth";
import {
  formatDuration,
  lifestyleFingerprint,
  moveEntry,
  recommendNext,
  repairEntries,
  setDuration,
} from "@/lib/dj";
import {
  type DJSet,
  type Lifestyle,
  type DJSettings,
  type SetEntry,
} from "@/lib/lifestyle-schema";
import { downloadText, type SaveLifestyle } from "./shared";
import SmartSetPlanner from "./SmartSetPlanner";

export default function SetBuilder({
  life,
  save,
  disabled,
  members,
  onPractice,
}: {
  life: Lifestyle;
  save: SaveLifestyle;
  disabled: boolean;
  members: { first: string; second: string };
  onPractice: (id: string) => void;
}) {
  const [selected, setSelected] = useState(""),
    [starter, setStarter] = useState("");
  const [planning, setPlanning] = useState(false);
  const [editing, setEditing] = useState<{
      value: DJSet;
      expected: string;
    } | null>(null),
    [transition, setTransition] = useState<{
      value: SetEntry;
      setId: string;
      expected: string;
    } | null>(null),
    [settings, setSettings] = useState<{
      value: DJSettings;
      expected: string;
    } | null>(null);
  const set = life.sets.find((s) => s.id === selected) ?? life.sets[0],
    tracks = new Map(life.tracks.map((t) => [t.id, t]));
  const current = tracks.get(set?.entries.at(-1)?.trackId ?? starter),
    suggestions = current
      ? recommendNext(
          current,
          life.tracks,
          life.settings,
          set?.entries.map((e) => e.trackId) ?? [],
        )
      : [];
  const duration = set ? setDuration(set, life.tracks) : null;
  const update = (fn: (s: DJSet) => DJSet, reason: string) =>
    set &&
    save(
      (l) => ({ ...l, sets: l.sets.map((s) => (s.id === set.id ? fn(s) : s)) }),
      reason,
    );
  const editSet = (value?: DJSet) =>
    setEditing({
      value: value
        ? structuredClone(value)
        : {
            id: crypto.randomUUID(),
            name: "",
            owner: "joint",
            targetMinutes: 45,
            entries: [],
          },
      expected: lifestyleFingerprint(life),
    });
  return (
    <section className="hobby-builder" aria-label="DJ Set Builder">
      <div className="card hobby-set-header">
        <div className="hobby-section-head">
          <div>
            <span className="hobby-kicker">FIND THE NEXT FEELING</span>
            <h2>从一首歌，走向一整段氛围</h2>
            <p>你来决定方向，评分只提供可解释的候选。</p>
          </div>
          <div className="hobby-smart-actions">
            <button
              className="secondary"
              disabled={
                disabled || !life.tracks.length || life.sets.length >= 60
              }
              onClick={() => setPlanning(true)}
            >
              <WandSparkles size={16} />
              一键智能编排
            </button>
            <button
              className="primary"
              disabled={disabled || life.sets.length >= 60}
              onClick={() => editSet()}
            >
              <Plus size={16} /> 新建 Set
            </button>
          </div>
        </div>
        {!!life.sets.length && (
          <div className="hobby-toolbar">
            <label>
              当前 Set
              <select
                aria-label="当前 Set"
                value={set?.id ?? ""}
                onChange={(e) => setSelected(e.target.value)}
              >
                {life.sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="hobby-chip">
              {ownerLabel(set!.owner, members)}
            </span>
            <button className="text-button" onClick={() => onPractice(set!.id)}>
              <Headphones size={14} /> 去记一次练习
            </button>
            <button
              className="text-button"
              disabled={disabled}
              onClick={() => editSet(set)}
            >
              <Pencil size={14} /> 编辑 Set 设置
            </button>
            <button
              className="text-button"
              disabled={disabled}
              onClick={() => {
                if (
                  confirm(
                    `删除 Set「${set?.name}」？曲库不受影响，练习记录保留但会取消关联。`,
                  )
                )
                  save(
                    (l) => ({
                      ...l,
                      sets: l.sets.filter((s) => s.id !== set!.id),
                      practices: l.practices.map((p) =>
                        p.setId === set!.id ? { ...p, setId: null } : p,
                      ),
                    }),
                    "删除 DJ Set",
                  );
              }}
            >
              <Trash2 size={14} /> 删除 Set
            </button>
          </div>
        )}
      </div>
      {!set ? (
        <div className="card hobby-empty">
          <Headphones size={36} />
          <h3>今晚想营造什么感觉？</h3>
          <p>
            建一套暖场、派对或放松的 Set。曲库为空时也可以先给计划起个名字。
          </p>
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => editSet()}
          >
            创建第一套 Set
          </button>
        </div>
      ) : (
        <div className="hobby-builder-grid">
          <div className="card hobby-sequence">
            <div className="hobby-section-head">
              <h3>
                你的顺序{" "}
                <span className="hobby-caption">{set.entries.length} 首</span>
              </h3>
              <button
                className="text-button"
                disabled={!set.entries.length}
                onClick={() =>
                  downloadText(
                    `${set.name.replace(/[^\p{L}\p{N}_-]/gu, "_").slice(0, 60)}-plan.txt`,
                    `${set.name}\n目标 ${set.targetMinutes} 分钟 · ${ownerLabel(set.owner, members)}\n${duration?.unknown ? `已知片段 ${formatDuration(duration.seconds)} + ${duration.unknown} 首时长未知` : `计划净时长 ${formatDuration(duration?.seconds ?? 0)}`}（按 Cue 与重叠估算，非实际录音）\n\n` +
                      set.entries
                        .map((e, i) => {
                          const t = tracks.get(e.trackId)!;
                          return `${i + 1}. ${t.title} — ${t.artist || "未知艺人"}\n${t.bpm ?? "?"} BPM · ${t.key || "调性未知"} · 能量 ${t.energy ?? "?"}\nCue ${formatDuration(e.cueIn)} → ${formatDuration(e.cueOut ?? t.duration)} · 混入重叠 ${e.overlap}s\n转场：${e.note || "未记录"}\n曲目备注：${t.cueNotes || "无"}`;
                        })
                        .join("\n\n"),
                    "text/plain;charset=utf-8",
                  )
                }
              >
                <Download size={14} /> 导出计划
              </button>
            </div>
            <div className="hobby-duration">
              <b>
                {duration!.unknown
                  ? `${formatDuration(duration!.seconds)} + ?`
                  : formatDuration(duration!.seconds)}
              </b>
              <span>
                目标 {set.targetMinutes} 分钟
                <br />
                {duration!.unknown
                  ? `${duration!.unknown} 首时长未完整，暂不计算剩余`
                  : duration!.remaining! >= 0
                    ? `还可安排 ${formatDuration(duration!.remaining)}`
                    : `比目标多 ${formatDuration(-duration!.remaining!)}`}
              </span>
            </div>
            <p className="hobby-caption">
              按选定片段减去手动设置的重叠；不是播放器或实际录音时长。
            </p>
            {!set.entries.length ? (
              <div className="hobby-starter">
                <label>
                  选择起始曲目
                  <select
                    aria-label="选择起始曲目"
                    value={starter}
                    onChange={(e) => setStarter(e.target.value)}
                  >
                    <option value="">从曲库选择…</option>
                    {life.tracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title} · {t.bpm ?? "?"} BPM · {t.key || "?"}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="primary"
                  disabled={disabled || !current}
                  onClick={() =>
                    update(
                      (s) => ({
                        ...s,
                        entries: [
                          {
                            id: crypto.randomUUID(),
                            trackId: current!.id,
                            cueIn: 0,
                            cueOut: null,
                            overlap: 0,
                            note: "",
                          },
                        ],
                      }),
                      "选择 DJ Set 起始曲",
                    )
                  }
                >
                  用这首开始
                </button>
                {!life.tracks.length && <p>请先到曲库添加至少一首曲目。</p>}
              </div>
            ) : (
              <>
                <div
                  className="hobby-energy-curve"
                  role="img"
                  aria-label={`Set 能量顺序：${set.entries.map((e, i) => `${i + 1} ${tracks.get(e.trackId)?.energy ?? "未知"}`).join("，")}`}
                >
                  {set.entries.map((e, i) => (
                    <div key={e.id} title={tracks.get(e.trackId)?.title}>
                      <i
                        style={{
                          height:
                            tracks.get(e.trackId)?.energy === null
                              ? 8
                              : (tracks.get(e.trackId)?.energy ?? 0) * 6,
                        }}
                        className={
                          tracks.get(e.trackId)?.energy === null
                            ? "unknown"
                            : ""
                        }
                      />
                      <span>{i + 1}</span>
                    </div>
                  ))}
                </div>
                <ol className="hobby-set-entries">
                  {set.entries.map((e, i) => {
                    const t = tracks.get(e.trackId)!;
                    return (
                      <li key={e.id}>
                        <div className="hobby-set-number">
                          {String(i + 1).padStart(2, "0")}
                        </div>
                        <div className="hobby-entry-content">
                          <b>{t.title}</b>
                          <small>
                            {t.artist || "艺人未知"} · {t.bpm ?? "?"} BPM ·{" "}
                            {t.key || "?"} · 能量 {t.energy ?? "?"}
                          </small>
                          <small>
                            Cue {formatDuration(e.cueIn)} →{" "}
                            {formatDuration(e.cueOut ?? t.duration)} · 重叠{" "}
                            {e.overlap}s
                          </small>
                          {e.note && <p>{e.note}</p>}
                          {t.cues.length > 0 && (
                            <small>
                              标记：
                              {t.cues
                                .map(
                                  (c) =>
                                    `${c.label} ${formatDuration(c.seconds)}`,
                                )
                                .join(" / ")}
                            </small>
                          )}
                          <div className="hobby-entry-actions">
                            <button
                              className="text-button"
                              aria-label={`上移：${t.title}`}
                              disabled={disabled || i === 0}
                              onClick={() =>
                                update(
                                  (s) => moveEntry(s, i, -1),
                                  "上移 Set 曲目",
                                )
                              }
                            >
                              <ArrowUp size={14} />
                              上移
                            </button>
                            <button
                              className="text-button"
                              aria-label={`下移：${t.title}`}
                              disabled={
                                disabled || i === set.entries.length - 1
                              }
                              onClick={() =>
                                update(
                                  (s) => moveEntry(s, i, 1),
                                  "下移 Set 曲目",
                                )
                              }
                            >
                              <ArrowDown size={14} />
                              下移
                            </button>
                            <button
                              className="text-button"
                              disabled={disabled}
                              aria-label={`编辑转场：${t.title}`}
                              onClick={() =>
                                setTransition({
                                  value: structuredClone(e),
                                  setId: set.id,
                                  expected: lifestyleFingerprint(life),
                                })
                              }
                            >
                              <Pencil size={14} />
                              Cue / 转场
                            </button>
                            <button
                              className="text-button"
                              disabled={disabled}
                              aria-label={`移出 Set：${t.title}`}
                              onClick={() =>
                                update(
                                  (s) => ({
                                    ...s,
                                    entries: repairEntries(
                                      s.entries.filter((x) => x.id !== e.id),
                                      s.entries,
                                    ),
                                  }),
                                  "从 Set 移出曲目",
                                )
                              }
                            >
                              移出
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                <p className="hobby-caption">
                  改变相邻顺序时，只重置受影响的混入转场备注与重叠；曲目 Cue
                  不变。
                </p>
              </>
            )}
          </div>
          <div className="card hobby-recommendations">
            <div className="hobby-section-head">
              <div>
                <h3>下一首，试试这些</h3>
                <p>
                  {current ? `从「${current.title}」出发` : "先选一首起始曲"}
                </p>
              </div>
              <button
                className="text-button"
                disabled={disabled}
                onClick={() =>
                  setSettings({
                    value: structuredClone(life.settings),
                    expected: lifestyleFingerprint(life),
                  })
                }
              >
                <SlidersHorizontal size={15} />
                调整推荐
              </button>
            </div>
            <div className="hobby-recipe">
              BPM {life.settings.weights.bpm} · 调性 {life.settings.weights.key}{" "}
              · 能量 {life.settings.weights.energy} · 偏好{" "}
              {life.settings.weights.preference}
              <span>
                权重自动归一化 · 目标能量{" "}
                {life.settings.energyDelta >= 0 ? "+" : ""}
                {life.settings.energyDelta} ·{" "}
                {life.settings.keyLock ? "假设已启用保调" : "未启用保调假设"}
              </span>
            </div>
            {!current ? (
              <div className="hobby-empty">
                <p>先把最想听的曲目放到第一位。</p>
              </div>
            ) : !suggestions.length ? (
              <div className="hobby-empty">
                <p>当前曲库没有尚未使用的候选。添加更多曲目，或换一个起点。</p>
              </div>
            ) : (
              <>
                <p className="hobby-caption">
                  缺失因子取中性
                  50%，不代表兼容；依据覆盖率按权重计算。非保调变速时不推断新调性。
                </p>
                <div className="hobby-candidates">
                  {suggestions.slice(0, 6).map((r) => (
                    <article className="hobby-candidate" key={r.track.id}>
                      <div className="hobby-candidate-head">
                        <div>
                          <b>{r.track.title}</b>
                          <small>
                            {r.track.artist || "艺人未知"} ·{" "}
                            {r.track.bpm ?? "?"} BPM · {r.track.key || "?"}
                          </small>
                        </div>
                        <span className="hobby-match">
                          {r.score}
                          <small>启发分 / 100</small>
                        </span>
                      </div>
                      <div className="hobby-score-parts">
                        {(
                          [
                            ["bpm", "BPM"],
                            ["key", "调性"],
                            ["energy", "能量"],
                            ["preference", "偏好"],
                          ] as const
                        ).map(([key, label]) => (
                          <span key={key}>
                            {label}
                            <b>{Math.round(r.parts[key] * 100)}</b>
                          </span>
                        ))}
                      </div>
                      <ul>
                        <li>
                          {r.tempo
                            ? `候选速度需 ${r.tempo.pitch >= 0 ? "+" : ""}${r.tempo.pitch.toFixed(1)}%${r.tempo.factor !== 1 ? `（按 ${r.tempo.factor === 0.5 ? "半拍" : "双拍"}解释）` : ""}`
                            : "BPM 缺失，速度兼容未知"}
                        </li>
                        <li>{r.keyReason}</li>
                        <li>
                          {r.energyChange === null
                            ? "能量未完整记录"
                            : `能量变化 ${r.energyChange >= 0 ? "+" : ""}${r.energyChange}（目标能量 ${r.targetEnergy}/10）`}
                        </li>
                      </ul>
                      <div className="hobby-candidate-bottom">
                        <span>依据覆盖率 {r.confidence}%</span>
                        <button
                          className="secondary"
                          disabled={
                            disabled ||
                            !set.entries.length ||
                            set.entries.length >= 200
                          }
                          onClick={() =>
                            update(
                              (s) => ({
                                ...s,
                                entries: [
                                  ...s.entries,
                                  {
                                    id: crypto.randomUUID(),
                                    trackId: r.track.id,
                                    cueIn: 0,
                                    cueOut: null,
                                    overlap: 0,
                                    note: "",
                                  },
                                ],
                              }),
                              "加入候选 DJ 曲目",
                            )
                          }
                          aria-label={`加入下一首：${r.track.title}`}
                        >
                          加入下一首 <Plus size={14} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
            <details className="hobby-method">
              <summary>评分怎么来的？</summary>
              <p>
                BPM：达到上一曲标注 BPM 所需的相对速度变化，12% 偏移时该项降到
                0；半 / 双拍须自行开启。调性：同调 100、相邻同环 / 相对大小调
                90，其余 15。能量：越接近你设置的目标变化越高，目标限制在 1–10。
              </p>
              <p>
                偏好 = 65% 个人评分 + 35%
                风格偏好；缺失或未选用中性值。总分是四项按权重加权的候选排序，不是客观过渡质量或概率。未分析节拍网格、乐句、人声冲突与实际音频，最终要试听。
              </p>
              <a
                href="https://mixedinkey.com/camelot-wheel/"
                target="_blank"
                rel="noreferrer noopener"
              >
                Camelot 基础关系参考 ↗
              </a>
            </details>
          </div>
        </div>
      )}
      {editing && (
        <SetEditor
          value={editing.value}
          members={members}
          disabled={disabled}
          onClose={() => setEditing(null)}
          onSave={(value) => {
            if (
              save(
                (l) => ({
                  ...l,
                  sets: l.sets.some((s) => s.id === value.id)
                    ? l.sets.map((s) => (s.id === value.id ? value : s))
                    : [...l.sets, value],
                }),
                "保存 DJ Set",
                editing.expected,
              )
            ) {
              setSelected(value.id);
              setEditing(null);
              return true;
            }
            return false;
          }}
        />
      )}
      {planning && (
        <SmartSetPlanner
          life={life}
          save={save}
          disabled={disabled}
          onClose={() => setPlanning(false)}
          onSaved={(id) => setSelected(id)}
        />
      )}
      {transition && (
        <TransitionEditor
          value={transition.value}
          first={
            life.sets.find((s) => s.id === transition.setId)?.entries[0]?.id ===
            transition.value.id
          }
          disabled={disabled}
          onClose={() => setTransition(null)}
          onSave={(value) => {
            if (
              save(
                (l) => ({
                  ...l,
                  sets: l.sets.map((s) =>
                    s.id === transition.setId
                      ? {
                          ...s,
                          entries: s.entries.map((e) =>
                            e.id === value.id ? value : e,
                          ),
                        }
                      : s,
                  ),
                }),
                "保存 Cue 与转场计划",
                transition.expected,
              )
            ) {
              setTransition(null);
              return true;
            }
            return false;
          }}
        />
      )}
      {settings && (
        <RecommendationSettings
          value={settings.value}
          disabled={disabled}
          onClose={() => setSettings(null)}
          onSave={(value) => {
            if (
              save(
                (l) => ({ ...l, settings: value }),
                "调整 DJ 推荐偏好",
                settings.expected,
              )
            ) {
              setSettings(null);
              return true;
            }
            return false;
          }}
        />
      )}
    </section>
  );
}
function SetEditor({
  value,
  members,
  disabled,
  onSave,
  onClose,
}: {
  value: DJSet;
  members: { first: string; second: string };
  disabled: boolean;
  onSave: (s: DJSet) => boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value),
    [error, setError] = useState("");
  return (
    <Dialog
      title={value.name ? "编辑 Set 设置" : "新建 DJ Set"}
      error={error}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        if (!onSave({ ...draft, name: draft.name.trim() }))
          setError("未保存，请查看同步或数据提示。");
      }}
    >
      <fieldset disabled={disabled} className="hobby-form">
        <label>
          Set 名称
          <input
            aria-label="Set 名称"
            required
            maxLength={120}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="例如：周末客厅 · Warm-up"
          />
        </label>
        <div className="form-grid">
          <label>
            归属
            <select
              aria-label="Set 归属"
              value={draft.owner}
              onChange={(e) =>
                setDraft({ ...draft, owner: e.target.value as DJSet["owner"] })
              }
            >
              {(["joint", "first", "second"] as const).map((k) => (
                <option value={k} key={k}>
                  {ownerLabel(k, members)}
                </option>
              ))}
            </select>
          </label>
          <label>
            目标时长（分钟）
            <input
              aria-label="Set 目标分钟"
              type="number"
              required
              min="1"
              max="600"
              step="1"
              value={draft.targetMinutes}
              onChange={(e) =>
                setDraft({ ...draft, targetMinutes: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <div className="dialog-actions">
          <button className="secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" type="submit">
            保存 Set
          </button>
        </div>
      </fieldset>
    </Dialog>
  );
}
function TransitionEditor({
  value,
  first,
  disabled,
  onSave,
  onClose,
}: {
  value: SetEntry;
  first: boolean;
  disabled: boolean;
  onSave: (e: SetEntry) => boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({
      ...value,
      cueOut: value.cueOut?.toString() ?? "",
    }),
    [error, setError] = useState("");
  return (
    <Dialog
      title="编辑 Cue 与混入转场"
      error={error}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        if (
          !onSave({
            ...draft,
            cueOut: draft.cueOut.trim() ? Number(draft.cueOut) : null,
          })
        )
          setError(
            "未保存：请确认 Cue 在曲目内、结束晚于开始、首曲重叠为 0，且前后混音重叠不超过片段时长。",
          );
      }}
    >
      <fieldset disabled={disabled} className="hobby-form">
        <div className="form-grid">
          <label>
            入点（秒）
            <input
              aria-label="入点秒数"
              type="number"
              required
              min="0"
              max="14400"
              value={draft.cueIn}
              onChange={(e) =>
                setDraft({ ...draft, cueIn: Number(e.target.value) })
              }
            />
          </label>
          <label>
            出点（秒，空白到曲末）
            <input
              aria-label="出点秒数"
              type="number"
              min="1"
              max="14400"
              value={draft.cueOut}
              onChange={(e) => setDraft({ ...draft, cueOut: e.target.value })}
            />
          </label>
        </div>
        <label>
          与前一首重叠（秒）
          <input
            aria-label="混入重叠秒数"
            type="number"
            required
            min="0"
            max={first ? 0 : 600}
            value={draft.overlap}
            onChange={(e) =>
              setDraft({ ...draft, overlap: Number(e.target.value) })
            }
          />
        </label>
        <label>
          转场备注
          <textarea
            aria-label="转场备注"
            rows={3}
            maxLength={600}
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            placeholder="例如：前曲 break 后 16 小节混入；留意人声。"
          />
        </label>
        <p className="hobby-caption">
          时长未知的片段不能设置重叠；这些标记只用于计划，不控制音频或硬件。
        </p>
        <div className="dialog-actions">
          <button className="secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" type="submit">
            保存转场
          </button>
        </div>
      </fieldset>
    </Dialog>
  );
}
function RecommendationSettings({
  value,
  disabled,
  onSave,
  onClose,
}: {
  value: DJSettings;
  disabled: boolean;
  onSave: (s: DJSettings) => boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value),
    [genres, setGenres] = useState(value.genres.join(", ")),
    [error, setError] = useState("");
  const sum = Object.values(draft.weights).reduce((a, b) => a + b, 0);
  return (
    <Dialog
      title="调整下一首推荐"
      error={error}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        if (!sum) {
          setError("至少保留一项非零权重。");
          return;
        }
        if (
          !onSave({
            ...draft,
            genres: [
              ...new Set(
                genres
                  .split(/[,，]/)
                  .map((g) => g.trim())
                  .filter(Boolean),
              ),
            ],
          })
        )
          setError("未保存，请核对权重与同步状态。");
      }}
    >
      <fieldset disabled={disabled} className="hobby-form">
        <p>默认 30 / 30 / 25 / 15；总和不必等于 100，系统会归一化。</p>
        {(
          [
            ["bpm", "BPM"],
            ["key", "调性"],
            ["energy", "能量"],
            ["preference", "偏好"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label} · {sum ? Math.round((draft.weights[key] / sum) * 100) : 0}%
            <input
              aria-label={`${label} 权重`}
              type="range"
              min="0"
              max="100"
              value={draft.weights[key]}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  weights: { ...draft.weights, [key]: Number(e.target.value) },
                })
              }
            />
          </label>
        ))}
        <label>
          下一首目标能量变化
          <select
            aria-label="目标能量变化"
            value={draft.energyDelta}
            onChange={(e) =>
              setDraft({ ...draft, energyDelta: Number(e.target.value) })
            }
          >
            {[-2, -1, 0, 1, 2].map((n) => (
              <option value={n} key={n}>
                {n > 0 ? "+" : ""}
                {n} · {n < 0 ? "降温" : n === 0 ? "平稳" : "推高"}
              </option>
            ))}
          </select>
        </label>
        <label>
          偏好风格（逗号分隔）
          <input
            aria-label="偏好风格"
            maxLength={1000}
            value={genres}
            onChange={(e) => setGenres(e.target.value)}
            placeholder="House, Disco"
          />
        </label>
        <label className="hobby-checkbox">
          <input
            type="checkbox"
            checked={draft.halfDouble}
            onChange={(e) =>
              setDraft({ ...draft, halfDouble: e.target.checked })
            }
          />
          允许半 / 双拍 BPM 解释（需要你试听核对）
        </label>
        <label className="hobby-checkbox">
          <input
            type="checkbox"
            checked={draft.keyLock}
            onChange={(e) => setDraft({ ...draft, keyLock: e.target.checked })}
          />
          假设设备启用 Key Lock 保调；App 不处理音频
        </label>
        <div className="dialog-actions">
          <button className="secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" type="submit">
            保存推荐偏好
          </button>
        </div>
      </fieldset>
    </Dialog>
  );
}
