import { it, expect } from "vitest";
import { portfolioCurrencies, cadReference } from "../lib/backtest-currency";
import { syntheticBacktest, importBacktestCSV } from "../lib/backtest-import";
import { runBacktest } from "../lib/backtest";
const now = new Date("2026-11-01T18:00:00Z");
const market = () => ({
  fetchedAt: "2026-11-01T17:00:00Z",
  fx: [
    {
      id: "FXUSDCAD",
      value: 1 / 1.38,
      date: "2026-10-30",
      unit: " / CAD",
      source:
        "https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/",
    },
  ],
});
it("只有所有当前证券都有行情记录才给统一币种，不把后缀当事实", () => {
  const p = syntheticBacktest();
  expect(
    portfolioCurrencies([{ symbol: "ZSP.U.TO", weight: 100 }], null).currency,
  ).toBeNull();
  expect(portfolioCurrencies(p.config.holdings, p.data)).toMatchObject({
    currency: "USD",
    complete: true,
    mixed: false,
  });
  expect(
    portfolioCurrencies(
      [...p.config.holdings, { symbol: "NEW.TO", weight: 1 }],
      p.data,
    ).currency,
  ).toBeNull();
  p.data.assets[1].currency = "CAD";
  expect(portfolioCurrencies(p.config.holdings, p.data)).toMatchObject({
    currency: null,
    mixed: true,
    complete: true,
  });
});
it("央行页面口径1CAD对应USD反转为1USD对应CAD，保留观测日与来源", () => {
  expect(cadReference(market(), now)).toMatchObject({
    rate: 1.38,
    date: "2026-10-30",
  });
});
it("汇率缺失、非正、过期、未来、错口径或错来源均不能覆盖手工值", () => {
  for (const patch of [
    { value: 0 },
    { value: NaN },
    { value: -1 },
    { date: "2026-11-02" },
    { date: "2020-01-01" },
    { unit: "CAD / USD" },
    { source: "https://evil.example" },
  ]) {
    const m = market();
    Object.assign(m.fx[0], patch);
    expect(() => cadReference(m, now)).toThrow();
  }
  const m = market();
  m.fetchedAt = "2099-01-01";
  expect(() => cadReference(m, now)).toThrow();
  expect(() => cadReference({}, now)).toThrow();
});
it("CSV显式currency支持TSX美元份额，仍按真实币种拒绝混合回测", () => {
  const csv =
    "symbol,currency,date,adjusted_close\nZSP.U.TO,USD,2020-01-02,100\nZSP.U.TO,USD,2020-01-03,101\nZSP.U.TO,USD,2020-01-06,102";
  const d = importBacktestCSV(csv, "total-return", "synthetic-currency-test");
  expect(d.assets[0].currency).toBe("USD");
  const c = {
    ...syntheticBacktest().config,
    start: "2020-01-02",
    end: "2020-01-06",
    holdings: [{ symbol: "ZSP.U.TO", weight: 100 }],
  };
  expect(runBacktest(c, d).config.currency).toBe("USD");
  expect(() => runBacktest({ ...c, currency: "CAD" }, d)).toThrow(/币种/);
});
it("CSV币种不能在同一证券内漂移或包含不支持币种", () => {
  for (const tail of ["CAD", "JPY", ""]) {
    expect(() =>
      importBacktestCSV(
        `symbol,currency,date,adjusted_close\nTEST.TO,USD,2020-01-02,100\nTEST.TO,${tail},2020-01-03,101`,
        "total-return",
        "fixture",
      ),
    ).toThrow(/币种|currency/);
  }
});
