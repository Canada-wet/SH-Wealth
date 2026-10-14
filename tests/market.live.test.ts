import { expect, it } from "vitest";
import {
  commonCurve,
  alignedSpread,
  payrollAverage,
  readingChange,
} from "../lib/market-analysis";
it.skipIf(process.env.RUN_MARKET_INTEGRATION !== "1")(
  "真实官方市场数据：CAD正确反转、美债期限、CPI同比、GDP口径与非农月差",
  async () => {
    const { fetchOfficialMarket } = await import("../lib/market-server");
    const data = await fetchOfficialMarket();
    expect(data.failures).toEqual([]);
    expect(data.fx).toHaveLength(3);
    expect(
      data.fx.every((row) => row.value !== null && row.value > 0 && row.date),
    ).toBe(true);
    expect(commonCurve(data.yields)?.points).toHaveLength(6);
    expect(commonCurve(data.yields, 20)?.points).toHaveLength(6);
    expect(alignedSpread(data.yields, "DGS10", "DGS2")).not.toBeNull();
    expect(
      payrollAverage(data.macro.find((row) => row.id === "PAYEMS")),
    ).not.toBeNull();
    expect(
      readingChange(data.macro.find((row) => row.id === "CPIAUCNS")!),
    ).not.toBeNull();
    expect(data.yields).toHaveLength(6);
    expect(data.yields.every((row) => row.value !== null && row.date)).toBe(
      true,
    );
    expect(data.macro).toHaveLength(5);
    expect(
      data.macro.every(
        (row) => row.value !== null && row.date && row.trend.length > 0,
      ),
    ).toBe(true);
  },
  25000,
);
