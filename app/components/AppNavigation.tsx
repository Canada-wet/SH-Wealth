"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Search,
  Pin,
  X,
  Home,
  WalletCards,
  Target,
  Users,
  Landmark,
  CalendarCheck,
  Globe2,
  ChartNoAxesCombined,
  Link2,
  History,
  MessagesSquare,
  BookOpen,
  Headphones,
  Music2,
  Sparkles,
  Database,
  Bell,
  ArrowUpRight,
  LayoutGrid,
  Clock3,
  ChevronDown,
} from "lucide-react";
import {
  FEATURES,
  NAV_GROUPS,
  orderedFeatures,
  searchFeatures,
  featureById,
  relatedFeatures,
  recentTime,
  spaceFeatures,
  navigationSpaceId,
  type Feature,
  type NavGroup,
} from "@/lib/navigation";
import { APP_VERSION } from "@/lib/releases";
import { useNavigation } from "./NavigationProvider";
const icons = {
  home: Home,
  wallet: WalletCards,
  cash: WalletCards,
  target: Target,
  users: Users,
  plan: Landmark,
  review: CalendarCheck,
  globe: Globe2,
  chart: ChartNoAxesCombined,
  link: Link2,
  history: History,
  messages: MessagesSquare,
  book: BookOpen,
  headphones: Headphones,
  music: Music2,
  sparkles: Sparkles,
  database: Database,
  bell: Bell,
};
function FeatureIcon({
  feature,
  size = 18,
}: {
  feature: Feature;
  size?: number;
}) {
  const Icon = icons[feature.icon as keyof typeof icons] || LayoutGrid;
  return <Icon size={size} aria-hidden="true" />;
}
const openSearch = () =>
  window.dispatchEvent(new Event("together-navigation-search"));
const revisit = (feature: Feature) => {
  // A collapsed advisor can be reopened even when its hash has not changed.
  if (
    feature.id === "advisor" &&
    location.pathname === "/" &&
    location.hash === "#advisor"
  )
    window.dispatchEvent(new Event("together-open-advisor"));
};
function PinButton({ feature }: { feature: Feature }) {
  const nav = useNavigation(),
    pinned = !!nav.entries.find((r) => r.feature_id === feature.id)?.pinned;
  return (
    <button
      type="button"
      className={`app-pin ${pinned ? "is-pinned" : ""}`}
      aria-label={`${pinned ? "取消置顶" : "置顶"}${feature.title}`}
      aria-pressed={pinned}
      disabled={!nav.ready || nav.busy}
      onClick={() => void nav.pin(feature.id, !pinned)}
      title={nav.ready ? "按个人账号保存到云端" : "正在连接个人导航"}
    >
      <Pin size={15} />
    </button>
  );
}
function NavigationSearch({
  close,
  footer,
  restoreFocus,
}: {
  close: () => void;
  footer?: ReactNode;
  restoreFocus: HTMLElement | null;
}) {
  const nav = useNavigation(),
    [query, setQuery] = useState(""),
    [group, setGroup] = useState<NavGroup | undefined>(),
    [selected, setSelected] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null),
    list = useRef<HTMLDivElement>(null),
    composing = useRef(false);
  const results = searchFeatures(query, nav.entries, group);
  useEffect(() => {
    const before = restoreFocus;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    setSelected(0);
    list.current?.scrollTo?.(0, 0);
  }, [query, group]);
  return (
    <dialog
      ref={dialog}
      className="app-command"
      aria-labelledby="app-command-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      <div className="app-command-heading">
        <div>
          <span>TOGETHER / YOUR SPACE</span>
          <h2 id="app-command-title">想去哪里？</h2>
        </div>
        <button
          className="icon-button"
          aria-label="关闭功能搜索"
          onClick={close}
        >
          <X size={19} />
        </button>
      </div>
      <label className="app-search-input">
        <Search size={20} />
        <input
          autoFocus
          type="search"
          placeholder="搜索页面、功能或关键词…"
          aria-label="搜索页面与功能"
          aria-controls="app-search-results"
          aria-describedby="app-search-selection"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(e) => {
            // Enter and arrows belong to the IME while choosing Chinese text.
            if (
              composing.current ||
              e.nativeEvent.isComposing ||
              e.nativeEvent.keyCode === 229
            )
              return;
            if (["ArrowDown", "ArrowUp"].includes(e.key)) {
              e.preventDefault();
              const next = Math.max(
                0,
                Math.min(
                  results.length - 1,
                  selected + (e.key === "ArrowDown" ? 1 : -1),
                ),
              );
              setSelected(next);
              list.current
                ?.querySelectorAll(".app-result")
                [next]?.scrollIntoView?.({ block: "nearest" });
            }
            if (e.key === "Enter" && results[selected]) {
              e.preventDefault();
              list.current
                ?.querySelectorAll<HTMLAnchorElement>(".app-result-link")
                [selected]?.click();
            }
          }}
        />
      </label>
      <div className="app-search-groups" role="group" aria-label="功能分类">
        <button aria-pressed={!group} onClick={() => setGroup(undefined)}>
          全部
        </button>
        {NAV_GROUPS.map((g) => (
          <button
            key={g}
            aria-pressed={group === g}
            onClick={() => setGroup(g)}
          >
            {g}
          </button>
        ))}
      </div>
      <div className="app-search-meta">
        <span>
          {query
            ? `找到 ${results.length} 个入口`
            : "置顶优先 · 其余按最近使用"}
        </span>
        <span>↑ ↓ 选择 · Enter 打开</span>
      </div>
      <p
        id="app-search-selection"
        className="app-visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {results[selected]
          ? `当前选择：${results[selected].title}，第 ${selected + 1} 项，共 ${results.length} 项。按回车打开，可用上下方向键选择。`
          : "没有匹配的功能入口。"}
      </p>
      <div
        id="app-search-results"
        className="app-search-results"
        ref={list}
        role="list"
        aria-label="功能搜索结果"
      >
        {results.map((f, i) => (
          <div
            key={f.id}
            role="listitem"
            className={`app-result ${i === selected ? "is-selected" : ""}`}
            onPointerEnter={() => setSelected(i)}
          >
            <a
              className="app-result-link"
              href={f.href}
              onClick={() => {
                revisit(f);
                close();
              }}
            >
              <span className="app-result-icon">
                <FeatureIcon feature={f} size={21} />
              </span>
              <span>
                <strong>{f.title}</strong>
                <small>{f.description}</small>
                <em>{f.group}</em>
              </span>
              <ArrowUpRight size={15} />
            </a>
            <PinButton feature={f} />
          </div>
        ))}
        {!results.length && (
          <div className="app-search-empty">
            <Search size={25} />
            <h3>没有找到这个入口</h3>
            <p>试试「汇率」「DJ」「备份」「CPI」或「语音」。</p>
            <button
              className="text-button"
              onClick={() => {
                setQuery("");
                setGroup(undefined);
              }}
            >
              查看全部功能
            </button>
          </div>
        )}
      </div>
      <footer className="app-search-footer">
        <span>
          {nav.error ||
            (nav.ready
              ? "仅保存页面使用与置顶，不搜索私人账本或聊天。"
              : "正在连接个人偏好；所有页面仍可打开。")}
        </span>
        {nav.error && (
          <button className="text-button" onClick={nav.refresh}>
            重新连接
          </button>
        )}
      </footer>
      {footer && (
        <div
          className="app-mobile-account"
          onClick={(e) => {
            const button = (e.target as HTMLElement).closest("button");
            // Keep async sign-out visible: errors must remain readable in this panel.
            if (button && !button.classList.contains("app-signout")) close();
          }}
        >
          {footer}
        </div>
      )}
    </dialog>
  );
}
export default function AppNavigation({
  active,
  footer,
}: {
  active?: string;
  footer?: ReactNode;
}) {
  const nav = useNavigation(),
    [search, setSearch] = useState(false);
  const searchOrigin = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const show = () => {
      if (!search) searchOrigin.current = document.activeElement as HTMLElement;
      setSearch(true);
    };
    const key = (e: KeyboardEvent) => {
      if (
        !e.isComposing &&
        e.keyCode !== 229 &&
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "k" &&
        (!document.querySelector("dialog[open]") || search)
      ) {
        e.preventDefault();
        if (!search)
          searchOrigin.current = document.activeElement as HTMLElement;
        setSearch((s) => !s);
      }
    };
    window.addEventListener("together-navigation-search", show);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("together-navigation-search", show);
      window.removeEventListener("keydown", key);
    };
  }, [search]);
  const pinned = orderedFeatures(
    FEATURES.filter((f) =>
      nav.entries.some((r) => r.feature_id === f.id && r.pinned),
    ),
    nav.entries,
  );
  const spaces = spaceFeatures(nav.entries);
  const wealthSections = [
    "overview",
    "assets",
    "cashflow",
    "growth",
    "contributions",
    "quarterly-review",
    "framework",
  ];
  const activeFeature = featureById(active || "");
  const current =
    activeFeature &&
    (navigationSpaceId(activeFeature.id) !== navigationSpaceId(nav.current) ||
      (wealthSections.includes(activeFeature.id) &&
        wealthSections.includes(nav.current)))
      ? activeFeature.id
      : featureById(nav.current)?.id || activeFeature?.id || "space";
  const space = navigationSpaceId(current);
  const wealth = wealthSections
    .filter((id) => id !== "overview")
    .map((id) => featureById(id)!)
    .filter(Boolean);
  const pinnedCurrent = pinned.some((f) => f.id === current);
  const shortcutItems = [
    ...pinned,
    ...spaces.filter((f) => !pinned.some((p) => p.id === f.id)),
  ].slice(0, 6);
  useEffect(() => {
    const before = document.title;
    document.title = `${featureById(current)?.title || "家庭空间"} · Together`;
    return () => {
      document.title = before;
    };
  }, [current]);
  const row = (f: Feature, section: "pinned" | "space" | "wealth") => (
    <div className="app-nav-row" key={f.id}>
      <a
        href={f.href}
        onClick={() => revisit(f)}
        className={
          section === "space" && space === f.id ? "is-active-space" : undefined
        }
        aria-current={
          current === f.id && (section === "pinned" || !pinnedCurrent)
            ? "page"
            : section === "space" && space === f.id && current !== f.id
              ? "location"
              : undefined
        }
      >
        <FeatureIcon feature={f} />
        <span>{f.title}</span>
      </a>
      {(section === "pinned" || !pinned.some((p) => p.id === f.id)) && (
        <PinButton feature={f} />
      )}
    </div>
  );
  return (
    <>
      <a className="app-skip" href="#page-content">
        跳至页面内容
      </a>
      <aside
        className="sidebar market-sidebar app-sidebar"
        aria-label="家庭空间导航"
      >
        <a className="brand" href="/space">
          <span>t</span>ogether<small>家庭 · 生活 · 成长</small>
        </a>
        <button
          className="app-search-trigger"
          aria-label="搜索页面与功能"
          onClick={openSearch}
        >
          <Search size={17} />
          <span>搜索页面与功能</span>
          <kbd>⌘ K</kbd>
        </button>
        <nav aria-label="主导航">
          <div className="app-nav-section">
            <h2>
              <Pin size={12} />
              置顶常用<span>{pinned.length}</span>
            </h2>
            {pinned.length ? (
              pinned.map((f) => row(f, "pinned"))
            ) : (
              <button className="app-pin-empty" onClick={openSearch}>
                把常用功能钉在这里 <span>+</span>
              </button>
            )}
          </div>
          <div className="app-nav-section app-space-navigation">
            <h2>
              <Clock3 size={12} />
              我的空间<span>最近使用排序</span>
            </h2>
            {spaces.map((f) => row(f, "space"))}
          </div>
          {space === "overview" && (
            <div className="app-nav-section app-wealth-navigation">
              <h2>
                <WalletCards size={12} />
                财富工作台
              </h2>
              {wealth.map((f) => row(f, "wealth"))}
            </div>
          )}
        </nav>
        <div className="sidebar-bottom app-sidebar-footer">
          <button className="app-all-features" onClick={openSearch}>
            <LayoutGrid size={16} />
            全部 {FEATURES.length} 个功能
            <ArrowUpRight size={14} />
          </button>
          {nav.error && (
            <button className="app-nav-warning" onClick={nav.refresh}>
              导航未同步 · 重新连接
            </button>
          )}
          {footer}
          <a className="version-link" href="/updates">
            Together v{APP_VERSION} · Admin
          </a>
        </div>
      </aside>
      <div className="app-mobile-bar">
        <a className="app-mobile-brand" href="/space">
          <b>t</b>ogether
        </a>
        <span>{featureById(current)?.title || "家庭空间"}</span>
        <button aria-label="打开页面与功能搜索" onClick={openSearch}>
          <Search size={17} />
          搜索 / 全部
        </button>
      </div>
      <nav className="app-mobile-shortcuts" aria-label="手机主导航">
        {shortcutItems.map((f) => (
          <a
            key={f.id}
            href={f.href}
            onClick={() => revisit(f)}
            aria-current={current === f.id ? "page" : undefined}
          >
            {f.title}
          </a>
        ))}
        <button onClick={openSearch}>全部功能</button>
      </nav>
      {search && (
        <NavigationSearch
          close={() => setSearch(false)}
          footer={footer}
          restoreFocus={searchOrigin.current}
        />
      )}
    </>
  );
}
export function WorkspaceHub() {
  const nav = useNavigation();
  const used = orderedFeatures(
    FEATURES.filter(
      (f) =>
        nav.entries.some((r) => r.feature_id === f.id && r.pinned) ||
        (f.primary && recentTime(f, nav.entries) > 0),
    ),
    nav.entries,
  );
  const starter = [
    "overview",
    "markets",
    "council",
    "lifestyle",
    "learn",
    "cashflow",
  ].map((id) => featureById(id)!);
  const choices = [
    ...used,
    ...starter.filter((f) => !used.some((u) => u.id === f.id)),
  ].slice(0, 6);
  return (
    <section className="app-workspace-hub" aria-label="我的家庭工作台">
      <div className="app-hub-heading">
        <div>
          <span>YOUR EVERYDAY, CONNECTED</span>
          <h2>你的常用，从这里继续。</h2>
          <p>财富有计划，生活有余地。先置顶，再按最近使用排列。</p>
        </div>
        <button className="secondary" onClick={openSearch}>
          <LayoutGrid size={15} />
          探索全部功能
        </button>
      </div>
      <div className="app-hub-grid">
        {choices.map((f) => (
          <div className="app-hub-item" key={f.id}>
            <a href={f.href} onClick={() => revisit(f)}>
              <FeatureIcon feature={f} />
              <span>
                <b>{f.title}</b>
                <small>{f.group}</small>
              </span>
            </a>
            <PinButton feature={f} />
          </div>
        ))}
      </div>
    </section>
  );
}
export function ModuleBridge({ featureId }: { featureId: string }) {
  const links = relatedFeatures(featureId);
  return (
    <section className="app-module-bridge" aria-label="关联功能">
      <details>
        <summary>
          <Link2 size={14} aria-hidden="true" />
          关联功能
          <span>需要时，接着做</span>
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <div className="app-module-links">
          {links.map((f) => (
            <a href={f.href} key={f.id} onClick={() => revisit(f)}>
              <FeatureIcon feature={f} size={14} />
              <span>{f.title}</span>
              <ArrowUpRight size={12} />
            </a>
          ))}
        </div>
      </details>
    </section>
  );
}
