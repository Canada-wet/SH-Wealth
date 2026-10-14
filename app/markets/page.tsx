"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, RefreshCw, Plus, X, TrendingUp } from "lucide-react";
import useWealth from "@/lib/useWealth";
import { cloudClient } from "@/lib/cloud";
import MarketNavigator from "@/app/components/MarketNavigator";
import {
  MarketOverview,
  MacroResearch,
  YieldResearch,
} from "@/app/components/MarketResearch";
import { readingChange, signed } from "@/lib/market-analysis";
import {
  DEFAULT_WATCHLIST,
  EXCHANGES,
  instrumentKey,
  normalizeWatchlist,
  tradingSymbol,
  widgetUrl,
  type MarketInstrument,
  type MarketData,
  type MarketReading,
} from "@/lib/market";

function Sparkline({ row }: { row: MarketReading }) {
  const points = row.trend.filter((point) => Number.isFinite(point.value));
  if (points.length < 2) return null;
  const low = Math.min(...points.map((p) => p.value)),
    high = Math.max(...points.map((p) => p.value));
  const path = points
    .map(
      (p, i) =>
        `${(i / (points.length - 1)) * 120},${30 - ((p.value - low) / (high - low || 1)) * 26}`,
    )
    .join(" ");
  return (
    <svg
      className="market-sparkline"
      viewBox="0 0 120 34"
      role="img"
      aria-label={`${row.label}近期走势`}
    >
      <polyline points={path} fill="none" stroke="#315b4d" strokeWidth="2" />
    </svg>
  );
}
function Reading({ row }: { row: MarketReading }) {
  const change = readingChange(row);
  const period = row.date
    ? row.frequency === "quarterly"
      ? `${row.date.slice(0, 4)} Q${Math.floor((Number(row.date.slice(5, 7)) - 1) / 3) + 1}`
      : row.frequency === "monthly"
        ? row.date.slice(0, 7)
        : row.date
    : "日期未知";
  return (
    <article className="market-reading">
      <span>{row.label}</span>
      <b>
        {row.value === null
          ? "暂不可用"
          : `${row.id === "PAYEMS" && row.value > 0 ? "+" : ""}${new Intl.NumberFormat("en-CA", { maximumFractionDigits: row.unit.includes("CAD") ? 4 : 2 }).format(row.value)}${row.unit}`}
      </b>
      <Sparkline row={row} />
      <small>
        {change
          ? `${change.label} ${signed(change.value)} ${change.unit}`
          : "暂无可比前期"}
      </small>
      <small>
        {period} ·{" "}
        {row.frequency === "daily"
          ? "日频"
          : row.frequency === "monthly"
            ? "月频"
            : "季频"}
      </small>
      <p>{row.note}</p>
      <a href={row.source} target="_blank" rel="noopener noreferrer">
        官方来源 ↗
      </a>
    </article>
  );
}
function QuoteFrame({
  title,
  src,
  height,
}: {
  title: string;
  src: string;
  height: number;
}) {
  return (
    <div className="market-frame">
      <iframe
        title={title}
        src={src}
        height={height}
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
      <small>
        行情由{" "}
        <a
          href="https://www.tradingview.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          TradingView
        </a>{" "}
        提供。若图表空白或提示不支持，请在提供商页面核对代码和数据授权。
      </small>
    </div>
  );
}
export default function Markets() {
  const store = useWealth();
  const [data, setData] = useState<MarketData | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [live, setLive] = useState(false),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState("NASDAQ:NVDA"),
    [chartOpen, setChartOpen] = useState(false),
    [cad, setCad] = useState("1000");
  const [ticker, setTicker] = useState(""),
    [exchange, setExchange] = useState<MarketInstrument["exchange"]>("NASDAQ"),
    [name, setName] = useState(""),
    [reload, setReload] = useState(0);
  const request = useRef<AbortController | null>(null),
    fetching = useRef(false);
  const list = normalizeWatchlist(
    store.state.preferences.marketWatchlist ?? DEFAULT_WATCHLIST,
  );
  const filtered = list.filter((row) =>
    `${row.ticker} ${row.name} ${row.exchange}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const instrument =
    list.find((row) => instrumentKey(row) === selected) ?? list[0];
  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch("/api/market", {
        cache: "no-store",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(25000),
        ]),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "数据读取失败");
      if (!controller.signal.aborted) setData(result);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : "数据读取失败");
    } finally {
      fetching.current = false;
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    try {
      setLive(localStorage.getItem("together-market-embeds") === "on");
    } catch {}
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 300000);
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    const sub = cloudClient()?.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") window.location.replace("/login");
    });
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      request.current?.abort();
      sub?.data.subscription.unsubscribe();
    };
  }, [refresh]);
  const save = (rows: MarketInstrument[]) => {
    try {
      if (store.cloudChoice)
        throw new Error(
          "请先回到家庭财富页面处理本机与云端版本差异，再修改自选。",
        );
      const normalized = normalizeWatchlist(rows);
      store.commit(
        (current) => ({
          ...current,
          preferences: { ...current.preferences, marketWatchlist: normalized },
        }),
        "更新市场自选清单",
      );
      setError("");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "自选未保存");
      return false;
    }
  };
  const toggleLive = () => {
    const next = !live;
    setLive(next);
    try {
      localStorage.setItem("together-market-embeds", next ? "on" : "off");
    } catch {}
  };
  return (
    <main className="market-shell">
      <MarketNavigator />
      <div className="markets-page">
        <header className="markets-header">
          <div>
            <a className="market-back" href="/">
              <ArrowLeft size={15} />
              回到家庭财富
            </a>
            <p className="eyebrow">TOGETHER · RESEARCH DESK</p>
            <h1>市场看板</h1>
            <p>宏观周期、利率结构与跨市场观察；不自动改动家庭资产估值。</p>
          </div>
          <div className="market-status">
            <span>{store.cloudStatus}</span>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw size={14} />
              {busy ? "读取中…" : "刷新官方数据"}
            </button>
          </div>
        </header>
        <nav className="research-section-nav" aria-label="市场区块导航">
          <a href="#market-overview">市场概览</a>
          <a href="#macro-research">宏观研究</a>
          <a href="#rates-research">收益率曲线</a>
          <a href="#fx-research">汇率</a>
          <a href="#securities">自选证券</a>
        </nav>
        {(error || store.error) && (
          <div className="error-banner" role="alert">
            {error || store.error}
            {data && "；下方保留上次成功读取的数据，请核对日期。"}
          </div>
        )}
        {store.cloudChoice && (
          <p className="error-banner" role="alert">
            本机与云端版本待确认。<a href="/">回到家庭财富处理同步</a>
            ；当前可查看行情，暂不修改自选。
          </p>
        )}
        {data?.failures.length ? (
          <p className="error-banner" role="status">
            暂缺：{data.failures.join("、")}
            。可点击对应官方来源核对，不以示例数字补齐。
          </p>
        ) : null}
        <MarketOverview data={data} />
        <MacroResearch data={data} />
        <YieldResearch data={data} />
        <section className="card market-connection">
          <div>
            <h2>
              <TrendingUp size={18} />
              行情连接
            </h2>
            <p>
              股票 / ETF
              为提供商允许的延迟行情；外汇为市场参考。仅发送公开证券代码，不发送资产金额、成员或聊天；提供商仍会收到网络
              / 浏览器信息。
            </p>
          </div>
          <button
            className={live ? "secondary" : "primary"}
            onClick={toggleLive}
          >
            {live ? "暂停外部行情" : "启用自动更新行情"}
          </button>
        </section>
        <section
          className="card market-section"
          id="fx-research"
          aria-label="加币汇率"
        >
          <div className="card-head">
            <div>
              <h2>加币汇率 · 1 CAD =</h2>
              <p>
                人民币用 CNY，不混用离岸 CNH；盘中市场价与央行日均分开显示。
              </p>
            </div>
            <span className="market-badge">CNY · USD · JPY</span>
          </div>
          {live ? (
            <QuoteFrame
              key={`fx-${reload}`}
              title="加币盘中外汇参考"
              src={widgetUrl("fx", [])}
              height={240}
            />
          ) : (
            <p className="empty-note">
              启用上方外部行情可查看自动更新的盘中汇率；下方官方日均参考无需额外
              key。
            </p>
          )}
          <details className="market-reference" open>
            <summary>加拿大央行日均参考 · 非盘中成交价</summary>
            <div className="market-fx-grid">
              {data?.fx.map((row) => <Reading key={row.id} row={row} />) ?? (
                <p>正在读取官方日均汇率…</p>
              )}
            </div>
            <label className="market-converter">
              按官方日均试算 CAD 金额
              <input
                aria-label="试算加币金额"
                value={cad}
                inputMode="decimal"
                onChange={(event) => setCad(event.target.value)}
              />
            </label>
            <div className="market-conversion">
              {data?.fx.map((row) => (
                <span key={row.id}>
                  {row.label}：
                  {cad.trim() &&
                  Number.isFinite(Number(cad)) &&
                  Number(cad) >= 0 &&
                  row.value !== null
                    ? new Intl.NumberFormat("en-CA", {
                        maximumFractionDigits: 2,
                      }).format(Number(cad) * row.value)
                    : "—"}
                </span>
              ))}
            </div>
            <small>不是银行买卖价，未计手续费或点差。</small>
          </details>
        </section>
        <section
          className="card market-section"
          id="securities"
          aria-label="股票与ETF自选"
        >
          <div className="card-head">
            <div>
              <h2>股票与 ETF</h2>
              <p>
                {list.length} 个唯一标的 · 美股 USD / TSX CAD · CLS 默认
                NYSE，需加币版可添加 TSX:CLS
              </p>
            </div>
            <button
              className="text-button"
              disabled={!live}
              onClick={() => setReload(reload + 1)}
            >
              重新连接行情
            </button>
          </div>
          <div className="table-toolbar">
            <input
              aria-label="搜索市场自选"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索代码、名称或交易所…"
            />
            <span>自选清单随家庭同步，查看位置只在当前页面。</span>
          </div>
          <div className="market-watchlist">
            {filtered.map((row) => (
              <div
                key={instrumentKey(row)}
                className={
                  instrumentKey(row) ===
                  instrumentKey(instrument ?? DEFAULT_WATCHLIST[0])
                    ? "selected"
                    : ""
                }
              >
                <button
                  onClick={() => {
                    setSelected(instrumentKey(row));
                    setChartOpen(true);
                  }}
                  aria-label={`查看${row.exchange}:${row.ticker}图表`}
                >
                  <b>{row.ticker}</b>
                  <small>
                    {row.exchange} · {row.exchange === "TSX" ? "CAD" : "USD"}
                  </small>
                </button>
                <button
                  aria-label={`移除自选${row.exchange}:${row.ticker}`}
                  disabled={
                    !store.ready || store.cloudLoading || !!store.cloudChoice
                  }
                  onClick={() =>
                    save(
                      list.filter(
                        (other) => instrumentKey(other) !== instrumentKey(row),
                      ),
                    )
                  }
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          {!filtered.length && (
            <p className="empty-note">没有匹配标的；可清空搜索或添加项目。</p>
          )}
          <form
            className="market-add"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                save([
                  ...list,
                  {
                    ticker: ticker.trim().toUpperCase(),
                    exchange,
                    name: name.trim() || ticker.trim().toUpperCase(),
                  },
                ])
              ) {
                setTicker("");
                setName("");
              }
            }}
          >
            <input
              aria-label="新增证券代码"
              required
              maxLength={15}
              value={ticker}
              onChange={(event) => setTicker(event.target.value)}
              placeholder="例如 NVDA、BTCC.B"
            />
            <select
              aria-label="新增证券交易所"
              value={exchange}
              onChange={(event) =>
                setExchange(event.target.value as MarketInstrument["exchange"])
              }
            >
              {EXCHANGES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <input
              aria-label="新增证券名称"
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="名称（可选）"
            />
            <button
              className="secondary"
              disabled={
                !store.ready ||
                store.cloudLoading ||
                !!store.cloudChoice ||
                list.length >= 60
              }
            >
              <Plus size={14} />
              加入自选
            </button>
          </form>
          {live && filtered.length > 0 && (
            <QuoteFrame
              key={`quotes-${reload}`}
              title="自选股票ETF行情"
              src={widgetUrl("quotes", filtered)}
              height={520}
            />
          )}
          {list.some(
            (row) => row.exchange === "TSX" && row.ticker === "ZGIN",
          ) && (
            <p className="empty-note">
              ZGIN
              已保留在自选；本次接入核对时行情源暂无报价，空白不代表价格为零。可到{" "}
              <a
                href="https://www.bmoetfs.ca/etfs/zgin-bmo-global-innovators-fund-active-etf-series"
                target="_blank"
                rel="noopener noreferrer"
              >
                BMO 官方页面
              </a>{" "}
              核对市场价格和净值，不用其他基金替代。
            </p>
          )}
          {instrument && (
            <details
              className="market-chart"
              open={chartOpen}
              onToggle={(event) => setChartOpen(event.currentTarget.open)}
            >
              <summary>
                {instrument.ticker} · {instrument.name} · 历史图表
              </summary>
              <select
                aria-label="选择证券图表"
                value={instrumentKey(instrument)}
                onChange={(event) => setSelected(event.target.value)}
              >
                {list.map((row) => (
                  <option key={instrumentKey(row)} value={instrumentKey(row)}>
                    {row.exchange}:{row.ticker} · {row.name}
                  </option>
                ))}
              </select>
              {live && chartOpen && (
                <QuoteFrame
                  title="所选证券历史图表"
                  src={widgetUrl("chart", list, tradingSymbol(instrument))}
                  height={520}
                />
              )}
              <a
                target="_blank"
                rel="noopener noreferrer"
                href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tradingSymbol(instrument))}`}
              >
                在 TradingView 核对标的和行情 ↗
              </a>
            </details>
          )}
          <small>
            自选不等于持仓。未录入数量与成本，不推算家庭组合收益或权重。{" "}
            不同交易所 / 份额类别可能同名；ETF
            净值不等于交易价格。授权不足的标的可能无法嵌入，不填虚构价格。
          </small>
        </section>
        <footer className="market-footer">
          <span>
            官方数据读取：
            {data
              ? new Date(data.fetchedAt).toLocaleString("zh-CN", {
                  timeZone: "America/Toronto",
                })
              : "尚未完成"}{" "}
            · Toronto · 服务端缓存 / 页面核对约 5 分钟，隐藏页面暂停轮询。
          </span>
          <a
            href="https://www.tradingview.com/widget-docs/faq/data/"
            target="_blank"
            rel="noopener noreferrer"
          >
            行情延迟与授权说明 ↗
          </a>
          <p>市场看板仅提供信息，不执行交易，不替代券商成交价。</p>
        </footer>
      </div>
    </main>
  );
}
