"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Bell,
  Check,
  Database,
  History,
  Landmark,
  LineChart,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Users,
  WalletCards,
  Eye,
  EyeOff,
} from "lucide-react";
import useWealth from "@/lib/useWealth";
import {
  breakdown,
  chartPoints,
  contributionSummary,
  deleteAsset,
  deleteContribution,
  id,
  money,
  numberInput,
  ownerLabel,
  saveAsset,
  saveContribution,
  totals,
  type Asset,
  type Contribution,
  type WealthState,
} from "@/lib/wealth";
import {
  applyAssistantActions,
  type AssistantAction,
} from "@/lib/advisor-actions";
import FinancialFramework from "./framework";
import FloatingAdvisor from "./components/FloatingAdvisor";
import Dialog from "./components/Dialog";
import DataSettings from "./components/DataSettings";
import CashflowTable from "./components/CashflowTable";
import HouseholdReview from "./components/HouseholdReview";
import PushSettings from "./components/PushSettings";
import { cloudClient } from "@/lib/cloud";
import { allowedEmail } from "@/lib/access";
import { proactiveInsights } from "@/lib/insights";
import WealthPulse from "./components/WealthPulse";
import AdvisorMarkdown from "./components/AdvisorMarkdown";
import ChannelSettings from "./components/ChannelSettings";
import { financialFingerprint } from "@/lib/advisor-preview";
import {
  LIQUIDITY,
  todayToronto,
  undoFinancial,
  undoPoint,
  type FinancialUndo,
} from "@/lib/household-workspace";
import ValuationTable from "./components/ValuationTable";
import HouseholdPlanning from "./components/HouseholdPlanning";
import HistoryComparison from "./components/HistoryComparison";

type Modal =
  | {
      kind: "asset" | "debt" | "contribution";
      id?: string;
      focusReturn?: boolean;
    }
  | {
      kind:
        "goal" | "members" | "history" | "alerts" | "settings" | "valuations";
    }
  | null;
export default function Home() {
  useEffect(() => {
    const client = cloudClient();
    if (!client) return;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (
        event === "SIGNED_OUT" ||
        (session && !allowedEmail(session.user.email))
      )
        window.location.replace("/login");
    });
    return () => subscription.unsubscribe();
  }, []);
  const store = useWealth();
  const { state, ready, commit } = store;
  const [modal, setModal] = useState<Modal>(null);
  const [notificationView, setNotificationView] = useState<
    "alerts" | "channels"
  >("alerts");
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");
  const [privacy, setPrivacy] = useState(false);
  const [undo, setUndo] = useState<FinancialUndo | null>(null);
  useEffect(() => {
    try {
      setPrivacy(sessionStorage.getItem("together-privacy") === "on");
    } catch {}
  }, []);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [assetSort, setAssetSort] = useState("original");
  const [activeSection, setActiveSection] = useState("overview");
  const editStamp = useRef("");
  const stamp = (current: WealthState) =>
    JSON.stringify({
      assets: current.assets,
      debts: current.debts,
      contributions: current.contributions,
      budget: current.budget,
      goal: current.goal,
      members: current.members,
    });
  const [cloudAlerts, setCloudAlerts] = useState<
    { id: string; title: string; body: string; prompt: string }[]
  >([]);
  const balance = useMemo(() => totals(state), [state]);
  const groups = useMemo(
    () => breakdown(state, state.preferences.allocation),
    [state],
  );
  const owners = useMemo(() => breakdown(state, "owner"), [state]);
  const contributions = useMemo(() => contributionSummary(state), [state]);
  const history = useMemo(
    () => chartPoints(state, state.preferences.months),
    [state],
  );
  const alerts = useMemo(
    () => [...proactiveInsights(state), ...cloudAlerts],
    [state, cloudAlerts],
  );
  const unreadInsights = proactiveInsights(state).filter(
    (row) => !state.readAlerts.includes(row.id),
  );
  useEffect(() => {
    if (!ready || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { rootMargin: "-5% 0px -65% 0px", threshold: 0 },
    );
    ["overview", "assets", "cashflow", "contributions", "framework"].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) observer.observe(el);
      },
    );
    return () => observer.disconnect();
  }, [ready, store.cloudLoading]);
  useEffect(() => {
    if (!store.cloudHousehold) {
      setCloudAlerts([]);
      return;
    }
    let active = true;
    const fetchAlerts = async () => {
      const client = cloudClient();
      if (!client || document.hidden) return;
      const result = await client
        .from("advisor_alerts")
        .select("id,title,body")
        .eq("household_id", store.cloudHousehold)
        .order("created_at", { ascending: false })
        .limit(12);
      if (active && result.data)
        setCloudAlerts(
          result.data.map((row) => ({
            ...row,
            prompt: `帮我们讨论这条提醒：${row.title}。${row.body}`,
          })),
        );
    };
    void fetchAlerts();
    const timer = setInterval(() => void fetchAlerts(), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [store.cloudHousehold]);
  const progress =
    state.goal.target > 0
      ? Math.max(0, Math.min((balance.netWorth / state.goal.target) * 100, 100))
      : 0;
  const assets = state.assets
    .filter(
      (asset) =>
        (!filter ||
          (state.preferences.allocation === "owner"
            ? asset.owner
            : asset.category) === filter) &&
        `${asset.name} ${asset.category} ${ownerLabel(asset.owner, state.members)}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      assetSort === "value-desc"
        ? b.value - a.value
        : assetSort === "name"
          ? a.name.localeCompare(b.name, "zh-CN")
          : assetSort === "return-desc"
            ? (b.annualReturn ?? -Infinity) - (a.annualReturn ?? -Infinity)
            : 0,
    );
  const filteredTotal = assets.reduce((sum, row) => sum + row.value, 0);
  const open = (next: Modal) => {
    if (privacy) return;
    editStamp.current = stamp(state);
    setFormError("");
    setModal(next);
  };
  const close = () => {
    setModal(null);
    setFormError("");
  };
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const change = (
    update: (state: WealthState) => WealthState,
    reason: string,
    financial = false,
    dismiss = false,
  ) => {
    try {
      let before: WealthState | undefined;
      const next = commit(
        (current) => {
          if (dismiss && editStamp.current !== stamp(current))
            throw new Error(
              "家庭数据已更新，请重新打开编辑，不覆盖伴侣的新记录。",
            );
          before = current;
          return update(current);
        },
        reason,
        financial,
      );
      if (financial && before) setUndo(undoPoint(before, next, reason));
      setToast("已保存");
      setFormError("");
      if (dismiss) close();
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "保存失败";
      setFormError(message);
      store.setError(message);
      return false;
    }
  };
  const onActions = (
    actions: AssistantAction[],
    expectedFinancial?: string,
  ) => {
    let before: WealthState | undefined;
    const next = commit(
      (current) => {
        before = current;
        if (
          expectedFinancial &&
          expectedFinancial !== financialFingerprint(current)
        )
          throw new Error(
            "家庭数据已有变化，未执行过期的顾问修改。请重新提问。",
          );
        return applyAssistantActions(current, actions);
      },
      "AI 更新家庭数据",
      actions.some((action) => action.type !== "set_plan_field"),
    );
    if (before) setUndo(undoPoint(before, next, "顾问修改"));
    setToast("顾问变更已保存");
    return next;
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    try {
      if (editStamp.current !== stamp(state))
        throw new Error(
          "家庭数据已在另一个页面更新，请关闭并重新打开编辑，避免覆盖最新记录。",
        );
      if (modal?.kind === "asset") {
        const asset: Asset = {
          ...state.assets.find((row) => row.id === modal.id),
          id: modal.id ?? id(),
          name: text("name"),
          owner: text("owner"),
          category: text("category"),
          value: numberInput(text("value"), "当前价值"),
          annualReturn:
            text("annualReturn") === ""
              ? null
              : numberInput(text("annualReturn"), "本年回报", true),
          valuationDate: text("valuationDate") || undefined,
          liquidity: (text("liquidity") || "unknown") as Asset["liquidity"],
          note: text("note"),
        };
        if (asset.valuationDate && asset.valuationDate > todayToronto())
          throw new Error("核对日期不能在未来。");
        change(
          (current) => saveAsset(current, asset),
          `${modal.id ? "修改" : "新增"}资产：${asset.name}`,
          true,
          true,
        );
      } else if (modal?.kind === "debt") {
        const debt = {
          ...state.debts.find((row) => row.id === modal.id),
          id: modal.id ?? id(),
          name: text("name"),
          owner: text("owner"),
          value: numberInput(text("value"), "负债余额"),
          annualRate: text("annualRate")
            ? numberInput(text("annualRate"), "年利率")
            : null,
          monthlyPayment: text("monthlyPayment")
            ? numberInput(text("monthlyPayment"), "月还款")
            : null,
        };
        change(
          (current) => ({
            ...current,
            debts: modal.id
              ? current.debts.map((row) => (row.id === modal.id ? debt : row))
              : [...current.debts, debt],
          }),
          `${modal.id ? "修改" : "新增"}负债：${debt.name}`,
          true,
          true,
        );
      } else if (modal?.kind === "contribution") {
        const contribution: Contribution = {
          id: modal.id ?? id(),
          member: text("member"),
          assetId: text("assetId") || null,
          amount: numberInput(text("amount"), "贡献金额"),
          kind: text("kind") as Contribution["kind"],
          date: text("date"),
          note: text("note"),
        };
        change(
          (current) => saveContribution(current, contribution),
          `${modal.id ? "修改" : "新增"}贡献记录`,
          true,
          true,
        );
      } else if (modal?.kind === "goal")
        change(
          (current) => ({
            ...current,
            goal: {
              name: text("name"),
              target: numberInput(text("target"), "目标金额"),
              year: text("year"),
            },
          }),
          "更新家庭目标",
          true,
          true,
        );
      else if (modal?.kind === "members")
        change(
          (current) => ({
            ...current,
            members: { first: text("first"), second: text("second") },
          }),
          "更新成员名称",
          false,
          true,
        );
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "请检查输入。");
    }
  };
  const remove = (
    kind: "asset" | "debt" | "contribution",
    rowId: string,
    name: string,
  ) => {
    if (
      !window.confirm(
        `删除「${name}」？历史快照会保留${kind === "contribution" ? "，关联账户的资金变动也会撤回" : ""}。`,
      )
    )
      return;
    change(
      (current) =>
        kind === "asset"
          ? deleteAsset(current, rowId)
          : kind === "contribution"
            ? deleteContribution(current, rowId)
            : {
                ...current,
                debts: current.debts.filter((row) => row.id !== rowId),
              },
      `删除${kind === "asset" ? "资产" : kind === "debt" ? "负债" : "贡献"}：${name}`,
      true,
    );
  };
  const options = (selected?: string) => (
    <>
      {[
        "joint",
        "first",
        "second",
        ...Array.from(new Set(state.assets.map((row) => row.owner))).filter(
          (owner) => !["joint", "first", "second"].includes(owner),
        ),
      ].map((owner) => (
        <option key={owner} value={owner}>
          {ownerLabel(owner, state.members)}
        </option>
      ))}
      {selected &&
        !state.assets.some((row) => row.owner === selected) &&
        !["joint", "first", "second"].includes(selected) && (
          <option value={selected}>{selected}</option>
        )}
    </>
  );
  const advisor = (prompt?: string) =>
    !privacy &&
    window.dispatchEvent(
      new CustomEvent("together-open-advisor", {
        detail: prompt
          ? `只做分析与讨论，不执行数据变更。\n${prompt}`
          : undefined,
      }),
    );
  if (!ready || (store.cloudLoading && !state.updatedAt))
    return <div className="loading-screen">正在读取家庭财富数据…</div>;
  return (
    <main>
      <aside className="sidebar">
        <a className="brand" href="#overview">
          <span>t</span>ogether
        </a>
        <nav>
          <a
            href="#overview"
            aria-current={activeSection === "overview" ? "location" : undefined}
          >
            <LineChart />
            全景
          </a>
          <a
            href="#assets"
            aria-current={activeSection === "assets" ? "location" : undefined}
          >
            <WalletCards />
            资产与负债
          </a>
          <a
            href="#cashflow"
            aria-current={activeSection === "cashflow" ? "location" : undefined}
          >
            <WalletCards />
            每月现金流
          </a>
          <a
            href="#contributions"
            aria-current={
              activeSection === "contributions" ? "location" : undefined
            }
          >
            <Users />
            成员贡献
          </a>
          <a
            href="#framework"
            aria-current={
              activeSection === "framework" ? "location" : undefined
            }
          >
            <Landmark />
            家庭计划
          </a>
          <button onClick={() => advisor()}>
            <Sparkles />
            财富顾问
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button
            className="data-nav"
            onClick={() => open({ kind: "settings" })}
          >
            <Database size={17} />
            数据与同步
          </button>
          <button className="people" onClick={() => open({ kind: "members" })}>
            <div className="avatars">
              <i>{state.members.first.slice(0, 1)}</i>
              <i>{state.members.second.slice(0, 1)}</i>
            </div>
            <div>
              <b>
                {state.members.first} & {state.members.second}
              </b>
              <small>共同空间 · 编辑名称</small>
            </div>
            <Pencil size={13} />
          </button>
        </div>
      </aside>
      <section className="content">
        <header id="overview">
          <div>
            <p className="eyebrow">TOGETHER · FAMILY WEALTH</p>
            <h1>家庭财富，一起掌握。</h1>
            <button
              className="save-status"
              onClick={() => open({ kind: "settings" })}
            >
              <Check size={13} />
              {store.cloudStatus}
              {state.updatedAt && (
                <span>
                  {" "}
                  ·{" "}
                  {new Date(state.updatedAt).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
            </button>
          </div>
          <div className="header-actions">
            <button
              className="icon-button"
              aria-label={privacy ? "显示家庭数据" : "隐藏家庭数据"}
              onClick={() => {
                const next = !privacy;
                setPrivacy(next);
                close();
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
            <button
              className="icon-button notification-button"
              aria-label="通知"
              onClick={() => open({ kind: "alerts" })}
            >
              <Bell size={19} />
              {state.preferences.proactive !== false &&
                alerts.some((row) => !state.readAlerts.includes(row.id)) && (
                  <i />
                )}
            </button>
            <button className="primary" onClick={() => open({ kind: "asset" })}>
              <Plus size={16} />
              添加资产
            </button>
          </div>
        </header>
        {store.error && (
          <div className="error-banner" role="alert">
            <span>{store.error}</span>
            <button onClick={() => open({ kind: "settings" })}>
              查看数据设置
            </button>
          </div>
        )}
        {store.cloudChoice && (
          <div className="error-banner" role="alert">
            <span>
              发现本机与云端两份不同数据，尚未覆盖。请选择家庭共享版本。
            </span>
            <button onClick={() => open({ kind: "settings" })}>
              选择数据版本
            </button>
          </div>
        )}
        {privacy && (
          <div className="privacy-curtain" role="status">
            <EyeOff size={26} />
            <h2>家庭数据已隐藏</h2>
            <p>
              适合共享屏幕或公共场合。点击右上角眼睛恢复；这不是退出登录或访问控制。
            </p>
          </div>
        )}
        <div className="financial-content" hidden={privacy}>
          <div className="mobile-nav">
            <a href="#overview">总览</a>
            <a href="#assets">资产</a>
            <a href="#cashflow">收支</a>
            <a href="#contributions">贡献</a>
            <a href="#framework">计划</a>
            <button onClick={() => open({ kind: "members" })}>成员</button>
            <button onClick={() => open({ kind: "settings" })}>数据</button>
          </div>
          <div className="hero">
            <div>
              <span className="label">家庭净资产 · CAD</span>
              <div className="value" data-testid="net-worth">
                {money(balance.netWorth)}
              </div>
              <div className="balance-split">
                <span>
                  总资产 <b>{money(balance.totalAssets)}</b>
                </span>
                <span>
                  总负债 <b>{money(balance.totalDebts)}</b>
                </span>
              </div>
            </div>
            <div className="goal">
              <div className="goal-top">
                <span>{state.goal.name}</span>
                <button
                  aria-label="编辑财富目标"
                  onClick={() => open({ kind: "goal" })}
                >
                  <Pencil size={13} />
                </button>
                <b>{progress.toFixed(1)}%</b>
              </div>
              <div className="bar">
                <i style={{ width: `${progress}%` }} />
              </div>
              <p>
                距目标还差{" "}
                {money(Math.max(state.goal.target - balance.netWorth, 0))}
                <span>
                  {money(state.goal.target)} · {state.goal.year} 年
                </span>
              </p>
            </div>
          </div>
          <WealthPulse
            state={state}
            insights={
              state.preferences.proactive === false ? [] : unreadInsights
            }
            onDiscuss={advisor}
            onDismiss={(alertId) =>
              change(
                (current) => ({
                  ...current,
                  readAlerts: [...new Set([...current.readAlerts, alertId])],
                }),
                "处理主动提醒",
              )
            }
          />
          <div className="ownership-strip">
            {owners.map((group) => (
              <button
                type="button"
                key={group.key}
                aria-label={`查看${group.name}持有资产`}
                onClick={() => {
                  if (
                    change(
                      (current) => ({
                        ...current,
                        preferences: {
                          ...current.preferences,
                          allocation: "owner",
                        },
                      }),
                      "按成员查看资产",
                    )
                  ) {
                    setFilter(group.key);
                    document
                      .getElementById("assets")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }
                }}
              >
                <span>
                  <i style={{ background: group.color }} />
                  {group.name}持有
                </span>
                <b>{money(group.amount)}</b>
                <small>占总资产 {group.percent.toFixed(1)}%</small>
              </button>
            ))}
          </div>
          <div className="dashboard-grid">
            <section className="card chart-card">
              <div className="card-head">
                <div>
                  <h2>净资产走势</h2>
                  <p>每次估值变动留存历史 · CAD</p>
                </div>
                <div className="button-row">
                  <select
                    aria-label="图表时间范围"
                    value={state.preferences.months}
                    onChange={(e) =>
                      change(
                        (current) => ({
                          ...current,
                          preferences: {
                            ...current.preferences,
                            months: Number(e.target.value),
                          },
                        }),
                        "切换图表范围",
                      )
                    }
                  >
                    <option value={3}>近 3 个月</option>
                    <option value={6}>近 6 个月</option>
                    <option value={12}>近 12 个月</option>
                    <option value={24}>近 24 个月</option>
                  </select>
                  <button
                    className="text-button"
                    onClick={() => open({ kind: "history" })}
                  >
                    <History size={14} />
                    历史
                  </button>
                </div>
              </div>
              {history.length > 1 ? (
                <div className="chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={history}
                      margin={{ top: 18, right: 10, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="wealth-fill"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0"
                            stopColor="#a8c7b7"
                            stopOpacity={0.5}
                          />
                          <stop
                            offset="1"
                            stopColor="#a8c7b7"
                            stopOpacity={0.02}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="#eef2ed" />
                      <XAxis
                        dataKey="at"
                        tickFormatter={(at) =>
                          new Date(at).toLocaleDateString("zh-CN", {
                            month: "short",
                            day: "numeric",
                          })
                        }
                        minTickGap={45}
                        tick={{ fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        width={65}
                        tickFormatter={(value) =>
                          new Intl.NumberFormat("en-CA", {
                            notation: "compact",
                          }).format(value)
                        }
                        tick={{ fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        labelFormatter={(at) =>
                          new Date(String(at)).toLocaleString("zh-CN")
                        }
                        formatter={(value) => [money(Number(value)), "净资产"]}
                      />
                      <Area
                        dataKey="netWorth"
                        type="linear"
                        stroke="#315b4d"
                        strokeWidth={2.5}
                        fill="url(#wealth-fill)"
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="chart-empty">
                  <LineChart size={28} />
                  <b>
                    {history.length ? "第一份估值已记录" : "从第一项资产开始"}
                  </b>
                  <span>后续更新会形成趋势，历史中可查看每次变动。</span>
                </div>
              )}
            </section>
            <section className="card allocation-card">
              <div className="card-head">
                <div>
                  <h2>资产分布</h2>
                  <p>金额来自下方实际账户</p>
                </div>
                <div className="segmented">
                  <button
                    className={
                      state.preferences.allocation === "category"
                        ? "selected"
                        : ""
                    }
                    onClick={() => {
                      setFilter("");
                      change(
                        (current) => ({
                          ...current,
                          preferences: {
                            ...current.preferences,
                            allocation: "category",
                          },
                        }),
                        "按类别查看",
                      );
                    }}
                  >
                    类别
                  </button>
                  <button
                    className={
                      state.preferences.allocation === "owner" ? "selected" : ""
                    }
                    onClick={() => {
                      setFilter("");
                      change(
                        (current) => ({
                          ...current,
                          preferences: {
                            ...current.preferences,
                            allocation: "owner",
                          },
                        }),
                        "按归属查看",
                      );
                    }}
                  >
                    归属
                  </button>
                </div>
              </div>
              {balance.totalAssets > 0 ? (
                <>
                  <div className="donut">
                    <ResponsiveContainer width="100%" height={190}>
                      <PieChart>
                        <Pie
                          data={groups.filter((group) => group.amount > 0)}
                          nameKey="name"
                          dataKey="amount"
                          innerRadius={57}
                          outerRadius={78}
                          paddingAngle={0}
                          isAnimationActive={false}
                        >
                          {groups
                            .filter((group) => group.amount > 0)
                            .map((group) => (
                              <Cell key={group.key} fill={group.color} />
                            ))}
                        </Pie>
                        <Tooltip formatter={(value) => money(Number(value))} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="donut-center">
                      <b>{state.assets.length}</b>
                      <span>资产账户</span>
                    </div>
                  </div>
                  <div className="legend">
                    {groups.map((group) => (
                      <button
                        key={group.key}
                        onClick={() => {
                          setFilter(group.key);
                          document
                            .getElementById("assets")
                            ?.scrollIntoView({ behavior: "smooth" });
                        }}
                      >
                        <i style={{ background: group.color }} />
                        <span>{group.name}</span>
                        <b>{group.percent.toFixed(1)}%</b>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="chart-empty">添加资产后显示配置占比</div>
              )}
            </section>
          </div>
          <section className="card accounts-card" id="assets">
            <div className="card-head">
              <div>
                <h2>家庭资产负债表</h2>
                <p>编辑任何项目，总览、配置与目标同时更新</p>
              </div>
              <div className="button-row">
                <button
                  className="secondary"
                  disabled={!state.assets.length}
                  onClick={() => open({ kind: "valuations" })}
                >
                  批量核对
                </button>
                <button
                  className="secondary"
                  onClick={() => open({ kind: "debt" })}
                >
                  <Plus size={14} />
                  负债
                </button>
                <button
                  className="primary"
                  onClick={() => open({ kind: "asset" })}
                >
                  <Plus size={14} />
                  资产
                </button>
              </div>
            </div>
            <div className="table-toolbar">
              <input
                aria-label="搜索资产"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索账户、类别或成员…"
              />
              {filter && (
                <button className="filter-chip" onClick={() => setFilter("")}>
                  {state.preferences.allocation === "owner"
                    ? ownerLabel(filter, state.members)
                    : filter}{" "}
                  ×
                </button>
              )}
              <span>
                {assets.length} / {state.assets.length} 项资产
              </span>
              <select
                aria-label="资产排序"
                value={assetSort}
                onChange={(event) => setAssetSort(event.target.value)}
              >
                <option value="original">录入顺序</option>
                <option value="value-desc">价值从高到低</option>
                <option value="name">按名称</option>
                <option value="return-desc">本年回报从高到低</option>
              </select>
              {(filter || search) && (
                <button
                  className="text-button"
                  onClick={() => {
                    setFilter("");
                    setSearch("");
                  }}
                >
                  清除筛选
                </button>
              )}
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>账户 / 项目</th>
                    <th>类别</th>
                    <th>归属</th>
                    <th className="numeric">当前价值 · CAD</th>
                    <th className="numeric">本年回报</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((asset) => (
                    <tr key={asset.id}>
                      <td>
                        <button
                          className="name-button"
                          onClick={() => open({ kind: "asset", id: asset.id })}
                        >
                          {asset.name}
                        </button>
                        {(asset.valuationDate ||
                          asset.liquidity ||
                          asset.note) && (
                          <small className="cell-note">
                            {asset.valuationDate
                              ? `核对 ${asset.valuationDate}`
                              : "核对日期未填"}{" "}
                            · {LIQUIDITY[asset.liquidity ?? "unknown"]}
                            {asset.note ? ` · ${asset.note}` : ""}
                          </small>
                        )}
                      </td>
                      <td>{asset.category}</td>
                      <td>
                        <span className="owner-tag">
                          {ownerLabel(asset.owner, state.members)}
                        </span>
                      </td>
                      <td className="numeric">
                        <button
                          className="value-button"
                          onClick={() => open({ kind: "asset", id: asset.id })}
                        >
                          {money(asset.value)}
                        </button>
                      </td>
                      <td className="numeric">
                        <button
                          className={`return-button ${asset.annualReturn !== null && asset.annualReturn < 0 ? "negative" : ""}`}
                          aria-label={`编辑${asset.name}本年回报`}
                          onClick={() =>
                            open({
                              kind: "asset",
                              id: asset.id,
                              focusReturn: true,
                            })
                          }
                        >
                          {asset.annualReturn === null
                            ? "填写回报"
                            : `${asset.annualReturn > 0 ? "+" : ""}${asset.annualReturn}%`}
                          <Pencil size={11} />
                        </button>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            aria-label={`编辑${asset.name}`}
                            onClick={() =>
                              open({ kind: "asset", id: asset.id })
                            }
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            aria-label={`删除${asset.name}`}
                            onClick={() =>
                              remove("asset", asset.id, asset.name)
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {(filter || search) && (
                    <tr>
                      <td colSpan={3}>当前筛选小计 · {assets.length} 项</td>
                      <td
                        className="numeric"
                        data-testid="filtered-assets-total"
                      >
                        {money(filteredTotal)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  )}
                  <tr>
                    <td colSpan={3}>
                      资产合计{filter || search ? "（全部账户）" : ""}
                    </td>
                    <td className="numeric">{money(balance.totalAssets)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
            {!assets.length && (
              <div className="table-empty">
                {state.assets.length
                  ? "没有匹配的账户。"
                  : "还没有资产记录。添加银行账户、房产或任何自定义资产。"}
              </div>
            )}
            <div className="debt-heading">
              <h3>负债明细</h3>
              <span>
                {state.debts.length} 项 · {money(balance.totalDebts)}
              </span>
            </div>
            {state.debts.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>归属</th>
                      <th className="numeric">当前余额 · CAD</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.debts.map((debt) => (
                      <tr key={debt.id}>
                        <td>{debt.name}</td>
                        <td>
                          <span className="owner-tag">
                            {ownerLabel(debt.owner, state.members)}
                          </span>
                        </td>
                        <td className="numeric">{money(debt.value)}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              aria-label={`编辑${debt.name}`}
                              onClick={() =>
                                open({ kind: "debt", id: debt.id })
                              }
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              aria-label={`删除${debt.name}`}
                              onClick={() => remove("debt", debt.id, debt.name)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-note">
                没有记录负债。房贷、信用卡和个人贷款都可以逐项加入。
              </p>
            )}
          </section>
          <CashflowTable state={state} onChange={change} />
          <HouseholdReview state={state}>
            <HouseholdPlanning
              state={state}
              onChange={change}
              onAsset={(id) => open({ kind: "asset", id })}
              onDebt={(id) => open({ kind: "debt", id })}
              onBatch={() => open({ kind: "valuations" })}
            />
          </HouseholdReview>
          <section className="card contributions-card" id="contributions">
            <div className="card-head">
              <div>
                <h2>成员贡献</h2>
                <p>实际投入与取出单独记录；贡献占比按累计投入计算</p>
              </div>
              <button
                className="primary"
                onClick={() => open({ kind: "contribution" })}
              >
                <Plus size={14} />
                记录贡献
              </button>
            </div>
            <div className="contribution-summary">
              {contributions.map((row) => (
                <div key={row.member}>
                  <span>{row.name}</span>
                  <b>{money(row.net)}</b>
                  <small>
                    净贡献 · 投入 {money(row.deposits)} / 取出{" "}
                    {money(row.withdrawals)}
                  </small>
                  <div className="share-track">
                    <i style={{ width: `${row.percent}%` }} />
                  </div>
                  <em>累计投入占比 {row.percent.toFixed(1)}%</em>
                </div>
              ))}
            </div>
            {state.contributions.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>成员</th>
                      <th>关联账户 / 备注</th>
                      <th>类型</th>
                      <th className="numeric">金额 · CAD</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...state.contributions]
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((row) => (
                        <tr key={row.id}>
                          <td>{row.date}</td>
                          <td>{ownerLabel(row.member, state.members)}</td>
                          <td>
                            {state.assets.find(
                              (asset) => asset.id === row.assetId,
                            )?.name ?? "独立记录"}
                            {row.note && (
                              <small className="cell-note">{row.note}</small>
                            )}
                          </td>
                          <td>{row.kind === "deposit" ? "投入" : "取出"}</td>
                          <td className="numeric">{money(row.amount)}</td>
                          <td>
                            <div className="row-actions">
                              <button
                                aria-label={`编辑贡献${row.id}`}
                                onClick={() =>
                                  open({ kind: "contribution", id: row.id })
                                }
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                aria-label={`删除贡献${row.id}`}
                                onClick={() =>
                                  remove(
                                    "contribution",
                                    row.id,
                                    `${ownerLabel(row.member, state.members)}的贡献`,
                                  )
                                }
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="table-empty">
                记录首付、共同储蓄或定期投入，清楚看见各自贡献。关联账户时，资金变动会同步账户价值。
              </div>
            )}
          </section>
          <FinancialFramework
            plan={state.plan}
            assets={state.assets}
            debts={state.debts}
            members={state.members}
            budget={state.budget ?? []}
            onChange={(plan) =>
              change((current) => ({ ...current, plan }), "更新家庭规划")
            }
          />
          <footer className="page-footer">
            <span>
              金额统一以 CAD 记录 · 最近保存{" "}
              {state.updatedAt
                ? new Date(state.updatedAt).toLocaleString("zh-CN")
                : "尚未录入"}
            </span>
            <button onClick={() => open({ kind: "settings" })}>
              备份与同步
            </button>
          </footer>
        </div>
      </section>
      {modal?.kind === "valuations" && (
        <ValuationTable state={state} onClose={close} onChange={change} />
      )}
      {modal?.kind === "asset" &&
        (() => {
          const asset = state.assets.find((row) => row.id === modal.id);
          return (
            <Dialog
              title={asset ? "编辑资产" : "添加资产"}
              onClose={close}
              onSubmit={submit}
              error={formError}
            >
              <label>
                资产名称
                <input
                  name="name"
                  required
                  defaultValue={asset?.name}
                  placeholder="例如：共同投资账户"
                  autoFocus={!modal.focusReturn}
                />
              </label>
              <div className="form-grid">
                <label>
                  当前价值（CAD）
                  <input
                    name="value"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={asset?.value}
                  />
                </label>
                <label>
                  本年回报（%）
                  <input
                    name="annualReturn"
                    type="number"
                    step="0.01"
                    defaultValue={asset?.annualReturn ?? ""}
                    placeholder="可留空"
                    autoFocus={modal.focusReturn}
                  />
                </label>
              </div>
              <div className="form-grid">
                <label>
                  类别
                  <input
                    name="category"
                    list="asset-categories"
                    required
                    defaultValue={asset?.category ?? "投资"}
                    placeholder="可自定义"
                  />
                  <datalist id="asset-categories">
                    {[
                      "投资",
                      "房产",
                      "现金",
                      "退休",
                      "其他",
                      ...state.assets.map((row) => row.category),
                    ]
                      .filter(
                        (value, index, all) => all.indexOf(value) === index,
                      )
                      .map((value) => (
                        <option key={value} value={value} />
                      ))}
                  </datalist>
                </label>
                <label>
                  归属
                  <select name="owner" defaultValue={asset?.owner ?? "joint"}>
                    {options(asset?.owner)}
                  </select>
                </label>
              </div>
              <p className="form-help">
                回报支持负数、零或留空；手动记录回报不会改变账户估值。
              </p>
              <div className="form-grid">
                <label>
                  估值核对日期
                  <input
                    name="valuationDate"
                    type="date"
                    max={todayToronto()}
                    defaultValue={asset?.valuationDate ?? ""}
                  />
                </label>
                <label>
                  资金可动用情况
                  <select
                    name="liquidity"
                    defaultValue={asset?.liquidity ?? "unknown"}
                  >
                    {Object.entries(LIQUIDITY).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                账户备注
                <textarea
                  name="note"
                  maxLength={500}
                  defaultValue={asset?.note ?? ""}
                  placeholder="顾问可读取；记录用途或到期日，不要记录密码或完整账号"
                  rows={2}
                />
              </label>
              <div className="dialog-actions">
                <button type="button" className="secondary" onClick={close}>
                  取消
                </button>
                <button className="primary">保存资产</button>
              </div>
            </Dialog>
          );
        })()}
      {modal?.kind === "debt" &&
        (() => {
          const debt = state.debts.find((row) => row.id === modal.id);
          return (
            <Dialog
              title={debt ? "编辑负债" : "添加负债"}
              onClose={close}
              onSubmit={submit}
              error={formError}
            >
              <label>
                负债名称
                <input
                  name="name"
                  required
                  defaultValue={debt?.name}
                  placeholder="例如：房贷"
                  autoFocus
                />
              </label>
              <label>
                当前余额（CAD）
                <input
                  name="value"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  defaultValue={debt?.value}
                />
              </label>
              <label>
                归属
                <select name="owner" defaultValue={debt?.owner ?? "joint"}>
                  {options(debt?.owner)}
                </select>
              </label>
              <div className="form-grid">
                <label>
                  年利率（%）
                  <input
                    name="annualRate"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    defaultValue={debt?.annualRate ?? ""}
                    placeholder="可留空，不等于零"
                  />
                </label>
                <label>
                  计划月还款（CAD）
                  <input
                    name="monthlyPayment"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={debt?.monthlyPayment ?? ""}
                    placeholder="可留空"
                  />
                </label>
              </div>
              <p className="form-help">
                用于共同安排中的成本核对，不自动修改每月现金流。
              </p>
              <div className="dialog-actions">
                <button type="button" className="secondary" onClick={close}>
                  取消
                </button>
                <button className="primary">保存负债</button>
              </div>
            </Dialog>
          );
        })()}
      {modal?.kind === "contribution" &&
        (() => {
          const row = state.contributions.find((row) => row.id === modal.id);
          return (
            <Dialog
              title={row ? "编辑贡献" : "记录成员贡献"}
              onClose={close}
              onSubmit={submit}
              error={formError}
            >
              <div className="form-grid">
                <label>
                  贡献成员
                  <select name="member" defaultValue={row?.member ?? "first"}>
                    {["first", "second", "joint"].map((owner) => (
                      <option value={owner} key={owner}>
                        {ownerLabel(owner, state.members)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  类型
                  <select name="kind" defaultValue={row?.kind ?? "deposit"}>
                    <option value="deposit">投入</option>
                    <option value="withdrawal">取出</option>
                  </select>
                </label>
              </div>
              <div className="form-grid">
                <label>
                  金额（CAD）
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    defaultValue={row?.amount}
                    autoFocus
                  />
                </label>
                <label>
                  日期
                  <input
                    name="date"
                    type="date"
                    required
                    defaultValue={
                      row?.date ?? new Date().toLocaleDateString("en-CA")
                    }
                  />
                </label>
              </div>
              <label>
                关联资产账户
                <select name="assetId" defaultValue={row?.assetId ?? ""}>
                  <option value="">独立记录（仅统计贡献）</option>
                  {state.assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name} · {money(asset.value)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="form-help">
                关联账户时，投入会增加账户价值，取出会减少。独立记录适用于已计入当前估值的历史出资，避免重复计算。
              </p>
              <label>
                备注
                <input
                  name="note"
                  defaultValue={row?.note}
                  placeholder="例如：首付、每月共同储蓄"
                />
              </label>
              <div className="dialog-actions">
                <button type="button" className="secondary" onClick={close}>
                  取消
                </button>
                <button className="primary">保存贡献</button>
              </div>
            </Dialog>
          );
        })()}
      {modal?.kind === "goal" && (
        <Dialog
          title="编辑家庭财富目标"
          onClose={close}
          onSubmit={submit}
          error={formError}
        >
          <label>
            目标名称
            <input
              name="name"
              required
              defaultValue={state.goal.name}
              autoFocus
            />
          </label>
          <label>
            目标净资产（CAD）
            <input
              name="target"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={state.goal.target}
            />
          </label>
          <label>
            目标年份
            <input
              name="year"
              type="number"
              min="1900"
              max="2200"
              required
              defaultValue={state.goal.year}
            />
          </label>
          <div className="dialog-actions">
            <button className="primary">保存目标</button>
          </div>
        </Dialog>
      )}
      {modal?.kind === "members" && (
        <Dialog
          title="编辑成员名称"
          onClose={close}
          onSubmit={submit}
          error={formError}
        >
          <label>
            成员一显示名
            <input
              name="first"
              required
              defaultValue={state.members.first}
              autoFocus
            />
          </label>
          <label>
            成员二显示名
            <input name="second" required defaultValue={state.members.second} />
          </label>
          <p className="form-help">
            显示名更新后，资产归属、贡献记录与顾问会一起使用新名称。
          </p>
          <div className="dialog-actions">
            <button className="primary">保存名称</button>
          </div>
        </Dialog>
      )}
      {modal?.kind === "history" && (
        <Dialog title="完整财富历史" onClose={close} wide>
          <HistoryComparison state={state} />
          <p className="form-help">
            保留每次变动时的资产、负债与贡献快照。日期相同的多次修改也分别记录。
          </p>
          <div className="history-list">
            {[...state.history].reverse().map((point) => (
              <details key={point.id}>
                <summary>
                  <span>
                    <b>{point.reason}</b>
                    <small>{new Date(point.at).toLocaleString("zh-CN")}</small>
                  </span>
                  <strong>{money(point.netWorth)}</strong>
                </summary>
                <p>
                  资产 {money(point.totalAssets)} · 负债{" "}
                  {money(point.totalDebts)}
                </p>
                {point.assets.map((asset) => (
                  <div className="history-row" key={asset.id}>
                    <span>
                      {asset.name} ·{" "}
                      {ownerLabel(asset.owner, point.members ?? state.members)}
                    </span>
                    <span>
                      {money(asset.value)} · 回报{" "}
                      {asset.annualReturn === null
                        ? "未填"
                        : `${asset.annualReturn}%`}
                    </span>
                  </div>
                ))}
                {point.debts.map((debt) => (
                  <div className="history-row" key={debt.id}>
                    <span>负债 · {debt.name}</span>
                    <span>{money(debt.value)}</span>
                  </div>
                ))}
                {point.contributions.map((row) => (
                  <div className="history-row" key={row.id}>
                    <span>
                      {ownerLabel(row.member, point.members ?? state.members)} ·{" "}
                      {row.kind === "deposit" ? "投入" : "取出"}
                    </span>
                    <span>{money(row.amount)}</span>
                  </div>
                ))}
                {point.goal && (
                  <p>
                    当时目标：{point.goal.name} · {money(point.goal.target)} ·{" "}
                    {point.goal.year} 年
                  </p>
                )}
                {point.budget?.map((row) => (
                  <div className="history-row" key={row.id}>
                    <span>现金流 · {row.name}</span>
                    <span>{money(row.amount)}/月</span>
                  </div>
                ))}
              </details>
            ))}
            {(state.legacyHistory?.length ?? 0) > 0 && (
              <details>
                <summary>旧版估值记录（未记录完整日期）</summary>
                {state.legacyHistory?.map((point, index) => (
                  <div className="history-row" key={index}>
                    <span>{point.month}</span>
                    <span>{money(point.value * 10000)}</span>
                  </div>
                ))}
              </details>
            )}
            {!state.history.length && !state.legacyHistory?.length && (
              <p className="empty-note">添加第一笔记录后，会在这里保留历史。</p>
            )}
          </div>
        </Dialog>
      )}
      {modal?.kind === "alerts" && (
        <Dialog title="通知与消息渠道" onClose={close}>
          <div
            className="notification-tabs"
            role="tablist"
            aria-label="通知设置页面"
          >
            <button
              type="button"
              role="tab"
              aria-selected={notificationView === "alerts"}
              onClick={() => setNotificationView("alerts")}
            >
              主动提醒
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={notificationView === "channels"}
              onClick={() => setNotificationView("channels")}
            >
              消息渠道
            </button>
          </div>
          {notificationView === "alerts" && (
            <>
              <label className="proactive-toggle">
                <input
                  type="checkbox"
                  checked={state.preferences.proactive !== false}
                  onChange={(event) =>
                    change(
                      (current) => ({
                        ...current,
                        preferences: {
                          ...current.preferences,
                          proactive: event.target.checked,
                        },
                      }),
                      "更新主动提醒偏好",
                    )
                  }
                />
                <span>
                  开启主动洞察与每周复盘
                  <small>
                    即时提示依据记录生成；每周可使用已配置 AI。不会自动改账。
                  </small>
                </span>
              </label>
              <div className="alerts-list">
                {alerts.map((row) => (
                  <article key={row.id}>
                    <h3>{row.title}</h3>
                    <AdvisorMarkdown text={row.body} />
                    <div className="button-row">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          close();
                          advisor(row.prompt);
                        }}
                      >
                        与顾问讨论
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        disabled={state.readAlerts.includes(row.id)}
                        onClick={() =>
                          change(
                            (current) => ({
                              ...current,
                              readAlerts: [...current.readAlerts, row.id],
                            }),
                            "已读提醒",
                          )
                        }
                      >
                        {state.readAlerts.includes(row.id)
                          ? "已读"
                          : "标为已读"}
                      </button>
                    </div>
                  </article>
                ))}
                {!alerts.length && (
                  <p>当前没有待处理提醒。更新账户或计划后，会生成新的提示。</p>
                )}
              </div>
            </>
          )}
          {notificationView === "channels" && (
            <>
              <ChannelSettings
                householdId={store.cloudHousehold}
                proactive={state.preferences.proactive !== false}
              />
              <PushSettings householdId={store.cloudHousehold} />
            </>
          )}
        </Dialog>
      )}
      {modal?.kind === "settings" && (
        <DataSettings
          state={state}
          onClose={close}
          restore={store.restore}
          recoverPrevious={store.recoverPrevious}
          connectCloud={store.connectCloud}
          disconnectCloud={store.disconnectCloud}
          cloudStatus={store.cloudStatus}
          cloudChoice={store.cloudChoice}
          householdId={store.cloudHousehold}
        />
      )}
      {!privacy && (
        <FloatingAdvisor
          state={state}
          saveStatus={store.cloudStatus}
          loading={store.cloudLoading || !ready}
          onActions={onActions}
          onChange={(update) => commit(update, "保存顾问对话")}
        />
      )}
      {undo && !privacy && (
        <div className="undo-bar">
          <span>
            {undo.reason} ·{" "}
            {financialFingerprint(state) === undo.expected
              ? "本次财务修改可撤销"
              : "后续数据已变，撤销已过期"}
          </span>
          <button
            type="button"
            disabled={financialFingerprint(state) !== undo.expected}
            onClick={() => {
              try {
                commit(
                  (current) => undoFinancial(current, undo),
                  `撤销：${undo.reason}`,
                  true,
                );
                setUndo(null);
                setToast("已撤销，原操作与撤销均保留历史");
              } catch (reason) {
                store.setError(
                  reason instanceof Error ? reason.message : "撤销失败",
                );
              }
            }}
          >
            撤销上次修改
          </button>
          <button
            type="button"
            aria-label="关闭撤销提示"
            onClick={() => setUndo(null)}
          >
            ×
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
    </main>
  );
}
