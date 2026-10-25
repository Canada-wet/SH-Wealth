"use client";
import { useEffect, useState } from "react";
import { Bookmark, BookOpen } from "lucide-react";
import useWealth from "@/lib/useWealth";
import MarketNavigator from "@/app/components/MarketNavigator";
import { ModuleBridge } from "@/app/components/AppNavigation";
import PushSettings from "@/app/components/PushSettings";
import LearningScheduleControl from "@/app/components/LearningScheduleControl";
import {
  learningDisplayDay,
  learningUpdatesEnabled,
} from "@/lib/learning-schedule";
import {
  EMPTY_LEARNING,
  LESSONS,
  lessonArchive,
  lessonForDay,
  validLearningPreferences,
  type LearningPreferences,
} from "@/lib/learning";
import { torontoDay } from "@/lib/market-briefing";
type Delivery = { day: string; transport: string; status: string };
export default function Learn() {
  const store = useWealth();
  const [prefs, setPrefs] = useState<LearningPreferences>(EMPTY_LEARNING),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [retry, setRetry] = useState(0);
  const [day, setDay] = useState(""),
    [view, setView] = useState<"daily" | "favorites">("daily"),
    [query, setQuery] = useState(""),
    [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [today, setToday] = useState("");
  useEffect(() => {
    const change = () =>
      setView(location.hash === "#favorites" ? "favorites" : "daily");
    change();
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const changeView = (next: "daily" | "favorites") => {
    setView(next);
    history.replaceState(
      null,
      "",
      next === "favorites" ? "#favorites" : "/learn",
    );
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  useEffect(() => {
    const update = () => setToday(torontoDay());
    update();
    const timer = setInterval(update, 60000);
    const wanted = new URLSearchParams(location.search).get("day");
    if (wanted) setDay(wanted);
    return () => {
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    setLoaded(false);
    if (!store.cloudHousehold || store.cloudLoading) return;
    const c = new AbortController();
    const timer = setTimeout(() => {
      setError("收藏读取超时，请重试；未清空已有收藏。");
      c.abort();
    }, 20000);
    void fetch(
      `/api/learning?household=${encodeURIComponent(store.cloudHousehold)}`,
      { cache: "no-store", signal: c.signal },
    )
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw Error(body.error || "收藏读取失败");
        if (!validLearningPreferences(body.preferences))
          throw Error("收藏数据格式异常，未覆盖现有内容。");
        setPrefs(body.preferences);
        setDeliveries(body.deliveries ?? []);
        setLoaded(true);
        setError("");
      })
      .finally(() => clearTimeout(timer))
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [store.cloudHousehold, store.cloudLoading, retry]);
  const save = async (next: LearningPreferences) => {
    if (!loaded || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const c = new AbortController(),
      timer = setTimeout(() => c.abort(), 20000);
    try {
      const r = await fetch("/api/learning", {
        signal: c.signal,
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          household: store.cloudHousehold,
          preferences: next,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw Error(body.error || "尚未保存");
      if (!validLearningPreferences(body.preferences))
        throw Error("保存确认异常，请重新读取核对。");
      setPrefs(body.preferences);
      setNotice("已保存到本人云端收藏与提醒偏好。");
    } catch (e) {
      if (c.signal.aborted) {
        setLoaded(false);
        setError("未收到保存确认，请重新读取核对；不要反复提交。");
      } else setError(e instanceof Error ? e.message : "未保存");
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  };
  const archive = today
    ? lessonArchive(new Date(`${today}T16:00:00Z`), 120)
    : [];
  const currentDay = today
    ? learningDisplayDay(store.state.preferences.learningSchedule, today)
    : "";
  if (
    currentDay &&
    lessonForDay(currentDay) &&
    !archive.some((r) => r.day === currentDay)
  )
    archive.push({ day: currentDay, lesson: lessonForDay(currentDay)! });
  const automatic = learningUpdatesEnabled(
    store.state.preferences.learningSchedule,
  );
  const selected = day || currentDay;
  const lesson = archive.some((r) => r.day === selected)
    ? lessonForDay(selected)
    : null;
  const favorites = LESSONS.filter(
    (l) =>
      prefs.favorites.includes(l.id) &&
      `${l.title} ${l.model}`.toLowerCase().includes(query.toLowerCase()),
  );
  const card = (l: (typeof LESSONS)[number]) => (
    <article
      className="card lesson-card"
      key={l.id}
      aria-label={`心理学卡片：${l.model}`}
    >
      <div className="section-head">
        <div>
          <span className="lesson-model">{l.model}</span>
          <h2>{l.title}</h2>
          <p>{l.research}</p>
        </div>
        <button
          className="secondary"
          disabled={!loaded || busy}
          aria-pressed={prefs.favorites.includes(l.id)}
          onClick={() =>
            void save({
              ...prefs,
              favorites: prefs.favorites.includes(l.id)
                ? prefs.favorites.filter((id) => id !== l.id)
                : [...prefs.favorites, l.id],
            })
          }
        >
          <Bookmark size={16} />
          {prefs.favorites.includes(l.id) ? "取消收藏" : "收藏卡片"}
        </button>
      </div>
      <p className="lesson-finding">{l.finding}</p>
      <div className="lesson-applications">
        {[
          ["投资决策", l.investment],
          ["工作协作", l.work],
          ["共同生活", l.life],
        ].map(([title, text]) => (
          <div key={title}>
            <h3>{title}</h3>
            <p>{text}</p>
          </div>
        ))}
      </div>
      <div className="lesson-exercise">
        <b>今天的一分钟练习</b>
        <p>{l.exercise}</p>
      </div>
      <details>
        <summary>研究来源与适用边界</summary>
        <p>{l.limit}</p>
        <a href={l.source} target="_blank" rel="noopener noreferrer">
          阅读原始研究 / 作者讲座 ↗
        </a>
        <p>
          应用举例为编辑推演，不是原研究验证的投资策略、收益保证或心理治疗。
        </p>
      </details>
      <a
        className="text-button"
        href="/#overview"
        onClick={() => {
          try {
            sessionStorage.setItem(
              "together-advisor-intent",
              `只讨论、不修改数据。用「${l.model}」帮助我设计一个本周可控的决策练习，区分研究发现与应用推演；不要据此推荐买卖。来源：${l.source}`,
            );
          } catch {}
        }}
      >
        和顾问讨论如何实践 →
      </a>
    </article>
  );
  return (
    <main className="market-shell">
      <MarketNavigator active="learn" />
      <div
        className="markets-page learning-page"
        id="page-content"
        tabIndex={-1}
      >
        <header className="markets-header">
          <div>
            <p className="eyebrow">ONE IDEA · BETTER DECISIONS</p>
            <h1>
              <BookOpen size={26} /> 每日决策心理学
            </h1>
            <p>
              少一点冲动，多一点好决策。每天一则有来源的模型，用于投资、工作和共同生活。
            </p>
          </div>
          <span>{today} · Toronto</span>
        </header>
        <ModuleBridge featureId="learn" />
        <LearningScheduleControl
          state={store.state}
          ready={
            store.ready &&
            !store.cloudLoading &&
            !store.cloudChoice &&
            !!store.cloudHousehold
          }
          syncStatus={store.cloudStatus}
          error={store.error}
          onChange={(fn, reason) => store.commit(fn, reason, false)}
          onChanged={() => {
            setDay("");
            // Clear a stale day deep link without taking the user out of favorites.
            history.replaceState(
              null,
              "",
              view === "favorites" ? "/learn#favorites" : "/learn",
            );
          }}
        />
        <div className="learning-toolbar">
          <div role="group" aria-label="心理学视图">
            <button
              className="secondary"
              aria-pressed={view === "daily"}
              onClick={() => changeView("daily")}
            >
              每日与回看
            </button>
            <button
              className="secondary"
              aria-pressed={view === "favorites"}
              onClick={() => changeView("favorites")}
            >
              我的收藏（{loaded ? prefs.favorites.length : "…"}）
            </button>
          </div>
          {view === "daily" ? (
            <label>
              回看日期
              <select
                aria-label="心理学回看日期"
                value={selected}
                onChange={(e) => setDay(e.target.value)}
              >
                {archive.map((r) => (
                  <option key={r.day} value={r.day}>
                    {r.day} · {r.lesson.model}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              搜索收藏
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="模型或标题"
              />
            </label>
          )}
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}{" "}
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setNotice("");
                setRetry((n) => n + 1);
              }}
            >
              重新读取收藏
            </button>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        {view === "daily" ? (
          lesson ? (
            card(lesson)
          ) : (
            <section className="card">
              <p>
                这一天不在可回看范围内（最近 120
                天、不早于上线日）；不提前显示未来内容。
              </p>
              <button className="secondary" onClick={() => setDay("")}>
                回到当前卡片
              </button>
            </section>
          )
        ) : !loaded ? (
          <p>正在读取本人收藏…</p>
        ) : favorites.length ? (
          favorites.map(card)
        ) : (
          <section className="card">
            <p>
              {query
                ? "没有匹配收藏。"
                : "还没有收藏。每日卡片点击收藏后，可在这里继续回看。"}
            </p>
          </section>
        )}
        <section className="card learning-subscription">
          <h2>每天提醒我</h2>
          {!automatic && (
            <p className="learning-paused-note">
              家庭自动更新已暂停，定时任务不会发送这组提醒。重新开启更新后，也仅向仍有个人订阅的成员发送；你可以在下面关闭个人订阅。
            </p>
          )}
          <p>
            本人单独订阅。每天 15:00 UTC（多伦多夏令时 11:00 / 冬令时
            10:00，Vercel
            调度可能延后）投递当日精选；无可用渠道时仍可在站内阅读。首次启用从下一次定时任务开始，不补发旧通知。
          </p>
          <button
            className="secondary"
            disabled={!loaded || busy || (!automatic && !prefs.daily)}
            aria-pressed={prefs.daily}
            onClick={() => void save({ ...prefs, daily: !prefs.daily })}
          >
            {prefs.daily ? "关闭我的每日提醒" : "订阅我的每日提醒"}
          </button>
          <p>
            通过本人已启用的浏览器通知、Email / Telegram
            渠道发送；渠道配置与订阅是两件事。WhatsApp
            暂无该类模板，不发送每日学习消息。
          </p>
          <PushSettings householdId={store.cloudHousehold} />
          <a className="text-button" href="/#overview">
            回到首页「通知 → 消息渠道」配置 Email / Telegram →
          </a>
          <details>
            <summary>最近投递状态</summary>
            {deliveries.length ? (
              deliveries.map((r, i) => (
                <p key={i}>
                  {r.day} · {r.transport} ·{" "}
                  {(
                    {
                      accepted: "平台已接受（不代表已阅读）",
                      failed: "平台拒绝，未自动重发",
                      uncertain: "结果不确定，未自动重发",
                      sending: "已认领 / 结果待确认，不自动重发",
                    } as Record<string, string>
                  )[r.status] ?? "未知"}
                </p>
              ))
            ) : (
              <p>尚无本人投递记录。刷新页面可核对最新状态。</p>
            )}
          </details>
        </section>
        <p className="muted">
          精选库 v1 · 8
          个模型按多伦多日期循环复习，不是每日新发表论文。历史日期与卡片映射固定；回看提供最近
          120 天（不早于上线日）。收藏和提醒按本人账号与家庭隔离存于
          Supabase，不包含在共同账本 JSON 备份中。
          家庭自动更新开关独立保存在共同设置中，并包含在家庭备份内。
        </p>
      </div>
    </main>
  );
}
