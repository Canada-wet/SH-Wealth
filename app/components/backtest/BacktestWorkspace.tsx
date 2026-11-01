"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  Play,
  Download,
  Upload,
  Save,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  RotateCcw,
  X,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceArea,
  Legend,
} from "recharts";
import AdvisorMarkdown from "../AdvisorMarkdown";
import {
  defaultBacktest,
  backtestToday,
  STRATEGIES,
  validateBacktestConfig,
  validateBacktestData,
  type BacktestConfig,
  type BacktestData,
  type BacktestLab,
  type HistoricalAsset,
} from "@/lib/backtest-schema";
import { runBacktest, type BacktestReport } from "@/lib/backtest";
import { BACKTEST_EVENTS } from "@/lib/backtest-events";
import {
  BACKTEST_CSV_TEMPLATE,
  importBacktestCSV,
  readBacktestStudy,
  syntheticBacktest,
} from "@/lib/backtest-import";
import { backtestCache, portfolioShelfCache } from "@/lib/backtest-cache";
import PortfolioComparison from "./PortfolioComparison";
import PortfolioCollection from "./PortfolioCollection";
import SecurityPicker from "./SecurityPicker";
import {
  portfolioCurrencies,
  cadReference,
  type CadReference,
} from "@/lib/backtest-currency";
import {
  EMPTY_PORTFOLIO_SHELF,
  validatePortfolioShelf,
  type PortfolioShelf,
  type PortfolioStudy,
} from "@/lib/backtest-comparison";
import {
  backtestHouseholdContext,
  EMPTY_BACKTEST_LAB,
} from "@/lib/backtest-context";
import { stableJSON } from "@/lib/cloud-plan";
import { yahooRequest, type YahooBatch } from "@/lib/backtest-yahoo";
import type { WealthState } from "@/lib/wealth";

type Chat = { role: "user" | "assistant"; text: string };
const percent = (n: number | null) =>
  n === null
    ? "未知"
    : new Intl.NumberFormat("zh-CN", {
        style: "percent",
        maximumFractionDigits: 2,
      }).format(n);
const amount = (n: number | null, currency: string) =>
  n === null
    ? "未知"
    : new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(n);
const colors = ["#315b4d", "#936020", "#66658f"];
const today = backtestToday;
function download(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function BacktestWorkspace({
  state,
  scope,
  editable,
  onSaveLab,
}: {
  state: WealthState;
  scope: string;
  editable: boolean;
  onSaveLab: (lab: BacktestLab, expected: string) => void;
}) {
  const [config, setConfig] = useState(() => defaultBacktest(today())),
    [data, setData] = useState<BacktestData | null>(null),
    [report, setReport] = useState<BacktestReport | null>(null),
    [runData, setRunData] = useState<BacktestData | null>(null);
  const [tab, setTab] = useState<"compare" | "events" | "research">("compare"),
    [chart, setChart] = useState<"nav" | "value" | "drawdown">("nav");
  const [basis, setBasis] = useState<HistoricalAsset["basis"]>("raw"),
    [single, setSingle] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [cacheReady, setCacheReady] = useState(false),
    [cacheStatus, setCacheStatus] = useState(""),
    [reading, setReading] = useState(false);
  const [yahoo, setYahoo] = useState<YahooBatch | null>(null),
    [yahooBusy, setYahooBusy] = useState(false),
    [yahooError, setYahooError] = useState("");
  const yahooController = useRef<AbortController | null>(null);
  const fxController = useRef<AbortController | null>(null);
  const [fx, setFx] = useState<CadReference | null>(null),
    [fxBusy, setFxBusy] = useState(false),
    [fxError, setFxError] = useState("");
  const currencies = portfolioCurrencies(config.holdings, data);
  const previewCurrencies = portfolioCurrencies(
    config.holdings,
    yahoo?.data ?? null,
  );
  const yahooSelection = {
    symbols: config.holdings.map((h) => h.symbol),
    start: config.start,
    end: config.end,
  };
  const yahooStale =
    !!yahoo && stableJSON(yahoo.requested) !== stableJSON(yahooSelection);
  const [messages, setMessages] = useState<Chat[]>([]),
    [question, setQuestion] = useState(""),
    [household, setHousehold] = useState(false),
    [currentMarket, setCurrentMarket] = useState(false),
    [model, setModel] = useState<"deepseek-chat" | "auto">("deepseek-chat"),
    [busy, setBusy] = useState(false),
    [route, setRoute] = useState("");
  const privateHistory = useRef(false);
  const request = useRef<AbortController | null>(null),
    mounted = useRef(true),
    input = useRef<HTMLInputElement>(null),
    transcript = useRef<HTMLDivElement>(null),
    results = useRef<HTMLElement>(null),
    autoScroll = useRef(false);
  const lab = state.preferences.backtestLab ?? EMPTY_BACKTEST_LAB,
    expected = stableJSON(lab),
    [selected, setSelected] = useState("");
  const [planBaseline, setPlanBaseline] = useState<string | null>(null);
  const [mode, setMode] = useState<"workspace" | "portfolios" | "collection">(
      "workspace",
    ),
    [step, setStep] = useState<"design" | "data" | "results">("design"),
    [shelf, setShelf] = useState<PortfolioShelf>(() =>
      structuredClone(EMPTY_PORTFOLIO_SHELF),
    ),
    [shelfReady, setShelfReady] = useState(false),
    [shelfDirty, setShelfDirty] = useState(false),
    [shelfStatus, setShelfStatus] = useState("");
  const shelfWrite = useRef<Promise<unknown>>(Promise.resolve());
  const stale =
    !!report &&
    (stableJSON(config) !== stableJSON(report.config) || data !== runData);
  useEffect(() => {
    mounted.current = true;
    setYahoo(null);
    setYahooError("");
    setYahooBusy(false);
    let alive = true;
    if (!scope) {
      setCacheReady(true);
      setCacheStatus("未连接家庭空间：请导出研究包保留本机工作。");
      return () => {
        alive = false;
        mounted.current = false;
        request.current?.abort();
        yahooController.current?.abort();
        fxController.current?.abort();
      };
    }
    void backtestCache(scope)
      .then((d) => {
        if (alive && d) {
          setConfig(d.config);
          setData(d.data);
          setNotice("已恢复此设备的回测草稿与数据；点击运行重新计算。");
          if (d.data && d.conversation?.capturedAt === d.data.capturedAt) {
            try {
              setReport(runBacktest(d.conversation.config, d.data));
              setStep("results");
              setRunData(d.data);
              setMessages(d.conversation.messages);
              privateHistory.current = d.conversation.householdIncluded;
              setNotice(
                "已恢复本设备研究与对话；未调用模型。家庭授权默认关闭，旧私密对话不会在未授权时重发。",
              );
            } catch {
              setNotice("已恢复草稿，但旧研究数据无法重算；请核对并重新运行。");
            }
          }
        }
        if (alive) setCacheReady(true);
      })
      .catch(() => {
        if (alive) {
          setCacheReady(true);
          setCacheStatus("浏览器缓存不可用，请导出研究包。");
        }
      });
    return () => {
      alive = false;
      mounted.current = false;
      request.current?.abort();
      yahooController.current?.abort();
      fxController.current?.abort();
    };
  }, [scope]);
  useEffect(() => {
    let alive = true;
    if (!scope) {
      setShelfReady(true);
      setShelfStatus("未连接家庭空间，请导出对照包保留快照。");
      return;
    }
    void portfolioShelfCache(scope)
      .then((s) => {
        if (!alive) return;
        if (s) setShelf(s);
        setShelfReady(true);
        setShelfStatus(
          s?.studies.length
            ? "已恢复本设备的组合对照；重新运行即可比较，不会抓取行情或调用AI。"
            : "对照快照只保存在本设备；可导出对照包，不改真实持仓。",
        );
      })
      .catch(() => {
        if (alive) {
          setShelfReady(true);
          setShelfStatus(
            "对照缓存读取失败；已有草稿不受影响，新对照请导出备份。",
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [scope]);
  useEffect(() => {
    if (!shelfReady || !shelfDirty || !scope) return;
    let alive = true;
    const timer = setTimeout(() => {
      try {
        validatePortfolioShelf(shelf);
      } catch (e) {
        setShelfStatus((e as Error).message + " 当前修改尚未缓存。");
        return;
      }
      const copy = structuredClone(shelf);
      shelfWrite.current = shelfWrite.current
        .catch(() => {})
        .then(() => portfolioShelfCache(scope, copy))
        .then(() => {
          if (alive)
            setShelfStatus(
              "组合快照与对照设置已缓存于本设备；跨设备请导出／导入对照包。",
            );
        })
        .catch(() => {
          if (alive)
            setShelfStatus("对照缓存写入失败，请导出对照包，不能视为已保存。");
        });
    }, 700);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [shelf, shelfReady, shelfDirty, scope]);
  const changeShelf = (next: PortfolioShelf) => {
    setShelf(next);
    setShelfDirty(true);
  };
  useEffect(() => {
    if (!cacheReady || !scope) return;
    const timer = setTimeout(() => {
      try {
        validateBacktestConfig(config);
      } catch {
        setCacheStatus("当前草稿有无效输入，未更新缓存；修正后自动保存。");
        return;
      }
      void backtestCache(scope, {
        config,
        data,
        ...(report && runData === data && messages.length
          ? {
              conversation: {
                config: report.config,
                capturedAt: runData!.capturedAt,
                householdIncluded: privateHistory.current,
                messages: messages.slice(-40),
              },
            }
          : {}),
      })
        .then(() => {
          if (mounted.current)
            setCacheStatus(
              "草稿、行情与最近对话已缓存于此设备；共享计划请点保存。",
            );
        })
        .catch((e) => {
          if (mounted.current) setCacheStatus(e.message);
        });
    }, 700);
    return () => clearTimeout(timer);
  }, [config, data, messages, report, runData, cacheReady, scope]);
  useEffect(() => {
    transcript.current?.scrollTo?.({
      top: transcript.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy]);
  useEffect(() => {
    if (report && autoScroll.current) {
      results.current?.scrollIntoView?.({
        behavior: "instant",
        block: "start",
      });
      results.current?.focus({ preventScroll: true });
      autoScroll.current = false;
    }
  }, [report]);
  const patch = (p: Partial<BacktestConfig>) =>
    setConfig((c) => ({ ...c, ...p }));
  const run = (c = config, d = data) => {
    try {
      if (!d)
        throw Error("先获取Yahoo日线、导入CSV，或使用明确标注的合成演示。");
      const cutoff = today();
      if (
        c.end > cutoff ||
        d.assets.some((a) => a.points.some((p) => p.date > cutoff))
      )
        throw Error("历史回测不能包含未来日期。");
      const r = runBacktest(c, d);
      autoScroll.current = true;
      setReport(r);
      setStep("results");
      setRunData(d);
      setMessages([]);
      privateHistory.current = false;
      setRoute("");
      setTab("compare");
      setError("");
      setNotice("已重新计算；旧对话不会用于新回测。回测不改变资产账本。");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const load = async (file: File) => {
    setReading(true);
    setError("");
    try {
      if (file.size > 20_000_000) throw Error("文件不能超过20MB。");
      const text = await file.text();
      if (!mounted.current) return;
      if (file.name.toLowerCase().endsWith(".json")) {
        const p = readBacktestStudy(text);
        setConfig(p.config);
        setData(p.data);
        setNotice("研究包已读取，请核对后重新运行。历史结果不作为可信输入。");
      } else {
        const d = importBacktestCSV(
          text,
          basis,
          `用户CSV · ${file.name}`,
          single.trim().toUpperCase(),
        );
        setData(d);
        setNotice("已导入；请核对下方标的、币种与覆盖区间，再运行回测。");
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setReading(false);
    }
  };
  const loadDemo = () => {
    if (
      data &&
      !confirm("使用合成演示替换当前草稿与行情？请先导出需要保留的研究包。")
    )
      return;
    const p = syntheticBacktest();
    setConfig(p.config);
    setData(p.data);
    setSelected("");
    setPlanBaseline(null);
    run(p.config, p.data);
  };
  const fetchYahoo = async () => {
    setYahooError("");
    let query;
    try {
      query = yahooRequest(yahooSelection);
    } catch (e) {
      setYahooError((e as Error).message);
      return;
    }
    const controller = new AbortController();
    yahooController.current?.abort();
    yahooController.current = controller;
    setYahooBusy(true);
    setYahoo(null);
    const timeout = setTimeout(() => controller.abort(), 95000);
    try {
      const response = await fetch("/api/backtest/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(query),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Yahoo历史暂不可用。");
      if (
        !result ||
        stableJSON(result.requested) !== stableJSON(query) ||
        !Array.isArray(result.results) ||
        result.results.length !== query.symbols.length
      )
        throw Error("行情响应无效；未替换已有数据。");
      if (result.data) {
        validateBacktestData(result.data);
        if (
          result.data.synthetic ||
          result.data.assets.some(
            (a: HistoricalAsset) =>
              !query.symbols.includes(a.symbol) ||
              a.basis !== "total-return" ||
              a.points.some(
                (p) => p.date < query.start || p.date > result.effectiveEnd,
              ),
          )
        )
          throw Error("行情范围或口径无效；未替换已有数据。");
      }
      if (mounted.current && !controller.signal.aborted) setYahoo(result);
    } catch (e) {
      if (mounted.current && yahooController.current === controller)
        setYahooError(
          controller.signal.aborted
            ? "获取已停止或超时，未自动重试；已有行情不变。"
            : (e as Error).message,
        );
    } finally {
      clearTimeout(timeout);
      if (mounted.current && yahooController.current === controller)
        setYahooBusy(false);
    }
  };
  const save = () => {
    try {
      if (!editable) throw Error("请先处理家庭同步冲突。");
      validateBacktestConfig(config);
      if (!selected && lab.saved.length >= 12)
        throw Error("最多保存12个计划，请先整理旧计划。");
      const entry = {
        id: selected || crypto.randomUUID(),
        at: new Date().toISOString(),
        config: structuredClone(config),
      };
      const nextLab: BacktestLab = {
        ...lab,
        saved: [entry, ...lab.saved.filter((s) => s.id !== entry.id)],
      };
      onSaveLab(nextLab, selected ? (planBaseline ?? expected) : expected);
      setSelected(entry.id);
      setPlanBaseline(stableJSON(nextLab));
      setNotice(
        "计划已存入家庭文档，云端确认见页顶；行情仅缓存于本设备，跨设备可重新导入研究包。",
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const loadPlan = (id: string, copy = false) => {
    const p = lab.saved.find((s) => s.id === id);
    if (!p || busy || reading || yahooBusy) return;
    if (
      !confirm(
        "载入此组合配置并替换当前草稿？已有行情保留，但需重新核对并运行；真实持仓、已保存组合与对照快照不变。",
      )
    )
      return;
    setConfig({
      ...structuredClone(p.config),
      ...(copy ? { name: `${p.config.name.slice(0, 90)} · 副本` } : {}),
    });
    setSelected(copy ? "" : id);
    setPlanBaseline(copy ? null : expected);
    setYahoo(null);
    setError("");
    setStep("design");
    setMode("workspace");
    setNotice(
      copy
        ? "已复制为新草稿；保存时创建新组合，不覆盖原组合。"
        : "已载入Collection组合；请核对行情后重新运行。",
    );
  };
  const removePlan = (id: string) => {
    if (
      !editable ||
      !confirm(
        "从家庭共享Collection删除这个组合配置？对照快照、本机行情与真实账本不变，当前草稿仍保留。",
      )
    )
      return;
    try {
      onSaveLab(
        { ...lab, saved: lab.saved.filter((p) => p.id !== id) },
        expected,
      );
      if (selected === id) {
        setSelected("");
        setPlanBaseline(null);
      }
      setError("");
      setNotice(
        "已从Collection移除配置；云端确认见页顶。对照快照与真实账本未改动。",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const fetchFx = async () => {
    const controller = new AbortController();
    fxController.current?.abort();
    fxController.current = controller;
    setFxBusy(true);
    setFxError("");
    const timeout = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetch("/api/market", {
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error || "官方汇率暂不可用。");
      const rate = cadReference(body);
      if (mounted.current && !controller.signal.aborted) setFx(rate);
    } catch (e) {
      if (mounted.current && fxController.current === controller)
        setFxError(
          controller.signal.aborted
            ? "汇率请求停止或超时，未自动重试；原规划汇率未改动。"
            : (e as Error).message,
        );
    } finally {
      clearTimeout(timeout);
      if (mounted.current && fxController.current === controller)
        setFxBusy(false);
    }
  };
  const adoptCurrency = (currency: "CAD" | "USD") => {
    if (
      currency !== config.currency &&
      !confirm(
        `按行情币种将组合切换为${currency}？起始资金与月供的数字不变，不自动兑换金额；请核对后再运行。`,
      )
    )
      return false;
    patch({
      currency,
      ...(currency === "CAD"
        ? { risk: { ...config.risk, cadPerUnit: 1 } }
        : {}),
    });
    return true;
  };
  const addComparison = () => {
    if (!report || !runData || stale || !shelfReady) return;
    if (shelf.studies.length >= 4) {
      setError("最多保留4个组合快照，请先在组合对照中移除不需要的快照。");
      return;
    }
    if (
      shelf.studies.some(
        (s) =>
          stableJSON(s.config) === stableJSON(report.config) &&
          s.data.capturedAt === runData.capturedAt,
      )
    ) {
      setNotice("这个回测快照已在组合对照中，可复制到工作台修改后再加入。");
      setMode("portfolios");
      return;
    }
    const id = crypto.randomUUID();
    let title = report.config.name,
      n = 2;
    while (shelf.studies.some((s) => s.title === title))
      title = `${report.config.name.slice(0, 90)} · ${n++}`;
    const next: PortfolioShelf = {
      ...shelf,
      studies: [
        ...shelf.studies,
        {
          id,
          title,
          at: new Date().toISOString(),
          config: structuredClone(report.config),
          data: structuredClone(runData),
        },
      ],
      selected: [...shelf.selected, id],
      baseline: shelf.baseline || id,
    };
    try {
      validatePortfolioShelf(next);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    changeShelf(next);
    setNotice(
      "已加入对照快照。可复制修改另一组合，再并排比较；原回测与账本不变。",
    );
    setMode("portfolios");
  };
  const editComparison = (p: PortfolioStudy) => {
    if (busy || yahooBusy || reading) return;
    if (
      data &&
      !confirm(
        "复制这个快照到工作台修改？当前草稿将被替换；对照快照、家庭计划和真实持仓不变。",
      )
    )
      return;
    setConfig({
      ...structuredClone(p.config),
      name: `${p.title.slice(0, 90)} · 副本`,
    });
    setData(structuredClone(p.data));
    setReport(null);
    setRunData(null);
    setMessages([]);
    privateHistory.current = false;
    setSelected("");
    setPlanBaseline(null);
    setYahoo(null);
    setError("");
    setStep("design");
    setMode("workspace");
    setNotice("已复制到工作台；修改权重或持仓，核对行情后重新运行并加入对照。");
  };
  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!report || !runData || busy || stale || !question.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    const user = question.trim(),
      history =
        !household && privateHistory.current
          ? []
          : messages
              .slice(-12)
              .map((m) => ({ ...m, text: m.text.slice(0, 8000) }));
    if (!household && privateHistory.current) {
      setMessages([]);
      privateHistory.current = false;
    }
    if (household) privateHistory.current = true;
    setBusy(true);
    setError("");
    setQuestion("");
    setMessages((m) => [...m, { role: "user", text: user }]);
    try {
      const response = await fetch("/api/backtest/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          config: report.config,
          data: runData,
          message: user,
          preference: model,
          includeHousehold: household,
          ...(household ? { state } : {}),
          currentMarket,
          history,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "顾问暂不可用。");
      if (mounted.current) {
        setMessages((m) => [...m, { role: "assistant", text: result.answer }]);
        setRoute(
          `${result.route.provider} · ${result.route.model}${result.marketAsOf ? ` · 公开观测获取 ${new Date(result.marketAsOf).toLocaleString()}` : ""}${result.marketUnavailable ? " · 当前市场观测读取失败" : ""}`,
        );
      }
    } catch (e) {
      if (mounted.current) {
        setQuestion(user);
        setError(
          controller.signal.aborted
            ? "请求已停止；可能已计费，不会自动重发。"
            : (e as Error).message,
        );
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const context = useMemo(() => backtestHouseholdContext(state), [state]);
  const chartPoints = useMemo(
    () =>
      report?.results[0].points.map((p, i) => ({
        date: p.date,
        ...Object.fromEntries(
          report.results.map((s, j) => [`s${j}`, s.points[i][chart]]),
        ),
      })) ?? [],
    [report, chart],
  );
  const events = [...BACKTEST_EVENTS].sort((a, b) => {
    const rank = { complete: 0, partial: 1, none: 2 };
    const coverage = (id: string) =>
      report?.results[0].events.find((e) => e.id === id)?.coverage ?? "none";
    return (
      rank[coverage(a.id)] - rank[coverage(b.id)] ||
      a.start.localeCompare(b.start)
    );
  });
  // Keep the analytical calculations at daily resolution; chart rendering only is sampled.
  const stride = Math.max(1, Math.ceil(chartPoints.length / 1500)),
    plot = chartPoints.filter(
      (_, i) => i % stride === 0 || i === chartPoints.length - 1,
    );
  const inputNumber = (
    key:
      | "initial"
      | "monthly"
      | "entryMonths"
      | "feeBps"
      | "cashRate"
      | "riskFree",
    label: string,
  ) => (
    <label>
      {label}
      <input
        type="number"
        min="0"
        step={key === "entryMonths" ? "1" : "any"}
        value={config[key]}
        onChange={(e) => patch({ [key]: e.target.valueAsNumber })}
      />
    </label>
  );
  return (
    <>
      <div className="bt-mode-bar">
        <div role="group" aria-label="比较方式">
          <button
            aria-pressed={mode === "workspace"}
            onClick={() => setMode("workspace")}
          >
            策略工作台
          </button>
          <button
            aria-label="组合对照"
            aria-pressed={mode === "portfolios"}
            disabled={busy || reading || yahooBusy}
            onClick={() => setMode("portfolios")}
          >
            组合对照 <span>{shelf.studies.length}</span>
          </button>
          <button
            aria-label="组合Collection"
            aria-pressed={mode === "collection"}
            disabled={busy || reading || yahooBusy}
            onClick={() => setMode("collection")}
          >
            组合库 <span>{lab.saved.length}</span>
          </button>
        </div>
        <small>
          <ShieldCheck size={14} />
          独立研究 · 不下单、不改账本
        </small>
      </div>
      {error && (
        <p className="bt-notice bt-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="bt-notice" role="status">
          {notice}
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </p>
      )}
      <div hidden={mode !== "workspace"} className="bt-workspace-view">
        <nav className="bt-steps" aria-label="回测工作流">
          <button
            aria-current={step === "design" ? "step" : undefined}
            onClick={() => setStep("design")}
          >
            <span>01</span>组合设置
          </button>
          <button
            aria-current={step === "data" ? "step" : undefined}
            onClick={() => setStep("data")}
          >
            <span>02</span>历史数据
          </button>
          <button
            aria-current={step === "results" ? "step" : undefined}
            disabled={!report}
            onClick={() => setStep("results")}
          >
            <span>03</span>比较结果
          </button>
        </nav>
        {step !== "design" && (
          <div className="bt-context-strip">
            <strong>{config.name}</strong>
            <span>
              {config.holdings.length}项持仓 · {config.currency}
            </span>
            <span>
              {config.start} → {config.end}
            </span>
            <button
              className="bt-text-button"
              onClick={() => setStep("design")}
            >
              编辑组合与假设
            </button>
          </div>
        )}
        <div className="bt-layout bt-focused-layout">
          <aside
            hidden={step !== "design"}
            className="bt-builder card"
            aria-label="组合与回测设置"
            id="backtest-builder"
          >
            <div className="bt-section-head">
              <div>
                <span className="bt-kicker">01 / DESIGN</span>
                <h2>构建你的组合</h2>
              </div>
              <Save size={20} />
            </div>
            <div className="bt-editor-main">
              <label>
                计划名称
                <input
                  value={config.name}
                  maxLength={100}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </label>
              <div className="bt-field-grid">
                <label>
                  计价币种
                  <select
                    value={config.currency}
                    onChange={(e) =>
                      patch({ currency: e.target.value as "CAD" | "USD" })
                    }
                  >
                    <option>USD</option>
                    <option>CAD</option>
                  </select>
                </label>
                <label>
                  已存家庭计划
                  <select
                    aria-label="已存家庭计划"
                    value={selected}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSelected(id);
                      setPlanBaseline(expected);
                      const s = lab.saved.find((s) => s.id === id);
                      if (s) {
                        setConfig(structuredClone(s.config));
                        setNotice(
                          "已载入计划。行情不会跨设备自动复制，请核对数据。",
                        );
                      }
                    }}
                  >
                    <option value="">新计划 / 草稿</option>
                    {lab.saved.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.config.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="bt-holdings">
                <table>
                  <caption>股票与ETF · .US / .TO</caption>
                  <thead>
                    <tr>
                      <th>标的代码</th>
                      <th>权重 %</th>
                      <th>
                        <span className="sr-only">操作</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {config.holdings.map((h, i) => (
                      <tr key={i}>
                        <td>
                          <SecurityPicker
                            label={`标的${i + 1}`}
                            value={h.symbol}
                            excluded={config.holdings
                              .filter((_, j) => j !== i)
                              .map((h) => h.symbol)}
                            disabled={busy || reading || yahooBusy}
                            onSelect={(security) =>
                              patch({
                                holdings: config.holdings.map((r, j) =>
                                  j === i
                                    ? {
                                        ...r,
                                        symbol: security.symbol,
                                      }
                                    : r,
                                ),
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`权重${i + 1}`}
                            type="number"
                            min="0.01"
                            max="100"
                            step="any"
                            value={h.weight}
                            onChange={(e) =>
                              patch({
                                holdings: config.holdings.map((r, j) =>
                                  j === i
                                    ? { ...r, weight: e.target.valueAsNumber }
                                    : r,
                                ),
                              })
                            }
                          />
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`移除标的${i + 1}`}
                            disabled={config.holdings.length === 1}
                            onClick={() =>
                              patch({
                                holdings: config.holdings.filter(
                                  (_, j) => j !== i,
                                ),
                              })
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="bt-row">
                  <button
                    className="bt-text-button"
                    disabled={config.holdings.length >= 8}
                    onClick={() =>
                      patch({
                        holdings: [
                          ...config.holdings,
                          { symbol: "", weight: 0 },
                        ],
                      })
                    }
                  >
                    <Plus size={14} /> 添加标的
                  </button>
                  <span
                    className={
                      Math.abs(
                        config.holdings.reduce((s, h) => s + h.weight, 0) - 100,
                      ) > 0.00001
                        ? "bt-negative"
                        : ""
                    }
                  >
                    合计{" "}
                    {config.holdings
                      .reduce((s, h) => s + (h.weight || 0), 0)
                      .toFixed(2)}
                    %
                  </span>
                </div>
              </div>
              <p className="bt-help">
                搜索后从下拉列表选择已核对的股票／ETF，不能提交任意手填代码。最多8个标的。同一回测仅用一种计价币种；加币对冲
                ETF 的币种指成交币种，不代表没有底层风险。
              </p>
              <div className="bt-currency-panel" aria-label="证券计价币种识别">
                <strong>按证券历史核对币种</strong>
                <div className="bt-currency-list">
                  {currencies.rows.map((r, i) => (
                    <span key={i}>
                      {r.symbol || "待填代码"} ·{" "}
                      {r.currency
                        ? `${r.currency}${data?.synthetic ? "（合成）" : " · 行情记录"}`
                        : r.symbol.endsWith(".US")
                          ? "USD? · 待核对"
                          : r.symbol.endsWith(".TO")
                            ? "CAD/USD · 待核对"
                            : "待识别"}
                    </span>
                  ))}
                </div>
                <small>
                  代码后缀只作线索；TSX也有美元份额。获取Yahoo历史后读取实际成交币种，不会仅凭代码自动兑换资金。
                </small>
                {currencies.mixed && (
                  <p role="alert">
                    持仓实际包含多种币种：目前需拆成独立组合，不能用当前汇率拼接历史。
                  </p>
                )}
                {currencies.currency &&
                  currencies.currency !== config.currency && (
                    <button
                      className="secondary"
                      onClick={() => adoptCurrency(currencies.currency!)}
                    >
                      按行情切换为 {currencies.currency}
                    </button>
                  )}
              </div>
            </div>
            <div className="bt-editor-assumptions">
              <div className="bt-field-grid">
                <label>
                  开始日期
                  <input
                    type="date"
                    max={today()}
                    value={config.start}
                    onChange={(e) => patch({ start: e.target.value })}
                  />
                </label>
                <label>
                  结束日期
                  <input
                    type="date"
                    max={today()}
                    value={config.end}
                    onChange={(e) => patch({ end: e.target.value })}
                  />
                </label>
                {inputNumber("initial", `起始资金 · ${config.currency}`)}
                {inputNumber("monthly", `每月新增 · ${config.currency}`)}
              </div>
              <fieldset className="bt-strategies">
                <legend>同时比较</legend>
                {Object.entries(STRATEGIES).map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={config.strategies.includes(
                        key as keyof typeof STRATEGIES,
                      )}
                      onChange={(e) =>
                        patch({
                          strategies: e.target.checked
                            ? [
                                ...config.strategies,
                                key as keyof typeof STRATEGIES,
                              ]
                            : config.strategies.filter((s) => s !== key),
                        })
                      }
                    />
                    <span>
                      <strong>{label}</strong>
                      <small>
                        {key === "buy-hold"
                          ? "首日部署本金，月供到达即买入"
                          : key === "dca"
                            ? "原有本金分批投入，剩余资金留现金"
                            : "每年首个交易日调回投资部分权重"}
                      </small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <details className="bt-details">
                <summary>资金与成本假设</summary>
                <div className="bt-field-grid">
                  {inputNumber("entryMonths", "DCA 本金分几个月入场")}
                  {inputNumber("feeBps", "单边费用＋滑点 · bps")}
                  {inputNumber("cashRate", "未投资现金年息 · %")}
                  {inputNumber("riskFree", "Sharpe 无风险年率 · %")}
                  <label className="bt-full">
                    分红处理
                    <select
                      value={config.dividends}
                      onChange={(e) =>
                        patch({
                          dividends: e.target.value as "reinvest" | "cash",
                        })
                      }
                    >
                      <option value="reinvest">再投资（计入总回报）</option>
                      <option value="cash">留在组合现金中</option>
                    </select>
                  </label>
                </div>
                <p className="bt-help">
                  1 bps =
                  0.01%。收益已扣上述交易成本；未计税和外汇费用。现金利率与无风险利率为固定假设，并非当前市场利率。
                </p>
              </details>
              <details className="bt-details">
                <summary>我的投资偏好与规划</summary>
                <div className="bt-field-grid">
                  <label>
                    计划持有 · 年
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={config.risk.horizon}
                      onChange={(e) =>
                        patch({
                          risk: {
                            ...config.risk,
                            horizon: e.target.valueAsNumber,
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    可承受回撤 · %
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={config.risk.maxLoss}
                      onChange={(e) =>
                        patch({
                          risk: {
                            ...config.risk,
                            maxLoss: e.target.valueAsNumber,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="bt-full">
                    目标用途
                    <input
                      value={config.risk.purpose}
                      maxLength={300}
                      onChange={(e) =>
                        patch({
                          risk: { ...config.risk, purpose: e.target.value },
                        })
                      }
                    />
                  </label>
                  {config.currency === "USD" && (
                    <label className="bt-full">
                      规划换算 · 1 USD = 多少 CAD
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={config.risk.cadPerUnit}
                        onChange={(e) =>
                          patch({
                            risk: {
                              ...config.risk,
                              cadPerUnit: e.target.valueAsNumber,
                            },
                          })
                        }
                      />
                    </label>
                  )}
                </div>
                {config.currency === "USD" && (
                  <div className="bt-fx-reference">
                    <button
                      className="bt-text-button"
                      disabled={fxBusy}
                      onClick={() => void fetchFx()}
                    >
                      {fxBusy ? "读取官方参考…" : "获取最新官方参考汇率"}
                    </button>
                    {fxError && <p role="alert">{fxError}</p>}
                    {fx && (
                      <>
                        <p>
                          1 USD = {fx.rate} CAD · 观测日 {fx.date} ·{" "}
                          <a href={fx.source} target="_blank" rel="noreferrer">
                            加拿大央行
                          </a>
                        </p>
                        <button
                          className="secondary"
                          onClick={() => {
                            patch({
                              risk: { ...config.risk, cadPerUnit: fx.rate },
                            });
                            setNotice(
                              "已采用规划参考汇率；它不参与历史回测收益计算。",
                            );
                          }}
                        >
                          用于家庭规划换算
                        </button>
                      </>
                    )}
                    <small>
                      工作日日均、非实时成交价。仅用于当下家庭规划与AI适配；历史回测仍用原币，不将当前汇率套到过去。
                    </small>
                  </div>
                )}
              </details>
            </div>
            <div className="bt-save-row">
              <button
                className="secondary"
                disabled={!editable || !cacheReady}
                onClick={save}
              >
                <Save size={15} /> 保存计划
              </button>
              {selected && (
                <button
                  className="bt-text-button"
                  disabled={!editable}
                  onClick={() => {
                    if (
                      !confirm(
                        "删除这个家庭共享回测计划？本机行情与真实财富账本不受影响。",
                      )
                    )
                      return;
                    try {
                      onSaveLab(
                        {
                          ...lab,
                          saved: lab.saved.filter((s) => s.id !== selected),
                        },
                        planBaseline ?? expected,
                      );
                      setSelected("");
                      setPlanBaseline(null);
                      setNotice("已移除共享计划；当前草稿仍可重新保存。");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <Trash2 size={15} /> 删除计划
                </button>
              )}
            </div>
            <small className="bt-help" role="status">
              {notice.startsWith("计划已存")
                ? "计划已存到本机家庭文档；云端是否确认请查看页顶。 "
                : ""}
              {cacheStatus || "正在读取本机研究缓存…"}
            </small>
            <div className="bt-step-footer">
              <button
                className="primary"
                disabled={!cacheReady}
                onClick={() => setStep("data")}
              >
                下一步：历史数据 <ArrowRight size={16} />
              </button>
            </div>
          </aside>
          <div className="bt-main" hidden={step === "design"}>
            <section
              className="card bt-data"
              id="backtest-data"
              hidden={step !== "data"}
            >
              <div className="bt-section-head">
                <div>
                  <span className="bt-kicker">02 / EVIDENCE</span>
                  <h2>给策略接上历史</h2>
                </div>
                <span className="bt-pill">Yahoo 日线 / CSV</span>
              </div>
              <p>
                按组合代码获取Yahoo可用历史，或导入你有权使用的CSV。只有点击才请求；不会把家庭资产、金额、权重或聊天发给Yahoo。
              </p>
              <div className="bt-yahoo">
                <div className="bt-row bt-wrap">
                  <button
                    className="secondary"
                    disabled={!cacheReady || yahooBusy || reading || busy}
                    onClick={() => void fetchYahoo()}
                  >
                    <Download size={16} />{" "}
                    {yahooBusy ? "正在获取Yahoo日线…" : "从Yahoo获取组合历史"}
                  </button>
                  {yahooBusy && (
                    <button
                      className="bt-text-button"
                      onClick={() => yahooController.current?.abort()}
                    >
                      停止等待
                    </button>
                  )}
                </div>
                <small className="bt-help">
                  无需新增key · 非官方日线，可能缺失 · 先预览再采用
                </small>
                <details className="bt-details">
                  <summary>数据口径与访问说明</summary>
                  <p>
                    最多8只股票/ETF；美股用.US，多伦多用.TO，份额类别如CGL.C.TO会明确映射为CGL-C.TO。仅取多伦多日期之前的完整日线，公开历史缓存1小时。遇到拒绝或限流就停止；沿用现有研究请求频率限制，不产生模型调用。
                  </p>
                </details>
                {yahooError && (
                  <p role="alert" className="bt-yahoo-error">
                    {yahooError}
                  </p>
                )}
                {yahoo && (
                  <div aria-live="polite">
                    <h3>
                      已获取 {yahoo.data?.assets.length ?? 0}/
                      {yahoo.requested.symbols.length} 项
                    </h3>
                    <p>
                      已含拆股与分红，仅支持再投资，分红金额不单列。失败不改持仓或权重。
                    </p>
                    {previewCurrencies.mixed && (
                      <p role="alert" className="bt-yahoo-error">
                        实际成交币种混合，不能采用为单一币种回测；请拆成独立组合。没有自动换汇或重配权重。
                      </p>
                    )}
                    <ul className="bt-yahoo-list">
                      {yahoo.results.map((r) => {
                        const a = yahoo.data?.assets.find(
                          (a) => a.symbol === r.symbol,
                        );
                        return (
                          <li key={r.symbol}>
                            <strong>
                              {r.symbol} → {r.yahooSymbol}
                            </strong>
                            <span>
                              {r.error ||
                                (a
                                  ? `${a.currency} · ${a.points.length.toLocaleString()}日线 · ${a.points[0].date} → ${a.points.at(-1)!.date}`
                                  : "无可用历史")}
                            </span>
                            {!r.error && (
                              <small>
                                来源读取于{" "}
                                {new Date(r.fetchedAt).toLocaleString()}
                                <details>
                                  <summary>来源说明</summary>
                                  {r.warnings.join(" ")}
                                </details>
                              </small>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {yahooStale && (
                      <p role="alert">
                        标的或日期已改变，这批预览已过期；请重新获取。
                      </p>
                    )}
                    <button
                      className="secondary"
                      disabled={
                        !yahoo.data ||
                        previewCurrencies.mixed ||
                        yahooStale ||
                        yahooBusy ||
                        reading ||
                        busy
                      }
                      onClick={() => {
                        if (!yahoo.data || yahooStale) return;
                        if (previewCurrencies.mixed) return;
                        if (config.dividends !== "reinvest") {
                          setYahooError(
                            "请先把分红处理改为再投资；复权总回报不能模拟现金分红。",
                          );
                          return;
                        }
                        if (
                          data &&
                          !confirm(
                            "用已获取的Yahoo历史替换当前研究行情？建议先导出旧研究包。组合和权重不会改变。",
                          )
                        )
                          return;
                        if (
                          previewCurrencies.currency &&
                          !adoptCurrency(previewCurrencies.currency)
                        )
                          return;
                        setData(yahoo.data);
                        setError("");
                        setYahooError("");
                        setNotice(
                          `已采用${yahoo.data.assets.length}项Yahoo复权历史；请核对覆盖区间并重新运行。缺失标的需修改组合或另行补齐，权重未改动。`,
                        );
                      }}
                    >
                      使用这批行情
                    </button>
                  </div>
                )}
              </div>
              <button
                className="bt-text-button"
                disabled={reading || !cacheReady || busy}
                onClick={loadDemo}
              >
                试用合成演示 <ArrowRight size={14} />
              </button>
              <details className="bt-details bt-import-details">
                <summary>从CSV或研究包导入</summary>
                <p className="bt-help">
                  CSV可加currency列指定USD或CAD；未提供时仅按.US→USD、.TO→CAD推定，美元TSX份额务必提供currency。导入后核对币种，不能仅凭后缀认定。
                </p>
                <div className="bt-data-controls">
                  <label>
                    导入口径
                    <select
                      value={basis}
                      onChange={(e) =>
                        setBasis(e.target.value as HistoricalAsset["basis"])
                      }
                    >
                      <option value="raw">原始收盘价＋分红＋拆股</option>
                      <option value="total-return">含分红／拆股复权价</option>
                      <option value="split-adjusted">
                        仅拆股复权价 · 不含分红
                      </option>
                    </select>
                  </label>
                  <label>
                    单标的文件代码（可选）
                    <input
                      value={single}
                      placeholder="NVDA.US"
                      onChange={(e) => setSingle(e.target.value.toUpperCase())}
                    />
                  </label>
                </div>
                <div
                  className="bt-dropzone"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file && !reading && !busy) void load(file);
                  }}
                >
                  <Upload size={22} />
                  <strong>拖入 CSV 或完整研究包</strong>
                  <span>CSV ≤ 8MB · JSON ≤ 20MB · 仅在浏览器解析</span>
                  <input
                    ref={input}
                    aria-label="导入历史行情或研究包"
                    type="file"
                    accept=".csv,.json"
                    disabled={reading || !cacheReady || busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void load(f);
                      e.target.value = "";
                    }}
                  />
                </div>
                <div className="bt-row bt-wrap">
                  <button
                    className="bt-text-button"
                    onClick={() =>
                      download(
                        "backtest-template.csv",
                        BACKTEST_CSV_TEMPLATE,
                        "text/csv;charset=utf-8",
                      )
                    }
                  >
                    <Download size={14} /> CSV 模板
                  </button>
                </div>
                <details className="bt-details">
                  <summary>数据服务建议与 CSV 口径</summary>
                  <p>
                    优先考虑{" "}
                    <a
                      href="https://eodhd.com/financial-apis/api-for-historical-data-and-volumes"
                      target="_blank"
                      rel="noreferrer"
                    >
                      EODHD
                    </a>{" "}
                    的全球日线与公司行动。正式开通前，请核对具体美股／加拿大ETF历史、分红、拆股和家庭内部使用许可。Alpha
                    Vantage 与 Twelve Data 也可评估，尚未替你开通任何服务。
                  </p>
                  <p>
                    原始价格列：symbol,date,close,dividend,split。无事件填0、1，拆股为新股数／旧股数（如2）。总回报复权价列：symbol,date,adjusted_close（也接受
                    Adj Close），分红已在价格中。仅拆股复权使用
                    close，收益不包含分红。所有金额须与证券交易币种一致。
                  </p>
                </details>
              </details>
              {data && (
                <button
                  className="secondary"
                  onClick={() => {
                    if (
                      new Set(data.assets.map((a) => a.currency)).size !== 1
                    ) {
                      setError("数据包含多种币种，请分开构建组合。");
                      return;
                    }
                    if (
                      !confirm(
                        "用文件中的标的建立等权组合？只改变回测草稿，不改真实持仓。",
                      )
                    )
                      return;
                    patch({
                      holdings: data.assets.map((a) => ({
                        symbol: a.symbol,
                        weight: 100 / data.assets.length,
                      })),
                      currency: data.assets[0].currency,
                    });
                    setSelected("");
                    setPlanBaseline(null);
                    setNotice(
                      "已按文件建立等权草稿；请自行调整权重、日期与资金假设。",
                    );
                  }}
                >
                  按文件标的建立等权组合
                </button>
              )}
              {data && (
                <>
                  <div
                    className={
                      data.synthetic ? "bt-synthetic" : "bt-source-status"
                    }
                  >
                    {data.synthetic
                      ? "合成演示 · 非真实证券／市场，不可据此作投资结论"
                      : data.assets.every((a) =>
                            a.source.startsWith("Yahoo Finance"),
                          )
                        ? "Yahoo Finance历史 · 非官方接入／可能延迟，未经独立核验"
                        : "用户导入历史 · 未经第三方独立核验"}
                    <small>
                      读取于 {new Date(data.capturedAt).toLocaleString()}
                    </small>
                  </div>
                  <div className="bt-table-scroll">
                    <table className="bt-data-table">
                      <caption className="sr-only">行情质量与覆盖日期</caption>
                      <thead>
                        <tr>
                          <th>标的</th>
                          <th>币种</th>
                          <th>覆盖日期</th>
                          <th>日线</th>
                          <th>分红</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.assets.map((a) => (
                          <tr key={a.symbol}>
                            <th>{a.symbol}</th>
                            <td>{a.currency}</td>
                            <td>
                              {a.points[0].date} → {a.points.at(-1)!.date}
                            </td>
                            <td>{a.points.length.toLocaleString()}</td>
                            <td>
                              {a.dividendsKnown
                                ? "明细已提供"
                                : a.basis === "total-return"
                                  ? "已含于复权价"
                                  : "未知／未计入"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <button
                className="primary bt-run"
                disabled={!cacheReady || reading || busy}
                onClick={() => run()}
              >
                <Play size={17} /> 运行策略比较
              </button>
            </section>
            {!report ? (
              <section className="card bt-empty" hidden={step !== "results"}>
                <FlaskIcon />
                <h2>收益只是问题的一半。</h2>
                <p>
                  从Yahoo获取历史、导入数据，或先运行合成演示。
                  <br />
                  你会看到相同投入下的净值、回撤、年度回报与事件韧性。
                </p>
                <div className="bt-empty-steps">
                  <span>01 构建组合</span>
                  <ArrowRight size={15} />
                  <span>02 核对数据</span>
                  <ArrowRight size={15} />
                  <span>03 比较与研究</span>
                </div>
              </section>
            ) : (
              <section
                className="card bt-results"
                hidden={step !== "results"}
                id="backtest-results"
                ref={results}
                tabIndex={-1}
              >
                <div className="bt-section-head">
                  <div>
                    <span className="bt-kicker">03 / COMPARE</span>
                    <h2>{report.config.name}</h2>
                    <p>
                      {report.start} — {report.end} ·{" "}
                      {report.observations.toLocaleString()}个共同日线 ·{" "}
                      {report.config.currency}
                    </p>
                  </div>
                  <div className="bt-action-row">
                    <button
                      className="secondary"
                      disabled={stale || !shelfReady || busy}
                      onClick={addComparison}
                    >
                      <Plus size={15} />
                      加入组合对照
                    </button>
                    <button
                      className="bt-text-button"
                      onClick={() => setStep("design")}
                    >
                      编辑组合
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        download(
                          "together-backtest.json",
                          JSON.stringify(
                            {
                              format: "together-backtest-v1",
                              method: "together-backtest-v1",
                              config: report.config,
                              data: runData,
                            },
                            null,
                            2,
                          ),
                        )
                      }
                    >
                      <Download size={15} /> 导出研究包
                    </button>
                  </div>
                </div>
                {report.synthetic && (
                  <p className="bt-synthetic">
                    以下所有图表与指标均来自合成演示，不是真实历史收益。
                  </p>
                )}
                {stale && (
                  <p className="bt-notice" role="status">
                    设置或数据已变化。以下保留上次结果；请重新运行，AI研究暂不可用。
                  </p>
                )}
                <div className="bt-critical-warnings">
                  {report.warnings
                    .filter((w) =>
                      /不足一年|少于60|未完整覆盖|部分数据未提供/.test(w),
                    )
                    .map((w) => (
                      <p key={w}>{w}</p>
                    ))}
                </div>
                <div
                  className="bt-tabs"
                  role="tablist"
                  aria-label="回测结果视图"
                  onKeyDown={(e) => {
                    const tabs = ["compare", "events", "research"] as const;
                    const i = tabs.indexOf(tab);
                    const next =
                      e.key === "ArrowRight"
                        ? tabs[(i + 1) % 3]
                        : e.key === "ArrowLeft"
                          ? tabs[(i + 2) % 3]
                          : e.key === "Home"
                            ? tabs[0]
                            : e.key === "End"
                              ? tabs[2]
                              : null;
                    if (next) {
                      e.preventDefault();
                      setTab(next);
                      document.getElementById(`bt-tab-${next}`)?.focus();
                    }
                  }}
                >
                  {[
                    ["compare", "策略比较"],
                    ["events", "历史冲击"],
                    ["research", "AI 与家庭适配"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={tab === key}
                      tabIndex={tab === key ? 0 : -1}
                      aria-controls={`bt-panel-${key}`}
                      id={`bt-tab-${key}`}
                      onClick={() => setTab(key as typeof tab)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {tab === "compare" && (
                  <div
                    role="tabpanel"
                    id="bt-panel-compare"
                    aria-labelledby="bt-tab-compare"
                  >
                    <div className="bt-chart-head">
                      <div>
                        <h3>看增长，也看过程</h3>
                        <p>净值剔除新增投入影响；账户价值包含未投资现金。</p>
                      </div>
                      <select
                        aria-label="图表口径"
                        value={chart}
                        onChange={(e) =>
                          setChart(e.target.value as typeof chart)
                        }
                      >
                        <option value="nav">策略净值 · 初始100</option>
                        <option value="value">
                          账户价值 · {report.config.currency}
                        </option>
                        <option value="drawdown">净值回撤 · %</option>
                      </select>
                    </div>
                    <div
                      className="bt-chart"
                      role="img"
                      aria-label="策略日线表现对比，详细指标见下表"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={plot}
                          margin={{ left: 0, right: 12, top: 12, bottom: 4 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            vertical={false}
                          />
                          <XAxis
                            dataKey="date"
                            minTickGap={65}
                            tickFormatter={(v) => String(v).slice(0, 7)}
                            tick={{ fontSize: 11 }}
                          />
                          <YAxis
                            width={62}
                            domain={
                              chart === "drawdown"
                                ? ["auto", 0]
                                : ["auto", "auto"]
                            }
                            tickFormatter={(v) =>
                              chart === "drawdown"
                                ? percent(v)
                                : new Intl.NumberFormat("en", {
                                    notation: "compact",
                                  }).format(v)
                            }
                            tick={{ fontSize: 11 }}
                          />
                          <Tooltip
                            formatter={(v) =>
                              chart === "drawdown"
                                ? percent(Number(v))
                                : chart === "value"
                                  ? amount(Number(v), report.config.currency)
                                  : Number(v).toFixed(2)
                            }
                          />
                          <Legend />
                          {BACKTEST_EVENTS.filter(
                            (e) =>
                              e.start >= report.start && e.end <= report.end,
                          ).map((e) => (
                            <ReferenceArea
                              key={e.id}
                              x1={plot.find((p) => p.date >= e.start)?.date}
                              x2={
                                plot.filter((p) => p.date <= e.end).at(-1)?.date
                              }
                              fill="#bf9b65"
                              fillOpacity={0.09}
                            />
                          ))}
                          {report.results.map((s, i) => (
                            <Line
                              key={s.strategy}
                              name={s.label}
                              dataKey={`s${i}`}
                              stroke={colors[i]}
                              strokeWidth={2}
                              dot={false}
                              isAnimationActive={false}
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="bt-help">
                      阴影为已覆盖历史事件窗口。绘图适度抽样，指标始终按全部日线计算。
                      <button
                        className="bt-text-button"
                        onClick={() => setTab("events")}
                      >
                        查看事件表现 →
                      </button>
                    </p>
                    <div className="bt-table-scroll">
                      <table className="bt-metrics">
                        <caption>同样的外部投入，不同的部署方式</caption>
                        <thead>
                          <tr>
                            <th>指标</th>
                            {report.results.map((r, i) => (
                              <th key={r.strategy}>
                                <i style={{ background: colors[i] }} />
                                {r.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(
                            [
                              [
                                "期末账户价值",
                                (
                                  m: BacktestReport["results"][number]["metrics"],
                                ) => amount(m.final, report.config.currency),
                              ],
                              [
                                "累计投入",
                                (m) =>
                                  amount(m.invested, report.config.currency),
                              ],
                              [
                                "投资净收益 · 含息及费用",
                                (m) => amount(m.gain, report.config.currency),
                              ],
                              [
                                "年化回报 CAGR · 时间加权",
                                (m) => percent(m.cagr),
                              ],
                              [
                                "资金年化 XIRR · 现金流加权",
                                (m) => percent(m.xirr),
                              ],
                              ["累计净值回报 TWR", (m) => percent(m.twr)],
                              ["最大净值回撤", (m) => percent(m.maxDrawdown)],
                              [
                                "年化波动率 · 252日",
                                (m) => percent(m.volatility),
                              ],
                              [
                                "Sharpe · 固定无风险假设",
                                (m) =>
                                  m.sharpe === null
                                    ? "不适用"
                                    : m.sharpe.toFixed(2),
                              ],
                              [
                                "累计分红 · 已含在总回报",
                                (m) =>
                                  amount(m.dividends, report.config.currency),
                              ],
                              [
                                "现金利息 · 已含在总回报",
                                (m) =>
                                  amount(
                                    m.cashInterest,
                                    report.config.currency,
                                  ),
                              ],
                              [
                                "交易费用＋滑点",
                                (m) => amount(m.fees, report.config.currency),
                              ],
                              [
                                "峰值至恢复 · 日历天",
                                (m) =>
                                  m.maxDrawdown === 0
                                    ? "无回撤"
                                    : m.recoveryDays === null
                                      ? "期末仍未恢复"
                                      : `${Math.round(m.recoveryDays)}天`,
                              ],
                            ] satisfies [
                              string,
                              (
                                m: BacktestReport["results"][number]["metrics"],
                              ) => string,
                            ][]
                          ).map(([label, format]) => (
                            <tr key={String(label)}>
                              <th scope="row">{String(label)}</th>
                              {report.results.map((s) => (
                                <td key={s.strategy}>
                                  {(
                                    format as (
                                      m: BacktestReport["results"][number]["metrics"],
                                    ) => string
                                  )(s.metrics)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <details className="bt-details">
                      <summary>年度回报与回撤日期</summary>
                      <p className="bt-help">
                        年度为该日历年实际覆盖区间的净值回报，首末年可能不足一年，不对短年再次年化。
                      </p>
                      <div className="bt-table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>年份</th>
                              {report.results.map((s) => (
                                <th key={s.strategy}>{s.label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {report.results[0].years.map((y, i) => (
                              <tr key={y.year}>
                                <th>{y.year}</th>
                                {report.results.map((s) => (
                                  <td key={s.strategy}>
                                    {percent(s.years[i].return)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {report.results.map((s) => (
                        <p key={s.strategy}>
                          {s.label}：峰值 {s.metrics.peakDate} → 谷底{" "}
                          {s.metrics.troughDate} →{" "}
                          {s.metrics.maxDrawdown === 0
                            ? "无回撤"
                            : (s.metrics.recovery ?? "尚未恢复")}
                        </p>
                      ))}
                    </details>
                  </div>
                )}
                {tab === "events" && (
                  <div
                    role="tabpanel"
                    id="bt-panel-events"
                    aria-labelledby="bt-tab-events"
                  >
                    <div className="bt-chart-head">
                      <div>
                        <h3>当市场遭遇冲击</h3>
                        <p>
                          比较的是你的组合在事件窗口内的历史表现，不是市场指数跌幅。
                        </p>
                      </div>
                    </div>
                    <div className="bt-events">
                      {events.map((e) => (
                        <article key={e.id} className="bt-event">
                          <div className="bt-event-title">
                            <div>
                              <span>
                                {e.start} — {e.end}
                              </span>
                              <h3>{e.title}</h3>
                            </div>
                            <a href={e.source} target="_blank" rel="noreferrer">
                              事件背景 ↗
                            </a>
                          </div>
                          <p>{e.note}</p>
                          <div className="bt-event-strategies">
                            {report.results.map((s, i) => {
                              const v = s.events.find((v) => v.id === e.id)!;
                              return (
                                <div key={s.strategy}>
                                  <strong style={{ color: colors[i] }}>
                                    {s.label}
                                  </strong>
                                  <span>
                                    {v.coverage === "none"
                                      ? "未覆盖"
                                      : v.coverage === "partial"
                                        ? "仅部分覆盖"
                                        : "完整窗口"}
                                  </span>
                                  <b>
                                    {v.coverage === "none"
                                      ? "—"
                                      : percent(v.return)}
                                  </b>
                                  <small>
                                    窗口回撤{" "}
                                    {v.coverage === "none"
                                      ? "—"
                                      : percent(v.drawdown)}
                                  </small>
                                  <small>
                                    {v.start && v.coverage !== "none"
                                      ? `${v.start} → ${v.end}`
                                      : "不要将缺失误读为零风险"}
                                  </small>
                                </div>
                              );
                            })}
                          </div>
                        </article>
                      ))}
                    </div>
                    <p className="bt-help">
                      窗口回报以窗口前最后一个交易日为基准；回撤为窗口内局部峰谷，不等同于全时期最大回撤。事件集并非穷尽，未显示不代表没有风险。
                    </p>
                  </div>
                )}
                {tab === "research" && (
                  <div
                    role="tabpanel"
                    id="bt-panel-research"
                    aria-labelledby="bt-tab-research"
                  >
                    <h3>把结果放回你们的生活</h3>
                    <p>
                      {report.config.risk.horizon}年规划 · 可承受回撤{" "}
                      {report.config.risk.maxLoss}% ·{" "}
                      {report.config.risk.purpose || "未填写用途"}
                    </p>
                    <div className="bt-suitability">
                      {report.results.map((s, i) => (
                        <div key={s.strategy}>
                          <span style={{ color: colors[i] }}>{s.label}</span>
                          <strong>
                            {Math.abs(s.metrics.maxDrawdown) * 100 >
                            report.config.risk.maxLoss
                              ? "历史回撤超出设定承受线"
                              : "历史区间未超过承受线"}
                          </strong>
                          <small>不代表未来损失上限或适合性认证。</small>
                        </div>
                      ))}
                    </div>
                    <label className="bt-check">
                      <input
                        type="checkbox"
                        checked={household}
                        disabled={busy}
                        onChange={(e) => {
                          setHousehold(e.target.checked);
                          setMessages([]);
                          privateHistory.current = false;
                          setRoute("");
                          setNotice(
                            "家庭背景授权已变化，开始新对话，先前私密内容不带入未授权请求。",
                          );
                        }}
                      />
                      <span>
                        联动当前家庭汇总，发送给所选 AI 服务商
                        <small>
                          仅净资产、现金参考、预算与目标；不发送成员、账户明细或家庭聊天。
                        </small>
                      </span>
                    </label>
                    {household && (
                      <div className="bt-household">
                        <dl>
                          <div>
                            <dt>当前净资产 · CAD</dt>
                            <dd>{amount(context.netWorth, "CAD")}</dd>
                          </div>
                          <div>
                            <dt>记录的月结余 · CAD</dt>
                            <dd>
                              {amount(context.monthlyBudgetSurplus, "CAD")}
                            </dd>
                          </div>
                          <div>
                            <dt>本次计划月投入 · CAD</dt>
                            <dd>
                              {amount(
                                report.config.monthly *
                                  (report.config.currency === "CAD"
                                    ? 1
                                    : report.config.risk.cadPerUnit),
                                "CAD",
                              )}
                            </dd>
                          </div>
                        </dl>
                        <p>
                          现金参考 {amount(context.cashReference.amount, "CAD")}
                          ，其中{" "}
                          {amount(context.cashReference.unverified, "CAD")}{" "}
                          流动性未核实。预算结余不是已确认可投资额度；USD使用计划内手填汇率{" "}
                          {report.config.risk.cadPerUnit}，不是实时汇率。
                        </p>
                        <a href="/#cashflow">核对家庭现金流 →</a>
                        {context.monthlyBudgetSurplus !== null &&
                          report.config.monthly *
                            (report.config.currency === "CAD"
                              ? 1
                              : report.config.risk.cadPerUnit) >
                            Math.max(0, context.monthlyBudgetSurplus) && (
                            <p className="bt-negative">
                              计划月投入高于已记录的月预算结余；请先核对持续投入来源，不应仅凭历史回报提高投入。
                            </p>
                          )}
                        <p>
                          本金未绑定真实账户，应急金、近期大额开支和锁定资产不能自动视为投资资金。
                        </p>
                      </div>
                    )}
                    <label className="bt-check">
                      <input
                        type="checkbox"
                        checked={currentMarket}
                        disabled={busy}
                        onChange={(e) => setCurrentMarket(e.target.checked)}
                      />
                      <span>
                        提问时读取官方公开宏观／情绪观测
                        <small>
                          如
                          VIX、利率、CPI；附观测日期，可能滞后，不提供实时预测。
                        </small>
                      </span>
                    </label>
                    <div className="bt-field-grid">
                      <label>
                        研究模型
                        <select
                          disabled={busy}
                          value={model}
                          onChange={(e) =>
                            setModel(e.target.value as typeof model)
                          }
                        >
                          <option value="deepseek-chat">
                            DeepSeek · 省钱优先
                          </option>
                          <option value="auto">
                            自动路由 · 复杂题可能使用旗舰
                          </option>
                        </select>
                      </label>
                      <div className="bt-help">
                        只有提交问题才调用模型，可能产生 API
                        费用。AI不会下单或更改数据。
                      </div>
                    </div>
                    <div className="bt-prompts">
                      {[
                        "哪个策略更符合我的期限和回撤承受力？",
                        "找出这次回测最可能误导我的三个假设。",
                        "结合已提供的公开观测，哪些风险需要继续核验？",
                      ].map((q) => (
                        <button
                          key={q}
                          disabled={busy}
                          onClick={() => setQuestion(q)}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                    <div
                      className="bt-chat"
                      ref={transcript}
                      aria-label="回测研究对话"
                      aria-live="polite"
                    >
                      {!messages.length && (
                        <div className="bt-chat-empty">
                          <Sparkles size={24} />
                          <p>研究差异与盲点，不把历史收益当成未来承诺。</p>
                        </div>
                      )}
                      {messages.map((m, i) => (
                        <article
                          key={i}
                          className={`bt-message bt-message-${m.role}`}
                        >
                          <strong>
                            {m.role === "user" ? "你" : "投资研究助手"}
                          </strong>
                          <AdvisorMarkdown text={m.text} />
                        </article>
                      ))}
                      {busy && <p role="status">正在核验回测与研究背景…</p>}
                    </div>
                    <form
                      onSubmit={(e) => void ask(e)}
                      className="bt-chat-form"
                    >
                      <label className="sr-only" htmlFor="bt-question">
                        继续研究或追问
                      </label>
                      <textarea
                        id="bt-question"
                        maxLength={3000}
                        value={question}
                        placeholder="继续追问、检验假设或讨论风险…"
                        onChange={(e) => setQuestion(e.target.value)}
                        disabled={busy}
                      />
                      <button
                        className="primary"
                        disabled={busy || stale || !question.trim()}
                      >
                        <Sparkles size={16} /> 提问
                      </button>
                      {busy && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => request.current?.abort()}
                        >
                          停止
                        </button>
                      )}
                    </form>
                    {error && <p className="bt-notice bt-error">{error}</p>}
                    {route && <small className="bt-help">{route}</small>}
                    <p className="bt-help">
                      最近40条对话缓存于此设备的家庭空间，不跨设备共享；可导出完整当前对话。重新运行开始新的研究上下文，不串用旧结论。清除浏览器数据会移除缓存。
                    </p>
                    {messages.length > 0 && (
                      <button
                        className="bt-text-button"
                        onClick={() =>
                          download(
                            "backtest-research.md",
                            `# ${report.config.name}\n\n${report.synthetic ? "合成数据，非投资依据\n\n" : ""}${messages.map((m) => `## ${m.role === "user" ? "问题" : "研究回复"}\n\n${m.text}`).join("\n\n")}`,
                            "text/markdown;charset=utf-8",
                          )
                        }
                      >
                        <Download size={14} /> 导出本次对话
                      </button>
                    )}
                  </div>
                )}
                <details className="bt-details bt-method">
                  <summary>方法、来源与局限</summary>
                  <ul>
                    {report.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                  <p>
                    CAGR 使用剔除外部现金流后的单位净值；XIRR
                    使用每笔实际投入日期与期末价值。两者不能混为一谈。Sharpe
                    用日收益均值减固定日无风险回报，除以样本标准差，再按252日年化；零波动不报告有意义的Sharpe。
                  </p>
                  <p>
                    最大回撤从单位净值历史峰值计算，包含未投入现金；恢复期从最差回撤的峰值日起计算。未恢复并非零天。不同起始日期可能显著改变结果。
                  </p>
                  {report.sources.map((s) => (
                    <p key={s.symbol}>
                      {s.symbol} · {s.basis} · {s.source}
                    </p>
                  ))}
                  <a
                    href="https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/rates-and-returns"
                    target="_blank"
                    rel="noreferrer"
                  >
                    TWR 与资金加权回报概念 · CFA Institute ↗
                  </a>
                </details>
              </section>
            )}
          </div>
        </div>
      </div>
      <div hidden={mode !== "portfolios"}>
        <PortfolioComparison
          shelf={shelf}
          ready={shelfReady}
          status={shelfStatus}
          onChange={changeShelf}
          onEdit={editComparison}
          onBack={() => {
            setMode("workspace");
            setStep("design");
          }}
        />
      </div>
      <div hidden={mode !== "collection"}>
        <PortfolioCollection
          lab={lab}
          selected={selected}
          editable={editable && cacheReady}
          onLoad={loadPlan}
          onRemove={removePlan}
          onSave={save}
          onBack={() => setMode("workspace")}
        />
      </div>
    </>
  );
}
function FlaskIcon() {
  return <RotateCcw size={32} strokeWidth={1.5} />;
}
