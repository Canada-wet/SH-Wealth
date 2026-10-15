import { expect, it } from "vitest";
import {
  MARKET_INDICATORS,
  observationAge,
  volatilityTerm,
} from "../lib/market-indicators";
import {
  briefingFacts,
  parseMarketNarrative,
  ruleMarketBrief,
  torontoDay,
} from "../lib/market-briefing";
import { readingChange } from "../lib/market-analysis";
import {
  validMarketData,
  mergeMarketData,
  marketSnapshot,
} from "../lib/market-state";
import type { MarketData, MarketReading } from "../lib/market";
export const indicatorFixture: MarketData = {
  fetchedAt: "2026-10-15T14:00:00Z",
  fx: [],
  yields: [],
  macro: [],
  failures: [],
  indicators: MARKET_INDICATORS.map((definition, i) => ({
    ...definition,
    value: [20, 24, 200000, 1300, 30000, 180, 75][i],
    date:
      definition.frequency === "daily"
        ? "2026-10-14"
        : definition.frequency === "weekly"
          ? "2026-10-10"
          : "2026-08-01",
    source: `https://fred.stlouisfed.org/series/${definition.id}`,
    trend: [
      {
        date:
          definition.frequency === "daily"
            ? "2026-10-13"
            : definition.frequency === "weekly"
              ? "2026-10-03"
              : "2026-07-01",
        value: [18, 22, 190000, 1400, 29000, 170, 74][i],
      },
    ],
  })),
};
it("按多伦多日历归档，跨UTC午夜与夏冬令时不会错日", () => {
  expect(torontoDay(new Date("2026-10-15T02:00:00Z"))).toBe("2026-10-14");
  expect(torontoDay(new Date("2026-12-15T04:30:00Z"))).toBe("2026-12-14");
  expect(torontoDay(new Date("2026-07-15T04:30:00Z"))).toBe("2026-07-15");
});
it("VIX期限比值仅同日正值计算，不从旧日期拼接", () => {
  expect(volatilityTerm(indicatorFixture.indicators!)?.ratio).toBeCloseTo(
    20 / 24,
  );
  expect(
    volatilityTerm(
      indicatorFixture.indicators!.map((row) =>
        row.id === "VXVCLS" ? { ...row, date: "2026-10-13" } : row,
      ),
    ),
  ).toBeNull();
  expect(
    volatilityTerm(
      indicatorFixture.indicators!.map((row) =>
        row.id === "VXVCLS" ? { ...row, value: 0 } : row,
      ),
    ),
  ).toBeNull();
});
it("初请周差严格相邻一周，缺周不当成上周；产能变化为百分点", () => {
  const claims = indicatorFixture.indicators!.find((row) => row.id === "ICSA")!;
  expect(readingChange(claims)).toMatchObject({
    value: 10000,
    unit: "人",
    label: "较上周",
  });
  expect(
    readingChange({
      ...claims,
      trend: [{ date: "2026-09-26", value: 190000 }],
    }),
  ).toBeNull();
  expect(
    readingChange(
      indicatorFixture.indicators!.find((row) => row.id === "CAPUTLG3344S")!,
    ),
  ).toMatchObject({ value: 1, unit: "百分点" });
});
it("规则摘要明确身份、限制和来源，缺失组不编造分析", () => {
  const brief = ruleMarketBrief(
    indicatorFixture,
    new Date("2026-10-15T14:00:00Z"),
  );
  expect(brief.mode).toBe("rules");
  expect(brief.points).toHaveLength(3);
  expect(brief.points[2].text).toContain("不含半导体新订单");
  expect(brief.points[0].text).toContain("不是期货");
  expect(
    ruleMarketBrief({ ...indicatorFixture, indicators: [] }).points,
  ).toEqual([]);
});
it("AI叙述必须引用已有非空序列，拒绝未知ID、超长和坏JSON", () => {
  const raw = {
    summary: "合成概括",
    points: [
      { title: "情绪与波动", text: "合成分析", evidence: ["VIXCLS"] },
      { title: "经济前瞻", text: "合成分析", evidence: ["ICSA"] },
      { title: "AI 产业代理", text: "合成分析", evidence: ["A34SNO"] },
    ],
    watchNext: "核对发布",
    limitations: "有滞后",
  };
  expect(
    parseMarketNarrative(
      "```json\n" + JSON.stringify(raw) + "\n```",
      briefingFacts(indicatorFixture),
    ).summary,
  ).toBe(raw.summary);
  expect(
    parseMarketNarrative(
      JSON.stringify({
        ...raw,
        points: raw.points.map((point) => ({
          ...point,
          title: "模型标题别名",
        })),
      }),
      briefingFacts(indicatorFixture),
    ).points.map((point) => point.title),
  ).toEqual(["情绪与波动", "经济前瞻", "AI 产业代理"]);
  for (const invalid of [
    { ...raw, points: [] },
    { ...raw, summary: "x".repeat(241) },
    { ...raw, summary: "加元走强" },
    { ...raw, points: raw.points.slice(0, 2) },
    { ...raw, points: [{ ...raw.points[0], evidence: ["FAKE_PRICE"] }] },
  ])
    expect(() =>
      parseMarketNarrative(
        JSON.stringify(invalid),
        briefingFacts(indicatorFixture),
      ),
    ).toThrow();
  expect(() => parseMarketNarrative(JSON.stringify(raw), [])).toThrow();
});
it("AI输入仅白名单公共字段，缓存兼容旧版并保留失效指标原日期", () => {
  const data = { ...indicatorFixture, household: { secret: "private" } };
  expect(JSON.stringify(briefingFacts(data))).not.toContain("private");
  expect(
    briefingFacts({
      ...data,
      fx: [{ ...data.indicators![0], id: "FXUSDCAD" }],
    }).some((row) => row.id === "FXUSDCAD"),
  ).toBe(false);
  expect(validMarketData(data)).toBe(true);
  expect(validMarketData({ ...data, indicators: "bad" })).toBe(false);
  const next = mergeMarketData(data, {
    ...data,
    indicators: data.indicators!.map((row) => ({
      ...row,
      value: null,
      date: null,
    })),
  });
  expect(next.indicators?.[0].date).toBe("2026-10-14");
  expect(next.indicators?.[0].note).toContain("保留上次");
  expect(marketSnapshot(data, []).indicators).toHaveLength(7);
});
it("陈旧观测按自身频率标注，不把月度指标当成刚读取的今日数据", () => {
  const row = indicatorFixture.indicators![0];
  expect(observationAge(row, new Date("2026-10-30T00:00:00Z")).delayed).toBe(
    true,
  );
  expect(
    observationAge(
      { ...row, frequency: "monthly" },
      new Date("2026-10-30T00:00:00Z"),
    ).delayed,
  ).toBe(false);
  expect(observationAge({ ...row, value: null }).days).toBeNull();
});
