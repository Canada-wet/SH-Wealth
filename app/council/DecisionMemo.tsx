"use client";
import { useEffect, useRef, useState } from "react";
import {
  Archive,
  Bookmark,
  CalendarClock,
  Check,
  PencilLine,
} from "lucide-react";
import {
  EMPTY_COUNCIL_MEMO,
  parseCouncilMemo,
  type CouncilMemo,
} from "@/lib/council-library";
import type { CouncilRun } from "@/lib/council";
import { todayToronto } from "@/lib/household-workspace";
export default function DecisionMemo({
  run,
  value,
  ready,
  disabled,
  save,
  onDirtyChange,
}: {
  run: CouncilRun;
  value?: CouncilMemo;
  ready: boolean;
  disabled: boolean;
  save: (memo: CouncilMemo) => Promise<CouncilMemo>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const base = value ?? EMPTY_COUNCIL_MEMO;
  const [draft, setDraft] = useState<CouncilMemo>(() => structuredClone(base)),
    [editing, setEditing] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const tags = useRef<HTMLInputElement>(null),
    original = useRef(JSON.stringify(base));
  const dirty = JSON.stringify(draft) !== original.current;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!editing) {
      setDraft(structuredClone(base));
      original.current = JSON.stringify(base);
    }
  }, [base, editing]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const persist = async (next: CouncilMemo) => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await save(parseCouncilMemo(next));
      setDraft(saved);
      original.current = JSON.stringify(saved);
      setEditing(false);
      setNotice("已私密保存；不会发送给模型。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存未确认，草稿已保留。");
    } finally {
      setSaving(false);
    }
  };
  const active = ["active", "paused"].includes(run.status);
  return (
    <section
      className="council-card council-decision"
      aria-label="私人决策笔记"
    >
      <div className="council-section-label">
        <div>
          <p className="eyebrow">MAKE IT YOURS</p>
          <h2>把讨论，变成自己的判断</h2>
        </div>
        <PencilLine size={21} />
      </div>
      <p className="council-muted">
        由你记录采纳的判断、仍需验证的假设与现实反馈。笔记不改模型原文，也不自动进入追问。
      </p>
      <div className="council-decision-actions">
        <button
          disabled={!ready || disabled || saving || editing}
          aria-pressed={base.pinned}
          onClick={() => void persist({ ...base, pinned: !base.pinned })}
        >
          <Bookmark size={15} />
          {base.pinned ? "取消置顶" : "置顶这场研讨"}
        </button>
        <button
          disabled={!ready || disabled || saving || editing || active}
          title={
            active
              ? "先结束或停止当前研讨，才能归档"
              : "归档只隐藏整理，不删除原文"
          }
          onClick={() => void persist({ ...base, archived: !base.archived })}
        >
          <Archive size={15} />
          {base.archived ? "恢复到全部研讨" : "归档研讨"}
        </button>
        {!editing && (
          <button
            disabled={!ready || disabled || saving}
            onClick={() => {
              setEditing(true);
              setNotice("");
            }}
          >
            整理与笔记
          </button>
        )}
      </div>
      {!ready && (
        <p className="council-library-error">
          整理服务未连接，可继续回看原研讨；当前不能保存笔记。
        </p>
      )}
      {editing ? (
        <form
          className="council-memo-form"
          onSubmit={(e) => {
            e.preventDefault();
            void persist({
              ...draft,
              title: draft.title.trim(),
              note: draft.note.trim(),
              tags: (tags.current?.value ?? "")
                .split(/[,，]/)
                .map((t) => t.trim())
                .filter(Boolean),
            });
          }}
        >
          <label>
            自定义标题
            <input
              value={draft.title}
              maxLength={120}
              placeholder="留空保留原问题，不改原始问题"
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label>
            标签
            <input
              ref={tags}
              defaultValue={draft.tags.join("，")}
              placeholder="投资，职业，待验证（最多 6 个）"
              onChange={() =>
                setDraft((d) => ({
                  ...d,
                  tags: (tags.current?.value ?? "")
                    .split(/[,，]/)
                    .map((t) => t.trim())
                    .filter(Boolean),
                }))
              }
            />
          </label>
          <label>
            我的判断与待验证假设
            <textarea
              aria-label="我的判断与待验证假设"
              rows={5}
              value={draft.note}
              maxLength={2400}
              placeholder={
                "我决定先…\n因为…\n如果出现…，就重新评估。\n实际尝试后，我发现…"
              }
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
            <small>{draft.note.length}/2,400 · 仅本人可见，不发送模型</small>
          </label>
          <label>
            下次复核日期
            <input
              aria-label="下次复核日期"
              type="date"
              min="2000-01-01"
              max="2100-12-31"
              value={draft.reviewOn}
              onChange={(e) => setDraft({ ...draft, reviewOn: e.target.value })}
            />
            <small>到期显示在研讨库“待复核”，不会自动发通知或调用 AI。</small>
          </label>
          {value && value.version !== draft.version && (
            <p className="council-library-error">
              云端整理版本已变化，请先复制草稿，再取消编辑并重新读取。不会覆盖另一设备。
            </p>
          )}
          <div className="council-decision-actions">
            <button
              type="submit"
              className="primary-button"
              disabled={disabled || saving || !ready}
            >
              {saving ? "正在确认保存…" : "保存私人笔记"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                if (!dirty || window.confirm("放弃尚未保存的整理草稿？")) {
                  setEditing(false);
                  setError("");
                }
              }}
            >
              取消
            </button>
          </div>
        </form>
      ) : (
        <>
          {base.title && <h3>{base.title}</h3>}
          {!!base.tags.length && (
            <div className="council-library-tags">
              {base.tags.map((t) => (
                <span key={t}>#{t}</span>
              ))}
            </div>
          )}
          {base.note && <p className="council-personal-note">{base.note}</p>}
          {base.reviewOn && (
            <p
              className={`council-review-date${base.reviewOn <= todayToronto(new Date()) ? " due" : ""}`}
            >
              <CalendarClock size={16} />
              复核日期 {base.reviewOn}
              {base.reviewOn <= todayToronto(new Date())
                ? " · 已到期，请记录现实反馈或更新日期"
                : ""}
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="council-library-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="council-memo-saved">
          <Check size={15} />
          {notice}
        </p>
      )}
    </section>
  );
}
