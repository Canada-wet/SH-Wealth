"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  Clock3,
  Eye,
  EyeOff,
  Globe2,
  Headphones,
  LayoutGrid,
  MessagesSquare,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import useWealth from "@/lib/useWealth";
import { money } from "@/lib/wealth";
import { homeSnapshot } from "@/lib/home-space";
import { todayToronto } from "@/lib/household-workspace";
import { lessonForDay } from "@/lib/learning";
import { continueFeatures } from "@/lib/navigation";
import { useNavigation } from "../components/NavigationProvider";
import MarketNavigator from "../components/MarketNavigator";
import ActionCenter from "../components/ActionCenter";
import "./space.css";

const spaces = [
  {
    title: "家庭财富",
    icon: WalletCards,
    href: "/#overview",
    label: "把钱安排明白",
    description: "同一份账本，连接资产、现金流、目标和季度复盘。",
    links: [
      ["盘点资产", "/#assets"],
      ["安排增长", "/#growth"],
    ],
  },
  {
    title: "市场投资",
    icon: Globe2,
    href: "/markets",
    label: "把信息变成判断",
    description: "市场事实与家庭敞口分开呈现，再看它们如何相互影响。",
    links: [
      ["每日简报", "/markets#market-intelligence"],
      ["家庭敞口", "/markets#market-wealth"],
    ],
  },
  {
    title: "思考与成长",
    icon: MessagesSquare,
    href: "/council",
    label: "给重要决定多一点视角",
    description: "让观点接受质询，也用研究模型理解工作、投资与生活。",
    links: [
      ["深入研讨", "/council"],
      ["每日心理学", "/learn"],
    ],
  },
  {
    title: "兴趣与生活",
    icon: Headphones,
    href: "/lifestyle",
    label: "为喜欢的事留点时间",
    description: "从曲库到编排，再到属于自己的练习；不把生活只过成任务。",
    links: [
      ["我的曲库", "/lifestyle#library"],
      ["Set 编排", "/lifestyle#sets"],
    ],
  },
] as const;

export default function FamilySpace() {
  const store = useWealth(),
    nav = useNavigation();
  const [privacy, setPrivacy] = useState(true),
    [privacyReady, setPrivacyReady] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    try {
      setPrivacy(sessionStorage.getItem("together-privacy") === "on");
    } catch {
      setPrivacy(true);
    }
    setPrivacyReady(true);
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 60000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, []);
  const state = store.state;
  const loaded = store.ready && !store.cloudLoading;
  const showPrivate = loaded && privacyReady && !privacy;
  const statusProblem = !!store.error || !!store.cloudChoice;
  const visible = showPrivate && !statusProblem;
  const placeholder = !loaded
    ? "读取中"
    : privacy
      ? "••••••"
      : store.cloudChoice
        ? "待确认版本"
        : store.error
          ? "待重新连接"
          : "••••••";
  const snapshot = homeSnapshot(state, now ?? new Date());
  const financialDate =
    snapshot.financialAt && Number.isFinite(Date.parse(snapshot.financialAt))
      ? new Intl.DateTimeFormat("zh-CN", {
          timeZone: "America/Toronto",
          year: "numeric",
          month: "short",
          day: "numeric",
        }).format(new Date(snapshot.financialAt))
      : null;
  const recent = continueFeatures(nav.entries, 3);
  const lesson = now ? lessonForDay(todayToronto(now)) : null;
  return (
    <main>
      <MarketNavigator active="space" />
      <section className="content space-page" id="page-content" tabIndex={-1}>
        <header className="space-heading">
          <div>
            <p className="eyebrow">TOGETHER / EVERYDAY LIFE</p>
            <h1>把今天，留给真正重要的事。</h1>
            <p className="space-intro">
              {visible
                ? `${state.members.first} & ${state.members.second} 的共同空间。`
                : "一个私密的家庭空间。"}
              财富有计划，生活有余地。
            </p>
          </div>
          <div className="space-heading-tools">
            <span>
              <CalendarDays size={15} />
              {now
                ? new Intl.DateTimeFormat("zh-CN", {
                    timeZone: "America/Toronto",
                    month: "long",
                    day: "numeric",
                    weekday: "short",
                  }).format(now)
                : "多伦多时间"}
            </span>
            <button
              className="icon-button"
              aria-label={privacy ? "显示家庭数据" : "隐藏家庭数据"}
              disabled={!privacyReady}
              onClick={() => {
                const next = !privacy;
                setPrivacy(next);
                try {
                  sessionStorage.setItem(
                    "together-privacy",
                    next ? "on" : "off",
                  );
                } catch {}
              }}
            >
              {privacy ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
          </div>
        </header>

        <div
          className={`space-trust ${statusProblem ? "needs-attention" : ""}`}
          role="status"
        >
          <span>
            {statusProblem ? <ShieldCheck size={16} /> : <Check size={16} />}
            {!loaded
              ? "正在读取家庭记录…"
              : store.cloudChoice
                ? "本机与云端有不同版本，先确认数据来源"
                : store.cloudStatus}
          </span>
          <a href="/#settings">
            {statusProblem ? "检查数据与同步" : "数据与隐私"}
            <ArrowUpRight size={13} />
          </a>
        </div>
        {store.error && (
          <p className="space-error" role="alert">
            {store.error} <a href="/#settings">查看保留的数据</a>
          </p>
        )}

        <section className="space-snapshot" aria-label="家庭状态摘要">
          <a href="/#overview" className="space-metric is-wealth">
            <span>
              <WalletCards size={16} />
              账面净资产 <small>CAD</small>
            </span>
            <strong>
              {visible
                ? snapshot.hasLedger
                  ? money(snapshot.netWorth)
                  : "尚未盘点"
                : placeholder}
            </strong>
            <small>
              来自家庭账本，非实时市值 <ArrowUpRight size={13} />
            </small>
            {visible && snapshot.hasLedger && (
              <small className="space-financial-date">
                {financialDate
                  ? `最近财务快照：${financialDate}`
                  : "尚无财务快照，估值日期请逐项核对"}
              </small>
            )}
          </a>
          <a href="/#cashflow" className="space-metric">
            <span>
              每月可留存 <small>CAD</small>
            </span>
            <strong>
              {visible
                ? snapshot.monthlySurplus === null
                  ? "待补齐收支"
                  : money(snapshot.monthlySurplus)
                : placeholder}
            </strong>
            <small>
              已记录收支的估算，非实际储蓄 <ArrowUpRight size={13} />
            </small>
          </a>
          <a href="/lifestyle#practice" className="space-metric">
            <span>
              <Headphones size={16} />
              为喜欢的事留时间
            </span>
            <strong>
              {visible
                ? snapshot.practices
                  ? `${snapshot.practiceMinutes} 分钟`
                  : "从一次练习开始"
                : placeholder}
            </strong>
            <small>
              {visible
                ? `累计 ${snapshot.practices} 次已记录练习`
                : "你的曲库、编排和练习"}{" "}
              <ArrowUpRight size={13} />
            </small>
          </a>
        </section>

        <div className="space-today-grid">
          <section className="space-card space-next" aria-label="家庭下一步">
            <div className="space-section-head">
              <div>
                <p className="space-kicker">SMALL STEPS, TOGETHER</p>
                <h2>先推进一小步。</h2>
              </div>
              <span>最多三件</span>
            </div>
            {!loaded ? (
              <p className="space-empty">等记录读取完成，再看需要关注的事。</p>
            ) : !showPrivate ? (
              <div className="space-empty">
                <EyeOff size={22} />
                <p>家庭数据已隐藏</p>
                <small>恢复显示后，再看基于账本的提示。</small>
              </div>
            ) : statusProblem ? (
              <div className="space-empty">
                <ShieldCheck size={24} />
                <p>先把数据版本确认好。</p>
                <small>未把尚待同步的记录包装成最新家庭结论。</small>
                <a href="/#settings">
                  检查数据版本 <ArrowRight size={14} />
                </a>
              </div>
            ) : snapshot.actions.length ? (
              <div className="space-action-list">
                {snapshot.actions.map((action, i) => (
                  <a
                    href={action.href}
                    key={action.id}
                    className={`space-action ${action.attention ? "is-attention" : ""}`}
                  >
                    <span className="space-step">0{i + 1}</span>
                    <div>
                      <strong>{action.title}</strong>
                      <p>{action.detail}</p>
                      <small>{action.source}</small>
                    </div>
                    <ArrowUpRight size={17} />
                  </a>
                ))}
              </div>
            ) : (
              <div className="space-empty">
                <Check size={24} />
                <p>
                  {state.preferences.proactive === false
                    ? "按你的节奏来。"
                    : "目前没有新增的规则提示。"}
                </p>
                <small>
                  {state.preferences.proactive === false
                    ? "你已关闭主动提示，可以从常用空间继续。"
                    : "不代表数据已完全核验，也不需要为了清空清单而忙碌。"}
                </small>
                <a href="/#quarterly-review">
                  一起回顾计划 <ArrowRight size={14} />
                </a>
              </div>
            )}
            <p className="space-footnote">
              依据已保存记录整理，不是 AI 预测或实时市场建议。
            </p>
          </section>
          <section className="space-card space-continue" aria-label="继续使用">
            <div className="space-section-head">
              <div>
                <p className="space-kicker">PICK UP WHERE YOU LEFT OFF</p>
                <h2>接着上次。</h2>
              </div>
              <Clock3 size={18} />
            </div>
            {nav.ready && recent.length ? (
              recent.map((feature) => (
                <a
                  className="space-recent"
                  href={feature.href}
                  key={feature.id}
                >
                  <div>
                    <strong>{feature.title}</strong>
                    <small>{feature.group}</small>
                  </div>
                  <ArrowUpRight size={16} />
                </a>
              ))
            ) : (
              <p className="space-empty">
                {nav.error
                  ? "最近使用暂未同步；所有空间仍可打开。"
                  : nav.ready
                    ? "还没有浏览记录。选一个空间，从这里开始。"
                    : "正在读取个人最近使用…"}
              </p>
            )}
            <button
              className="space-search-all"
              onClick={() =>
                window.dispatchEvent(new Event("together-navigation-search"))
              }
            >
              <LayoutGrid size={16} />
              搜索全部功能
              <ArrowRight size={15} />
            </button>
            <small className="space-footnote">
              只记录你打开的功能，不保存搜索词。
            </small>
          </section>
        </div>

        <section className="space-domains" aria-label="家庭生活空间">
          <div className="space-section-head">
            <div>
              <p className="space-kicker">A PLACE FOR EVERY PART OF LIFE</p>
              <h2>各有空间，也彼此相连。</h2>
            </div>
          </div>
          <div className="space-domain-grid">
            {spaces.map((space) => (
              <article className="space-domain" key={space.title}>
                <a className="space-domain-heading" href={space.href}>
                  <span>
                    <space.icon size={23} />
                  </span>
                  <div>
                    <small>{space.label}</small>
                    <h3>{space.title}</h3>
                  </div>
                  <ArrowUpRight size={18} />
                </a>
                <p>{space.description}</p>
                <div>
                  {space.links.map(([title, href]) => (
                    <a href={href} key={href}>
                      {title}
                      <ArrowRight size={13} />
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <ActionCenter
          householdId={store.cloudHousehold}
          state={state}
          hidden={!visible}
        />

        {lesson && (
          <section className="space-lesson" aria-label="今日思考模型">
            <span className="space-lesson-icon">
              <BookOpen size={24} />
            </span>
            <div>
              <p className="space-kicker">
                每天一点新视角 · 研究精选，不是今日新发表论文
              </p>
              <h2>{lesson.title}</h2>
              <p>{lesson.finding}</p>
              <small>{lesson.research}</small>
            </div>
            <a href="/learn">
              阅读与收藏
              <ArrowUpRight size={15} />
            </a>
          </section>
        )}
        <footer className="space-footer">
          <ShieldCheck size={14} />
          <span>
            家庭记录共同维护；研讨、收藏与常用导航按各自账号保存。首页不会自动调用付费模型。
          </span>
        </footer>
      </section>
    </main>
  );
}
