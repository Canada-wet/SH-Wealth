import {
  validInstrument,
  instrumentKey,
  type MarketInstrument,
  type MarketData,
} from "./market";
import {
  money,
  round,
  totals,
  cashReference,
  budgetTotals,
  type WealthState,
} from "./wealth";
import { todayToronto } from "./household-workspace";
import { stableJSON } from "./cloud-plan";

export const EXPOSURES = {
  CAD: "无该外币敞口 / CAD",
  USD: "未对冲美元",
  CNY: "未对冲人民币",
  JPY: "未对冲日元",
  hedged: "已对冲（不追加汇率冲击）",
  unknown: "尚未核实",
} as const;
export type PortfolioLink = {
  id: string;
  assetId: string;
  instrument: MarketInstrument;
  weight: number;
  currency: keyof typeof EXPOSURES;
};
export function validPortfolioLinks(raw: unknown): raw is PortfolioLink[] {
  if (!Array.isArray(raw) || raw.length > 180) return false;
  const ids = new Set<string>(),
    allocations = new Map<string, number>(),
    pairs = new Set<string>();
  return raw.every((r: PortfolioLink) => {
    if (
      !r ||
      typeof r.id !== "string" ||
      !r.id ||
      r.id.length > 200 ||
      ids.has(r.id) ||
      typeof r.assetId !== "string" ||
      !r.assetId ||
      r.assetId.length > 200 ||
      !validInstrument(r.instrument) ||
      !Number.isFinite(r.weight) ||
      r.weight <= 0 ||
      r.weight > 100 ||
      typeof r.currency !== "string" ||
      !Object.prototype.hasOwnProperty.call(EXPOSURES, r.currency)
    )
      return false;
    const pair = `${r.assetId}|${instrumentKey(r.instrument)}`;
    if (pairs.has(pair)) return false;
    ids.add(r.id);
    pairs.add(pair);
    const sum = (allocations.get(r.assetId) ?? 0) + r.weight;
    allocations.set(r.assetId, sum);
    return sum <= 100 + 1e-8;
  });
}
export function linkBaseline(state: WealthState) {
  return stableJSON({
    links: state.preferences.portfolioLinks ?? [],
    assets: state.assets.map(({ id, value }) => ({ id, value })),
  });
}
export function savePortfolioLinks(
  state: WealthState,
  expected: string,
  links: PortfolioLink[],
): WealthState {
  if (linkBaseline(state) !== expected)
    throw new Error(
      "账户金额或关联已变化，请保留草稿或重新载入，不覆盖伴侣的新数据。",
    );
  if (!validPortfolioLinks(links))
    throw new Error(
      "请核对比例（大于 0、每账户合计不超过 100%），同账户同证券不能重复。",
    );
  if (links.some((r) => !state.assets.some((a) => a.id === r.assetId)))
    throw new Error("关联账户已删除，请移除该行后保存。");
  return {
    ...state,
    preferences: {
      ...state.preferences,
      portfolioLinks: links.map((r) => ({
        ...r,
        instrument: { ...r.instrument },
      })),
    },
  };
}
export function portfolioExposure(state: WealthState) {
  const links = state.preferences.portfolioLinks ?? [];
  const rows = links.flatMap((link) => {
    const asset = state.assets.find((a) => a.id === link.assetId);
    return asset
      ? [
          {
            ...link,
            account: asset.name,
            owner: asset.owner,
            value: (asset.value * link.weight) / 100,
            valuationDate: asset.valuationDate ?? null,
          },
        ]
      : [];
  });
  const linked = round(rows.reduce((n, r) => n + r.value, 0));
  const balance = totals(state);
  const byInstrument = [
    ...new Set(rows.map((r) => instrumentKey(r.instrument))),
  ]
    .map((key) => {
      const holdings = rows.filter((r) => instrumentKey(r.instrument) === key);
      const value = round(holdings.reduce((n, r) => n + r.value, 0));
      return {
        key,
        value,
        accounts: new Set(holdings.map((r) => r.assetId)).size,
        percent:
          balance.totalAssets > 0 ? (value / balance.totalAssets) * 100 : 0,
      };
    })
    .sort((a, b) => b.value - a.value);
  const currency = Object.keys(EXPOSURES).map((code) => ({
    code,
    value: round(
      rows.filter((r) => r.currency === code).reduce((n, r) => n + r.value, 0),
    ),
  }));
  return {
    rows,
    linked,
    byInstrument,
    currency,
    missing: links.filter((r) => !rows.some((a) => a.id === r.id)).length,
    unknown: round(Math.max(0, balance.totalAssets - linked)),
    coverage:
      balance.totalAssets > 0 ? (linked / balance.totalAssets) * 100 : 0,
    balance,
  };
}
export function portfolioStress(state: WealthState, price: number, fx: number) {
  if (
    ![price, fx].every(Number.isFinite) ||
    price < -100 ||
    price > 100 ||
    fx <= -100 ||
    fx > 100
  )
    throw new Error("压力假设范围无效。");
  const exposure = portfolioExposure(state);
  const effect = round(
    exposure.rows.reduce((sum, row) => {
      const unhedged = ["USD", "CNY", "JPY"].includes(row.currency);
      return (
        sum +
        row.value * ((1 + price / 100) * (1 + (unhedged ? fx : 0) / 100) - 1)
      );
    }, 0),
  );
  return {
    effect,
    netWorth: round(exposure.balance.netWorth + effect),
    goalGap: round(
      Math.max(0, state.goal.target - exposure.balance.netWorth - effect),
    ),
    unknownFx: exposure.currency.find((r) => r.code === "unknown")!.value,
    recoveryMonths:
      effect < 0 && (state.preferences.growthPlan?.monthlySaving ?? 0) > 0
        ? -effect / state.preferences.growthPlan!.monthlySaving
        : null,
  };
}
export function portfolioInsights(
  state: WealthState,
  market: MarketData | null = null,
  now = new Date(),
) {
  const exposure = portfolioExposure(state);
  const facts: {
    id: string;
    title: string;
    body: string;
    next: string;
    source?: string;
  }[] = [];
  if (!exposure.rows.length)
    return [
      {
        id: "mapping",
        title: "先关联持仓，才能判断市场与你们的关系",
        body: "自选不等于持有。按账户填写实际配置比例；其余部分保持未知。",
        next: "只录入已核实配置，不根据账户名称自动猜证券。",
      },
    ];
  facts.push({
    id: "coverage",
    title: `已关联家庭总资产 ${exposure.coverage.toFixed(1)}%`,
    body: `${money(exposure.linked)} 可追溯到账户；${money(exposure.unknown)} 未关联。${exposure.missing ? `另有 ${exposure.missing} 条关联指向已删除账户，未参与计算。` : ""}`,
    next: "账户估值改变时按保存比例重新计算；实际配置变动仍须核对比例。",
  });
  const top = exposure.byInstrument[0];
  if (top)
    facts.push({
      id: "concentration",
      title: `${top.key} 是关联金额最大的标的`,
      body: `${money(top.value)}，占家庭总资产 ${top.percent.toFixed(1)}%，来自 ${top.accounts} 个账户。`,
      next: "跨账户同名证券已合并；ETF 未穿透，不能据此断定整个组合已充分分散。",
    });
  const today = todayToronto(now);
  const cash = cashReference(state.assets),
    budget = budgetTotals(state),
    months = Number(state.plan.values.emergency_months);
  const verified = round(cash.amount - cash.unverified);
  const complete =
    state.budget?.some((r) => r.kind === "income") &&
    state.budget?.some((r) => r.kind === "expense");
  const reserveGap =
    complete && budget.essential > 0 && Number.isFinite(months) && months > 0
      ? Math.max(0, budget.essential * months - verified)
      : null;
  facts.push({
    id: "household-capacity",
    title: "把市场风险放回家庭现金需求里",
    body: `已确认可动用现金 ${money(verified)}。${reserveGap === null ? "必要支出或缓冲月数尚未完整，不能判断应急金缺口。" : `相对你们设定的缓冲目标，缺口 ${money(reserveGap)}。`}`,
    next: "先区分应急用途和长期投资；账户可赎回条件须自行核对，不因 VIX 或新闻自动交易。",
  });
  const unknownFx = exposure.currency.find((r) => r.code === "unknown")!.value;
  if (unknownFx > 0)
    facts.push({
      id: "unknown-currency",
      title: `${money(unknownFx)} 关联资金的外币敞口尚未核实`,
      body: "不会从交易所、证券名字或 CAD 报价推断对冲状态。",
      next: "查产品文件或券商记录后更新关联；当前试算未对这部分叠加汇率冲击，不代表没有汇率风险。",
    });
  const stale = exposure.rows.filter(
    (r) =>
      !r.valuationDate ||
      r.valuationDate > today ||
      Date.parse(today) - Date.parse(r.valuationDate) > 30 * 86400000,
  );
  if (stale.length)
    facts.push({
      id: "valuation",
      title: "先核对账户基准，再讨论影响金额",
      body: `${new Set(stale.map((r) => r.assetId)).size} 个关联账户缺核对日期、超过 30 天或日期在未来。`,
      next: "更新手工估值不会被行情覆盖；压力试算不代表今天的真实盈亏。",
    });
  for (const [currency, id] of [
    ["USD", "FXUSDCAD"],
    ["CNY", "FXCNYCAD"],
    ["JPY", "FXJPYCAD"],
  ]) {
    const amount = exposure.currency.find((r) => r.code === currency)!.value;
    if (!amount) continue;
    const reading = market?.fx.find((r) => r.id === id);
    const age = reading?.date
      ? (Date.parse(today) - Date.parse(reading.date)) / 86400000
      : Infinity;
    const available =
      reading?.value !== null &&
      Number.isFinite(reading?.value) &&
      reading!.value! > 0 &&
      age >= 0 &&
      age <= 7;
    facts.push({
      id: `fx-${currency}`,
      title: `${currency} 未对冲关联金额 ${money(amount)}`,
      body: available
        ? `1 CAD = ${reading!.value!.toFixed(4)} ${currency}（${reading!.date}，央行日均）。外币相对 CAD 贬值 5% 的单独假设影响约 ${money(-amount * 0.05)}。`
        : "当前缺少近 7 天内有效官方汇率，不给出当前汇率判断。",
      next: "这是外币敞口假设，不是今日损益；挂牌币种不等于经济敞口，先核对 ETF 对冲规则。",
      ...(available ? { source: reading!.source } : {}),
    });
  }
  const vix = market?.indicators?.find((r) => r.id === "VIXCLS");
  const vixAge = vix?.date
    ? (Date.parse(today) - Date.parse(vix.date)) / 86400000
    : Infinity;
  if (
    vix?.value !== null &&
    Number.isFinite(vix?.value) &&
    vixAge >= 0 &&
    vixAge <= 7
  )
    facts.push({
      id: "vix",
      title: `VIX ${vix!.value!.toFixed(2)} · ${vix!.date}`,
      body: "这是标普 500 期权隐含波动，不是这些持仓的预测或交易信号。",
      next: "先用下方统一价格冲击检查家庭承受力，再回到已保存的现金缓冲和长期计划。",
      source: vix!.source,
    });
  return facts;
}
export function portfolioContext(state: WealthState) {
  const e = portfolioExposure(state);
  return {
    asOf: state.updatedAt,
    linked: e.linked,
    unmapped: e.unknown,
    missing: e.missing,
    securities: e.byInstrument,
    currency: e.currency,
    observations: portfolioInsights(state),
    boundary:
      "用户确认的账户配置比例；不是券商实仓或自动估值。未包含最新证券报价；自选不等于持有。ETF未穿透。仅已知未对冲外币追加汇率冲击，不推断其余敞口。",
  };
}
