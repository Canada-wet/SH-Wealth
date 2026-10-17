"use client";
import { useState } from "react";
import { Heart, Plus, Pencil, Trash2 } from "lucide-react";
import Dialog from "../Dialog";
import { ownerLabel } from "@/lib/wealth";
import { torontoDay } from "@/lib/quarterly-review";
import { lifestyleFingerprint } from "@/lib/dj";
import type { Lifestyle, Practice } from "@/lib/lifestyle-schema";
import type { SaveLifestyle } from "./shared";
export default function PracticeJournal({
  life,
  save,
  disabled,
  members,
  preferredSet,
}: {
  life: Lifestyle;
  save: SaveLifestyle;
  disabled: boolean;
  members: { first: string; second: string };
  preferredSet: string;
}) {
  const [editor, setEditor] = useState<{
      value: Practice;
      expected: string;
    } | null>(null),
    [filter, setFilter] = useState("all");
  const today = torontoDay(),
    since = new Date(`${today}T12:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 29);
  const recent = life.practices.filter(
      (p) => p.date >= since.toISOString().slice(0, 10) && p.date <= today,
    ),
    rows = life.practices
      .filter((p) => filter === "all" || p.member === filter)
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const open = (p?: Practice) => {
    const set = life.sets.find((s) => s.id === preferredSet);
    setEditor({
      value: p
        ? structuredClone(p)
        : {
            id: crypto.randomUUID(),
            date: today,
            member: "joint",
            minutes: 20,
            enjoyment: 4,
            setId: set?.id ?? null,
            setName: set?.name ?? "",
            trackCount: set?.entries.length ?? 0,
            focus: "",
            note: "",
          },
      expected: lifestyleFingerprint(life),
    });
  };
  return (
    <section className="card hobby-journal" aria-label="兴趣练习记录">
      <div className="hobby-section-head">
        <div>
          <span className="hobby-kicker">LESS PRESSURE · MORE PLAY</span>
          <h2>不是打卡，是留住好玩的时刻</h2>
          <p>DJ、听歌或其他轻量兴趣都可以记。没有连胜，也不追求“最高效率”。</p>
        </div>
        <button
          className="primary"
          disabled={disabled || life.practices.length >= 300}
          onClick={() => open()}
        >
          <Plus size={16} /> 记录一次练习
        </button>
      </div>
      <div className="hobby-journal-stats">
        <Heart size={22} />
        <p>
          过去 30 天，留给兴趣{" "}
          <b>{recent.reduce((n, p) => n + p.minutes, 0)}</b> 分钟 ·{" "}
          <b>{recent.length}</b> 次记录<span>只是回忆，不是要超越的指标。</span>
        </p>
      </div>
      <div className="hobby-toolbar">
        <label>
          查看成员
          <select
            aria-label="练习成员筛选"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">全部成员</option>
            {(["first", "second", "joint"] as const).map((k) => (
              <option key={k} value={k}>
                {ownerLabel(k, members)}
              </option>
            ))}
          </select>
        </label>
        <span className="hobby-caption">
          记录保存在共同家庭空间，对两位成员可见；最多 300 则。
        </span>
      </div>
      {!rows.length ? (
        <div className="hobby-empty">
          <Heart size={32} />
          <h3>今天有什么让你开心？</h3>
          <p>
            {filter === "all"
              ? "记一次尝试，或一句“下次想玩什么”。"
              : "这位成员还没有练习记录。"}
          </p>
        </div>
      ) : (
        <div className="hobby-practice-list">
          {rows.map((p) => (
            <article key={p.id}>
              <div className="hobby-practice-date">
                <b>{p.date.slice(5)}</b>
                <span>
                  {p.date.slice(0, 4)} · {ownerLabel(p.member, members)}
                </span>
              </div>
              <div>
                <h3>{p.focus}</h3>
                <p>
                  {p.minutes} 分钟 · 主观愉悦 {p.enjoyment}/5
                </p>
                {p.setName && (
                  <small>
                    记录时的 Set：{p.setName} · {p.trackCount}{" "}
                    首计划曲目（非播放证明）
                    {p.setId === null ? " · 原 Set 已删除" : ""}
                  </small>
                )}
                {p.note && <p className="hobby-practice-note">{p.note}</p>}
              </div>
              <div className="hobby-row-actions">
                <button
                  className="icon-button"
                  disabled={disabled}
                  aria-label={`编辑练习：${p.focus}`}
                  onClick={() => open(p)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="icon-button"
                  disabled={disabled}
                  aria-label={`删除练习：${p.focus}`}
                  onClick={() => {
                    if (
                      confirm(
                        `删除练习记录「${p.focus}」？如需保留请先导出兴趣空间备份。`,
                      )
                    )
                      save(
                        (l) => ({
                          ...l,
                          practices: l.practices.filter((x) => x.id !== p.id),
                        }),
                        "删除兴趣练习记录",
                      );
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {editor && (
        <PracticeEditor
          value={editor.value}
          life={life}
          members={members}
          disabled={disabled}
          onClose={() => setEditor(null)}
          onSave={(p) => {
            if (
              save(
                (l) => ({
                  ...l,
                  practices: l.practices.some((x) => x.id === p.id)
                    ? l.practices.map((x) => (x.id === p.id ? p : x))
                    : [...l.practices, p],
                }),
                "保存兴趣练习记录",
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
function PracticeEditor({
  value,
  life,
  members,
  disabled,
  onSave,
  onClose,
}: {
  value: Practice;
  life: Lifestyle;
  members: { first: string; second: string };
  disabled: boolean;
  onSave: (p: Practice) => boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value),
    [error, setError] = useState("");
  return (
    <Dialog
      title={value.focus ? "编辑练习记录" : "留下一次好玩的练习"}
      error={error}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.date > torontoDay()) {
          setError("这里记录已发生的练习，请不要填未来日期。");
          return;
        }
        if (!onSave({ ...draft, focus: draft.focus.trim() }))
          setError("未保存，请查看同步提示并保留输入内容。");
      }}
    >
      <fieldset disabled={disabled} className="hobby-form">
        <label>
          这次玩了什么
          <input
            aria-label="练习主题"
            required
            maxLength={160}
            value={draft.focus}
            onChange={(e) => setDraft({ ...draft, focus: e.target.value })}
            placeholder="练习一段转场 / 周末一起听歌…"
          />
        </label>
        <div className="form-grid">
          <label>
            日期
            <input
              aria-label="练习日期"
              required
              type="date"
              min="2000-01-01"
              max={torontoDay()}
              value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            />
          </label>
          <label>
            成员
            <select
              aria-label="练习成员"
              value={draft.member}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  member: e.target.value as Practice["member"],
                })
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
            实际分钟
            <input
              aria-label="练习分钟"
              required
              type="number"
              min="1"
              max="600"
              step="1"
              value={draft.minutes}
              onChange={(e) =>
                setDraft({ ...draft, minutes: Number(e.target.value) })
              }
            />
          </label>
          <label>
            这次的愉悦感
            <select
              aria-label="练习愉悦感"
              value={draft.enjoyment}
              onChange={(e) =>
                setDraft({ ...draft, enjoyment: Number(e.target.value) })
              }
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option value={n} key={n}>
                  {n}/5 ·{" "}
                  {
                    ["有点费劲", "还在摸索", "还不错", "很开心", "特别享受"][
                      n - 1
                    ]
                  }
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          关联 Set（可选）
          <select
            aria-label="练习关联 Set"
            value={draft.setId ?? ""}
            onChange={(e) => {
              const set = life.sets.find((s) => s.id === e.target.value);
              setDraft({
                ...draft,
                setId: set?.id ?? null,
                setName: set?.name ?? "",
                trackCount: set?.entries.length ?? 0,
              });
            }}
          >
            <option value="">不关联 Set</option>
            {life.sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          留给下次的自己
          <textarea
            aria-label="练习笔记"
            maxLength={1000}
            rows={3}
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            placeholder="今天喜欢的部分、想再试的一小步…"
          />
        </label>
        <div className="dialog-actions">
          <button className="secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" type="submit">
            保存练习
          </button>
        </div>
      </fieldset>
    </Dialog>
  );
}
