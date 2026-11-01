// Curated observation windows, not an exhaustive list, market peak dating or
// signals available to the strategies. Event labels never affect execution.
export const BACKTEST_EVENTS = [
  {
    id: "1987",
    title: "1987 黑色星期一",
    start: "1987-10-01",
    end: "1987-10-30",
    note: "十月观察窗，不代表所有市场的峰谷。",
    source:
      "https://www.federalreservehistory.org/essays/stock-market-crash-of-1987",
  },
  {
    id: "2001",
    title: "科技泡沫后 · 2001 衰退",
    start: "2001-03-01",
    end: "2001-11-30",
    note: "NBER衰退月份窗口；不等于科技熊市完整区间。",
    source:
      "https://www.nber.org/research/business-cycle-dating/business-cycle-dating-committee-announcements",
  },
  {
    id: "gfc",
    title: "全球金融危机",
    start: "2007-12-01",
    end: "2009-06-30",
    note: "NBER衰退月份窗口；股票低点可能早于经济低点。",
    source:
      "https://www.nber.org/research/business-cycle-dating/business-cycle-dating-committee-announcements",
  },
  {
    id: "covid",
    title: "2020 疫情流动性冲击",
    start: "2020-02-01",
    end: "2020-04-30",
    note: "二月至四月观察窗，包含下跌与早期反弹。",
    source:
      "https://www.federalreserve.gov/publications/2020-monetary-policy.htm",
  },
  {
    id: "2022",
    title: "2022 通胀与紧缩",
    start: "2022-01-01",
    end: "2022-12-31",
    note: "完整日历年观察窗，不是事后择取最差买卖点。",
    source:
      "https://www.federalreserve.gov/monetarypolicy/fomchistorical2022.htm",
  },
] as const;
