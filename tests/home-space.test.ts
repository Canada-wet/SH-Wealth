import { describe, expect, it } from "vitest";
import { homeSnapshot } from "../lib/home-space";
import {
  emptyState,
  finishChange,
  type BudgetItem,
  type WealthState,
} from "../lib/wealth";
import { EMPTY_QUARTERLY, emptyReview } from "../lib/quarterly-schema";
import { EMPTY_LIFESTYLE, validLifestyle } from "../lib/lifestyle-schema";
import { lifestyleFixture } from "./fixtures/lifestyle";

const now = new Date("2026-10-18T15:00:00Z");
function fixture(): WealthState {
  const state = emptyState();
  state.members = { first: "Synthetic A", second: "Synthetic B" };
  state.assets = [
    {
      id: "a",
      name: "Synthetic account",
      owner: "first",
      category: "投资",
      value: 12000,
      annualReturn: null,
    },
  ];
  return state;
}
function budget(income: number, expense: number): BudgetItem[] {
  return [
    {
      id: "income",
      name: "Synthetic income",
      kind: "income",
      owner: "first",
      amount: income,
      essential: false,
    },
    {
      id: "expense",
      name: "Synthetic expense",
      kind: "expense",
      owner: "joint",
      amount: expense,
      essential: true,
    },
  ];
}
function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freezeDeep(item);
    Object.freeze(value);
  }
  return value;
}

describe("家庭首页只派生已保存数据", () => {
  it("应急金提示定位已挂载的家庭计划根区块，不跳入尚未展开的子区块", () => {
    const state = fixture();
    state.assets[0].category = "现金";
    state.assets[0].value = 100;
    state.budget = budget(5000, 1000);
    state.plan.values.emergency_months = "6";
    const action = homeSnapshot(state, now).actions.find(
      (row) => row.title === "现金缓冲低于你们设置的目标",
    );
    expect(action?.href).toBe("/#framework");
  });
  it("空账本明确未录入，不把没有记录当作已核实的零资产", () => {
    const result = homeSnapshot(emptyState(), now);
    expect(result.hasLedger).toBe(false);
    expect(result.monthlySurplus).toBeNull();
    expect(result.financialAt).toBeNull();
    expect(result.actions.map((action) => action.href)).toContain("/#assets");

    const zeroAccount = fixture();
    zeroAccount.assets[0].value = 0;
    expect(homeSnapshot(zeroAccount, now)).toMatchObject({
      hasLedger: true,
      netWorth: 0,
    });
    const debtOnly = emptyState();
    debtOnly.debts = [
      { id: "d", name: "Synthetic debt", owner: "joint", value: 200 },
    ];
    expect(homeSnapshot(debtOnly, now)).toMatchObject({
      hasLedger: true,
      totalAssets: 0,
      totalDebts: 200,
      netWorth: -200,
    });
  });

  it.each(["missing", "empty", "income-only", "expense-only"])(
    "收支未完整录入时不推测月结余：%s",
    (kind) => {
      const state = fixture();
      const rows = budget(5000, 3000);
      state.budget =
        kind === "missing"
          ? undefined
          : kind === "empty"
            ? []
            : kind === "income-only"
              ? rows.slice(0, 1)
              : rows.slice(1);
      expect(homeSnapshot(state, now).monthlySurplus).toBeNull();
    },
  );

  it.each([
    [5000, 3000, 2000],
    [2000, 3000, -1000],
    [0, 0, 0],
    [100.1, 50.05, 50.05],
  ])("完整收支保留真实月结余 %s − %s = %s", (income, expense, surplus) => {
    const state = fixture();
    state.budget = budget(income, expense);
    expect(homeSnapshot(state, now).monthlySurplus).toBe(surplus);
  });

  it("季度提醒遵守单独关闭与稍后提醒设置，不关闭其他派生行动", () => {
    const state = fixture();
    const reminder = homeSnapshot(state, now).actions.find(
      (action) => action.id === "quarter",
    );
    expect(reminder).toMatchObject({
      title: "2026 年第 3 季度，一起做一次复盘",
      href: "/#quarterly-review",
      attention: false,
    });
    state.preferences.quarterlyReviews = {
      ...structuredClone(EMPTY_QUARTERLY),
      reminders: false,
    };
    const disabled = homeSnapshot(state, now);
    expect(disabled.actions.some((action) => action.id === "quarter")).toBe(
      false,
    );
    expect(disabled.actions.map((action) => action.href)).toContain(
      "/#cashflow",
    );

    state.preferences.quarterlyReviews = {
      ...structuredClone(EMPTY_QUARTERLY),
      records: {
        "2026-Q3": { ...emptyReview(), snoozeUntil: "2026-10-19" },
      },
    };
    expect(
      homeSnapshot(state, now).actions.some(
        (action) => action.id === "quarter",
      ),
    ).toBe(false);
    state.preferences.quarterlyReviews.records["2026-Q3"].snoozeUntil =
      "2026-10-18";
    expect(
      homeSnapshot(state, now).actions.some(
        (action) => action.id === "quarter",
      ),
    ).toBe(true);
  });

  it("关闭主动建议时同时关闭首页建议和季度提醒，但保留财务摘要", () => {
    const state = fixture();
    state.budget = budget(2000, 3000);
    expect(homeSnapshot(state, now).actions.length).toBeGreaterThan(0);
    state.preferences.proactive = false;
    expect(homeSnapshot(state, now)).toMatchObject({
      hasLedger: true,
      netWorth: 12000,
      monthlySurplus: -1000,
      actions: [],
    });
  });

  it("同一入口的多项提醒只出现一次，首页最多给三个行动", () => {
    let state = fixture();
    state.assets[0].valuationDate = "2026-08-01";
    state.assets.push({
      ...state.assets[0],
      id: "b",
      name: "Synthetic partner account",
      owner: "second",
      value: 1000,
    });
    state.budget = budget(6000, 2000);
    state = finishChange(
      state,
      state,
      "Synthetic balance snapshot",
      true,
      new Date("2026-08-01T15:00:00Z"),
    );
    const actions = homeSnapshot(state, now).actions;
    expect(actions).toHaveLength(3);
    expect(new Set(actions.map((action) => action.href)).size).toBe(3);
    expect(actions.filter((action) => action.href === "/#assets")).toHaveLength(
      1,
    );
    expect(actions.every((action) => action.href.startsWith("/"))).toBe(true);
  });

  it("真实收支缺口优先于常规季度复盘，且保留解释与来源", () => {
    const state = fixture();
    state.budget = budget(2000, 3000);
    const actions = homeSnapshot(state, now).actions;
    expect(actions[0]).toMatchObject({
      title: "已记录的月支出超过收入",
      attention: true,
      href: "/#cashflow",
      source: "收入 − 支出",
    });
    expect(
      actions.findIndex((action) => action.id === "quarter"),
    ).toBeGreaterThan(0);
    expect(actions[0].detail).toContain("1,000");
  });

  it("兴趣数量与累计练习分钟只来自当前保存记录，不用 Set 目标时长冒充练习", () => {
    const state = fixture();
    expect(homeSnapshot(state, now)).toMatchObject({
      tracks: 0,
      sets: 0,
      practices: 0,
      practiceMinutes: 0,
    });
    const lifestyle = lifestyleFixture();
    lifestyle.sets = [
      {
        id: "set",
        name: "Synthetic session",
        owner: "joint",
        targetMinutes: 90,
        entries: [],
      },
    ];
    lifestyle.practices = [25, 40].map((minutes, index) => ({
      id: `practice-${index}`,
      date: "2026-10-17",
      member: "joint",
      minutes,
      enjoyment: 4,
      setId: "set",
      setName: "Synthetic session",
      trackCount: 3,
      focus: "Synthetic cue practice",
      note: "",
    }));
    expect(validLifestyle(lifestyle)).toBe(true);
    state.preferences.lifestyle = lifestyle;
    expect(homeSnapshot(state, now)).toMatchObject({
      tracks: 5,
      sets: 1,
      practices: 2,
      practiceMinutes: 65,
    });
    state.preferences.lifestyle = structuredClone(EMPTY_LIFESTYLE);
    expect(homeSnapshot(state, now)).toMatchObject({
      tracks: 0,
      sets: 0,
      practices: 0,
      practiceMinutes: 0,
    });
  });

  it("聊天或偏好保存的更新时间不伪装成财富快照时间", () => {
    let state = fixture();
    state.updatedAt = now.toISOString();
    state.messages = [
      {
        id: "message",
        role: "user",
        text: "Synthetic private message",
        createdAt: now.toISOString(),
      },
    ];
    expect(homeSnapshot(state, now).financialAt).toBeNull();
    state = finishChange(
      state,
      state,
      "Synthetic balance snapshot",
      true,
      new Date("2026-09-01T15:00:00Z"),
    );
    state = finishChange(
      state,
      state,
      "Synthetic conversation save",
      false,
      now,
    );
    expect(state.updatedAt).toBe(now.toISOString());
    expect(homeSnapshot(state, now).financialAt).toBe(
      "2026-09-01T15:00:00.000Z",
    );
  });

  it("重复派生不修改冻结的账本、偏好、历史或兴趣记录", () => {
    let state = fixture();
    state.budget = budget(2000, 3000);
    state.preferences.lifestyle = lifestyleFixture();
    state = finishChange(state, state, "Synthetic snapshot", true, now);
    const before = structuredClone(state);
    freezeDeep(state);
    expect(homeSnapshot(state, now)).toEqual(homeSnapshot(state, now));
    expect(state).toEqual(before);
  });
});
