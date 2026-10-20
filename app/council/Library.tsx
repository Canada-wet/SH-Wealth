"use client";
import { useEffect, useState } from "react";
import {
  Archive,
  Bookmark,
  CalendarClock,
  Search,
  SlidersHorizontal,
  X,
  RefreshCw,
} from "lucide-react";
import { councilExcerpt } from "@/lib/council-results";
import {
  COUNCIL_STATUS,
  legacyCouncilItem,
  selectCouncilLibrary,
  type CouncilLibraryItem,
  type LibraryScope,
  type LibrarySort,
} from "@/lib/council-library";
import type useCouncilLibrary from "@/lib/useCouncilLibrary";
import { todayToronto } from "@/lib/household-workspace";
type LibraryStore = ReturnType<typeof useCouncilLibrary>;
export default function Library({
  store,
  legacy,
  selected,
  disabled,
  open,
}: {
  store: LibraryStore;
  legacy: Parameters<typeof legacyCouncilItem>[0][];
  selected: string;
  disabled: boolean;
  open: (item: CouncilLibraryItem) => void;
}) {
  const [scope, setScope] = useState<LibraryScope>("inbox"),
    [status, setStatus] = useState("all"),
    [model, setModel] = useState(""),
    [sort, setSort] = useState<LibrarySort>("recent"),
    [filters, setFilters] = useState(false),
    [expanded, setExpanded] = useState(false),
    [limit, setLimit] = useState(20);
  const today = todayToronto(new Date());
  const items = store.ready
    ? store.items
    : legacy
        .map(legacyCouncilItem)
        .map((x) => ({
          ...x,
          matched:
            !store.query ||
            x.question
              .toLocaleLowerCase()
              .includes(store.query.trim().toLocaleLowerCase()),
        }));
  const scopes: [LibraryScope, string, number][] = [
    ["inbox", "全部", items.filter((x) => !x.memo.archived).length],
    [
      "pinned",
      "已置顶",
      items.filter((x) => !x.memo.archived && x.memo.pinned).length,
    ],
    [
      "review",
      "待复核",
      items.filter(
        (x) => !x.memo.archived && x.memo.reviewOn && x.memo.reviewOn <= today,
      ).length,
    ],
    ["archive", "已归档", items.filter((x) => x.memo.archived).length],
  ];
  const visible = selectCouncilLibrary(items, {
    scope,
    status,
    model,
    sort,
    today,
  });
  const models = [...new Set(items.flatMap((x) => x.models))].sort();
  useEffect(() => setLimit(20), [scope, status, model, sort, store.query]);
  const reset = () => {
    setScope("inbox");
    setStatus("all");
    setModel("");
    store.setQuery("");
    setSort("recent");
  };
  return (
    <aside
      className={`council-history council-library${expanded ? " is-expanded" : ""}`}
      aria-label="我的研讨历史"
    >
      <div className="council-library-heading">
        <div>
          <p className="eyebrow">YOUR THINKING LIBRARY</p>
          <h2>
            我的研讨库{" "}
            <span>
              {items.length}
              <small>/100</small>
            </span>
          </h2>
        </div>
        <button
          className="council-library-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((x) => !x)}
        >
          {expanded ? "收起历史" : "查看历史"}
        </button>
      </div>
      <div className="council-library-body">
        <label className="council-library-search">
          <Search size={16} />
          <span className="sr-only">搜索研讨历史</span>
          <input
            type="search"
            value={store.query}
            maxLength={120}
            placeholder="搜索问题、发言、笔记…"
            onChange={(e) => store.setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") store.setQuery("");
            }}
          />
          {store.query && (
            <button
              aria-label="清空研讨搜索"
              onClick={() => store.setQuery("")}
            >
              <X size={15} />
            </button>
          )}
        </label>
        <p className="council-library-help">
          {store.ready
            ? "多个词用空格分隔，需全部匹配；不搜索附件。"
            : "整理服务未就绪时，仅能搜索原问题。"}
        </p>
        <nav className="council-library-scopes" aria-label="研讨库分类">
          {scopes.map(([key, label, count]) => (
            <button
              key={key}
              aria-pressed={scope === key}
              onClick={() => setScope(key)}
            >
              {key === "pinned" ? (
                <Bookmark size={14} />
              ) : key === "review" ? (
                <CalendarClock size={14} />
              ) : key === "archive" ? (
                <Archive size={14} />
              ) : null}
              {label}
              <span>{count}</span>
            </button>
          ))}
        </nav>
        <div className="council-library-tools">
          <button onClick={() => setFilters((x) => !x)} aria-expanded={filters}>
            <SlidersHorizontal size={14} />
            筛选{status !== "all" || model ? " · 已启用" : ""}
          </button>
          <label>
            <span className="sr-only">历史排序</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as LibrarySort)}
            >
              <option value="recent">最近讨论优先</option>
              <option value="oldest">最早讨论优先</option>
              <option value="title">按标题排序</option>
            </select>
          </label>
          <button
            aria-label="刷新研讨库"
            disabled={store.loading}
            onClick={() => void store.refresh()}
          >
            <RefreshCw size={15} />
          </button>
        </div>
        {filters && (
          <div className="council-library-filters">
            <label>
              执行状态
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">所有状态</option>
                {Object.entries(COUNCIL_STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              参与模型
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">所有模型</option>
                {models.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        {store.error && (
          <p className="council-library-error" role="status">
            {store.error} 原历史入口仍保留；未把整理信息假装保存到本机。
          </p>
        )}
        <div className="council-library-count" aria-live="polite">
          {store.searching
            ? "正在检索…"
            : `${visible.length} 场${store.query ? "匹配" : "研讨"}`}
          {(scope !== "inbox" || status !== "all" || model || store.query) && (
            <button onClick={reset}>重置</button>
          )}
        </div>
        <div className="council-library-list" aria-busy={store.loading}>
          {!visible.length && !store.loading && (
            <div className="council-history-empty">
              {items.length
                ? "没有符合条件的研讨。试试更短的关键词，或重置筛选。"
                : "从一个值得认真思考的问题开始。结束后可留下判断、安排复核。"}
            </div>
          )}
          {visible.slice(0, limit).map((item) => (
            <button
              key={item.id}
              className={`council-library-item${selected === item.id ? " selected" : ""}`}
              disabled={disabled || (store.ready && store.searching)}
              aria-current={selected === item.id ? "page" : undefined}
              onClick={() => {
                open(item);
                setExpanded(false);
              }}
            >
              <div className="council-library-item-top">
                <span className={`council-library-status ${item.status}`}>
                  {COUNCIL_STATUS[item.status]}
                </span>
                {item.memo.pinned && <Bookmark size={13} aria-label="已置顶" />}
                {item.memo.reviewOn && item.memo.reviewOn <= today && (
                  <span className="council-library-due">待复核</span>
                )}
              </div>
              <strong>{item.memo.title || item.question}</strong>
              {(item.matchExcerpt || item.memo.note || item.excerpt) && (
                <p>
                  {councilExcerpt(
                    item.matchExcerpt || item.memo.note || item.excerpt,
                    110,
                  )}
                </p>
              )}
              {!!item.memo.tags.length && (
                <span className="council-library-tags">
                  {item.memo.tags.map((t) => (
                    <span key={t}>#{t}</span>
                  ))}
                </span>
              )}
              <small>
                {new Date(item.activityAt).toLocaleDateString("zh-CN", {
                  timeZone: "America/Toronto",
                  month: "short",
                  day: "numeric",
                })}
                {item.rounds ? ` · ${item.rounds} 次追问` : ""}
                {store.query && item.matchRound !== null
                  ? ` · 命中${item.matchRound ? `追问 ${item.matchRound}` : "原始研讨"}正文`
                  : ""}
              </small>
            </button>
          ))}
          {visible.length > limit && (
            <button
              className="council-library-more"
              onClick={() => setLimit((n) => n + 20)}
            >
              再显示 20 场（还有 {visible.length - limit} 场）
            </button>
          )}
        </div>
        <p className="council-library-help">
          置顶始终优先 · 归档可恢复，不等于删除或释放容量。
        </p>
      </div>
    </aside>
  );
}
