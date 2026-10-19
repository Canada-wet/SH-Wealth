"use client";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Circle,
  Pencil,
  RefreshCw,
  Trash2,
  LockKeyhole,
  Users,
} from "lucide-react";
import useActionCenter from "@/lib/useActionCenter";
import type { ActionItem, ActionPatch } from "@/lib/action-center";
import { FEATURES } from "@/lib/navigation";
import type { WealthState } from "@/lib/wealth";
import { todayToronto } from "@/lib/household-workspace";
import ActionCapture, { ACTION_STATUSES, ActionFields } from "./ActionCapture";
import Dialog from "./Dialog";

function EditAction({
  item,
  save,
  close,
}: {
  item: ActionItem;
  save: (patch: ActionPatch) => Promise<void>;
  close: () => void;
}) {
  const [draft, setDraft] = useState<ActionPatch>({
    title: item.title,
    note: item.note,
    owner: item.owner,
    status: item.status,
    due: item.due,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog
      title="跟进行动"
      onClose={() => {
        if (!busy) close();
      }}
      error={error}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          await save(draft);
          close();
        } catch (reason) {
          setError(
            reason instanceof Error
              ? reason.message
              : "未确认保存，草稿仍保留。",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="action-help">
        保存会核对打开时的版本。伴侣或其他设备先修改时，拒绝覆盖；你的草稿仍留在这里。
      </p>
      <ActionFields
        value={{
          title: draft.title ?? "",
          note: draft.note ?? "",
          owner: draft.owner ?? "joint",
          status: draft.status ?? "planned",
          due: draft.due ?? "",
        }}
        disabled={busy}
        change={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      />
      <div className="button-row">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "正在确认…" : "保存修改"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={close}
        >
          取消
        </button>
      </div>
    </Dialog>
  );
}

function ActionList({
  householdId,
  state,
}: {
  householdId: string;
  state: WealthState;
}) {
  const store = useActionCenter(householdId);
  const [filter, setFilter] = useState("open"),
    [scope, setScope] = useState("all"),
    [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ActionItem | null>(null),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const reset = () => {
      setEditing(null);
      setQuery("");
      setNotice("");
    };
    window.addEventListener("together-action-session-changed", reset);
    return () =>
      window.removeEventListener("together-action-session-changed", reset);
  }, []);
  const today = todayToronto(),
    owner = (value: string) =>
      value === "first"
        ? state.members.first
        : value === "second"
          ? state.members.second
          : "共同";
  const overdue = (item: ActionItem) =>
    item.status !== "done" && !!item.due && item.due < today;
  const openCount = store.items.filter((a) => a.status !== "done").length;
  const rows = store.items
    .filter(
      (item) =>
        (scope === "all" || item.visibility === scope) &&
        (filter === "all" ||
          (filter === "open"
            ? item.status !== "done"
            : filter === "overdue"
              ? overdue(item)
              : item.status === filter)) &&
        `${item.title} ${item.note}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(overdue(b)) - Number(overdue(a)) ||
        (a.due || "9999").localeCompare(b.due || "9999") ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  const legacy = Object.entries(
    state.preferences.quarterlyReviews?.records ?? {},
  ).flatMap(([quarter, record]) =>
    record.actions.filter((a) => !a.done).map((a) => ({ ...a, quarter })),
  );
  async function change(operation: () => Promise<unknown>) {
    setNotice("");
    try {
      await operation();
      setNotice("变更已由云端确认。");
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "未确认保存，请先重新读取。",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="action-summary">
        <span>
          <b>{store.loading || store.error ? "—" : openCount}</b> 项待推进
        </span>
        <span>
          <b>
            {store.loading || store.error
              ? "—"
              : store.items.filter(overdue).length}
          </b>{" "}
          项已过目标日
        </span>
        <small>日期按多伦多；仅自己的行动与双方共享的行动可见。</small>
      </div>
      <div className="action-toolbar">
        <input
          type="search"
          aria-label="搜索行动"
          placeholder="在可见行动中查找…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="筛选行动进度"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="open">待推进</option>
          <option value="doing">进行中</option>
          <option value="overdue">已过目标日</option>
          <option value="done">已完成</option>
          <option value="all">全部</option>
        </select>
        <select
          aria-label="筛选行动可见范围"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="all">全部可见</option>
          <option value="private">仅自己</option>
          <option value="household">家庭共享</option>
        </select>
        <button
          type="button"
          className="icon-button"
          aria-label="重新读取行动"
          disabled={store.loading || !!busy}
          onClick={() => void store.refresh().catch(() => {})}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {store.error && (
        <p role="alert" className="action-error">
          {store.error} 原有草稿不会被当作已保存；可重新读取。
        </p>
      )}
      {notice && (
        <p role="status" className="action-help">
          {notice}
        </p>
      )}
      {store.loading && (
        <p role="status" className="action-empty">
          正在读取云端行动…
        </p>
      )}
      {!store.loading && !rows.length && (
        <p className="action-empty">
          {store.error
            ? "行动暂不可用，不显示虚假的空清单。"
            : store.items.length
              ? "没有符合当前筛选的行动。"
              : "还没有行动。先从研究或研讨中确认一个值得推进的下一步。"}
        </p>
      )}
      <ul className="action-items">
        {rows.map((item) => {
          const source = FEATURES.find((f) => f.id === item.sourceFeature);
          const sourceHref =
            source?.href === "/council" &&
            item.visibility === "private" &&
            /^[0-9a-f-]{36}$/i.test(item.sourceRef)
              ? `/council?run=${encodeURIComponent(item.sourceRef)}`
              : source?.href;
          return (
            <li
              key={item.id}
              className={`${overdue(item) ? "action-overdue" : ""} ${item.status === "done" ? "action-complete" : ""}`}
            >
              <button
                type="button"
                className="action-check"
                aria-label={`${item.status === "done" ? "重新打开" : "完成"}行动：${item.title}`}
                disabled={!!busy || store.loading || !!store.error}
                onClick={() => {
                  setBusy(item.id);
                  void change(() =>
                    store.update(item, {
                      status: item.status === "done" ? "planned" : "done",
                    }),
                  );
                }}
              >
                {item.status === "done" ? (
                  <Check size={18} />
                ) : (
                  <Circle size={18} />
                )}
              </button>
              <div className="action-item-body">
                <h3>{item.title}</h3>
                {item.note && <p>{item.note}</p>}
                <div className="action-meta">
                  <span>
                    {item.visibility === "private" ? (
                      <LockKeyhole size={12} />
                    ) : (
                      <Users size={12} />
                    )}
                    {item.visibility === "private" ? "仅自己" : "家庭共享"}
                  </span>
                  <span>{owner(item.owner)}</span>
                  <span>{ACTION_STATUSES[item.status]}</span>
                  <span>
                    {item.due
                      ? `${item.due}${overdue(item) ? " · 待重新安排" : ""}`
                      : "未设目标日"}
                  </span>
                  {sourceHref && (
                    <a href={sourceHref}>
                      来源：{source?.title}
                      <ArrowUpRight size={12} />
                    </a>
                  )}
                </div>
              </div>
              <div className="action-item-tools">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`编辑行动：${item.title}`}
                  disabled={!!busy || !!store.error}
                  onClick={() => setEditing(item)}
                >
                  <Pencil size={16} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`删除行动：${item.title}`}
                  disabled={!!busy || !!store.error}
                  onClick={() => {
                    if (
                      window.confirm(
                        `删除“${item.title}”？仅删除这条行动，不修改其来源、账本或研讨；不能在页面撤销。`,
                      )
                    ) {
                      setBusy(item.id);
                      void change(() => store.remove(item));
                    }
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {!!legacy.length && (
        <details className="action-legacy">
          <summary>另有 {legacy.length} 项季度复盘原定行动</summary>
          <p>
            保留原始季度与完成状态，不重复复制成第二份任务。在季度复盘中跟进。
          </p>
          {legacy.map((a) => (
            <a href="/#quarterly-review" key={`${a.quarter}-${a.id}`}>
              <span>{a.title}</span>
              <small>
                {a.quarter} · {owner(a.owner)} · {a.due}
              </small>
              <ArrowUpRight size={14} />
            </a>
          ))}
        </details>
      )}
      <p className="action-help">
        独立云端保存，不改财富余额，也不进入旧版家庭 JSON
        备份。各模块的来源链接不授予对方查看私人研讨的权限。
      </p>
      {editing && (
        <EditAction
          item={editing}
          close={() => setEditing(null)}
          save={async (patch) => {
            await store.update(editing, patch);
            setNotice("行动修改已由云端确认。");
          }}
        />
      )}
    </>
  );
}

export default function ActionCenter({
  householdId,
  state,
  hidden = false,
}: {
  householdId?: string;
  state: WealthState;
  hidden?: boolean;
}) {
  return (
    <section
      className="space-card action-center"
      id="actions"
      aria-label="统一行动中心"
    >
      <div className="space-section-head">
        <div>
          <p className="space-kicker">FROM INSIGHT TO FOLLOW-THROUGH</p>
          <h2>把想清楚的事，做下去。</h2>
          <p className="action-help">
            研究、研讨与家庭计划的下一步，在这里跟进。
          </p>
        </div>
        {!hidden && !!householdId && (
          <ActionCapture
            householdId={householdId}
            sourceFeature="action-center"
            label="添加行动"
          />
        )}
      </div>
      {hidden ? (
        <p className="action-empty">
          恢复显示并确认家庭同步状态后，再查看行动。
        </p>
      ) : !householdId ? (
        <p className="action-empty">
          先连接家庭云端，再保存和跟进行动。<a href="/#settings">检查连接</a>
        </p>
      ) : (
        <ActionList key={householdId} householdId={householdId} state={state} />
      )}
    </section>
  );
}
