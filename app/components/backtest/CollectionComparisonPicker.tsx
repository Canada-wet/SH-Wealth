"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { FolderHeart, Search, Play, Square } from "lucide-react";
import {
  STRATEGIES,
  type BacktestLab,
  type BacktestConfig,
  type BacktestData,
  type BacktestStrategy,
} from "@/lib/backtest-schema";
import { stableJSON } from "@/lib/cloud-plan";
import type {
  PortfolioShelf,
  PortfolioComparison,
} from "@/lib/backtest-comparison";
import {
  cachedCollectionData,
  prepareCollectionComparison,
} from "@/lib/backtest-collection-comparison";
import type { HistoryProvider } from "@/lib/backtest-history";
export default function CollectionComparisonPicker({
  lab,
  shelf,
  draft,
  ready,
  onChange,
  onPrepared,
  onLibrary,
  onBusy,
}: {
  lab: BacktestLab;
  shelf: PortfolioShelf;
  draft?: { config: BacktestConfig; data: BacktestData | null };
  ready: boolean;
  onChange: (s: PortfolioShelf) => void;
  onPrepared: (s: PortfolioShelf, r: PortfolioComparison) => void;
  onLibrary: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [query, setQuery] = useState(""),
    [provider, setProvider] = useState<HistoryProvider>("auto"),
    [refresh, setRefresh] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [expanded, setExpanded] = useState(true);
  const controller = useRef<AbortController | null>(null),
    latest = useRef({ lab, shelf });
  latest.current = { lab, shelf };
  const collection = shelf.collection ?? { ids: [], baseline: "" };
  const chosen = collection.ids.flatMap((id) => {
    const p = lab.saved.find((p) => p.id === id);
    return p ? [p] : [];
  });
  const plans = lab.saved
    .filter((p) =>
      `${p.config.name} ${p.config.holdings.map((h) => h.symbol).join(" ")}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  const missing = collection.ids.length - chosen.length;
  const outdated = shelf.studies.some(
    (s) =>
      s.origin &&
      collection.ids.includes(s.origin.planId) &&
      !lab.saved.some(
        (p) =>
          p.id === s.origin!.planId &&
          p.at === s.origin!.savedAt &&
          stableJSON(p.config) === s.origin!.configKey,
      ),
  );
  const onBusyRef = useRef(onBusy);
  onBusyRef.current = onBusy;
  useEffect(
    () => () => {
      const c = controller.current;
      controller.current = null;
      c?.abort();
      onBusyRef.current(false);
    },
    [],
  );
  const cachedById = useMemo(
    () =>
      new Map(
        lab.saved.map((p) => [p.id, cachedCollectionData(p, shelf, draft)]),
      ),
    [lab, shelf.studies, draft?.config, draft?.data],
  );
  const update = (next: PortfolioShelf) => {
    setError("");
    setProgress("");
    onChange(next);
  };
  const toggle = (id: string) => {
    const ids = collection.ids.includes(id)
      ? collection.ids.filter((x) => x !== id)
      : [...collection.ids, id];
    if (ids.length > 4) {
      setError("每次最多对照4个组合，请先取消一项。");
      return;
    }
    update({
      ...shelf,
      collection: {
        ids,
        baseline: ids.includes(collection.baseline)
          ? collection.baseline
          : (ids[0] ?? ""),
      },
    });
  };
  const prepare = async () => {
    if (busy || !ready || chosen.length < 2 || missing) return;
    if (
      shelf.studies.some(
        (s) => !s.origin || !collection.ids.includes(s.origin.planId),
      ) &&
      !confirm(
        "将用所选组合更新本机对照快照。旧快照可先导出对照包保留；组合库、工作台草稿与财富账本不会改变。继续？",
      )
    )
      return;
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    onBusy(true);
    setError("");
    const selectedKey = stableJSON({ collection, plans: chosen });
    const baselineShelf = shelf;
    const timer = setTimeout(() => c.abort(), 240000);
    try {
      const prepared = await prepareCollectionComparison({
        lab,
        shelf,
        draft,
        provider,
        refresh,
        signal: c.signal,
        onProgress: setProgress,
      });
      if (c.signal.aborted) return;
      const now = latest.current;
      const nowPlans = (now.shelf.collection?.ids ?? []).flatMap((id) =>
        now.lab.saved.filter((p) => p.id === id),
      );
      if (
        now.shelf !== baselineShelf ||
        stableJSON({ collection: now.shelf.collection, plans: nowPlans }) !==
          selectedKey
      )
        throw Error("准备期间组合库或对照已变化，未覆盖旧研究；请重新准备。");
      onPrepared(prepared.shelf, prepared.report);
      setExpanded(false);
      setProgress(
        `已准备${prepared.shelf.studies.length}个组合并完成对照；组合库未改动。`,
      );
    } catch (e) {
      if (controller.current === c && !c.signal.aborted)
        setError((e as Error).message);
      else if (controller.current === c)
        setError(
          "已停止准备或等待超时；原组合、对照与工作台保留，未自动重试。",
        );
    } finally {
      clearTimeout(timer);
      if (controller.current === c) {
        setBusy(false);
        onBusy(false);
      }
    }
  };
  return (
    <section className="card bt-library-picker" aria-label="从组合库选择对照">
      <div className="bt-section-head">
        <div>
          <p className="bt-kicker">01 / SELECT FROM COLLECTION</p>
          <h3>从组合库选择</h3>
          <p>
            勾选2–4个已保存组合；缺少行情会在你点击准备后获取，不必逐个回工作台运行。
          </p>
        </div>
        <button
          className="bt-text-button"
          disabled={busy}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起选择" : "更换所选组合"}
        </button>
      </div>
      <div className="bt-library-selection-summary" role="status">
        <strong>已选 {collection.ids.length}/4 个</strong>
        <span>
          {chosen.map((p) => p.config.name).join(" · ") || "尚未选择"}
        </span>
      </div>
      {outdated && (
        <p role="status" className="bt-builder-check">
          组合库内容已更新。下方仍保留旧快照与结果，请准备最新配置后再比较。
        </p>
      )}
      {!!missing && (
        <p role="alert" className="bt-error">
          有{missing}个已选组合已从库中删除。
          <button
            className="bt-text-button"
            disabled={busy}
            onClick={() => {
              const ids = chosen.map((p) => p.id);
              update({
                ...shelf,
                collection: {
                  ids,
                  baseline: ids.includes(collection.baseline)
                    ? collection.baseline
                    : (ids[0] ?? ""),
                },
              });
            }}
          >
            清理失效选择
          </button>
        </p>
      )}
      {expanded && (
        <>
          {!!lab.saved.length && (
            <label className="bt-library-search">
              <Search size={15} />
              <input
                type="search"
                aria-label="搜索可对照组合"
                placeholder="搜索组合名称或股票代码"
                value={query}
                disabled={busy}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          )}
          {!lab.saved.length ? (
            <div className="bt-library-empty">
              <FolderHeart size={26} />
              <p>组合库还没有组合。保存配置即可选择，不必先完成回测。</p>
              <button className="secondary" onClick={onLibrary}>
                前往组合库
              </button>
            </div>
          ) : (
            <div className="bt-library-grid">
              {plans.map((p) => {
                const cached = cachedById.get(p.id),
                  active = collection.ids.includes(p.id),
                  study = shelf.studies.find((s) => s.origin?.planId === p.id);
                return (
                  <article
                    className={`bt-library-choice ${active ? "is-selected" : ""}`}
                    key={p.id}
                  >
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`选择组合：${p.config.name}`}
                        checked={active}
                        disabled={
                          busy ||
                          !ready ||
                          (!active && collection.ids.length >= 4)
                        }
                        onChange={() => toggle(p.id)}
                      />
                      <strong>{p.config.name}</strong>
                      <span className="bt-pill">{p.config.currency}</span>
                    </label>
                    <p>
                      {p.config.holdings
                        .map(
                          (h) => `${h.symbol} ${Number(h.weight.toFixed(2))}%`,
                        )
                        .join(" · ")}
                    </p>
                    <small>
                      {p.config.start} → {p.config.end}
                    </small>
                    <span
                      className={`bt-library-data-status ${cached ? "is-ready" : ""}`}
                    >
                      {cached
                        ? `可复用本机${cached.synthetic ? "合成" : "真实"}研究`
                        : study
                          ? "配置已更新 · 需要重新准备"
                          : "仅配置 · 待获取行情"}
                    </span>
                    {cached && (
                      <small>
                        本机历史{" "}
                        {cached.assets
                          .map((a) => a.points[0].date)
                          .sort()
                          .at(-1)}{" "}
                        →{" "}
                        {
                          cached.assets
                            .map((a) => a.points.at(-1)!.date)
                            .sort()[0]
                        }
                        ；实际对照还会取共同区间。
                      </small>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          {!!lab.saved.length && !plans.length && (
            <p>没有匹配的组合，试试名称或持仓代码。</p>
          )}
        </>
      )}
      {!!collection.ids.length && (
        <div className="bt-library-controls">
          <label>
            对照基准与统一币种
            <select
              aria-label="组合库对照基准"
              value={collection.baseline}
              disabled={busy || !ready}
              onChange={(e) =>
                update({
                  ...shelf,
                  collection: { ...collection, baseline: e.target.value },
                })
              }
            >
              {chosen.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.config.name} · {p.config.currency}
                </option>
              ))}
            </select>
          </label>
          <label>
            统一策略
            <select
              aria-label="组合库对照策略"
              value={shelf.strategy}
              disabled={busy || !ready}
              onChange={(e) =>
                update({
                  ...shelf,
                  strategy: e.target.value as BacktestStrategy,
                })
              }
            >
              {Object.entries(STRATEGIES).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            缺失行情来源
            <select
              aria-label="组合库行情来源"
              value={provider}
              disabled={busy}
              onChange={(e) => setProvider(e.target.value as HistoryProvider)}
            >
              <option value="auto">自动 · Yahoo + Tiingo</option>
              <option value="yahoo">Yahoo</option>
              <option value="tiingo">Tiingo · 仅美股</option>
            </select>
          </label>
          <label className="bt-library-refresh">
            <input
              type="checkbox"
              checked={refresh}
              disabled={busy}
              onChange={(e) => setRefresh(e.target.checked)}
            />
            重新获取行情，不复用本机快照
          </label>
          <div className="bt-action-row">
            <button
              className="primary"
              disabled={busy || !ready || chosen.length < 2 || !!missing}
              onClick={() => void prepare()}
            >
              <Play size={16} />
              {busy ? "正在准备…" : "准备行情并对比"}
            </button>
            {busy && (
              <button
                className="secondary"
                onClick={() => controller.current?.abort()}
              >
                <Square size={14} />
                停止准备
              </button>
            )}
          </div>
          <p className="bt-help">
            金额、月供与费用以基准组合统一；持仓权重保留。不同币种会按真实历史FX统一，可能缩短至2017年以后；只比较共同总回报日线，局限会在结果披露。只更新本机研究，不修改组合库、工作台或账本。服务器成功历史可能缓存1小时，不调用AI。
          </p>
        </div>
      )}
      {progress && (
        <p className="bt-help" role="status">
          {progress}
        </p>
      )}
      {error && (
        <p className="bt-notice bt-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
