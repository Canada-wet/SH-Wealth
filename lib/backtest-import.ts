import {
  validateBacktestConfig,
  validateBacktestData,
  validDate,
  SYMBOL,
  type BacktestConfig,
  type BacktestData,
  type HistoricalAsset,
} from "./backtest-schema";

// CSV is parsed as text only. No spreadsheet formulas, network requests or code.
function rows(text: string): string[][] {
  if (text.length > 8_000_000) throw Error("文件过大，请控制在8MB以内。");
  const out: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) out.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw Error("CSV引号未闭合。");
  row.push(cell.trim());
  if (row.some(Boolean)) out.push(row);
  if (out.length > 120001) throw Error("最多导入120000行。");
  return out;
}
const number = (s: string | undefined) => {
  if (!s || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s))
    throw Error("数值列不能空白或包含公式／千位分隔符。");
  const n = Number(s);
  if (!Number.isFinite(n)) throw Error("无效数字。");
  return n;
};
export const BACKTEST_CSV_TEMPLATE =
  "symbol,date,close,dividend,split\nDEMO1.US,2020-01-02,100,0,1\nDEMO1.US,2020-01-03,99,0,1\nDEMO1.US,2020-01-06,101,0,1\n";
export function importBacktestCSV(
  text: string,
  basis: HistoricalAsset["basis"],
  source = "用户CSV",
  singleSymbol = "",
): BacktestData {
  const parsed = rows(text),
    head =
      parsed.shift()?.map((s) => s.toLowerCase().replace(/[ _]/g, "")) ?? [];
  if (new Set(head).size !== head.length) throw Error("CSV列名重复。");
  const get = (r: string[], k: string) => r[head.indexOf(k)];
  const priceKey =
    basis === "total-return"
      ? head.includes("adjustedclose")
        ? "adjustedclose"
        : "adjclose"
      : "close";
  if (
    !head.includes("date") ||
    !head.includes(priceKey) ||
    (!head.includes("symbol") && !SYMBOL.test(singleSymbol))
  )
    throw Error(
      "需要 date、symbol 和价格列。单标的文件也可在上方指定准确代码。",
    );
  if (
    basis === "raw" &&
    (!head.includes("dividend") || !head.includes("split"))
  )
    throw Error(
      "原始价格必须同时提供 dividend 和 split；无事件填0和1，不能猜测缺失公司行动。",
    );
  const groups = new Map<string, HistoricalAsset>();
  for (const r of parsed) {
    if (r.length !== head.length) throw Error("CSV每行列数必须一致。");
    const symbol = (get(r, "symbol") || singleSymbol).toUpperCase(),
      date = get(r, "date");
    if (!SYMBOL.test(symbol) || !validDate(date))
      throw Error("标的代码或日期无效，使用 NVDA.US / ZSP.TO 和 YYYY-MM-DD。");
    if (!groups.has(symbol))
      groups.set(symbol, {
        symbol,
        currency: symbol.endsWith(".TO") ? "CAD" : "USD",
        basis,
        dividendsKnown: basis === "raw",
        source: source.slice(0, 200),
        points: [],
      });
    groups.get(symbol)!.points.push({
      date,
      close: number(get(r, priceKey)),
      dividend: basis === "raw" ? number(get(r, "dividend")) : 0,
      split: basis === "raw" ? number(get(r, "split")) : 1,
    });
  }
  const data: BacktestData = {
    version: 1,
    capturedAt: new Date().toISOString(),
    synthetic: false,
    assets: [...groups.values()].map((a) => ({
      ...a,
      points: a.points.sort((a, b) => a.date.localeCompare(b.date)),
    })),
  };
  validateBacktestData(data);
  return data;
}
export function readBacktestStudy(text: string): {
  config: BacktestConfig;
  data: BacktestData;
} {
  if (text.length > 20_000_000) throw Error("研究包不能超过20MB。");
  const pack = JSON.parse(text);
  if (pack?.format !== "together-backtest-v1")
    throw Error("不是受支持的回测研究包。");
  validateBacktestConfig(pack.config);
  validateBacktestData(pack.data);
  return { config: pack.config, data: pack.data };
}
export function syntheticBacktest(): {
  config: BacktestConfig;
  data: BacktestData;
} {
  const start = "2007-01-02",
    end = "2025-12-31";
  const assets: HistoricalAsset[] = ["DEMO1.US", "DEMO2.US"].map(
    (symbol, j) => {
      let close = 100;
      const points = [];
      for (
        let ms = Date.parse(start), i = 0;
        ms <= Date.parse(end);
        ms += 86400000
      ) {
        const d = new Date(ms);
        if ([0, 6].includes(d.getUTCDay())) continue;
        const date = d.toISOString().slice(0, 10);
        const shock =
          date >= "2008-09-01" && date <= "2009-03-01"
            ? -0.004
            : date >= "2020-02-20" && date <= "2020-03-23"
              ? -0.017
              : date >= "2022-01-01" && date <= "2022-09-30"
                ? -0.0018
                : 0.00065;
        close *= Math.exp(
          (j ? shock * 0.15 + 0.0001 : shock) +
            Math.sin(i++ * 0.71 + j) * (j ? 0.002 : 0.009),
        );
        points.push({
          date,
          close,
          dividend: d.getUTCDate() === 15 ? close * 0.001 : 0,
          split: 1,
        });
      }
      return {
        symbol,
        currency: "USD",
        basis: "raw",
        dividendsKnown: true,
        source: "合成算法演示，非真实证券",
        points,
      };
    },
  );
  return {
    config: {
      version: 1,
      name: "合成演示 · 非真实市场",
      currency: "USD",
      start,
      end,
      initial: 30000,
      monthly: 500,
      entryMonths: 12,
      feeBps: 5,
      cashRate: 0,
      riskFree: 0,
      dividends: "reinvest",
      holdings: [
        { symbol: "DEMO1.US", weight: 70 },
        { symbol: "DEMO2.US", weight: 30 },
      ],
      strategies: ["buy-hold", "dca", "rebalance"],
      risk: {
        horizon: 10,
        maxLoss: 25,
        purpose: "体验回测，不作投资结论",
        cadPerUnit: 1,
      },
    },
    data: {
      version: 1,
      capturedAt: new Date().toISOString(),
      synthetic: true,
      assets,
    },
  };
}
