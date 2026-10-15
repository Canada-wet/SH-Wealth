"use client";
import { useEffect, useState } from "react";
import { Search, X, SlidersHorizontal } from "lucide-react";
import MarketQuoteTile from "./MarketQuoteTile";
import { instrumentKey, type MarketInstrument } from "@/lib/market";

export default function MarketPulse({
  rows,
  live,
  ready,
  onEnable,
  onSelect,
}: {
  rows: MarketInstrument[];
  live: boolean;
  ready: boolean;
  onEnable: () => void;
  onSelect: (row: MarketInstrument) => void;
}) {
  const [scope, setScope] = useState("all");
  const [query, setQuery] = useState("");
  const [density, setDensity] = useState("compact");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("together-market-layout-v1");
      if (saved === "comfortable") setDensity(saved);
    } catch {}
  }, []);
  const chooseDensity = (value: string) => {
    setDensity(value);
    try {
      localStorage.setItem("together-market-layout-v1", value);
    } catch {}
  };
  const visible = rows.filter(
    (row) =>
      (scope === "all" || (row.exchange === "TSX" ? "cad" : "usd") === scope) &&
      `${row.ticker} ${row.exchange} ${row.name}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const missing = visible.filter(
    (row) => row.exchange === "TSX" && row.ticker === "ZGIN",
  );
  const covered = visible.filter((row) => !missing.includes(row));
  return (
    <section
      className="card market-section market-pulse"
      id="watchlist-pulse"
      aria-label="自选涨跌速览"
      data-density={density}
    >
      <div className="card-head">
        <div>
          <p className="eyebrow">WATCHLIST · DAILY PULSE</p>
          <h2>自选涨跌速览</h2>
          <p>
            最新价格 · 当日涨跌额 · 当日涨跌幅。与前收盘比较，不是你的持仓收益。
          </p>
        </div>
        <a className="text-button" href="#securities">
          管理自选 ↓
        </a>
      </div>
      <div className="market-pulse-toolbar">
        <div role="group" aria-label="速览市场筛选">
          {[
            ["all", "全部"],
            ["usd", "美股 · USD"],
            ["cad", "加拿大 · CAD"],
          ].map(([value, label]) => (
            <button
              key={value}
              className="secondary"
              aria-pressed={scope === value}
              aria-label={label}
              disabled={!ready}
              onClick={() => setScope(value)}
            >
              {label}
              <span aria-hidden="true">
                {
                  rows.filter(
                    (row) =>
                      value === "all" ||
                      (row.exchange === "TSX" ? "cad" : "usd") === value,
                  ).length
                }
              </span>
            </button>
          ))}
        </div>
        <div
          className="market-density"
          role="group"
          aria-label="卡片显示密度"
          title="仅保存在当前浏览器"
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
          {[
            ["compact", "紧凑"],
            ["comfortable", "舒适"],
          ].map(([value, label]) => (
            <button
              key={value}
              className="text-button"
              disabled={!ready}
              aria-pressed={density === value}
              onClick={() => chooseDensity(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="market-pulse-searchbar">
        <div className="market-pulse-search">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="搜索涨跌速览"
            placeholder="搜索代码、名称或交易所"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
          />
          {query && (
            <button aria-label="清空速览搜索" onClick={() => setQuery("")}>
              <X size={15} />
            </button>
          )}
        </div>
        <label>
          <span className="sr-only">打开详细图表</span>
          <select
            aria-label="从速览查看图表"
            value=""
            disabled={!ready || !visible.length}
            onChange={(event) => {
              const row = rows.find(
                (item) => instrumentKey(item) === event.target.value,
              );
              if (row) onSelect(row);
            }}
          >
            <option value="" disabled>
              选择证券…
            </option>
            {visible.map((row) => (
              <option key={instrumentKey(row)} value={instrumentKey(row)}>
                {row.ticker} · {row.exchange}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="market-pulse-count" role="status">
        显示 {visible.length} / {rows.length} 个自选 · {covered.length}{" "}
        个行情请求{missing.length ? ` · ${missing.length} 个暂无覆盖` : ""}
      </p>
      {!visible.length ? (
        <p className="empty-note">
          {rows.length
            ? "没有匹配的自选，试试其他关键词或切回全部市场。"
            : "自选清单为空，请先在下方添加证券。"}
          {(query || scope !== "all") && (
            <button
              className="text-button"
              onClick={() => {
                setQuery("");
                setScope("all");
              }}
            >
              重置速览筛选
            </button>
          )}
        </p>
      ) : !live ? (
        <div className="market-action-hint">
          <p>
            开启后，所有自选的涨跌集中展示，不用逐个打开图表。行情可能延迟；此开关同时控制其他外部行情窗口。
          </p>
          <button className="primary" disabled={!ready} onClick={onEnable}>
            开启自选涨跌速览
          </button>
        </div>
      ) : (
        <div className="market-pulse-grid">
          {visible.map((row) => (
            <MarketQuoteTile
              key={instrumentKey(row)}
              row={row}
              ready={ready}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
      <details className="market-pulse-disclosure">
        <summary>行情口径与使用说明 · 非持仓收益</summary>
        <small>
          美股以 USD、TSX 以 CAD 报价，不跨币种合计。行情由{" "}
          <a
            href="https://www.tradingview.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            TradingView
          </a>{" "}
          提供。正负号与提供商颜色共同标识涨跌；交易时段、延迟和休市状态以窗口内标注为准。卡片按需加载，手机可向下滚动查看。报价空白或代码不支持时请点来源核对，不补示例数字。
        </small>
      </details>
    </section>
  );
}
