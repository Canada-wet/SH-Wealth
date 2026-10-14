import { expect, it } from "vitest";
import {
  emptyState,
  saveAsset,
  validateState,
  finishChange,
  cashReference,
  validDate,
} from "../lib/wealth";
import { financialFingerprint } from "../lib/advisor-preview";
import {
  costSharing,
  debtCosts,
  goalPace,
  valuationReview,
  todayToronto,
  updateValuations,
  undoPoint,
  undoFinancial,
  snapshotChanges,
} from "../lib/household-workspace";
import { applyAssistantActions } from "../lib/advisor-actions";
import { householdPulse, proactiveInsights } from "../lib/insights";
const now = new Date("2030-06-15T12:00:00Z");
const fixture = () => {
  const s = saveAsset(emptyState(), {
    id: "a",
    name: "储蓄",
    category: "现金",
    owner: "joint",
    value: 1000,
    annualReturn: 2,
  });
  s.goal = { name: "测试目标", target: 4100, year: "2032" };
  s.budget = [
    {
      id: "i1",
      name: "收入一",
      owner: "first",
      amount: 1000,
      kind: "income",
      essential: false,
    },
    {
      id: "i2",
      name: "收入二",
      owner: "second",
      amount: 3000,
      kind: "income",
      essential: false,
    },
    {
      id: "e",
      name: "共同开销",
      owner: "joint",
      amount: 1000.01,
      kind: "expense",
      essential: true,
    },
    {
      id: "p",
      name: "个人开销",
      owner: "first",
      amount: 300,
      kind: "expense",
      essential: true,
    },
  ];
  return s;
};
it("旧版备份兼容；新增可选日期、备注、流动性和负债资料校验", () => {
  const s = fixture();
  validateState(s);
  s.assets[0] = {
    ...s.assets[0],
    valuationDate: "2030-06-15",
    note: "有期限",
    liquidity: "locked",
  };
  s.debts.push({
    id: "d",
    name: "负债",
    owner: "joint",
    value: 500,
    annualRate: 0,
    monthlyPayment: 0,
  });
  validateState(s);
  s.debts[0].annualRate = -1;
  expect(() => validateState(s)).toThrow(/负债/);
  s.debts[0].annualRate = null;
  s.assets[0].valuationDate = "2030-02-31";
  expect(() => validateState(s)).toThrow(/资产/);
});
it.each(["2030-02-31", "2030-13-01", "garbage", "2030-1-01"])(
  "真实日期校验拒绝 %s",
  (date) => expect(validDate(date)).toBe(false),
);
it("Toronto跨午夜日期统一，不跟服务端UTC日期走", () =>
  expect(todayToronto(new Date("2030-06-16T02:00:00Z"))).toBe("2030-06-15"));
it("单项日期检查不受最近修改预算或聊天影响", () => {
  const s = fixture();
  s.assets[0].valuationDate = "2030-05-01";
  s.assets.push({ ...s.assets[0], id: "b", valuationDate: undefined });
  s.updatedAt = now.toISOString();
  expect(valuationReview(s, now).map((row) => row.age)).toEqual([45, null]);
  s.assets[0].valuationDate = "2030-06-15";
  expect(valuationReview(s, now)).toHaveLength(1);
});
it("财务顾问改值和saveAsset保留账户资料，不伪造新核对日期", () => {
  const s = fixture();
  s.assets[0] = {
    ...s.assets[0],
    valuationDate: "2030-05-01",
    liquidity: "locked",
    note: "期限",
  };
  expect(
    applyAssistantActions(s, [
      { type: "update_asset", existingName: "储蓄", value: 2000 },
    ]).assets[0],
  ).toMatchObject({
    valuationDate: "2030-05-01",
    liquidity: "locked",
    note: "期限",
  });
  expect(
    saveAsset(s, {
      id: "a",
      name: "储蓄",
      category: "现金",
      owner: "joint",
      value: 2000,
      annualReturn: 0,
    }).assets[0].note,
  ).toBe("期限");
});
it("现金覆盖与计划排除锁定现金，未知资金另标，不改变图表总额", () => {
  const s = fixture();
  s.assets[0].liquidity = "locked";
  s.assets.push({ ...s.assets[0], id: "b", value: 200, liquidity: "unknown" });
  expect(cashReference(s.assets)).toEqual({
    amount: 200,
    unverified: 200,
    excluded: 1000,
  });
  expect(householdPulse(s, now).cash).toBe(200);
  expect(s.assets.reduce((sum, row) => sum + row.value, 0)).toBe(1200);
});
it("目标基线与首页一致，缺失预算和过期目标不伪造结论", () => {
  const s = fixture();
  expect(goalPace(s, now)).toMatchObject({
    months: 31,
    required: 100,
    surplus: 2699.99,
    shortfall: 0,
  });
  expect(householdPulse(s, now).monthlyGoal).toBe(goalPace(s, now).required);
  s.budget = [];
  expect(goalPace(s, now).surplus).toBeNull();
  s.goal.year = "2029";
  expect(goalPace(s, now).required).toBeNull();
});
it("共同费用比例精确到分，只读不冒充实际贡献", () => {
  const s = fixture(),
    before = JSON.stringify(s);
  expect(costSharing(s, "equal")).toEqual({
    joint: 1000.01,
    first: 500.01,
    second: 500,
  });
  expect(costSharing(s, "income")).toEqual({
    joint: 1000.01,
    first: 250,
    second: 750.01,
  });
  expect(JSON.stringify(s)).toBe(before);
  s.budget = [];
  expect(costSharing(s, "income").first).toBeNull();
  s.budget = [
    {
      id: "one",
      name: "一方收入",
      owner: "first",
      amount: 1000,
      kind: "income",
      essential: false,
    },
  ];
  expect(costSharing(s, "income").first).toBeNull();
});
it("负债未知利率不作为零，零利率可用，月还款不再加到预算", () => {
  const s = fixture(),
    budget = JSON.stringify(s.budget);
  s.debts = [
    {
      id: "d1",
      name: "贷款",
      owner: "joint",
      value: 10000,
      annualRate: 5,
      monthlyPayment: 200,
    },
    { id: "d2", name: "待核对", owner: "joint", value: 1000 },
    {
      id: "d3",
      name: "无息",
      owner: "joint",
      value: 1000,
      annualRate: 0,
      monthlyPayment: 100,
    },
  ];
  expect(debtCosts(s)).toEqual({
    annualInterest: 500,
    unknown: 1,
    payments: 300,
    missingPayments: 1,
  });
  expect(JSON.stringify(s.budget)).toBe(budget);
});
it("批量值、负回报、零和清空一次更新，保留未选项目与资料", () => {
  const s = fixture();
  s.assets[0].note = "备注";
  s.assets.push({ ...s.assets[0], id: "b" });
  const next = updateValuations(
    s,
    [
      {
        id: "a",
        value: 1200.25,
        annualReturn: -3,
        valuationDate: "2030-06-15",
      },
    ],
    financialFingerprint(s),
  );
  expect(next.assets[0]).toMatchObject({
    value: 1200.25,
    annualReturn: -3,
    note: "备注",
  });
  expect(next.assets[1]).toEqual(s.assets[1]);
  expect(s.assets[0].value).toBe(1000);
  expect(finishChange(s, next, "批量", true, now).history).toHaveLength(1);
});
it("批量错误或伙伴更新拒绝整个批次，不做部分写入", () => {
  const s = fixture(),
    expected = financialFingerprint(s);
  const rows = [
    { id: "a", value: 1200, annualReturn: null, valuationDate: "2030-06-15" },
    {
      id: "missing",
      value: 0,
      annualReturn: null,
      valuationDate: "2030-06-15",
    },
  ];
  expect(() => updateValuations(s, rows, expected)).toThrow();
  expect(s.assets[0].value).toBe(1000);
  s.assets[0].value = 1500;
  expect(() => updateValuations(s, rows.slice(0, 1), expected)).toThrow(/更新/);
});
it("安全撤销只还原财务、不删聊天和历史，撤销另写快照", () => {
  const before = fixture(),
    after = finishChange(before, { ...before, assets: [] }, "删除", true, now),
    point = undoPoint(before, after, "删除");
  after.messages = [{ id: "m", role: "user", text: "保留聊天" }];
  after.preferences.model = "local";
  const next = finishChange(
    after,
    undoFinancial(after, point),
    "撤销删除",
    true,
    now,
  );
  expect(next.assets).toEqual(before.assets);
  expect(next.messages).toEqual(after.messages);
  expect(next.preferences.model).toBe("local");
  expect(next.history).toHaveLength(2);
});
it("撤销遇到新的财务、成员、计划变动必须拒绝覆盖", () => {
  const before = fixture(),
    after = { ...before, assets: [{ ...before.assets[0], value: 1500 }] },
    point = undoPoint(before, after, "改值");
  const current = structuredClone(after);
  current.plan.values.rule = "新的安排";
  expect(() => undoFinancial(current, point)).toThrow(/变动/);
  expect(current.assets[0].value).toBe(1500);
});
it("历史对比保留新增、删除及债务余额符号，不误报收益", () => {
  const s = fixture();
  const a = finishChange(emptyState(), s, "初始", true, now).history[0];
  const b = finishChange(
    s,
    {
      ...s,
      assets: [],
      debts: [{ id: "d", name: "贷款", value: 500, owner: "joint" }],
    },
    "变更",
    true,
    now,
  ).history[0];
  const diff = snapshotChanges(a, b);
  expect(diff.netDelta).toBe(-1500);
  expect(diff.changes.map((row) => row.delta)).toEqual([-1000, 500]);
});
it("逐项过期提醒使用独立核对日期，预算更新不会掩盖", () => {
  const s = fixture();
  s.assets[0].valuationDate = "2030-04-01";
  expect(
    proactiveInsights(s, now).some((row) => row.id.includes("account-dates")),
  ).toBe(true);
});
