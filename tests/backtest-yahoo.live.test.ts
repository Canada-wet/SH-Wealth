import { expect, it } from "vitest";
it.skipIf(process.env.RUN_YAHOO_INTEGRATION !== "1")(
  "真实Yahoo公开日线：美股、加拿大ETF与份额映射；拒绝即停止，不使用家庭数据",
  async () => {
    const { fetchYahooHistory } = await import("../lib/backtest-yahoo-server");
    for (const symbol of [
      "VTV.US",
      "XCV.TO",
      "NVDA.US",
      "ZSP.TO",
      "CGL.C.TO",
    ]) {
      const result = await fetchYahooHistory(
        symbol,
        "2020-01-01",
        "2026-10-30",
      );
      console.log(
        JSON.stringify({
          symbol,
          yahooSymbol: result.yahooSymbol,
          points: result.asset?.points.length,
          first: result.asset?.points[0].date,
          last: result.asset?.points.at(-1)?.date,
          error: result.error,
        }),
      );
      if (result.blocked) throw Error("Yahoo拒绝或限流，停止真实检查");
      expect(result.asset).toBeDefined();
      expect(result.asset!.points.length).toBeGreaterThan(1000);
      expect(result.asset!.basis).toBe("total-return");
      expect(result.asset!.dividendsKnown).toBe(false);
    }
  },
  40000,
);
