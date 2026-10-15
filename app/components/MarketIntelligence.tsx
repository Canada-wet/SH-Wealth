"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import type { MarketData, MarketReading } from "@/lib/market";
import { formatPeriod, readingChange, signed } from "@/lib/market-analysis";
import {
  INDICATOR_GROUPS,
  MARKET_INDICATORS,
  observationAge,
  volatilityTerm,
} from "@/lib/market-indicators";
import type { MarketBrief } from "@/lib/market-briefing";
type Group = keyof typeof INDICATOR_GROUPS;
const level = (value: number) =>
  new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 }).format(value);

function Fact({ row }: { row: MarketReading }) {
  return (
    <a href={row.source} target="_blank" rel="noopener noreferrer">
      {row.label} ·{" "}
      {row.value === null ? "缺失" : `${level(row.value)} ${row.unit}`} ·{" "}
      {formatPeriod(row)} ↗
    </a>
  );
}
export default function MarketIntelligence({
  data,
}: {
  data: MarketData | null;
}) {
  const [group, setGroup] = useState<Group>("sentiment");
  const [ready, setReady] = useState(false);
  const [reports, setReports] = useState<MarketBrief[]>([]),
    [selectedDay, setSelectedDay] = useState(""),
    [today, setToday] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [info, setInfo] = useState("");
  const attempted = useRef(""),
    active = useRef<AbortController | null>(null);
  const load = useCallback(async (generate = false) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const timer = setTimeout(
      () => controller.abort(),
      generate ? 55000 : 15000,
    );
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const response = await fetch("/api/market/briefing", {
        method: generate ? "POST" : "GET",
        ...(generate
          ? { headers: { "content-type": "application/json" }, body: "{}" }
          : {}),
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403)
        throw new Error("登录已失效或无权限，请重新登录后读取简报。");
      if (!response.ok)
        throw new Error(
          generate
            ? "简报暂未完成；请稍后重试，已有历史会保留。"
            : "每日简报暂不可用，其他行情仍可查看。",
        );
      const result = await response.json();
      if (!Array.isArray(result.reports) || typeof result.today !== "string")
        throw new Error("简报响应格式异常，请重试。");
      if (controller.signal.aborted || active.current !== controller) return;
      setReports(result.reports);
      setToday(result.today);
      if (
        generate &&
        !result.reports.some((row: MarketBrief) => row.day === result.today)
      )
        setInfo(
          "今日简报正在生成，或先前任务等待恢复。稍后点击“检查今日简报”；不会并发重复付费调用。",
        );
      if (
        !generate &&
        result.canGenerate &&
        !result.reports.some((row: MarketBrief) => row.day === result.today) &&
        attempted.current !== result.today
      ) {
        attempted.current = result.today;
        clearTimeout(timer);
        active.current = null;
        // Schedule outside this request's finally block; StrictMode cleanup cancels the timer.
        auto.current = setTimeout(() => void load(true), 0);
      }
    } catch (reason) {
      if (active.current === controller)
        setError(
          controller.signal.aborted
            ? "读取超时，历史简报仍保留，请重试。"
            : reason instanceof Error
              ? reason.message
              : "简报读取失败。",
        );
    } finally {
      clearTimeout(timer);
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }, []);
  const auto = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setReady(true);
    void load();
    const check = () => {
      if (!document.hidden) void load();
    };
    const timer = setInterval(check, 300000);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      clearTimeout(auto.current);
      active.current?.abort();
      active.current = null;
      document.removeEventListener("visibilitychange", check);
    };
  }, [load]);
  const report = reports.find((row) => row.day === selectedDay) ?? reports[0];
  const indicators = data?.indicators ?? [];
  const rows = MARKET_INDICATORS.filter((row) => row.group === group).map(
    (definition) =>
      indicators.find((row) => row.id === definition.id) ?? {
        ...definition,
        value: null,
        date: null,
        trend: [],
        source: `https://fred.stlouisfed.org/series/${definition.id}`,
      },
  );
  const term = volatilityTerm(indicators);
  return (
    <section
      className="card market-section market-intelligence"
      id="market-intelligence"
      aria-label="每日市场简报与指标"
    >
      <div className="card-head">
        <div>
          <p className="eyebrow">DAILY BRIEF · EVIDENCE FIRST</p>
          <h2>
            <Sparkles size={18} aria-hidden="true" /> 每日市场简报
          </h2>
          <p>情绪、经济前瞻与 AI 产业线索，先核对事实，再看简短分析。</p>
        </div>
        <button
          className="secondary"
          disabled={!ready || busy}
          onClick={() => {
            attempted.current = "";
            void load();
          }}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {busy ? "正在读取简报…" : "检查今日简报"}
        </button>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {info && (
        <p role="status" className="market-notice">
          {info}
        </p>
      )}
      <div className="market-brief-layout">
        <div className="market-brief-narrative">
          <div className="market-brief-toolbar">
            <span className="market-badge">
              {report?.mode === "ai"
                ? `AI · ${report.provider} · ${report.model}`
                : report
                  ? "规则摘要 · 非 AI"
                  : "等待每日简报"}
            </span>
            {reports.length > 0 && (
              <select
                aria-label="查看历史市场简报"
                value={report?.day ?? ""}
                onChange={(event) => setSelectedDay(event.target.value)}
              >
                {reports.map((row) => (
                  <option key={row.day} value={row.day}>
                    {row.day}
                    {row.day === today ? " · 今日" : " · 历史"}
                  </option>
                ))}
              </select>
            )}
          </div>
          {report ? (
            <>
              <p className="market-brief-summary">{report.summary}</p>
              {report.day !== today && (
                <p className="desk-help">
                  当前查看 {report.day}{" "}
                  的归档，不代表今日市场；引用值为生成时快照。
                </p>
              )}
              <div className="market-brief-points">
                {report.points.map((point, index) => (
                  <article key={index}>
                    <h3>{point.title}</h3>
                    <p>{point.text}</p>
                    <details>
                      <summary>核对依据 · {point.evidence.length} 项</summary>
                      <div className="market-brief-evidence">
                        {point.evidence.map((id) => {
                          const fact = report.facts.find(
                            (row) => row.id === id,
                          );
                          return fact ? <Fact key={id} row={fact} /> : null;
                        })}
                      </div>
                    </details>
                  </article>
                ))}
              </div>
              <div className="market-brief-next">
                <b>接下来关注</b>
                <p>{report.watchNext}</p>
              </div>
              <p className="desk-help">{report.limitations}</p>
              <small className="desk-help">
                生成：
                {new Date(report.generatedAt).toLocaleString("zh-CN", {
                  timeZone: "America/Toronto",
                })}{" "}
                多伦多时间 · 数据读取：
                {new Date(report.dataAt).toLocaleString("zh-CN", {
                  timeZone: "America/Toronto",
                })}
              </small>
            </>
          ) : (
            <p className="empty-note" role="status">
              {busy
                ? "正在读取或准备今日简报…"
                : "暂无已保存简报。可点击“检查今日简报”生成；不影响现有行情。"}
            </p>
          )}
        </div>
        <div className="market-indicator-panel">
          <div
            className="market-indicator-tabs"
            role="group"
            aria-label="市场指标类别"
          >
            {Object.entries(INDICATOR_GROUPS).map(([id, label]) => (
              <button
                className="secondary"
                disabled={!ready}
                aria-pressed={group === id}
                key={id}
                onClick={() => setGroup(id as Group)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="desk-help">
            以下为当前最新可用观测；左侧归档引用的是当时快照，二者日期可能不同。
          </p>
          <div className="market-indicator-list">
            {rows.map((row) => {
              const change = readingChange(row),
                age = observationAge(row);
              return (
                <article key={row.id}>
                  <div>
                    <h3>{row.label}</h3>
                    <b>
                      {row.value === null
                        ? "暂不可用"
                        : `${level(row.value)} ${row.unit}`}
                    </b>
                  </div>
                  <p className="market-indicator-date">
                    {formatPeriod(row)} ·{" "}
                    {
                      {
                        daily: "日收盘",
                        weekly: "周频",
                        monthly: "月频",
                        quarterly: "季频",
                      }[row.frequency]
                    }
                    {age.delayed ? " · 期间较旧，请核对" : ""}
                  </p>
                  {change && (
                    <small>
                      {change.label} {signed(change.value)} {change.unit}
                    </small>
                  )}
                  <details>
                    <summary>口径与来源</summary>
                    <p>{row.note}</p>
                    <a
                      href={row.source}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      原始序列 · {row.id} ↗
                    </a>
                  </details>
                </article>
              );
            })}
          </div>
          {group === "sentiment" && (
            <p className="market-term-note">
              {term
                ? `${term.date} · VIX / VIX3M = ${term.ratio.toFixed(2)}；${term.description}。`
                : "VIX 与 VIX3M 未返回同日有效值，暂不计算比值。"}
              此比值描述隐含波动期限关系，不是期货升贴水或买卖信号。
            </p>
          )}
          {group === "ai" && (
            <div className="market-term-note">
              <b>尚不能从这些数据证明什么？</b>
              <p>
                它们不是全球 AI 供需指数，不覆盖实时 GPU 租价、HBM
                库存、先进封装交期或企业 AI
                收入。产出上升也可能来自补库存，不能单凭一个指标判定需求强弱。
              </p>
              <a
                href="https://www.census.gov/construction/c30/historical_data.html"
                target="_blank"
                rel="noopener noreferrer"
              >
                补充核对：Census 数据中心建设支出原表 ↗
              </a>
            </div>
          )}
        </div>
      </div>
      <details className="market-brief-policy">
        <summary>每日更新、费用与数据边界</summary>
        <p>
          每天安排 14:00 UTC 生成（多伦多夏令时约 10 点、冬令时约 9
          点，调度可能延迟）；首次打开时可补齐当天简报。每天共用一份，刷新不重复调用模型，最近
          7 份可回看。优先低成本模型；失败降级为明确标注的规则摘要。月度 /
          周度指标不是每日新发布。仅发送固定公开序列，不发送家庭金额、持仓、自选名称或聊天。没有新增付费行情订阅；AI
          生成计入现有 API 用量。
        </p>
        <p>
          Cboe 的 VIX / VIX3M 通过 FRED 引用，保留来源与版权说明。AI
          解读可能出错，应核对引用；不提供确定的市场方向或自动交易。
        </p>
      </details>
    </section>
  );
}
