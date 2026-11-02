"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Copy, Download, Play, Trash2, Upload } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  STRATEGIES,
  type BacktestStrategy,
  type BacktestLab,
  type BacktestConfig,
  type BacktestData,
} from "@/lib/backtest-schema";
import CollectionComparisonPicker from "./CollectionComparisonPicker";
import { stableJSON } from "@/lib/cloud-plan";
import {
  exportPortfolioShelf,
  readPortfolioShelf,
  runPortfolioComparison,
  type PortfolioComparison as ComparisonReport,
  type PortfolioShelf,
  type PortfolioStudy,
} from "@/lib/backtest-comparison";
import { syntheticBacktest } from "@/lib/backtest-import";
import type { BacktestResult } from "@/lib/backtest";
import { BACKTEST_EVENTS } from "@/lib/backtest-events";

const colors = ["#315b4d", "#ad7735", "#6d6caa", "#43818b"];
const pct = (n: number | null) =>
  n === null ? "未知" : `${(n * 100).toFixed(2)}%`;
const money = (n: number | null, currency: string) =>
  n === null
    ? "未知"
    : new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(n);
const delta = (n: number | null, base: number | null) =>
  n === null || base === null
    ? "未知"
    : `${n >= base ? "+" : ""}${((n - base) * 100).toFixed(2)}个百分点`;
export default function PortfolioComparison({
  shelf,
  ready,
  status,
  onChange,
  onEdit,
  onBack,
  lab,
  draft,
  onLibrary,
  onPrepareBusy,
}: {
  shelf: PortfolioShelf;
  ready: boolean;
  status: string;
  onChange: (s: PortfolioShelf) => void;
  onEdit: (s: PortfolioStudy) => void;
  onBack: () => void;
  lab: BacktestLab;
  draft?: { config: BacktestConfig; data: BacktestData | null };
  onLibrary: () => void;
  onPrepareBusy: (busy: boolean) => void;
}) {
  const [report, setReport] = useState<ComparisonReport | null>(null),
    [input, setInput] = useState<PortfolioShelf | null>(null),
    [error, setError] = useState("");
  const [chart, setChart] = useState<"nav" | "value" | "drawdown">("nav"),
    [event, setEvent] = useState("covid");
  const [preparing, setPreparing] = useState(false);
  const file = useRef<HTMLInputElement>(null),
    result = useRef<HTMLElement>(null);
  const latestShelf = useRef(shelf),
    importSequence = useRef(0);
  latestShelf.current = shelf;
  useEffect(
    () => () => {
      importSequence.current++;
    },
    [],
  );
  const libraryChanged = shelf.studies.some(
    (s) =>
      s.origin &&
      shelf.selected.includes(s.id) &&
      lab.saved.some((p) => p.id === s.origin!.planId) &&
      !lab.saved.some(
        (p) =>
          p.id === s.origin!.planId &&
          p.at === s.origin!.savedAt &&
          stableJSON(p.config) === s.origin!.configKey,
      ),
  );
  const stale = !!report && (input !== shelf || libraryChanged);
  const selected = shelf.studies.filter((p) => shelf.selected.includes(p.id));
  const base = report?.items.find((p) => p.id === report.baseline);
  const metric = (p: ComparisonReport["items"][number]) =>
    p.report.results[0].metrics;
  const curve = useMemo(
    () =>
      report?.items[0].report.results[0].points.flatMap((p, index, all) =>
        index % Math.max(1, Math.ceil(all.length / 1500)) === 0 ||
        index === all.length - 1
          ? [
              {
                date: p.date,
                ...Object.fromEntries(
                  report.items.map((r, i) => [
                    `p${i}`,
                    r.report.results[0].points[index][chart],
                  ]),
                ),
              },
            ]
          : [],
      ) ?? [],
    [report, chart],
  );
  const resultColor = (id: string) =>
    colors[Math.max(0, input?.studies.findIndex((p) => p.id === id) ?? 0)];
  const update = (s: PortfolioShelf) => {
    setError("");
    onChange(s);
  };
  const toggle = (id: string) => {
    const next = shelf.selected.includes(id)
      ? shelf.selected.filter((x) => x !== id)
      : [...shelf.selected, id];
    update({
      ...shelf,
      selected: next,
      baseline: next.includes(shelf.baseline)
        ? shelf.baseline
        : (next[0] ?? ""),
    });
  };
  const exportPack = () => {
    try {
      const url = URL.createObjectURL(
        new Blob([exportPortfolioShelf(shelf)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "together-portfolio-comparison.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const demo = () => {
    const p = syntheticBacktest();
    const studies = [70, 30].map((weight, i) => ({
      id: crypto.randomUUID(),
      title: `组合${i ? "B" : "A"} · 合成${weight}/${100 - weight}`,
      at: new Date().toISOString(),
      config: {
        ...structuredClone(p.config),
        name: `合成组合${i + 1}`,
        holdings: [
          { symbol: "DEMO1.US", weight },
          { symbol: "DEMO2.US", weight: 100 - weight },
        ],
      },
      data: structuredClone(p.data),
    }));
    update({
      version: 1,
      studies,
      selected: studies.map((s) => s.id),
      baseline: studies[0].id,
      strategy: "buy-hold",
    });
  };
  const rows: [string, (m: BacktestResult["metrics"]) => string][] = [
    ["期末账户价值", (m) => money(m.final, report!.currency)],
    ["累计投入", (m) => money(m.invested, report!.currency)],
    ["年化回报 CAGR", (m) => pct(m.cagr)],
    ["资金年化 XIRR", (m) => pct(m.xirr)],
    ["累计净值回报 TWR", (m) => pct(m.twr)],
    ["最大净值回撤", (m) => pct(m.maxDrawdown)],
    ["年化波动率", (m) => pct(m.volatility)],
    ["Sharpe", (m) => (m.sharpe === null ? "未知" : m.sharpe.toFixed(2))],
    ["累计分红 · 已含于总回报", (m) => money(m.dividends, report!.currency)],
    ["现金利息", (m) => money(m.cashInterest, report!.currency)],
    ["交易费用＋滑点", (m) => money(m.fees, report!.currency)],
    [
      "峰值至恢复",
      (m) => (m.recoveryDays === null ? "尚未恢复" : `${m.recoveryDays}天`),
    ],
  ];
  return (
    <section className="bt-portfolio" aria-label="多组合对照">
      <header className="bt-comparison-header">
        <div>
          <p className="bt-kicker">PORTFOLIO / VS / PORTFOLIO</p>
          <h2>不同组合，同一把尺。</h2>
          <p>从组合库选2–4个组合，准备共同历史，再统一策略与资金比较。</p>
        </div>
        <div className="bt-action-row">
          <button className="secondary" disabled={preparing} onClick={onBack}>
            <ArrowLeft size={15} /> 继续构建组合
          </button>
          <button
            className="bt-text-button"
            disabled={!ready || preparing}
            onClick={() => file.current?.click()}
          >
            <Upload size={15} /> 导入对照包
          </button>
          <button
            className="bt-text-button"
            disabled={!shelf.studies.length || preparing}
            onClick={exportPack}
          >
            <Download size={15} /> 导出对照包
          </button>
          <input
            ref={file}
            hidden
            aria-label="导入组合对照包"
            type="file"
            accept=".json"
            disabled={!ready || preparing}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              const sequence = ++importSequence.current,
                baseline = shelf;
              try {
                if (f.size > 20_000_000) throw Error("对照包不能超过20MB。");
                const next = readPortfolioShelf(await f.text());
                if (sequence !== importSequence.current) return;
                if (latestShelf.current !== baseline)
                  throw Error(
                    "导入期间组合对照已变化，请重新选择文件，避免覆盖新编辑。",
                  );
                if (
                  shelf.studies.length &&
                  !confirm(
                    "用对照包替换本设备的对照快照？原家庭计划和财富账本不会改变。",
                  )
                )
                  return;
                update(next);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        </div>
      </header>
      {error && (
        <p role="alert" className="bt-notice bt-error">
          {error}
        </p>
      )}
      <CollectionComparisonPicker
        lab={lab}
        shelf={shelf}
        draft={draft}
        ready={ready}
        onChange={update}
        onLibrary={onLibrary}
        onBusy={(b) => {
          setPreparing(b);
          onPrepareBusy(b);
        }}
        onPrepared={(next, r) => {
          update(next);
          setReport(r);
          setInput(next);
          setEvent(
            BACKTEST_EVENTS.find(
              (e) =>
                r.items[0].report.results[0].events.find((x) => x.id === e.id)
                  ?.coverage !== "none",
            )?.id ?? BACKTEST_EVENTS[0].id,
          );
          requestAnimationFrame(() => {
            result.current?.focus({ preventScroll: true });
            result.current?.scrollIntoView?.({
              block: "start",
              behavior: "smooth",
            });
          });
        }}
      />
      <fieldset className="bt-snapshot-fieldset" disabled={preparing}>
        <details className="bt-snapshot-details" open={!lab.saved.length}>
          <summary>已有研究快照 · {shelf.studies.length}（本机）</summary>
          {!shelf.studies.length ? (
            <div className="card bt-comparison-empty">
              <Copy size={28} />
              <h3>也可以继续已有的研究快照</h3>
              <p>
                组合库是主要入口。临时研究仍可从工作台运行后加入，或导入已有对照包；下方演示不会代表你的真实组合。
              </p>
              <button className="secondary" disabled={!ready} onClick={demo}>
                体验两个组合 · 合成演示
              </button>
            </div>
          ) : (
            <div className="bt-portfolio-cards">
              {shelf.studies.map((p, i) => (
                <article
                  className={`card bt-portfolio-card ${shelf.selected.includes(p.id) ? "is-selected" : ""}`}
                  key={p.id}
                  style={{ borderTopColor: colors[i] }}
                >
                  <div className="bt-row">
                    <label className="bt-check">
                      <input
                        type="checkbox"
                        aria-label={`参与对照：${p.title}`}
                        checked={shelf.selected.includes(p.id)}
                        onChange={() => toggle(p.id)}
                      />
                      组合 {String.fromCharCode(65 + i)}
                    </label>
                    <span className="bt-pill">
                      {p.data.synthetic ? "合成演示" : p.config.currency}
                      {shelf.baseline === p.id ? " · 基准" : ""}
                    </span>
                  </div>
                  <label>
                    组合{i + 1}名称
                    <input
                      value={p.title}
                      maxLength={100}
                      onChange={(e) =>
                        update({
                          ...shelf,
                          studies: shelf.studies.map((s) =>
                            s.id === p.id ? { ...s, title: e.target.value } : s,
                          ),
                        })
                      }
                    />
                  </label>
                  <p className="bt-portfolio-holdings">
                    {p.config.holdings
                      .map((h) => `${h.symbol} ${Number(h.weight.toFixed(2))}%`)
                      .join(" · ")}
                  </p>
                  <small>
                    {p.config.start} → {p.config.end}
                    {p.origin && (
                      <>
                        <br />
                        来源：组合库 ·{" "}
                        {new Date(p.origin.savedAt).toLocaleString()}
                      </>
                    )}
                  </small>
                  <div className="bt-action-row">
                    <button
                      className="bt-text-button"
                      onClick={() => onEdit(p)}
                    >
                      <Copy size={14} /> 复制到工作台修改
                    </button>
                    <button
                      className="bt-text-button"
                      aria-label={`移除对照组合${i + 1}`}
                      onClick={() => {
                        if (
                          !confirm(
                            "只从本机对照中移除此快照？原家庭计划、当前草稿和真实持仓不受影响。",
                          )
                        )
                          return;
                        const next = shelf.selected.filter((x) => x !== p.id);
                        update({
                          ...shelf,
                          studies: shelf.studies.filter((s) => s.id !== p.id),
                          selected: next,
                          baseline: next.includes(shelf.baseline)
                            ? shelf.baseline
                            : (next[0] ?? ""),
                        });
                      }}
                    >
                      <Trash2 size={14} /> 移除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className="bt-help" role="status">
            {status ||
              "对照快照仅缓存于本设备的家庭空间，不自动同步价格或修改账本。"}
          </p>
          {!!shelf.studies.length && (
            <div className="card bt-comparison-controls">
              <div className="bt-comparison-fields">
                <label>
                  统一策略
                  <select
                    aria-label="统一策略"
                    value={shelf.strategy}
                    onChange={(e) =>
                      update({
                        ...shelf,
                        strategy: e.target.value as BacktestStrategy,
                      })
                    }
                  >
                    {Object.entries(STRATEGIES).map(([key, name]) => (
                      <option value={key} key={key}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  资金与费用基准
                  <select
                    aria-label="资金与费用基准"
                    value={shelf.baseline}
                    disabled={!selected.length}
                    onChange={(e) =>
                      update({ ...shelf, baseline: e.target.value })
                    }
                  >
                    {!selected.length && <option value="">请先勾选组合</option>}
                    {selected.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="primary"
                  disabled={selected.length < 2}
                  onClick={() => {
                    try {
                      if (libraryChanged)
                        throw Error(
                          "组合库配置已更新，请在上方准备最新组合后再运行；旧快照仍保留。",
                        );
                      const r = runPortfolioComparison(shelf);
                      setReport(r);
                      setInput(shelf);
                      setEvent(
                        BACKTEST_EVENTS.find(
                          (e) =>
                            r.items[0].report.results[0].events.find(
                              (x) => x.id === e.id,
                            )?.coverage !== "none",
                        )?.id ?? BACKTEST_EVENTS[0].id,
                      );
                      setError("");
                      requestAnimationFrame(() =>
                        result.current?.focus({ preventScroll: true }),
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <Play size={16} /> 运行组合对照
                </button>
              </div>
              <p>
                统一使用基准组合的资金、月供和费用等假设；各组合保留自己的持仓权重。实际区间取全部所选持仓的共同历史，不补缺失价格。
              </p>
            </div>
          )}
        </details>
      </fieldset>
      {report && (
        <section
          className="card bt-comparison-results"
          ref={result}
          tabIndex={-1}
          aria-label="组合对照结果"
        >
          <div className="bt-section-head">
            <div>
              <p className="bt-kicker">ALIGNED / RECALCULATED</p>
              <h2>
                {STRATEGIES[report.strategy]} · {report.items.length}个组合
              </h2>
              <p>
                {report.start} — {report.end} ·{" "}
                {report.observations.toLocaleString()}个相同交易日 ·{" "}
                {report.currency}
              </p>
            </div>
            <label>
              对照图表
              <select
                aria-label="组合对照图表口径"
                value={chart}
                onChange={(e) => setChart(e.target.value as typeof chart)}
              >
                <option value="nav">净值 · 初始100</option>
                <option value="value">账户价值</option>
                <option value="drawdown">净值回撤</option>
              </select>
            </label>
          </div>
          {report.synthetic && (
            <p className="bt-synthetic">
              合成演示，不是真实证券表现或投资依据。
            </p>
          )}
          {stale && (
            <p className="bt-notice" role="status">
              对照选择或设置已变化；下方保留上次结果，请重新运行。
            </p>
          )}
          <div className="bt-comparison-highlights">
            {report.items.map((p, i) => (
              <div key={p.id} style={{ borderTopColor: resultColor(p.id) }}>
                <strong>
                  {p.title}
                  {p.id === report.baseline ? " · 基准" : ""}
                </strong>
                <span>{pct(metric(p).cagr)}</span>
                <small>
                  CAGR · 相对基准 {delta(metric(p).cagr, metric(base!).cagr)}
                </small>
                <small>最大回撤 {pct(metric(p).maxDrawdown)}</small>
              </div>
            ))}
          </div>
          <div
            className="bt-chart"
            role="img"
            aria-label="多组合统一口径曲线，详细指标见对照表"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={curve}
                margin={{ left: 0, right: 12, top: 12, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  minTickGap={65}
                  tickFormatter={(v) => String(v).slice(0, 7)}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  width={62}
                  tickFormatter={(v) =>
                    chart === "drawdown"
                      ? pct(v)
                      : new Intl.NumberFormat("en", {
                          notation: "compact",
                        }).format(v)
                  }
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  formatter={(v) =>
                    chart === "drawdown"
                      ? pct(Number(v))
                      : chart === "value"
                        ? money(Number(v), report.currency)
                        : Number(v).toFixed(2)
                  }
                />
                <Legend />
                {report.items.map((p, i) => (
                  <Line
                    key={p.id}
                    name={p.title}
                    dataKey={`p${i}`}
                    stroke={resultColor(p.id)}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="bt-table-scroll">
            <table className="bt-metrics bt-comparison-table">
              <caption>不同组合 · 同策略、同投入、同区间</caption>
              <thead>
                <tr>
                  <th>指标</th>
                  {report.items.map((p) => (
                    <th
                      key={p.id}
                      className={p.id === report.baseline ? "bt-baseline" : ""}
                    >
                      {p.title}
                      {p.id === report.baseline ? " · 基准" : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, format]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {report.items.map((p) => (
                      <td
                        key={p.id}
                        className={
                          p.id === report.baseline ? "bt-baseline" : ""
                        }
                      >
                        {format(metric(p))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="bt-details">
            <summary>历史冲击 · 同一事件下的不同组合</summary>
            <label>
              对照事件
              <select value={event} onChange={(e) => setEvent(e.target.value)}>
                {BACKTEST_EVENTS.map((e) => (
                  <option value={e.id} key={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="bt-table-scroll">
              <table>
                <caption>同事件风险对照</caption>
                <thead>
                  <tr>
                    <th>组合</th>
                    <th>覆盖</th>
                    <th>事件回报</th>
                    <th>事件内最大回撤</th>
                  </tr>
                </thead>
                <tbody>
                  {report.items.map((p) => {
                    const e = p.report.results[0].events.find(
                      (e) => e.id === event,
                    )!;
                    return (
                      <tr key={p.id}>
                        <th scope="row">{p.title}</th>
                        <td>
                          {e.coverage === "complete"
                            ? "完整"
                            : e.coverage === "partial"
                              ? "部分"
                              : "未覆盖"}
                        </td>
                        <td>{pct(e.return)}</td>
                        <td>{pct(e.drawdown)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="bt-help">
              事件是事后研究窗口，不是精确预测信号；未覆盖不代表零风险。
            </p>
          </details>
          <details className="bt-details">
            <summary>统一假设、来源与局限</summary>
            <ul>
              {report.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <p>
              起始资金 {money(base!.report.config.initial, report.currency)} ·
              月供 {money(base!.report.config.monthly, report.currency)} ·
              单边费用 {base!.report.config.feeBps} bps · 无风险年率{" "}
              {base!.report.config.riskFree}% · 分红
              {base!.report.config.dividends === "reinvest"
                ? "再投资"
                : "留现金"}{" "}
              · DCA {base!.report.config.entryMonths}个月 · 现金年息{" "}
              {base!.report.config.cashRate}%
            </p>
            {report.items.map((p) => (
              <div key={p.id}>
                <strong>{p.title}</strong>
                {p.report.sources.map((s) => (
                  <p key={s.symbol}>
                    {s.symbol} · {s.basis} · {s.source}
                  </p>
                ))}
              </div>
            ))}
            <p>
              分红金额未知不等于0；已含于总回报，不可重复加计。快照与对照包不含顾问聊天或真实家庭账本，分享前仍需检查自定义名称等私人信息。
            </p>
          </details>
        </section>
      )}
    </section>
  );
}
