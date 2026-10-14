import {
  MACRO,
  TREASURIES,
  parseFred,
  macroReading,
  type MarketData,
  type MarketReading,
  type Observation,
} from "./market";
import { unstable_cache } from "next/cache";
async function publicFetch(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("数据源暂不可用");
  return response;
}
export function parseBoc(raw: unknown): MarketReading[] {
  const body = raw as {
    observations?: { d: string; [key: string]: unknown }[];
  };
  if (!Array.isArray(body?.observations))
    throw new Error("官方外汇数据格式无效");
  return [
    ["FXCNYCAD", "人民币 CNY"],
    ["FXUSDCAD", "美元 USD"],
    ["FXJPYCAD", "日元 JPY"],
  ].map(([id, label]) => {
    const trend = body
      .observations!.flatMap((row) => {
        const value = Number((row[id] as { v?: string } | undefined)?.v);
        return /^\d{4}-\d{2}-\d{2}$/.test(row.d) &&
          Number.isFinite(value) &&
          value > 0
          ? [{ date: row.d, value: 1 / value }]
          : [];
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      id,
      label,
      value: trend.at(-1)?.value ?? null,
      date: trend.at(-1)?.date ?? null,
      unit: " / CAD",
      frequency: "daily" as const,
      source:
        "https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/",
      trend: trend.slice(-10),
      previous: trend.at(-2)?.value,
      note: "加拿大央行工作日日均，非盘中或银行成交价；已反转为 1 CAD 对目标货币",
    };
  });
}
export async function fetchOfficialMarket(): Promise<MarketData> {
  const failures: string[] = [];
  const fred = async (ids: string[]) =>
    parseFred(
      await (
        await publicFetch(
          `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${ids.join(",")}`,
        )
      ).text(),
      ids,
    );
  const missing = (
    id: string,
    label: string,
    frequency: MarketReading["frequency"],
    unit: string,
    source: string,
  ): MarketReading => ({
    id,
    label,
    frequency,
    unit,
    source,
    value: null,
    date: null,
    trend: [],
    note: "当前数据源未返回可用数据，不使用示例数值",
  });
  const [fx, yields, macro] = await Promise.all([
    (async () => {
      try {
        return parseBoc(
          await (
            await publicFetch(
              "https://www.bankofcanada.ca/valet/observations/FXCNYCAD,FXUSDCAD,FXJPYCAD/json?recent=10",
            )
          ).json(),
        );
      } catch {
        failures.push("加拿大央行外汇参考");
        return [
          ["FXCNYCAD", "人民币 CNY"],
          ["FXUSDCAD", "美元 USD"],
          ["FXJPYCAD", "日元 JPY"],
        ].map(([id, label]) =>
          missing(
            id,
            label,
            "daily",
            " / CAD",
            "https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/",
          ),
        );
      }
    })(),
    (async () => {
      try {
        const data = await fred(TREASURIES.map(([id]) => id));
        return TREASURIES.map(([id, label]) => ({
          id,
          label,
          value: data[id].at(-1)?.value ?? null,
          date: data[id].at(-1)?.date ?? null,
          unit: "%",
          frequency: "daily" as const,
          source: `https://fred.stlouisfed.org/series/${id}`,
          trend: data[id].slice(-30),
          previous: data[id].at(-2)?.value,
          note: "美债固定期限市场收益率，日频；不是价格或票息",
        }));
      } catch {
        failures.push("美国国债收益率");
        return TREASURIES.map(([id, label]) =>
          missing(
            id,
            label,
            "daily",
            "%",
            `https://fred.stlouisfed.org/series/${id}`,
          ),
        );
      }
    })(),
    Promise.all(
      MACRO.map(async (definition) => {
        try {
          const data = await fred([definition.id]);
          return macroReading(definition, data[definition.id]);
        } catch {
          failures.push(definition.label);
          return missing(
            definition.id,
            definition.label,
            definition.frequency,
            definition.unit,
            `https://fred.stlouisfed.org/series/${definition.id}`,
          );
        }
      }),
    ),
  ]);
  return { fetchedAt: new Date().toISOString(), fx, yields, macro, failures };
}
// Only public, fixed market series are cached, never household state or auth.
export const getOfficialMarket = unstable_cache(
  fetchOfficialMarket,
  ["together-official-market-v1"],
  { revalidate: 300 },
);
