import { expect, it } from "vitest";
import { DEFAULT_WATCHLIST } from "../lib/market";
import {
  cadScenario,
  EMPTY_RESEARCH_NOTE,
  productCaution,
  researchTheme,
  saveResearchNote,
  validResearchNotes,
  validReviewDate,
} from "../lib/market-research";
import { emptyState, validateState } from "../lib/wealth";
import { connectionPlan, hasSavedData } from "../lib/cloud-plan";
const nvda = DEFAULT_WATCHLIST[0];
const note = {
  ...EMPTY_RESEARCH_NOTE,
  thesis: "合成研究，非建议",
  updatedAt: "2026-10-14T12:00:00Z",
};
it("主题按交易所与代码精确映射，自定义未知代码不猜测", () => {
  expect(researchTheme(nvda)).toBe("semis");
  expect(researchTheme({ ...nvda, exchange: "TSX" })).toBe("other");
  expect(DEFAULT_WATCHLIST.every((row) => researchTheme(row) !== "other")).toBe(
    true,
  );
  expect(
    productCaution(DEFAULT_WATCHLIST.find((row) => row.ticker === "YINN")!)
      ?.text,
  ).toContain("单日");
  expect(
    productCaution({ ...nvda, ticker: "ZQQ", exchange: "NASDAQ" }),
  ).toBeNull();
  expect(
    productCaution(DEFAULT_WATCHLIST.find((row) => row.ticker === "ZQQ")!)
      ?.text,
  ).toContain("对冲");
});
it("外币与加币回报使用复乘，不相加；回撤恢复非对称", () => {
  const result = cadScenario(10000, -20, 10)!;
  expect(result.rate).toBeCloseTo(-0.12);
  expect(result.end).toBeCloseTo(8800);
  expect(result.pnl).toBeCloseTo(-1200);
  expect(result.recovery).toBeCloseTo(1 / 0.88 - 1);
  expect(cadScenario(10000, -20, 0)?.recovery).toBeCloseTo(0.25);
  expect(cadScenario(10000, -100, 0)?.recovery).toBeNull();
  expect(cadScenario(10000, 0, 0)?.rate).toBe(0);
});
it("压力情景拒绝无穷值、无效本金和低于归零的假设", () => {
  for (const [amount, asset, fx] of [
    [0, 0, 0],
    [-1, 0, 0],
    [Infinity, 0, 0],
    [100, NaN, 0],
    [100, -101, 0],
    [100, 0, -100],
    [100, 0, 1001],
  ])
    expect(cadScenario(amount, asset, fx)).toBeNull();
});
it("研究笔记独立更新，陈旧基线不可覆盖、其他标的不受影响", () => {
  const first = saveResearchNote({}, nvda, undefined, note);
  expect(first["NASDAQ:NVDA"].thesis).toBe(note.thesis);
  const second = saveResearchNote(first, DEFAULT_WATCHLIST[1], undefined, note);
  expect(second["NASDAQ:NVDA"]).toEqual(first["NASDAQ:NVDA"]);
  expect(() =>
    saveResearchNote(second, nvda, undefined, { ...note, thesis: "stale" }),
  ).toThrow("已被更新");
  expect(
    saveResearchNote(second, nvda, second["NASDAQ:NVDA"], {
      ...note,
      thesis: "新逻辑",
    })["NASDAQ:NVDA"].thesis,
  ).toBe("新逻辑");
  const reordered = Object.fromEntries(
    Object.entries(second["NASDAQ:NVDA"]).reverse(),
  ) as typeof note;
  expect(() => saveResearchNote(second, nvda, reordered, note)).not.toThrow();
});
it("备份验证限制格式、长度与真实日历日期，同时兼容旧文档", () => {
  expect(validReviewDate("2026-02-30")).toBe(false);
  expect(validReviewDate("2028-02-29")).toBe(true);
  expect(validReviewDate("")).toBe(true);
  for (const invalid of [
    [],
    null,
    { nope: note },
    { "NASDAQ:NVDA": { ...note, thesis: "x".repeat(2001) } },
    { "NASDAQ:NVDA": { ...note, reviewDate: "2026-02-30" } },
    { "NASDAQ:NVDA": { ...note, updatedAt: "invalid" } },
  ])
    expect(validResearchNotes(invalid)).toBe(false);
  expect(validResearchNotes({ "NASDAQ:NVDA": note })).toBe(true);
  const state = emptyState();
  expect(() => validateState(state)).not.toThrow();
  state.preferences.marketResearch = { "NASDAQ:NVDA": note };
  expect(() => validateState(JSON.parse(JSON.stringify(state)))).not.toThrow();
  state.preferences.marketResearch["NASDAQ:NVDA"].risk = "x".repeat(2001);
  expect(() => validateState(state)).toThrow("研究记录");
});
it("只存研究也算用户数据，云端连接不能当空文档覆盖或只合并聊天", () => {
  const state = emptyState();
  state.preferences.marketResearch = { "NASDAQ:NVDA": note };
  expect(hasSavedData(state)).toBe(true);
  expect(connectionPlan(state, null)).toBe("upload");
  const cloud = emptyState();
  cloud.messages = [{ id: "synthetic", role: "user", text: "test" }];
  expect(connectionPlan(state, cloud)).toBe("choice");
});
