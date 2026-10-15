import type { MarketReading } from "./market";
export const INDICATOR_GROUPS = {
  sentiment: "情绪与波动",
  leading: "经济前瞻",
  ai: "AI 产业供需代理",
} as const;
export const MARKET_INDICATORS = [
  {
    id: "VIXCLS",
    label: "VIX · 30 日隐含波动",
    unit: "点",
    frequency: "daily",
    group: "sentiment",
    note: "Cboe / FRED 日收盘；反映标普期权隐含的未来约 30 日波动，不预测涨跌方向。Cboe 版权所有，来源见原始序列。",
  },
  {
    id: "VXVCLS",
    label: "VIX3M · 3 个月隐含波动",
    unit: "点",
    frequency: "daily",
    group: "sentiment",
    note: "Cboe / FRED 日收盘；与 VIX 同日比较期限结构，不等同 VIX 期货曲线。Cboe 版权所有，来源见原始序列。",
  },
  {
    id: "ICSA",
    label: "初请失业金人数",
    unit: "人",
    frequency: "weekly",
    group: "leading",
    note: "美国劳工部 / FRED；季调、截至周六的一周，可能修订。反映劳动力市场边际变化，不是失业率。",
  },
  {
    id: "PERMIT",
    label: "住宅建筑许可",
    unit: "千套 · SAAR",
    frequency: "monthly",
    group: "leading",
    note: "Census / HUD / FRED；季调折年率，住宅建设前瞻代理，不是未来 GDP 的确定预测。",
  },
  {
    id: "A34SNO",
    label: "计算机与电子产品新订单",
    unit: "百万 USD",
    frequency: "monthly",
    group: "ai",
    note: "Census M3 / FRED；季调、名义金额。广义硬件需求代理；来源明确半导体新订单不可得，不是 GPU / AI 专属订单。",
  },
  {
    id: "IPG3344S",
    label: "半导体及电子元件产出",
    unit: "点 · 2017=100",
    frequency: "monthly",
    group: "ai",
    note: "美联储 G.17 / FRED；季调、美国实际产出指数。供给活动代理，不代表全球先进 GPU 产量。",
  },
  {
    id: "CAPUTLG3344S",
    label: "半导体及电子元件产能利用率",
    unit: "%",
    frequency: "monthly",
    group: "ai",
    note: "美联储 G.17 / FRED；季调、美国行业产出相对估计产能。不能外推为先进制程、HBM 或封装利用率，也不是 GPU 缺货率。",
  },
] as const;
export function indicatorGroup(id: string) {
  return MARKET_INDICATORS.find((row) => row.id === id)?.group;
}
export function volatilityTerm(rows: MarketReading[]) {
  const near = rows.find((row) => row.id === "VIXCLS"),
    far = rows.find((row) => row.id === "VXVCLS");
  if (
    !near?.date ||
    near.date !== far?.date ||
    near.value == null ||
    far.value == null ||
    near.value <= 0 ||
    far.value <= 0
  )
    return null;
  return {
    date: near.date,
    ratio: near.value / far.value,
    description:
      near.value > far.value
        ? "近端隐含波动高于三个月端"
        : near.value < far.value
          ? "近端隐含波动低于三个月端"
          : "近端与三个月端相同",
  };
}
export function observationAge(row: MarketReading, now = new Date()) {
  if (!row.date || row.value === null) return { days: null, delayed: false };
  const days = Math.floor(
    (now.getTime() - Date.parse(`${row.date}T00:00:00Z`)) / 86400000,
  );
  return {
    days,
    delayed:
      days >
      { daily: 7, weekly: 21, monthly: 90, quarterly: 180 }[row.frequency],
  };
}
