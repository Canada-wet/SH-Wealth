import { expect, it } from "vitest";
import {
  DEFAULT_WATCHLIST,
  normalizeWatchlist,
  widgetUrl,
  pulseWidgetUrl,
  tradingSymbol,
  parseFred,
  macroReading,
  MACRO,
} from "../lib/market";
import { parseBoc } from "../lib/market-server";
import { emptyState, validateState } from "../lib/wealth";
it("涨跌速览含全部唯一自选和正确报价币种，不发送自定义私密名称", () => {
  const config = JSON.parse(
    decodeURIComponent(
      new URL(
        pulseWidgetUrl({ ...DEFAULT_WATCHLIST[0], name: "PRIVATE_LABEL" }),
      ).hash.slice(1),
    ),
  );
  expect(config.symbol).toBe("NASDAQ:NVDA");
  expect(
    pulseWidgetUrl(DEFAULT_WATCHLIST.find((row) => row.ticker === "CGL.C")!),
  ).toContain("single-quote");
  expect(JSON.stringify(config)).not.toContain("PRIVATE_LABEL");
  expect(() =>
    pulseWidgetUrl({ ...DEFAULT_WATCHLIST[0], ticker: "<script>" }),
  ).toThrow();
});
it("默认清单完整去重，SPCX确认为SpaceX，TSX类份额保持CAD", () => {
  expect(DEFAULT_WATCHLIST).toHaveLength(30);
  expect(
    new Set(DEFAULT_WATCHLIST.map((row) => row.exchange + row.ticker)).size,
  ).toBe(30);
  expect(DEFAULT_WATCHLIST.find((row) => row.ticker === "SPCX")).toMatchObject({
    name: "SpaceX",
    exchange: "NASDAQ",
  });
  expect(
    tradingSymbol(DEFAULT_WATCHLIST.find((row) => row.ticker === "DATA.B")!),
  ).toBe("TSX:DATA.B");
  expect(DEFAULT_WATCHLIST.filter((row) => row.ticker === "ZSP")).toHaveLength(
    1,
  );
});
it("重复去重区分交易所，不接受脚本、任意host或过长清单", () => {
  const row = DEFAULT_WATCHLIST[0];
  expect(
    normalizeWatchlist([row, row, { ...row, exchange: "TSX" }]),
  ).toHaveLength(2);
  expect(() => normalizeWatchlist([{ ...row, ticker: "</script>" }])).toThrow();
  expect(() => normalizeWatchlist(Array(61).fill(row))).toThrow();
  const s = emptyState();
  s.preferences.marketWatchlist = [row];
  validateState(s);
  s.preferences.marketWatchlist = [{ ...row, exchange: "invalid" as "TSX" }];
  expect(() => validateState(s)).toThrow(/自选/);
});
it("只向隔离提供商传公开代码，不携带家庭数据或查询参数密钥", () => {
  const url = widgetUrl("quotes", DEFAULT_WATCHLIST);
  expect(
    url.startsWith(
      "https://www.tradingview-widget.com/embed-widget/market-quotes/",
    ),
  ).toBe(true);
  const config = JSON.parse(decodeURIComponent(new URL(url).hash.slice(1)));
  expect(config.symbolsGroups).toHaveLength(2);
  expect(JSON.stringify(config)).not.toMatch(
    /household|members|assets|apikey|messages/,
  );
  expect(
    widgetUrl("quotes", [
      { ...DEFAULT_WATCHLIST[0], name: "PRIVATE_ACCOUNT_LABEL" },
    ]),
  ).not.toContain("PRIVATE_ACCOUNT_LABEL");
  expect(
    widgetUrl("chart", DEFAULT_WATCHLIST, "https://evil.invalid"),
  ).not.toContain("evil");
});
it("央行原值是外币兑CAD，反转为1CAD兑目标币且保留来源日期", () => {
  const data = parseBoc({
    observations: [
      {
        d: "2026-10-12",
        FXCNYCAD: { v: "0.2" },
        FXUSDCAD: { v: "1.25" },
        FXJPYCAD: { v: "0.01" },
      },
      {
        d: "2026-10-13",
        FXCNYCAD: { v: "0.25" },
        FXUSDCAD: { v: "" },
        FXJPYCAD: { v: "0" },
      },
    ],
  });
  expect(data[0]).toMatchObject({ value: 4, previous: 5, date: "2026-10-13" });
  expect(data[1]).toMatchObject({ value: 0.8, date: "2026-10-12" });
  expect(data[2].value).toBe(100);
});
it("节假日缺值不当作零，FRED只取最新有效观察，拒绝ZIP或HTML", () => {
  const data = parseFred(
    "observation_date,DGS2,DGS10\n2026-10-12,.,\n2026-10-13,4.20,4.50\n2026-10-14,,.\n",
    ["DGS2", "DGS10"],
  );
  expect(data.DGS2).toEqual([{ date: "2026-10-13", value: 4.2 }]);
  expect(() => parseFred("<html>error</html>", ["DGS2"])).toThrow();
  expect(() => parseFred("DATE,OTHER\n2026-01-01,2", ["DGS2"])).toThrow();
});
it("CPI按去年同月算同比；不拿最新指数当百分比", () => {
  const rows = [
    { date: "2025-01-01", value: 200 },
    { date: "2026-01-01", value: 220 },
  ];
  const reading = macroReading(MACRO[0], rows);
  expect(reading.value).toBeCloseTo(10);
  expect(reading.date).toBe("2026-01-01");
  expect(
    macroReading(MACRO[0], [
      { date: "2025-12-01", value: 210 },
      { date: "2026-01-01", value: 220 },
    ]).value,
  ).toBeNull();
});
it("非农以千人的月差展示，GDP沿用环比折年率，不混成同比", () => {
  expect(
    macroReading(MACRO[2], [
      { date: "2026-08-01", value: 159000 },
      { date: "2026-09-01", value: 159029 },
    ]),
  ).toMatchObject({ value: 29, unit: "千人" });
  expect(
    macroReading(MACRO[4], [{ date: "2026-04-01", value: 2.2 }]),
  ).toMatchObject({ value: 2.2, frequency: "quarterly" });
});
it("未知数据保持不可用，支持负增长、零值而非伪造前值", () => {
  expect(macroReading(MACRO[4], []).value).toBeNull();
  expect(
    macroReading(MACRO[4], [{ date: "2026-04-01", value: -1.2 }]).value,
  ).toBe(-1.2);
  expect(macroReading(MACRO[3], [{ date: "2026-09-01", value: 0 }]).value).toBe(
    0,
  );
});
