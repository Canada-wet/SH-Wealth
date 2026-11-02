import { stableJSON } from "./cloud-plan";
import {
  backtestToday,
  validateBacktestData,
  validateBacktestConfig,
  type BacktestConfig,
  type BacktestData,
  type BacktestLab,
  type HistoricalAsset,
} from "./backtest-schema";
import { historyRequest, type HistoryProvider } from "./backtest-history";
import { convertHistoryToBase, type HistoricalFx } from "./backtest-fx";
import {
  runPortfolioComparison,
  validatePortfolioShelf,
  type PortfolioShelf,
  type PortfolioStudy,
} from "./backtest-comparison";
export type SavedPortfolio = BacktestLab["saved"][number];
type Draft = { config: BacktestConfig; data: BacktestData | null };
export function cachedCollectionData(
  plan: SavedPortfolio,
  shelf: PortfolioShelf,
  draft?: Draft,
): BacktestData | null {
  const key = stableJSON(plan.config);
  const study = shelf.studies.find(
    (s) =>
      (s.origin?.planId === plan.id &&
        s.origin.savedAt === plan.at &&
        s.origin.configKey === key) ||
      stableJSON(s.config) === key,
  );
  const data =
    study?.data ??
    (draft && stableJSON(draft.config) === key ? draft.data : null);
  if (!data) return null;
  try {
    validateBacktestData(data);
    if (
      plan.config.holdings.some(
        (h) => !data.assets.some((a) => a.symbol === h.symbol),
      )
    )
      return null;
    return data;
  } catch {
    return null;
  }
}
function alignTotalReturn(studies: PortfolioStudy[]): PortfolioStudy[] {
  const assets = studies.flatMap((s) =>
    s.config.holdings.map((h) =>
      s.data.assets.find((a) => a.symbol === h.symbol)!,
    ),
  );
  if (assets.some((a) => !a || a.basis !== "total-return")) return studies; // Raw actions must keep their exact original calendars.
  const start = [
    ...studies.map((s) => s.config.start),
    ...assets.map((a) => a.points[0].date),
  ]
    .sort()
    .at(-1)!;
  const end = [
    ...studies.map((s) => s.config.end),
    ...assets.map((a) => a.points.at(-1)!.date),
  ].sort()[0];
  const sets = assets.map((a) => new Set(a.points.map((p) => p.date)));
  const dates = assets[0].points
    .filter(
      (p) =>
        p.date >= start && p.date <= end && sets.every((s) => s.has(p.date)),
    )
    .map((p) => p.date);
  if (dates.length < 3)
    throw Error(
      "所选组合没有足够共同日线；请调整组合库日期或标的，不会填造价格。",
    );
  const grid = new Set(dates);
  return studies.map((s) => {
    const selected = s.config.holdings.map((h) =>
      s.data.assets.find((a) => a.symbol === h.symbol)!,
    );
    const omitted = selected.reduce(
      (n, a) => n + a.points.filter((p) => !grid.has(p.date)).length,
      0,
    );
    const data: BacktestData = {
      ...s.data,
      assets: selected.map((a) => ({
        ...a,
        points: a.points.filter((p) => grid.has(p.date)),
      })),
      ...(omitted
        ? {
            alignment: {
              method: "total-return-common-dates" as const,
              start: dates[0],
              end: dates.at(-1)!,
              omitted: (s.data.alignment?.omitted ?? 0) + omitted,
            },
          }
        : {}),
    };
    validateBacktestData(data);
    return { ...s, data };
  });
}
export async function prepareCollectionComparison(options: {
  lab: BacktestLab;
  shelf: PortfolioShelf;
  draft?: Draft;
  provider?: HistoryProvider;
  refresh?: boolean;
  signal: AbortSignal;
  onProgress?: (text: string) => void;
  fetcher?: typeof fetch;
}) {
  const { lab, shelf, signal, onProgress } = options,
    fetcher = options.fetcher ?? fetch;
  validatePortfolioShelf(shelf);
  const selection = shelf.collection;
  if (!selection || selection.ids.length < 2)
    throw Error("请先从组合库选择2–4个组合。");
  const plans = selection.ids.map((id) => {
    const p = lab.saved.find((p) => p.id === id);
    if (!p) throw Error("有已选组合已被删除，请重新选择；未覆盖已有对照。");
    validateBacktestConfig(p.config);
    return p;
  });
  const baseline = plans.find((p) => p.id === selection.baseline)!;
  const start = plans
      .map((p) => p.config.start)
      .sort()
      .at(-1)!,
    end = plans.map((p) => p.config.end).sort()[0];
  if (start >= end || end > backtestToday())
    throw Error(
      "组合日期没有共同历史区间，或包含未来日期；请先修改组合库配置。",
    );
  const cached = plans.map((p) =>
    options.refresh ? null : cachedCollectionData(p, shelf, options.draft),
  );
  // Existing converted prices cannot be converted a second time; get original quotes instead.
  cached.forEach((d, i) => {
    if (d?.conversion && d.conversion.base !== baseline.config.currency)
      cached[i] = null;
  });
  const missing = [
    ...new Set(
      plans.flatMap((p, i) =>
        cached[i] ? [] : p.config.holdings.map((h) => h.symbol),
      ),
    ),
  ];
  if (missing.length && baseline.config.dividends !== "reinvest")
    throw Error(
      "新获取的复权历史仅支持分红再投资。请在组合库修改基准组合的分红假设，或使用已有完整原价研究。",
    );
  const downloaded = new Map<string, HistoricalAsset>();
  let capturedAt = "";
  for (let offset = 0; offset < missing.length; offset += 8) {
    signal.throwIfAborted();
    onProgress?.(
      `正在获取第${Math.floor(offset / 8) + 1}/${Math.ceil(missing.length / 8)}批历史；仅发送证券代码和共同日期…`,
    );
    const query = historyRequest({
      symbols: missing.slice(offset, offset + 8),
      start,
      end,
      provider: options.provider ?? "auto",
    });
    const response = await fetcher("/api/backtest/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify(query),
    });
    const body = await response.json();
    if (!response.ok)
      throw Error(
        typeof body?.error === "string"
          ? body.error.slice(0, 350)
          : "行情获取失败；已有组合和对照保留。",
      );
    if (!body || stableJSON(body.requested) !== stableJSON(query) || !body.data)
      throw Error(
        "未返回完整行情；已有对照保留，请核对来源配置或稍后手动重试。",
      );
    validateBacktestData(body.data);
    if (
      body.data.synthetic ||
      body.data.assets.some(
        (a: HistoricalAsset) =>
          !query.symbols.includes(a.symbol) ||
          a.basis !== "total-return" ||
          a.points.some((p) => p.date < start || p.date > end),
      )
    )
      throw Error("行情身份、日期或复权口径无效，未覆盖已有研究。");
    const failed = query.symbols.filter(
      (symbol) =>
        !body.data.assets.some((a: HistoricalAsset) => a.symbol === symbol),
    );
    if (failed.length)
      throw Error(
        `未取全 ${failed.join("、")}；${
          Array.isArray(body.results)
            ? body.results
                .filter((r: { symbol: string }) => failed.includes(r.symbol))
                .map((r: { error?: string }) =>
                  String(r.error ?? "来源暂无覆盖").slice(0, 180),
                )
                .join("；")
            : "请稍后手动重试"
        }。未丢弃持仓或覆盖已有对照。`,
      );
    body.data.assets.forEach((a: HistoricalAsset) =>
      downloaded.set(a.symbol, a),
    );
    capturedAt = capturedAt
      ? [capturedAt, body.data.capturedAt].sort()[0]
      : body.data.capturedAt;
  }
  let studies = plans.map((p, i): PortfolioStudy => ({
    id:
      shelf.studies.find((s) => s.origin?.planId === p.id)?.id ??
      crypto.randomUUID(),
    title: p.config.name,
    at: new Date().toISOString(),
    origin: { planId: p.id, savedAt: p.at, configKey: stableJSON(p.config) },
    config: {
      ...structuredClone(p.config),
      currency: baseline.config.currency,
      risk: {
        ...p.config.risk,
        ...(baseline.config.currency === "CAD" ? { cadPerUnit: 1 } : {}),
      },
    },
    data: structuredClone(
      cached[i] ?? {
        version: 1,
        synthetic: false,
        capturedAt,
        assets: p.config.holdings.map((h) => downloaded.get(h.symbol)!),
      },
    ),
  }));
  if (new Set(studies.map((s) => s.data.synthetic)).size > 1)
    throw Error("不能把合成演示与真实行情混比；请只选择同一类研究。");
  if (
    studies.some((s) =>
      s.data.assets.some((a) => a.currency !== baseline.config.currency),
    )
  ) {
    if (
      studies.some(
        (s) =>
          s.data.synthetic ||
          s.data.assets.some((a) => a.basis !== "total-return"),
      )
    )
      throw Error(
        "跨币种准备只支持真实总回报复权日线；请刷新行情或选择同币种研究。",
      );
    signal.throwIfAborted();
    onProgress?.("正在核对加拿大央行历史汇率，统一回测币种…");
    const response = await fetcher(
        `/api/backtest/fx?${new URLSearchParams({ start, end })}`,
        { signal },
      ),
      body = await response.json();
    if (!response.ok)
      throw Error(
        typeof body?.error === "string"
          ? body.error.slice(0, 350)
          : "历史汇率暂不可用，原对照保留。",
      );
    studies = studies.map((s) =>
      s.data.assets.some((a) => a.currency !== baseline.config.currency)
        ? {
            ...s,
            data: convertHistoryToBase(
              s.data,
              body as HistoricalFx,
              baseline.config.currency,
            ),
          }
        : s,
    );
  }
  signal.throwIfAborted();
  onProgress?.("正在对齐共同历史并重新计算；不修改组合库或工作台…");
  studies = alignTotalReturn(studies);
  const next: PortfolioShelf = {
    ...shelf,
    studies,
    selected: studies.map((s) => s.id),
    baseline: studies[plans.findIndex((p) => p.id === baseline.id)].id,
  };
  const report = runPortfolioComparison(next); // Validate the entire comparison before replacing any local snapshots.
  signal.throwIfAborted();
  return { shelf: next, report };
}
