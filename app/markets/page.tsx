"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  RefreshCw,
  Plus,
  X,
  TrendingUp,
  Pencil,
  Download,
} from "lucide-react";
import useWealth from "@/lib/useWealth";
import { cloudClient } from "@/lib/cloud";
import MarketNavigator from "@/app/components/MarketNavigator";
import {
  MarketOverview,
  MacroResearch,
  YieldResearch,
} from "@/app/components/MarketResearch";
import { readingChange, signed } from "@/lib/market-analysis";
import useMarketData from "@/lib/useMarketData";
import {
  editWatchlist,
  instrumentFallback,
  marketSnapshot,
  watchlistFingerprint,
} from "@/lib/market-state";
import QuoteFrame from "@/app/components/MarketFrame";
import Dialog from "@/app/components/Dialog";
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
export default function Markets() {
  const store = useWealth();
  const {
    data,
    busy,
    error: dataError,
    cached,
    needsLogin,
    refresh,
  } = useMarketData();
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<{
      key: string;
      baseline: string;
      draft: MarketInstrument;
    } | null>(null),
    [editError, setEditError] = useState("");
  const [removal, setRemoval] = useState<{
    row: MarketInstrument;
    index: number;
    after: string;
  } | null>(null);
  const [live, setLive] = useState(false),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState("NASDAQ:NVDA"),
    [chartOpen, setChartOpen] = useState(false),
    [cad, setCad] = useState("1000");
  const [ticker, setTicker] = useState(""),
    [exchange, setExchange] = useState<MarketInstrument["exchange"]>("NASDAQ"),
    [name, setName] = useState(""),
    [reload, setReload] = useState(0);
  const chart = useRef<HTMLDetailsElement | null>(null);
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
  useEffect(() => {
    if (!chartOpen) return;
    const frame = requestAnimationFrame(() =>
      chart.current?.scrollIntoView({ behavior: "instant", block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [selected, chartOpen]);
  useEffect(() => {
    try {
      setLive(localStorage.getItem("together-market-embeds") === "on");
    } catch {}
    const sub = cloudClient()?.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT")
        window.location.replace("/login?next=%2Fmarkets&reauth=1");
    });
    return () => {
      sub?.data.subscription.unsubscribe();
    };
  }, []);
  const save = (rows: MarketInstrument[]) => {
    try {
      if (store.cloudChoice)
        throw new Error(
          "请先回到家庭财富页面处理本机与云端版本差异，再修改自选。",
        );
      const normalized = normalizeWatchlist(rows);
      store.commit((current) => {
        if (
          watchlistFingerprint(
            normalizeWatchlist(
              current.preferences.marketWatchlist ?? DEFAULT_WATCHLIST,
            ),
          ) !== watchlistFingerprint(list)
        )
          throw new Error("自选已在其他操作中变化，请核对后重试。");
        return {
          ...current,
          preferences: { ...current.preferences, marketWatchlist: normalized },
        };
      }, "更新市场自选清单");
      setError("");
      setRemoval(null);
      setNotice("自选已保存到本机；云端结果请以上方同步状态为准。");
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "自选未保存";
      setError(message);
      if (editing) setEditError(message);
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
  const exportSnapshot = () => {
    if (!data) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(marketSnapshot(data, list), null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `market-snapshot-${data.fetchedAt.slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(
      "已请求下载官方市场快照，不含家庭账本、聊天或跨域证券报价；请在浏览器下载记录查看。",
    );
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
              disabled={!data}
              onClick={exportSnapshot}
            >
              <Download size={14} />
              导出官方快照
            </button>
            <button
              className="secondary"
              disabled={!store.ready || busy}
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
        {dataError && (
          <div className="error-banner" role="alert">
            {dataError}
            {data && "；下方保留上次成功读取的数据，请核对日期。"}
            {needsLogin ? (
              <a href="/login?next=%2Fmarkets&reauth=1">重新登录市场看板 ↗</a>
            ) : (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void refresh()}
              >
                重试官方数据
              </button>
            )}
          </div>
        )}
        {cached && (
          <p className="market-cache-note" role="status">
            当前显示上次缓存快照（{data?.fetchedAt}），不是刚读取的数据；
            {busy ? "正在核对最新官方数据。" : "请查看源日期并尝试刷新。"}
          </p>
        )}
        {notice && (
          <p className="market-notice" role="status">
            {notice}
            {removal && (
              <button
                className="text-button"
                onClick={() => {
                  if (watchlistFingerprint(list) !== removal.after) {
                    setError("自选已变化，为避免覆盖其他修改，未撤销。");
                    setRemoval(null);
                    return;
                  }
                  const rows = [...list];
                  rows.splice(removal.index, 0, removal.row);
                  if (save(rows))
                    setNotice(`已撤销移除 ${removal.row.ticker}。`);
                }}
              >
                撤销移除
              </button>
            )}
          </p>
        )}
        {(error || store.error) && (
          <div className="error-banner" role="alert">
            {error || store.error}
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
            disabled={!store.ready}
            onClick={toggleLive}
          >
            {live ? "暂停外部行情" : "启用自动更新行情"}
          </button>
        </section>
        <MarketOverview data={data} />
        <MacroResearch data={data} />
        <YieldResearch data={data} />
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
              fallback="https://www.tradingview.com/markets/currencies/"
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
              onClick={() => setReload((value) => value + 1)}
            >
              重新连接行情
            </button>
          </div>
          {!live && (
            <div className="market-action-hint">
              <p>
                外部行情尚未开启，点击证券后可在图表区授权加载；未开启时不连接行情提供商。
              </p>
            </div>
          )}
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
                  disabled={!store.ready}
                >
                  <b>{row.ticker}</b>
                  <small>
                    {row.exchange} · {row.exchange === "TSX" ? "CAD" : "USD"}
                  </small>
                </button>
                <button
                  aria-label={`编辑自选${row.exchange}:${row.ticker}`}
                  disabled={
                    !store.ready || store.cloudLoading || !!store.cloudChoice
                  }
                  onClick={() => {
                    setEditError("");
                    setEditing({
                      key: instrumentKey(row),
                      baseline: watchlistFingerprint(list),
                      draft: { ...row },
                    });
                  }}
                >
                  <Pencil size={12} />
                </button>
                <button
                  aria-label={`移除自选${row.exchange}:${row.ticker}`}
                  disabled={
                    !store.ready || store.cloudLoading || !!store.cloudChoice
                  }
                  onClick={() => {
                    const rows = list.filter(
                      (other) => instrumentKey(other) !== instrumentKey(row),
                    );
                    if (save(rows)) {
                      setRemoval({
                        row,
                        index: list.findIndex(
                          (other) =>
                            instrumentKey(other) === instrumentKey(row),
                        ),
                        after: watchlistFingerprint(rows),
                      });
                      setNotice(`已移除 ${row.ticker}；可以撤销。`);
                    }
                  }}
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
              const next = {
                ticker: ticker.trim().toUpperCase(),
                exchange,
                name: name.trim() || ticker.trim().toUpperCase(),
              };
              if (
                list.some((row) => instrumentKey(row) === instrumentKey(next))
              ) {
                setError("");
                setNotice("该证券已经在自选中，无需重复添加。");
                setSelected(instrumentKey(next));
                setChartOpen(true);
                return;
              }
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
              fallback="https://www.tradingview.com/markets/stocks-usa/"
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
              ref={chart}
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
              {chartOpen &&
                !live &&
                !(
                  instrument.exchange === "TSX" && instrument.ticker === "ZGIN"
                ) && (
                  <div className="market-action-hint">
                    <h3>图表尚未连接行情服务</h3>
                    <p>
                      开启后仅发送证券代码，不发送家庭金额、自定义名称或聊天；提供商仍会收到网络信息。
                    </p>
                    <button className="primary" onClick={toggleLive}>
                      开启行情并加载所选图表
                    </button>
                  </div>
                )}
              {chartOpen &&
              instrument.exchange === "TSX" &&
              instrument.ticker === "ZGIN" ? (
                <div className="market-action-hint">
                  <h3>当前行情源暂不覆盖 ZGIN</h3>
                  <p>保留在自选中，不用空白窗口或其他基金替代。</p>
                  <a
                    className="secondary"
                    href={instrumentFallback(instrument)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    查看 ZGIN 官方价格与净值 ↗
                  </a>
                </div>
              ) : (
                live &&
                chartOpen && (
                  <QuoteFrame
                    title="所选证券历史图表"
                    src={widgetUrl("chart", list, tradingSymbol(instrument))}
                    height={520}
                    fallback={instrumentFallback(instrument)}
                  />
                )
              )}
              <a
                target="_blank"
                rel="noopener noreferrer"
                href={instrumentFallback(instrument)}
              >
                在提供商核对标的和行情 ↗
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
      {editing && (
        <Dialog
          title="编辑市场自选"
          error={editError}
          onClose={() => setEditing(null)}
          onSubmit={(event) => {
            event.preventDefault();
            try {
              if (editing.baseline !== watchlistFingerprint(list))
                throw new Error(
                  "编辑期间自选已被更新，请关闭后重新打开，未覆盖新数据。",
                );
              const draft = {
                ...editing.draft,
                ticker: editing.draft.ticker.trim().toUpperCase(),
                name:
                  editing.draft.name.trim() ||
                  editing.draft.ticker.trim().toUpperCase(),
              };
              const rows = editWatchlist(list, editing.key, draft);
              if (save(rows)) {
                setSelected(instrumentKey(draft));
                setEditing(null);
              }
            } catch (reason) {
              setEditError(
                reason instanceof Error ? reason.message : "编辑失败",
              );
            }
          }}
        >
          <label>
            证券代码
            <input
              required
              maxLength={15}
              value={editing.draft.ticker}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  draft: { ...editing.draft, ticker: e.target.value },
                })
              }
            />
          </label>
          <label>
            交易所
            <select
              value={editing.draft.exchange}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  draft: {
                    ...editing.draft,
                    exchange: e.target.value as MarketInstrument["exchange"],
                  },
                })
              }
            >
              {EXCHANGES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            显示名称
            <input
              maxLength={100}
              value={editing.draft.name}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  draft: { ...editing.draft, name: e.target.value },
                })
              }
            />
          </label>
          <p>只修改市场自选，不修改家庭资产。自定义名称不发送给行情提供商。</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setEditing(null)}
            >
              取消
            </button>
            <button className="primary">保存自选修改</button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
