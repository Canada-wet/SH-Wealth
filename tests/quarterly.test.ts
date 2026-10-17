import { describe, expect, it } from "vitest";
import {
  emptyState,
  finishChange,
  validateState,
  type WealthState,
} from "../lib/wealth";
import {
  EMPTY_QUARTERLY,
  REVIEW_CHECKS,
  emptyReview,
  validQuarterly,
} from "../lib/quarterly-schema";
import {
  addQuarterAction,
  completeQuarter,
  latestCompletedQuarter,
  quarterEvidence,
  quarterOptions,
  quarterPeriod,
  quarterPrompt,
  quarterlyStatus,
  setQuarterlyPreference,
  torontoDay,
  updateQuarter,
} from "../lib/quarterly-review";
import { connectionPlan, hasSavedData } from "../lib/cloud-plan";

const now = new Date("2026-10-16T12:00:00Z");
function fixture() {
  const s = emptyState();
  s.members = { first: "Test A", second: "Test B" };
  s.assets = [
    {
      id: "a",
      name: "模拟账户",
      owner: "joint",
      category: "投资",
      value: 1000,
      annualReturn: null,
    },
  ];
  return s;
}
function ready(s: WealthState) {
  return updateQuarter(s, "2026-Q3", () => ({
    notes: "明确记录缺口，下季补齐。",
    checks: Object.fromEntries(
      Object.keys(REVIEW_CHECKS).map((k) => [k, true]),
    ),
    actions: [
      {
        id: "action",
        title: "核对账单",
        owner: "joint",
        due: "2026-11-01",
        done: false,
      },
    ],
  }));
}
describe("季度财富复盘", () => {
  it.each([
    ["2026-10-01T03:59:59Z", "2026-Q2"],
    ["2026-10-01T04:00:00Z", "2026-Q3"],
    ["2027-01-01T04:59:59Z", "2026-Q3"],
    ["2027-01-01T05:00:00Z", "2026-Q4"],
    ["2026-04-01T04:00:00Z", "2026-Q1"],
  ])("按多伦多季末边界及夏令时选季度 %s", (at, key) =>
    expect(latestCompletedQuarter(new Date(at))).toBe(key),
  );
  it("季度范围、闰年和跨年下一季度正确", () => {
    expect(quarterPeriod("2024-Q1")).toMatchObject({
      start: "2024-01-01",
      end: "2024-03-31",
      due: "2024-04-01",
    });
    expect(quarterPeriod("2026-Q4")).toMatchObject({
      due: "2027-01-01",
      nextEnd: "2027-03-31",
    });
    expect(() => quarterPeriod("2026-Q5")).toThrow();
  });
  it("没有历史时标记缺失，不能用当前余额、演示曲线或当前预算回填", () => {
    const s = fixture();
    s.budget = [
      {
        id: "b",
        name: "当前工资",
        owner: "first",
        kind: "income",
        amount: 20000,
        essential: false,
      },
    ];
    s.legacyHistory = [{ month: "9月", value: 99 }];
    expect(quarterEvidence(s, "2026-Q3", now)).toMatchObject({
      opening: null,
      closing: null,
      monthlyBudget: null,
      target: null,
      contributionCount: 0,
    });
  });
  it("按时点排序，不用下一季度记录；重算余额而非信任旧缓存总额", () => {
    let s = fixture();
    s = finishChange(s, s, "期初", true, new Date("2026-07-01T03:59:59Z"));
    s = finishChange(
      s,
      { ...s, assets: [{ ...s.assets[0], value: 1200 }] },
      "期末",
      true,
      new Date("2026-10-01T03:59:59Z"),
    );
    s = finishChange(
      s,
      { ...s, assets: [{ ...s.assets[0], value: 99999 }] },
      "下季度",
      true,
      now,
    );
    s.history.reverse();
    s.history.forEach((h) => (h.netWorth = 888));
    expect(quarterEvidence(s, "2026-Q3", now)).toMatchObject({
      opening: { netWorth: 1000 },
      closing: { netWorth: 1200 },
    });
    expect(
      torontoDay(new Date(quarterEvidence(s, "2026-Q3", now).closing!.at)),
    ).toBe("2026-09-30");
  });
  it("贡献按发生日期和成员计算净投入，0笔不是零收益；不修改资产余额", () => {
    const s = fixture();
    s.contributions = [
      {
        id: "1",
        member: "first",
        amount: 100,
        kind: "deposit",
        date: "2026-07-01",
        assetId: "a",
        note: "",
      },
      {
        id: "2",
        member: "first",
        amount: 30,
        kind: "withdrawal",
        date: "2026-09-30",
        assetId: "a",
        note: "",
      },
      {
        id: "3",
        member: "second",
        amount: 40,
        kind: "deposit",
        date: "2026-09-05",
        assetId: "a",
        note: "",
      },
      {
        id: "4",
        member: "joint",
        amount: 9999,
        kind: "deposit",
        date: "2026-10-01",
        assetId: "a",
        note: "",
      },
    ];
    expect(quarterEvidence(s, "2026-Q3", now)).toMatchObject({
      contributionTotals: { first: 70, second: 40, joint: 0 },
      contributionCount: 3,
    });
    expect(s.assets[0].value).toBe(1000);
  });
  it("完成需要清单、结论和行动；不完整季度不可归档", () => {
    expect(() => completeQuarter(fixture(), "2026-Q3", now)).toThrow("四项");
    expect(() =>
      completeQuarter(
        ready(fixture()),
        "2026-Q3",
        new Date("2026-09-30T12:00:00Z"),
      ),
    ).toThrow("尚未结束");
    const s = updateQuarter(ready(fixture()), "2026-Q3", (r) => ({
      ...r,
      actions: [{ ...r.actions[0], due: "2026-10-01" }],
    }));
    expect(() => completeQuarter(s, "2026-Q3", now)).toThrow("到期日");
  });
  it("归档固定证据和结论，不改资产或伪造快照，行动完成仍可持久保存", () => {
    const s = ready(fixture()),
      completed = completeQuarter(s, "2026-Q3", now);
    validateState(completed);
    expect(completed.assets).toEqual(s.assets);
    expect(completed.history).toEqual([]);
    expect(quarterlyStatus(completed, now).due).toBe(false);
    const changed = {
      ...completed,
      assets: [{ ...s.assets[0], value: 20000 }],
    };
    expect(
      changed.preferences.quarterlyReviews!.records["2026-Q3"].evidence,
    ).toEqual(
      completed.preferences.quarterlyReviews!.records["2026-Q3"].evidence,
    );
    expect(() =>
      updateQuarter(completed, "2026-Q3", (r) => ({ ...r, notes: "改写" })),
    ).toThrow("不可改写");
    expect(() =>
      addQuarterAction(completed, "2026-Q3", {
        id: "new",
        title: "新行动",
        owner: "joint",
        due: "2026-11-01",
        done: false,
      }),
    ).toThrow("不可改写");
    const followed = updateQuarter(completed, "2026-Q3", (r) => ({
      ...r,
      actions: r.actions.map((a) => ({ ...a, done: true })),
    }));
    validateState(followed);
    expect(
      followed.preferences.quarterlyReviews!.records["2026-Q3"].actions[0].done,
    ).toBe(true);
  });
  it("提醒可关闭、延后、恢复，忽略空家庭和全局暂停；新季度独立提醒", () => {
    expect(quarterlyStatus(fixture(), now).due).toBe(true);
    expect(quarterlyStatus(emptyState(), now).due).toBe(false);
    expect(
      quarterlyStatus(
        setQuarterlyPreference(fixture(), "reminders", false),
        now,
      ).due,
    ).toBe(false);
    const s = updateQuarter(fixture(), "2026-Q3", (r) => ({
      ...r,
      snoozeUntil: "2026-10-23",
    }));
    expect(quarterlyStatus(s, now).due).toBe(false);
    expect(quarterlyStatus(s, new Date("2026-10-23T04:00:00Z")).due).toBe(true);
    expect(
      quarterlyStatus(
        { ...s, preferences: { ...s.preferences, proactive: false } },
        now,
      ).due,
    ).toBe(false);
    expect(
      quarterlyStatus(
        completeQuarter(ready(fixture()), "2026-Q3", now),
        new Date("2027-01-02T12:00:00Z"),
      ).due,
    ).toBe(true);
  });
  it("复盘记录进入备份/同步选择，不被当聊天数据覆盖；最多显示过去季度", () => {
    const s = setQuarterlyPreference(emptyState(), "external", true);
    expect(hasSavedData(s)).toBe(true);
    expect(connectionPlan(s, fixture())).toBe("choice");
    expect(quarterOptions(s, now)).toHaveLength(8);
    expect(quarterOptions(s, now)[0]).toBe("2026-Q3");
  });
  it.each([
    { ...EMPTY_QUARTERLY, external: "yes" },
    { ...EMPTY_QUARTERLY, records: { "2026-Q5": emptyReview() } },
    {
      ...EMPTY_QUARTERLY,
      records: { "2026-Q3": { ...emptyReview(), notes: "x".repeat(3001) } },
    },
    {
      ...EMPTY_QUARTERLY,
      records: {
        "2026-Q3": { ...emptyReview(), completedAt: now.toISOString() },
      },
    },
    {
      ...EMPTY_QUARTERLY,
      records: { "2026-Q3": { ...emptyReview(), snoozeUntil: "2026-02-30" } },
    },
  ])("拒绝无效复盘导入 %j", (v) => expect(validQuarterly(v)).toBe(false));
  it("AI收到明确证据边界和只读指令，不生成虚构收益", () => {
    const prompt = quarterPrompt(fixture(), "2026-Q3", now);
    expect(prompt).toContain('"opening":null');
    expect(prompt).toContain("不能把预算乘3");
    expect(prompt).toContain("不修改数据或执行交易");
  });
});
