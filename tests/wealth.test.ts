import { describe, it, expect } from "vitest";
import {
  breakdown,
  budgetTotals,
  chartPoints,
  contributionSummary,
  deleteAsset,
  deleteContribution,
  emptyState,
  finishChange,
  numberInput,
  ownerLabel,
  saveAsset,
  saveContribution,
  totals,
  validateState,
  type Contribution,
} from "../lib/wealth";
const initial = () =>
  saveAsset(emptyState(), {
    id: "a",
    name: "储蓄",
    category: "现金",
    owner: "joint",
    value: 100000.25,
    annualReturn: 8.4,
  });
const contribution = (values: Partial<Contribution> = {}): Contribution => ({
  id: "c",
  member: "first",
  amount: 1000,
  assetId: "a",
  kind: "deposit",
  date: "2026-10-12",
  note: "",
  ...values,
});
describe("资产与净资产", () => {
  it("负债扣除准确且保留分", () => {
    const state = initial();
    state.debts = [{ id: "d", name: "贷款", owner: "joint", value: 1234.56 }];
    expect(totals(state)).toEqual({
      totalAssets: 100000.25,
      totalDebts: 1234.56,
      netWorth: 98765.69,
    });
  });
  it.each([-2.5, 0, null, 12.34])(
    "本年回报可保存为 %s 且不改变估值",
    (annualReturn) => {
      const state = initial();
      const next = saveAsset(state, { ...state.assets[0], annualReturn });
      expect(next.assets[0].annualReturn).toBe(annualReturn);
      expect(next.assets[0].value).toBe(100000.25);
    },
  );
  it("自定义类别不被归为其他；图表准确汇总", () => {
    const state = initial();
    state.assets.push({
      id: "b",
      name: "艺术品",
      category: "艺术品",
      owner: "first",
      value: 50000,
      annualReturn: null,
    });
    const groups = breakdown(state, "category");
    expect(groups.map((row) => row.name)).toEqual(["现金", "艺术品"]);
    expect(groups.reduce((sum, row) => sum + row.amount, 0)).toBe(
      totals(state).totalAssets,
    );
    expect(groups.reduce((sum, row) => sum + row.percent, 0)).toBeCloseTo(100);
  });
  it("成员改名保留归属与贡献，按总资产计算占比", () => {
    const state = initial();
    state.assets.push({
      id: "b",
      name: "个人",
      category: "退休",
      owner: "first",
      value: 50000,
      annualReturn: null,
    });
    state.members = { first: "Alice", second: "Bob" };
    const owners = breakdown(state, "owner");
    expect(owners.find((row) => row.key === "first")?.name).toBe("Alice");
    expect(owners.find((row) => row.key === "first")?.amount).toBe(50000);
    expect(ownerLabel("second", state.members)).toBe("Bob");
    expect(owners.reduce((sum, row) => sum + row.percent, 0)).toBeCloseTo(100);
  });
  it("删除资产保留贡献、取消关联，历史仍保留原账户", () => {
    let state = saveContribution(initial(), contribution());
    state = finishChange(initial(), state, "投入", true);
    const next = deleteAsset(state, "a");
    expect(next.contributions[0].assetId).toBeNull();
    expect(next.history[0].assets[0].id).toBe("a");
  });
  it.each(["", "-5", "12foo", "NaN", "1.2.3"])("拒绝无效金额 %s", (input) =>
    expect(() => numberInput(input, "金额")).toThrow(),
  );
  it("支持数字格式并保留负回报", () => {
    expect(numberInput("$1,200.25", "金额")).toBe(1200.25);
    expect(numberInput("-4.2%", "回报", true)).toBe(-4.2);
  });
});
describe("贡献记账", () => {
  it("关联投入增加估值，编辑只应用差额，删除撤回资金变动", () => {
    let state = saveContribution(initial(), contribution());
    expect(state.assets[0].value).toBe(101000.25);
    state = saveContribution(state, contribution({ amount: 1500 }));
    expect(state.assets[0].value).toBe(101500.25);
    state = deleteContribution(state, "c");
    expect(state.assets[0].value).toBe(100000.25);
    expect(state.contributions).toHaveLength(0);
  });
  it("取出、修改关联账户和变更类型正确联动", () => {
    let state = initial();
    state.assets.push({
      id: "b",
      name: "另一账户",
      category: "现金",
      owner: "second",
      value: 5000,
      annualReturn: null,
    });
    state = saveContribution(state, contribution());
    state = saveContribution(
      state,
      contribution({ assetId: "b", kind: "withdrawal", amount: 2000 }),
    );
    expect(state.assets.map((row) => row.value)).toEqual([100000.25, 3000]);
  });
  it("独立历史出资不会再次增加资产", () => {
    const state = saveContribution(initial(), contribution({ assetId: null }));
    expect(state.assets[0].value).toBe(100000.25);
    expect(contributionSummary(state)[0].net).toBe(1000);
  });
  it("投入占比与净贡献分别计算", () => {
    let state = saveContribution(
      initial(),
      contribution({ assetId: null, amount: 2000 }),
    );
    state = saveContribution(
      state,
      contribution({ id: "c2", member: "second", assetId: null, amount: 3000 }),
    );
    state = saveContribution(
      state,
      contribution({
        id: "c3",
        assetId: null,
        kind: "withdrawal",
        amount: 500,
      }),
    );
    const summary = contributionSummary(state);
    expect(summary[0]).toMatchObject({
      deposits: 2000,
      withdrawals: 500,
      net: 1500,
      percent: 40,
    });
    expect(summary[1].percent).toBe(60);
  });
  it("拒绝负余额、零金额和未知关联，不改变原始数据", () => {
    const state = initial();
    expect(() =>
      saveContribution(
        state,
        contribution({ kind: "withdrawal", amount: 200000 }),
      ),
    ).toThrow();
    expect(() =>
      saveContribution(state, contribution({ amount: 0 })),
    ).toThrow();
    expect(() =>
      saveContribution(state, contribution({ assetId: "unknown" })),
    ).toThrow();
    expect(state.assets[0].value).toBe(100000.25);
  });
});
describe("历史与校验", () => {
  it("现金流按税后收入与每月开支汇总，必要开支单独用于应急金", () => {
    const state = emptyState();
    state.budget = [
      {
        id: "i",
        name: "收入",
        kind: "income",
        owner: "first",
        amount: 8000,
        essential: false,
      },
      {
        id: "e",
        name: "房租",
        kind: "expense",
        owner: "joint",
        amount: 3000,
        essential: true,
      },
      {
        id: "e2",
        name: "旅行",
        kind: "expense",
        owner: "joint",
        amount: 500,
        essential: false,
      },
    ];
    expect(budgetTotals(state)).toEqual({
      income: 8000,
      expenses: 3500,
      surplus: 4500,
      essential: 3000,
    });
  });
  it("同一天多个修改全部保留且深拷贝", () => {
    let state = initial();
    state = finishChange(
      state,
      saveAsset(state, { ...state.assets[0], value: 110000 }),
      "更新",
      true,
      new Date("2026-10-12T10:00:00Z"),
    );
    state = finishChange(
      state,
      saveAsset(state, { ...state.assets[0], annualReturn: -3 }),
      "回报",
      true,
      new Date("2026-10-12T10:00:01Z"),
    );
    expect(state.history).toHaveLength(2);
    expect(state.history[0].assets[0].annualReturn).toBe(8.4);
    expect(state.history[1].assets[0].annualReturn).toBe(-3);
    expect(state.revision).toBe(2);
  });
  it("范围按日期过滤，保留范围前的基准，非记录条数", () => {
    let state = initial();
    for (const date of [
      "2025-01-01",
      "2026-01-01",
      "2026-08-01",
      "2026-08-02",
      "2026-10-01",
    ])
      state = finishChange(state, state, "快照", true, new Date(date));
    expect(
      chartPoints(state, 3, new Date("2026-10-12")).map((row) =>
        row.at.slice(0, 10),
      ),
    ).toEqual(["2026-01-01", "2026-08-01", "2026-08-02", "2026-10-01"]);
  });
  it("空状态合法，不制造示例资产", () => {
    expect(() => validateState(emptyState())).not.toThrow();
    expect(totals(emptyState()).netWorth).toBe(0);
  });
  it("拒绝损坏数据、NaN、重复ID和相同成员名", () => {
    const state = initial();
    expect(() =>
      validateState({ ...state, assets: [{ ...state.assets[0], value: NaN }] }),
    ).toThrow();
    expect(() =>
      validateState({ ...state, assets: [state.assets[0], state.assets[0]] }),
    ).toThrow();
    expect(() =>
      validateState({ ...state, members: { first: "A", second: "A" } }),
    ).toThrow();
  });
});
