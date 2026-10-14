export type Owner = "joint" | "first" | "second" | string;
export type Asset = {
  id: string;
  name: string;
  owner: Owner;
  category: string;
  value: number;
  annualReturn: number | null;
  valuationDate?: string;
  liquidity?: "available" | "locked" | "illiquid" | "unknown";
  note?: string;
};
export type Debt = {
  id: string;
  name: string;
  owner: Owner;
  value: number;
  annualRate?: number | null;
  monthlyPayment?: number | null;
};
export type Contribution = {
  id: string;
  member: Owner;
  assetId: string | null;
  amount: number;
  kind: "deposit" | "withdrawal";
  date: string;
  note: string;
};
export type BudgetItem = {
  id: string;
  name: string;
  owner: Owner;
  amount: number;
  kind: "income" | "expense";
  essential: boolean;
};
export type Goal = { name: string; target: number; year: string };
export type Message = {
  id: string;
  role: "assistant" | "user";
  text: string;
  createdAt?: string;
};
export type Snapshot = {
  id: string;
  at: string;
  reason: string;
  totalAssets: number;
  totalDebts: number;
  netWorth: number;
  assets: Asset[];
  debts: Debt[];
  contributions: Contribution[];
  budget?: BudgetItem[];
  goal?: Goal;
  members?: WealthState["members"];
  plan?: WealthState["plan"];
};
export type WealthState = {
  version: 3;
  revision: number;
  updatedAt: string;
  members: { first: string; second: string };
  assets: Asset[];
  debts: Debt[];
  contributions: Contribution[];
  budget?: BudgetItem[];
  goal: Goal;
  history: Snapshot[];
  plan: { values: Record<string, string>; checks: Record<string, boolean> };
  messages: Message[];
  chatCurrent?: import("./conversations").ChatMeta;
  chatArchives?: import("./conversations").Conversation[];
  preferences: {
    model: string;
    allocation: "category" | "owner";
    months: number;
    proactive?: boolean;
    webSearch?: "auto" | "on" | "off";
    searchTopic?: keyof typeof import("./search-policy").SEARCH_TOPICS | "auto";
    marketWatchlist?: import("./market").MarketInstrument[];
  };
  readAlerts: string[];
  legacyHistory?: { month: string; value: number }[];
};
export const COLORS = [
  "#365B4D",
  "#A8C7B7",
  "#E5B879",
  "#8E85AB",
  "#6A90A0",
  "#C6CDBE",
];
export const id = () => crypto.randomUUID();
export const money = (value: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 2,
  }).format(value);
export const round = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
export function numberInput(
  value: string,
  label: string,
  allowNegative = false,
) {
  if (
    !value.trim() ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim().replace(/[, $%]/g, ""))
  )
    throw new Error(`请填写有效的${label}。`);
  const parsed = Number(value.replace(/[, $%]/g, ""));
  if (!Number.isFinite(parsed) || (!allowNegative && parsed < 0))
    throw new Error(
      `${label}需要是${allowNegative ? "有效数字" : "不小于零的数字"}。`,
    );
  return round(parsed);
}
export const ownerLabel = (owner: Owner, members: WealthState["members"]) =>
  owner === "joint"
    ? "共同"
    : owner === "first"
      ? members.first
      : owner === "second"
        ? members.second
        : owner;
export function ownerId(value: string, members: WealthState["members"]): Owner {
  if (["joint", "共同"].includes(value)) return "joint";
  if (["first", members.first].includes(value)) return "first";
  if (["second", members.second].includes(value)) return "second";
  return value.trim() || "joint";
}
export function emptyState(): WealthState {
  return {
    version: 3,
    revision: 0,
    updatedAt: "",
    members: { first: "Lin", second: "Han" },
    assets: [],
    debts: [],
    contributions: [],
    budget: [],
    goal: { name: "家庭财富目标", target: 2150000, year: "2032" },
    history: [],
    plan: { values: {}, checks: {} },
    messages: [],
    preferences: { model: "auto", allocation: "category", months: 6 },
    readAlerts: [],
  };
}
export function budgetTotals(state: WealthState) {
  const rows = state.budget ?? [];
  const income = round(
    rows
      .filter((row) => row.kind === "income")
      .reduce((sum, row) => sum + row.amount, 0),
  );
  const expenses = round(
    rows
      .filter((row) => row.kind === "expense")
      .reduce((sum, row) => sum + row.amount, 0),
  );
  const essential = round(
    rows
      .filter((row) => row.kind === "expense" && row.essential)
      .reduce((sum, row) => sum + row.amount, 0),
  );
  return { income, expenses, surplus: round(income - expenses), essential };
}
export function cashReference(assets: Asset[]) {
  const cash = assets.filter((row) =>
    /现金|储蓄|cash|hisa/i.test(row.category),
  );
  const included = cash.filter(
    (row) => row.liquidity !== "locked" && row.liquidity !== "illiquid",
  );
  return {
    amount: round(included.reduce((sum, row) => sum + row.value, 0)),
    unverified: round(
      included
        .filter((row) => !row.liquidity || row.liquidity === "unknown")
        .reduce((sum, row) => sum + row.value, 0),
    ),
    excluded: round(
      cash
        .filter((row) => !included.includes(row))
        .reduce((sum, row) => sum + row.value, 0),
    ),
  };
}
export function totals(state: Pick<WealthState, "assets" | "debts">) {
  const totalAssets = round(
    state.assets.reduce((sum, asset) => sum + asset.value, 0),
  );
  const totalDebts = round(
    state.debts.reduce((sum, debt) => sum + debt.value, 0),
  );
  return { totalAssets, totalDebts, netWorth: round(totalAssets - totalDebts) };
}
export function breakdown(state: WealthState, view: "category" | "owner") {
  const groups = new Map<
    string,
    { name: string; amount: number; ids: string[] }
  >();
  if (view === "owner")
    for (const owner of ["joint", "first", "second"])
      groups.set(owner, {
        name: ownerLabel(owner, state.members),
        amount: 0,
        ids: [],
      });
  state.assets.forEach((asset) => {
    const key = view === "category" ? asset.category : asset.owner;
    const group = groups.get(key) ?? {
      name: view === "category" ? key : ownerLabel(key, state.members),
      amount: 0,
      ids: [],
    };
    group.amount = round(group.amount + asset.value);
    group.ids.push(asset.id);
    groups.set(key, group);
  });
  const total = totals(state).totalAssets;
  return [...groups].map(([key, group], index) => ({
    key,
    ...group,
    percent: total ? (group.amount / total) * 100 : 0,
    color: COLORS[index % COLORS.length],
  }));
}
export function contributionSummary(state: WealthState) {
  const deposited = state.contributions.reduce(
    (sum, row) => sum + (row.kind === "deposit" ? row.amount : 0),
    0,
  );
  return ["first", "second", "joint"].map((member) => {
    const rows = state.contributions.filter((row) => row.member === member);
    const deposits = round(
      rows.reduce(
        (sum, row) => sum + (row.kind === "deposit" ? row.amount : 0),
        0,
      ),
    );
    const withdrawals = round(
      rows.reduce(
        (sum, row) => sum + (row.kind === "withdrawal" ? row.amount : 0),
        0,
      ),
    );
    return {
      member,
      name: ownerLabel(member, state.members),
      deposits,
      withdrawals,
      net: round(deposits - withdrawals),
      percent: deposited ? (deposits / deposited) * 100 : 0,
    };
  });
}
export function finishChange(
  previous: WealthState,
  next: WealthState,
  reason: string,
  financial = false,
  now = new Date(),
): WealthState {
  validateState(next);
  const updatedAt = now.toISOString();
  const history = financial
    ? [
        ...next.history,
        {
          id: id(),
          at: updatedAt,
          reason,
          ...totals(next),
          assets: structuredClone(next.assets),
          debts: structuredClone(next.debts),
          contributions: structuredClone(next.contributions),
          budget: structuredClone(next.budget ?? []),
          goal: structuredClone(next.goal),
          members: { ...next.members },
          plan: structuredClone(next.plan),
        },
      ]
    : next.history;
  return { ...next, revision: previous.revision + 1, updatedAt, history };
}
export function saveAsset(state: WealthState, asset: Asset): WealthState {
  if (!asset.name.trim() || !asset.category.trim())
    throw new Error("请填写资产名称和类别。");
  const assets = state.assets.some((row) => row.id === asset.id)
    ? state.assets.map((row) =>
        row.id === asset.id
          ? {
              ...row,
              ...asset,
              name: asset.name.trim(),
              category: asset.category.trim(),
            }
          : row,
      )
    : [
        ...state.assets,
        { ...asset, name: asset.name.trim(), category: asset.category.trim() },
      ];
  return { ...state, assets };
}
export function saveContribution(
  state: WealthState,
  contribution: Contribution,
): WealthState {
  if (contribution.amount <= 0) throw new Error("贡献金额需要大于零。");
  if (!["joint", "first", "second"].includes(contribution.member))
    throw new Error("请选择有效的贡献成员。");
  if (!validDate(contribution.date)) throw new Error("请选择有效日期。");
  const previous = state.contributions.find(
    (row) => row.id === contribution.id,
  );
  const assets = state.assets.map((row) => ({ ...row }));
  const adjust = (row: Contribution, undo = false) => {
    if (!row.assetId) return;
    const asset = assets.find((asset) => asset.id === row.assetId);
    if (!asset) throw new Error("关联资产不存在，请重新选择。");
    asset.value = round(
      asset.value +
        row.amount * (row.kind === "deposit" ? 1 : -1) * (undo ? -1 : 1),
    );
  };
  if (previous) adjust(previous, true);
  adjust(contribution);
  if (assets.some((asset) => asset.value < 0))
    throw new Error("该变更会使关联账户价值小于零，请调整金额或取消关联。");
  return {
    ...state,
    assets,
    contributions: previous
      ? state.contributions.map((row) =>
          row.id === contribution.id ? contribution : row,
        )
      : [...state.contributions, contribution],
  };
}
export function deleteContribution(
  state: WealthState,
  contributionId: string,
): WealthState {
  const row = state.contributions.find((row) => row.id === contributionId);
  if (!row) throw new Error("贡献记录不存在。");
  const assets = state.assets.map((asset) => ({
    ...asset,
    value:
      asset.id === row.assetId
        ? round(asset.value - row.amount * (row.kind === "deposit" ? 1 : -1))
        : asset.value,
  }));
  if (assets.some((asset) => asset.value < 0))
    throw new Error(
      "账户估值已变化，删除这笔贡献会产生负余额。请先核对账户估值。",
    );
  return {
    ...state,
    assets,
    contributions: state.contributions.filter(
      (item) => item.id !== contributionId,
    ),
  };
}
export function deleteAsset(state: WealthState, assetId: string): WealthState {
  return {
    ...state,
    assets: state.assets.filter((row) => row.id !== assetId),
    contributions: state.contributions.map((row) =>
      row.assetId === assetId
        ? {
            ...row,
            assetId: null,
            note: `${row.note}${row.note ? " · " : ""}原关联账户已删除`,
          }
        : row,
    ),
  };
}
export function chartPoints(
  state: WealthState,
  months: number,
  now = new Date(),
) {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - months);
  const ordered = state.history
    .filter((point) => !Number.isNaN(Date.parse(point.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const points = ordered.filter(
    (point) => Date.parse(point.at) >= cutoff.getTime(),
  );
  const baseline = ordered
    .filter((point) => Date.parse(point.at) < cutoff.getTime())
    .at(-1);
  return (baseline ? [baseline, ...points] : points).map((point) => ({
    ...point,
    label: new Date(point.at).toLocaleDateString("zh-CN", {
      month: "short",
      day: "numeric",
    }),
  }));
}
export function alertsFor(state: WealthState) {
  const alerts: { id: string; title: string; body: string; prompt: string }[] =
    [];
  const current = totals(state);
  if (!state.assets.length)
    alerts.push({
      id: "empty-assets",
      title: "先建立家庭资产清单",
      body: "添加实际账户与估值后，总览、占比与目标进度会一起更新。",
      prompt: "帮我梳理需要录入的家庭资产。",
    });
  const last = state.history.at(-1);
  if (last && Date.now() - Date.parse(last.at) > 30 * 86400000)
    alerts.push({
      id: `stale-${last.id}`,
      title: "账户估值超过 30 天未更新",
      body: "核对最近的账户余额，保持家庭总览准确。",
      prompt: "帮我们准备一次月度财富回顾。",
    });
  const monthly = state.budget?.some((row) => row.kind === "expense")
    ? budgetTotals(state).essential
    : Number(state.plan.values.essential_monthly) || 0;
  const months = Number(state.plan.values.emergency_months) || 0;
  const target = monthly * months;
  const cash = cashReference(state.assets).amount;
  if (target > cash)
    alerts.push({
      id: `emergency-${target}-${cash}`,
      title: "应急金尚未覆盖目标",
      body: `现金 ${money(cash)}，距离 ${months} 个月必要开支目标还差 ${money(target - cash)}。`,
      prompt: "根据我们的必要开支与现金余额，如何安排应急金？",
    });
  if (current.totalDebts > 0)
    alerts.push({
      id: `debt-${current.totalDebts}`,
      title: "把负债纳入下一次家庭复盘",
      body: `已记录负债 ${money(current.totalDebts)}，可在计划中补齐利率与还款安排。`,
      prompt: "帮我们把已记录负债和财富目标一起做规划。",
    });
  if (state.goal.target > 0 && current.netWorth >= state.goal.target)
    alerts.push({
      id: `goal-${state.goal.target}`,
      title: "账面净资产已达到目标",
      body: "一起复核目标期限和下一阶段安排。",
      prompt: "我们已达到财富目标，下一步如何复盘？",
    });
  return alerts;
}
export function validateState(raw: unknown): asserts raw is WealthState {
  if (!raw || typeof raw !== "object") throw new Error("数据格式无效。");
  const state = raw as WealthState;
  if (
    state.preferences?.marketWatchlist !== undefined &&
    (!Array.isArray(state.preferences.marketWatchlist) ||
      state.preferences.marketWatchlist.length > 60 ||
      state.preferences.marketWatchlist.some(
        (row) =>
          !row ||
          typeof row.ticker !== "string" ||
          !/^[A-Z0-9][A-Z0-9._-]{0,14}$/.test(row.ticker) ||
          !["NASDAQ", "NYSE", "AMEX", "TSX"].includes(row.exchange) ||
          typeof row.name !== "string" ||
          !row.name.trim() ||
          row.name.length > 100,
      ))
  )
    throw new Error("市场自选清单无效。");
  if (
    state.version !== 3 ||
    !Number.isInteger(state.revision) ||
    state.revision < 0 ||
    typeof state.updatedAt !== "string" ||
    !state.members ||
    !state.members.first?.trim() ||
    !state.members.second?.trim() ||
    state.members.first === state.members.second
  )
    throw new Error("家庭或版本信息无效。");
  const unique = (rows: { id: string }[]) =>
    rows.every((row) => typeof row.id === "string" && row.id.length > 0) &&
    new Set(rows.map((row) => row.id)).size === rows.length;
  const finite = (value: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (
    !Array.isArray(state.assets) ||
    !unique(state.assets) ||
    state.assets.some(
      (row) =>
        !row.name?.trim() ||
        !row.category?.trim() ||
        typeof row.owner !== "string" ||
        !finite(row.value) ||
        (row.annualReturn !== null &&
          (typeof row.annualReturn !== "number" ||
            !Number.isFinite(row.annualReturn))),
    ) ||
    state.assets.some(
      (row) =>
        (row.valuationDate !== undefined && !validDate(row.valuationDate)) ||
        (row.liquidity !== undefined &&
          !["available", "locked", "illiquid", "unknown"].includes(
            row.liquidity,
          )) ||
        (row.note !== undefined &&
          (typeof row.note !== "string" || row.note.length > 500)),
    )
  )
    throw new Error("资产数据无效。");
  if (
    !Array.isArray(state.debts) ||
    !unique(state.debts) ||
    state.debts.some(
      (row) =>
        !row.name?.trim() ||
        typeof row.owner !== "string" ||
        !finite(row.value) ||
        (row.annualRate != null &&
          (!finite(row.annualRate) || row.annualRate > 100)) ||
        (row.monthlyPayment != null && !finite(row.monthlyPayment)),
    )
  )
    throw new Error("负债数据无效。");
  if (
    !Array.isArray(state.contributions) ||
    !unique(state.contributions) ||
    state.contributions.some(
      (row) =>
        !["first", "second", "joint"].includes(row.member) ||
        !finite(row.amount) ||
        row.amount === 0 ||
        !["deposit", "withdrawal"].includes(row.kind) ||
        typeof row.note !== "string" ||
        !validDate(row.date) ||
        (row.assetId !== null &&
          !state.assets.some((asset) => asset.id === row.assetId)),
    )
  )
    throw new Error("贡献数据无效。");
  if (
    state.budget !== undefined &&
    (!Array.isArray(state.budget) ||
      !unique(state.budget) ||
      state.budget.some(
        (row) =>
          !row.name?.trim() ||
          typeof row.owner !== "string" ||
          !finite(row.amount) ||
          !["income", "expense"].includes(row.kind) ||
          typeof row.essential !== "boolean",
      ))
  )
    throw new Error("现金流数据无效。");
  if (
    !state.goal?.name?.trim() ||
    !finite(state.goal.target) ||
    !/^\d{4}$/.test(state.goal.year)
  )
    throw new Error("目标信息无效。");
  if (
    !state.plan ||
    typeof state.plan.values !== "object" ||
    !state.plan.values ||
    Object.values(state.plan.values).some(
      (value) => typeof value !== "string",
    ) ||
    !state.plan.checks ||
    Object.values(state.plan.checks).some((value) => typeof value !== "boolean")
  )
    throw new Error("规划数据无效。");
  if (
    !Array.isArray(state.history) ||
    state.history.some(
      (row) =>
        !row.id ||
        Number.isNaN(Date.parse(row.at)) ||
        !Number.isFinite(row.netWorth) ||
        !finite(row.totalAssets) ||
        !finite(row.totalDebts) ||
        !Array.isArray(row.assets) ||
        !Array.isArray(row.debts) ||
        !Array.isArray(row.contributions),
    )
  )
    throw new Error("历史记录无效。");
  if (
    !Array.isArray(state.messages) ||
    state.messages.some(
      (row) =>
        !row.id ||
        !["assistant", "user"].includes(row.role) ||
        typeof row.text !== "string",
    )
  )
    throw new Error("聊天记录无效。");
  if (
    !state.preferences ||
    typeof state.preferences.model !== "string" ||
    !["category", "owner"].includes(state.preferences.allocation) ||
    ![3, 6, 12, 24].includes(state.preferences.months) ||
    (state.preferences.proactive !== undefined &&
      typeof state.preferences.proactive !== "boolean") ||
    (state.preferences.webSearch !== undefined &&
      !["auto", "on", "off"].includes(state.preferences.webSearch)) ||
    (state.preferences.searchTopic !== undefined &&
      ![
        "auto",
        "rates",
        "mortgage",
        "gic",
        "tfsa",
        "rrsp",
        "fhsa",
        "fx",
        "inflation",
        "tax",
      ].includes(state.preferences.searchTopic)) ||
    !Array.isArray(state.readAlerts) ||
    state.readAlerts.some((value) => typeof value !== "string")
  )
    throw new Error("设置数据无效。");
  const validMessage = (row: Message) =>
    !!row &&
    typeof row.id === "string" &&
    !!row.id &&
    ["assistant", "user"].includes(row.role) &&
    typeof row.text === "string" &&
    (row.createdAt === undefined || !Number.isNaN(Date.parse(row.createdAt)));
  const validMeta = (row: import("./conversations").ChatMeta) =>
    !!row &&
    typeof row.id === "string" &&
    !!row.id &&
    typeof row.title === "string" &&
    (row.createdAt === undefined || !Number.isNaN(Date.parse(row.createdAt))) &&
    (row.updatedAt === undefined || !Number.isNaN(Date.parse(row.updatedAt)));
  if (
    state.messages.some((row) => !validMessage(row)) ||
    (state.chatCurrent !== undefined && !validMeta(state.chatCurrent)) ||
    (state.chatArchives !== undefined &&
      (!Array.isArray(state.chatArchives) ||
        !unique(state.chatArchives) ||
        state.chatArchives.some(
          (row) =>
            !validMeta(row) ||
            !Array.isArray(row.messages) ||
            !unique(row.messages) ||
            row.messages.some((message) => !validMessage(message)) ||
            row.id === (state.chatCurrent?.id ?? "legacy-chat"),
        )))
  )
    throw new Error("会话历史无效。");
}

export function validDate(value: string) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
