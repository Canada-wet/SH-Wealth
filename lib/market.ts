export type MarketInstrument = {
  ticker: string;
  exchange: "NASDAQ" | "NYSE" | "AMEX" | "TSX";
  name: string;
};
export const DEFAULT_WATCHLIST: MarketInstrument[] = [
  ["NVDA", "NASDAQ", "NVIDIA"],
  ["META", "NASDAQ", "Meta"],
  ["APH", "NYSE", "Amphenol"],
  ["AVGO", "NASDAQ", "Broadcom"],
  ["BTCC", "TSX", "Purpose Bitcoin ETF · CAD"],
  ["CGL.C", "TSX", "iShares Gold Bullion ETF · CAD"],
  ["CLS", "NYSE", "Celestica · USD"],
  ["DATA.B", "TSX", "Evolve Cloud Computing · CAD"],
  ["IQ", "NASDAQ", "iQIYI"],
  ["KBWB", "NASDAQ", "Invesco KBW Bank ETF"],
  ["KLAC", "NASDAQ", "KLA"],
  ["MSFT", "NASDAQ", "Microsoft"],
  ["MU", "NASDAQ", "Micron"],
  ["NBIS", "NASDAQ", "Nebius"],
  ["ONTO", "NYSE", "Onto Innovation"],
  ["PCG", "NYSE", "PG&E"],
  ["RBOT", "TSX", "Global X Robotics & AI · CAD"],
  ["SNOW", "NYSE", "Snowflake"],
  ["SPCX", "NASDAQ", "SpaceX"],
  ["TEAM", "NASDAQ", "Atlassian"],
  ["TSM", "NYSE", "TSMC ADR · USD"],
  ["UAE", "NASDAQ", "iShares MSCI UAE ETF"],
  ["UNH", "NYSE", "UnitedHealth"],
  ["VRT", "NYSE", "Vertiv"],
  ["XIC", "TSX", "iShares Core S&P/TSX · CAD"],
  ["XST", "TSX", "iShares S&P/TSX Consumer Staples · CAD"],
  ["YINN", "AMEX", "Direxion China Bull 3X ETF"],
  ["ZGIN", "TSX", "BMO Global Innovators · CAD"],
  ["ZQQ", "TSX", "BMO Nasdaq 100 · CAD"],
  ["ZSP", "TSX", "BMO S&P 500 · CAD"],
].map(([ticker, exchange, name]) => ({
  ticker,
  exchange: exchange as MarketInstrument["exchange"],
  name,
}));
export const EXCHANGES = ["NASDAQ", "NYSE", "AMEX", "TSX"] as const;
export function validInstrument(raw: unknown): raw is MarketInstrument {
  if (!raw || typeof raw !== "object") return false;
  const row = raw as MarketInstrument;
  return (
    typeof row.ticker === "string" &&
    /^[A-Z0-9][A-Z0-9._-]{0,14}$/.test(row.ticker) &&
    EXCHANGES.includes(row.exchange) &&
    typeof row.name === "string" &&
    !!row.name.trim() &&
    row.name.length <= 100
  );
}
export const instrumentKey = (row: MarketInstrument) =>
  `${row.exchange}:${row.ticker}`;
export const tradingSymbol = (row: MarketInstrument) =>
  `${row.exchange}:${row.ticker}`;
export function normalizeWatchlist(rows: MarketInstrument[]) {
  if (!Array.isArray(rows) || rows.length > 60 || !rows.every(validInstrument))
    throw new Error("自选代码无效，最多 60 个，须指定交易所。");
  return rows.filter(
    (row, index) =>
      rows.findIndex((other) => instrumentKey(other) === instrumentKey(row)) ===
      index,
  );
}
export const FX_SYMBOLS = ["FX_IDC:CADCNY", "FX_IDC:CADUSD", "FX_IDC:CADJPY"];
export function pulseWidgetUrl(row: MarketInstrument) {
  const [safe] = normalizeWatchlist([row]);
  return `https://www.tradingview-widget.com/embed-widget/single-quote/?locale=zh_CN#${encodeURIComponent(JSON.stringify({ symbol: tradingSymbol(safe), width: "100%", colorTheme: "light", isTransparent: false }))}`;
}
export function widgetUrl(
  kind: "quotes" | "fx" | "chart",
  rows: MarketInstrument[],
  symbol?: string,
) {
  const safe = normalizeWatchlist(rows);
  const path = kind === "chart" ? "advanced-chart" : "market-quotes";
  const shared = {
    width: "100%",
    height: kind === "fx" ? 240 : 520,
    locale: "zh_CN",
    colorTheme: "light",
    isTransparent: false,
  };
  const config =
    kind === "chart"
      ? {
          ...shared,
          symbol:
            symbol && safe.some((row) => tradingSymbol(row) === symbol)
              ? symbol
              : tradingSymbol(safe[0] ?? DEFAULT_WATCHLIST[0]),
          interval: "D",
          timezone: "America/Toronto",
          allow_symbol_change: false,
          hide_side_toolbar: true,
          style: "3",
          save_image: false,
          calendar: false,
          support_host: "https://www.tradingview.com",
        }
      : {
          ...shared,
          showSymbolLogo: true,
          symbolsGroups:
            kind === "fx"
              ? [
                  {
                    name: "1 CAD 兑目标货币",
                    symbols: FX_SYMBOLS.map((name, i) => ({
                      name,
                      displayName: ["人民币 CNY", "美元 USD", "日元 JPY"][i],
                    })),
                  },
                ]
              : [
                  {
                    name: "美股 / 美国 ETF · USD",
                    symbols: safe
                      .filter((row) => row.exchange !== "TSX")
                      .map((row) => ({
                        name: tradingSymbol(row),
                        displayName: row.ticker,
                      })),
                  },
                  {
                    name: "加拿大股票 / ETF · CAD",
                    symbols: safe
                      .filter((row) => row.exchange === "TSX")
                      .map((row) => ({
                        name: tradingSymbol(row),
                        displayName: row.ticker,
                      })),
                  },
                ].filter((group) => group.symbols.length),
        };
  return `https://www.tradingview-widget.com/embed-widget/${path}/?locale=zh_CN#${encodeURIComponent(JSON.stringify(config))}`;
}
export type Observation = { date: string; value: number };
export type MarketReading = {
  id: string;
  label: string;
  value: number | null;
  date: string | null;
  unit: string;
  frequency: "daily" | "weekly" | "monthly" | "quarterly";
  source: string;
  trend: Observation[];
  previous?: number;
  note?: string;
};
export type MarketData = {
  fetchedAt: string;
  fx: MarketReading[];
  yields: MarketReading[];
  macro: MarketReading[];
  indicators?: MarketReading[];
  failures: string[];
};
export const TREASURIES = [
  ["DGS3MO", "3 个月"],
  ["DGS1", "1 年"],
  ["DGS2", "2 年"],
  ["DGS5", "5 年"],
  ["DGS10", "10 年"],
  ["DGS30", "30 年"],
];
export const MACRO = [
  {
    id: "CPIAUCNS",
    label: "美国 CPI 同比",
    unit: "%",
    frequency: "monthly" as const,
    transform: "yoy",
    note: "总 CPI、未季调；与去年同月比较",
  },
  {
    id: "CPILFENS",
    label: "美国核心 CPI 同比",
    unit: "%",
    frequency: "monthly" as const,
    transform: "yoy",
    note: "剔除食品与能源、未季调",
  },
  {
    id: "PAYEMS",
    label: "美国非农新增就业",
    unit: "千人",
    frequency: "monthly" as const,
    transform: "difference",
    note: "季调非农就业总量的月差；历史数值可能修订",
  },
  {
    id: "UNRATE",
    label: "美国失业率",
    unit: "%",
    frequency: "monthly" as const,
    transform: "level",
    note: "季节调整值",
  },
  {
    id: "A191RL1Q225SBEA",
    label: "美国实际 GDP 增长",
    unit: "%",
    frequency: "quarterly" as const,
    transform: "level",
    note: "环比折年率（SAAR），不是同比；可修订",
  },
];
export function parseFred(
  csv: string,
  ids: string[],
): Record<string, Observation[]> {
  if (csv.length > 2_000_000) throw new Error("数据过大");
  const lines = csv.trim().split(/\r?\n/),
    header =
      lines
        .shift()
        ?.replace(/^\uFEFF/, "")
        .split(",") ?? [];
  if (
    !["observation_date", "DATE"].includes(header[0]) ||
    ids.some((id) => !header.includes(id))
  )
    throw new Error("官方数据格式改变");
  const result: Record<string, Observation[]> = Object.fromEntries(
    ids.map((id) => [id, []]),
  );
  for (const line of lines) {
    const fields = line.split(",");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields[0])) continue;
    for (const id of ids) {
      const raw = fields[header.indexOf(id)];
      if (
        raw?.trim() &&
        /^[+-]?\d+(?:\.\d+)?$/.test(raw) &&
        Number.isFinite(Number(raw))
      )
        result[id].push({ date: fields[0], value: Number(raw) });
    }
  }
  for (const id of ids)
    result[id] = result[id]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-60);
  return result;
}
function earlier(date: string, months: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}
export function macroReading(
  definition: {
    id: string;
    label: string;
    unit: string;
    frequency: MarketReading["frequency"];
    transform: string;
    note: string;
  },
  observations: Observation[],
): MarketReading {
  const transformed = observations.flatMap((row) => {
    if (definition.transform === "level") return [row];
    const previous = observations.find(
      (other) =>
        other.date ===
        earlier(row.date, definition.transform === "yoy" ? 12 : 1),
    );
    if (!previous || (definition.transform === "yoy" && previous.value <= 0))
      return [];
    return [
      {
        date: row.date,
        value:
          definition.transform === "yoy"
            ? (row.value / previous.value - 1) * 100
            : row.value - previous.value,
      },
    ];
  });
  const last = transformed.at(-1);
  return {
    id: definition.id,
    label: definition.label,
    value: last?.value ?? null,
    date: last?.date ?? null,
    unit: definition.unit,
    frequency: definition.frequency,
    source: `https://fred.stlouisfed.org/series/${definition.id}`,
    trend: transformed.slice(-24),
    previous: transformed.at(-2)?.value,
    note: definition.note,
  };
}
