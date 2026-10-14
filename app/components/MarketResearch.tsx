import { useState } from "react";
import type { MarketData, MarketReading } from "@/lib/market";
import {
  alignedSpread,
  commonCurve,
  payrollAverage,
  alignedHistory,
  formatPeriod,
  readingChange,
  signed,
} from "@/lib/market-analysis";

function HistoryChart({
  rows,
  months,
  title,
}: {
  rows: MarketReading[];
  months: number;
  title: string;
}) {
  const points = alignedHistory(rows, months);
  if (points.length < 2)
    return <p className="empty-note">尚无足够的共同观测，暂不绘制{title}。</p>;
  const values = points.flatMap((p) => p.values),
    low = Math.min(...values),
    high = Math.max(...values),
    padding = Math.max((high - low) * 0.15, 0.15),
    min = low - padding,
    max = high + padding;
  const y = (value: number) => 175 - ((value - min) / (max - min)) * 140;
  const start = Date.parse(points[0].date),
    end = Date.parse(points.at(-1)!.date);
  const x = (date: string) =>
    48 + ((Date.parse(date) - start) / (end - start)) * 532;
  return (
    <div className="research-chart">
      <svg
        viewBox="0 0 600 220"
        role="img"
        aria-label={`${title}，${points[0].date}至${points.at(-1)!.date}`}
      >
        {[0, 1, 2, 3].map((i) => {
          const v = min + ((max - min) * i) / 3;
          return (
            <g key={i}>
              <line x1="48" x2="580" y1={y(v)} y2={y(v)} stroke="#e2e8df" />
              <text x="6" y={y(v) + 4}>
                {v.toFixed(1)}
              </text>
            </g>
          );
        })}
        {min < 0 && max > 0 && (
          <line
            x1="48"
            x2="580"
            y1={y(0)}
            y2={y(0)}
            stroke="#a8b2aa"
            strokeDasharray="4 4"
          />
        )}
        {rows.map((row, series) => (
          <polyline
            key={row.id}
            points={points
              .map((p) => `${x(p.date)},${y(p.values[series])}`)
              .join(" ")}
            fill="none"
            stroke={series === 0 ? "#315b4d" : "#b68b48"}
            strokeWidth="2.5"
          />
        ))}
        <text x="48" y="205">
          {points[0].date.slice(0, 7)}
        </text>
        <text x="580" y="205" textAnchor="end">
          {points.at(-1)!.date.slice(0, 7)}
        </text>
      </svg>
      <div className="research-legend">
        {rows.map((row, i) => (
          <span key={row.id}>
            <i style={{ background: i === 0 ? "#315b4d" : "#b68b48" }} />
            {row.label} · {row.unit}
          </span>
        ))}
      </div>
      <small>
        共同观测期间；横轴按统计日期，折线仅连接已有观测，不补缺失月份。
      </small>
      <details className="research-history-data">
        <summary>查看观测值（{points.length} 期）</summary>
        <div className="research-table-wrap">
          <table className="research-table">
            <thead>
              <tr>
                <th>统计期间</th>
                {rows.map((row) => (
                  <th key={row.id}>
                    {row.label} · {row.unit}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.date}>
                  <td>{point.date.slice(0, 7)}</td>
                  {point.values.map((value, i) => (
                    <td key={i}>{value.toFixed(2)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
function Delta({ row }: { row: MarketReading }) {
  const change = readingChange(row);
  return (
    <small className="research-delta">
      {change
        ? `${change.label} ${signed(change.value)} ${change.unit}`
        : "前期数据不足 · 不推算变化"}
    </small>
  );
}
export function MarketOverview({ data }: { data: MarketData | null }) {
  const rows =
    data?.macro.filter((row) =>
      ["CPIAUCNS", "A191RL1Q225SBEA", "PAYEMS"].includes(row.id),
    ) ?? [];
  const spread = alignedSpread(data?.yields ?? [], "DGS10", "DGS2");
  const available = data
    ? [...data.fx, ...data.yields, ...data.macro].filter(
        (row) => row.value !== null && row.date,
      ).length
    : 0;
  return (
    <section
      className="market-overview"
      id="market-overview"
      aria-label="研究概览"
    >
      <div className="research-intro">
        <span>MACRO / RATES / FX / EQUITIES</span>
        <b>先看环境，再看标的。</b>
        <p>以下为不同统计期间的观测，不是同一时点的经济评分或买卖信号。</p>
        <small>
          官方序列可用：{available} / 14 · 股票为授权范围内的延迟报价
        </small>
      </div>
      <div className="research-kpis">
        {rows.map((row) => (
          <article key={row.id}>
            <span>{row.label}</span>
            <b>
              {row.value === null
                ? "—"
                : `${row.id === "PAYEMS" ? signed(row.value, 0) : row.value.toFixed(2)}${row.unit}`}
            </b>
            <small>
              {formatPeriod(row)} ·{" "}
              {row.frequency === "quarterly" ? "环比折年率" : "月度观测"}
            </small>
            <Delta row={row} />
          </article>
        ))}
        <article>
          <span>10Y − 2Y 期限利差</span>
          <b>{spread ? `${signed(spread.value, 0)} bp` : "—"}</b>
          <small>{spread?.date ?? "同日数据未齐"} · 日频</small>
          <small className="research-delta">
            {spread
              ? spread.value < 0
                ? "该期限组合倒挂"
                : "长端高于或等于短端"
              : "不混合不同日期计算"}
          </small>
        </article>
      </div>
    </section>
  );
}
export function MacroResearch({ data }: { data: MarketData | null }) {
  const [months, setMonths] = useState(12);
  const rows = data?.macro ?? [],
    inflation = rows.filter((row) => ["CPIAUCNS", "CPILFENS"].includes(row.id)),
    jobs = rows.find((row) => row.id === "PAYEMS"),
    average = payrollAverage(jobs);
  return (
    <section
      className="card market-section"
      id="macro-research"
      aria-label="宏观研究"
    >
      <div className="card-head">
        <div>
          <p className="eyebrow">01 / ECONOMIC CYCLE</p>
          <h2>宏观研究 · 美国</h2>
          <p>通胀、增长与就业分开比较，不混用单位或频率。</p>
        </div>
        <label className="research-range">
          历史观察窗口
          <select
            aria-label="宏观历史窗口"
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
          >
            <option value={6}>近 6 期</option>
            <option value={12}>近 12 期</option>
            <option value={24}>近 24 期</option>
          </select>
        </label>
      </div>
      <div className="research-chart-grid">
        <article>
          <h3>总体与核心通胀 · 同比</h3>
          <HistoryChart rows={inflation} months={months} title="通胀同比趋势" />
        </article>
        <article>
          <h3>非农新增 · 千人 / 月</h3>
          <HistoryChart
            rows={jobs ? [jobs] : []}
            months={months}
            title="非农新增趋势"
          />
          <p className="research-average">
            最近 3 个月平均新增{" "}
            <b>
              {average === null ? "暂不可用" : `${signed(average, 1)} 千人`}
            </b>
          </p>
        </article>
      </div>
      <div className="research-table-wrap">
        <table className="research-table">
          <caption>宏观指标监测 · 变化以自身前期为基准，不是市场预期差</caption>
          <thead>
            <tr>
              <th>指标 / 口径</th>
              <th>最新值</th>
              <th>统计期间</th>
              <th>前期变化</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const change = readingChange(row);
              return (
                <tr key={row.id}>
                  <td>
                    <b>{row.label}</b>
                    <small>{row.note}</small>
                  </td>
                  <td>
                    {row.value === null
                      ? "暂不可用"
                      : `${signed(row.value)}${row.unit}`}
                  </td>
                  <td>{formatPeriod(row)}</td>
                  <td>
                    {change ? `${signed(change.value)} ${change.unit}` : "—"}
                    <small>{change?.label ?? "无可比前期"}</small>
                  </td>
                  <td>
                    <a
                      href={row.source}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      FRED ↗
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="research-note">
        <b>研究纪律</b>
        <p>
          CPI 是同比；GDP
          是环比折年率；非农是月度新增而非总人数。月度和季度数据可能修订。当前未接入市场一致预期，因此不使用“超预期
          / 不及预期”标签，也不由单个指标推断衰退或投资胜率。
        </p>
      </div>
      <div className="research-calendar">
        <span>官方发布日历</span>
        <a
          href="https://www.bls.gov/schedule/news_release/"
          target="_blank"
          rel="noopener noreferrer"
        >
          BLS · CPI / 就业 ↗
        </a>
        <a
          href="https://www.bea.gov/news/schedule"
          target="_blank"
          rel="noopener noreferrer"
        >
          BEA · GDP ↗
        </a>
        <small>日历仅提供官方入口；不编造下一次发布日期。</small>
      </div>
    </section>
  );
}
export function YieldResearch({ data }: { data: MarketData | null }) {
  const rows = data?.yields ?? [],
    curve = commonCurve(rows),
    prior = commonCurve(rows, 20),
    two = alignedSpread(rows, "DGS10", "DGS2"),
    short = alignedSpread(rows, "DGS10", "DGS3MO");
  const values = [...(curve?.points ?? []), ...(prior?.points ?? [])].map(
      (p) => p.value,
    ),
    min = values.length ? Math.min(...values) - 0.25 : 0,
    max = values.length ? Math.max(...values) + 0.25 : 1;
  const y = (value: number) => 175 - ((value - min) / (max - min)) * 135;
  return (
    <section
      className="card market-section"
      id="rates-research"
      aria-label="收益率曲线研究"
    >
      <div className="card-head">
        <div>
          <p className="eyebrow">02 / TERM STRUCTURE</p>
          <h2>美国国债 · 期限结构</h2>
          <p>固定期限名义收益率；不是债券价格、票息或实际收益率。</p>
        </div>
        <span className="market-badge">
          同日曲线：{curve?.date ?? "数据未齐"}
        </span>
      </div>
      <div className="research-curve-layout">
        <div className="research-chart">
          {curve ? (
            <>
              <svg
                viewBox="0 0 620 225"
                role="img"
                aria-label="美国国债收益率曲线，同日六个期限，纵轴为百分比"
              >
                {[0, 1, 2, 3].map((i) => {
                  const value = min + ((max - min) * i) / 3;
                  return (
                    <g key={i}>
                      <line
                        x1="48"
                        x2="590"
                        y1={y(value)}
                        y2={y(value)}
                        stroke="#e2e8df"
                      />
                      <text x="3" y={y(value) + 4}>
                        {value.toFixed(2)}%
                      </text>
                    </g>
                  );
                })}
                {[prior, curve].map(
                  (series, index) =>
                    series && (
                      <polyline
                        key={index}
                        points={series.points
                          .map((p, i) => `${65 + i * 100},${y(p.value)}`)
                          .join(" ")}
                        fill="none"
                        stroke={index === 0 ? "#b68b48" : "#315b4d"}
                        strokeDasharray={index === 0 ? "5 4" : undefined}
                        strokeWidth="2.5"
                      />
                    ),
                )}
                {curve.points.map((p, i) => (
                  <g key={p.label}>
                    <circle
                      cx={65 + i * 100}
                      cy={y(p.value)}
                      r="4"
                      fill="#315b4d"
                    />
                    <text x={65 + i * 100} y="206" textAnchor="middle">
                      {p.label}
                    </text>
                  </g>
                ))}
              </svg>
              <div className="research-legend">
                <span>
                  <i />
                  {curve.date} · 最近共同观测
                </span>
                {prior && (
                  <span>
                    <i style={{ background: "#b68b48" }} />
                    {prior.date} · 前 20 个共同观测日
                  </span>
                )}
              </div>
              <small>
                横轴为等距期限类别，不是等距时间。六个期限必须同日；不足 21
                个共同观测时不画比较线。
              </small>
            </>
          ) : (
            <p className="empty-note">
              六个期限的同日数据尚未齐全，不混合不同日期画曲线。
            </p>
          )}
        </div>
        <div className="research-spreads">
          {[
            ["10Y − 2Y", two],
            ["10Y − 3M", short],
          ].map(([label, spread]) => {
            const s = spread as typeof two;
            return (
              <article key={String(label)}>
                <span>{String(label)}</span>
                <b>{s ? `${signed(s.value, 0)} bp` : "—"}</b>
                <small>{s?.date ?? "日期不一致或缺值"}</small>
              </article>
            );
          })}
          <p>
            bp 为基点：100 bp = 1
            个百分点。倒挂仅描述短端高于长端；不等于确定的衰退预测。
          </p>
        </div>
      </div>
      {curve && (
        <details className="research-history-data">
          <summary>查看曲线观测值与历史变化</summary>
          <div className="research-table-wrap">
            <table className="research-table">
              <thead>
                <tr>
                  <th>期限</th>
                  <th>{curve.date}</th>
                  <th>{prior?.date ?? "无历史比较"}</th>
                  <th>变化 · bp</th>
                </tr>
              </thead>
              <tbody>
                {curve.points.map((point, i) => (
                  <tr key={point.label}>
                    <td>{point.label}</td>
                    <td>{point.value.toFixed(2)}%</td>
                    <td>
                      {prior ? `${prior.points[i].value.toFixed(2)}%` : "—"}
                    </td>
                    <td>
                      {prior
                        ? signed((point.value - prior.points[i].value) * 100, 0)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <p className="research-observation-label">
        逐项最新观测 · 日期可能不同，以各项标注为准
      </p>
      <div className="research-yield-strip">
        {rows.map((row) => (
          <article key={row.id}>
            <span>{row.label}</span>
            <b>{row.value === null ? "—" : `${row.value.toFixed(2)}%`}</b>
            <small>{row.date ?? "未知日期"}</small>
            <small>
              {readingChange(row)
                ? `${signed(readingChange(row)!.value * 100, 0)} bp · 较前一观测日`
                : "无可比前期"}
            </small>
            <a href={row.source} target="_blank" rel="noopener noreferrer">
              FRED ↗
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
