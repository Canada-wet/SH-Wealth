import { describe, it, expect } from "vitest";
import { emptyState, validateState, type WealthState } from "../lib/wealth";
import {
  defaultFreedomPlan,
  freedomAnalysis,
  saveFreedomPlan,
  freedomContext,
  freedomSummary,
  FREEDOM_KEY,
  parseFreedomPlan,
} from "../lib/freedom";
import { validFreedomPlan } from "../lib/freedom-schema";
import { financialFingerprint } from "../lib/advisor-preview";
import { hasSavedData } from "../lib/cloud-plan";
import { growthContext } from "../lib/growth";
import { localAdvice } from "../lib/ai/local";
const fixture = () => {
  const s = emptyState();
  s.assets = [
    {
      id: "home",
      name: "住房",
      category: "住房",
      owner: "joint",
      value: 650000,
      annualReturn: 20,
      liquidity: "illiquid",
    },
    {
      id: "fund",
      name: "长期账户",
      category: "投资",
      owner: "first",
      value: 100000,
      annualReturn: 50,
    },
    {
      id: "cash",
      name: "现金",
      category: "现金",
      owner: "second",
      value: 50000,
      annualReturn: 0,
      liquidity: "available",
    },
  ];
  s.budget = [
    {
      id: "i",
      name: "工资",
      owner: "joint",
      kind: "income",
      amount: 15000,
      essential: false,
    },
    {
      id: "e",
      name: "生活费（包含孩子和医疗）",
      owner: "joint",
      kind: "expense",
      amount: 5000,
      essential: true,
    },
  ];
  return s;
};
const plan = (s: WealthState) => ({
  ...defaultFreedomPlan(s, new Date("2026-10-25T12:00:00Z")),
  years: 10,
  netReturn: 0,
  inflation: 0,
  monthlySaving: 1000,
});
describe("可解释的财务自由规划", () => {
  it("480个月等于2.5%提款率的40倍年支出，不能用工资抵掉支出", () => {
    const s = fixture(),
      p = plan(s);
    p.reserveMonths = 0;
    const a = freedomAnalysis(s, p);
    expect(a.annualSpending).toBe(60000);
    expect(a.portfolioTarget).toBe(2400000);
    expect(a.totalTarget).toBe(480 * 5000);
  });
  it("默认不自动选择住房、现金或全部净资产，也不沿用本年回报", () => {
    const p = defaultFreedomPlan(fixture());
    expect(p.selectedAssetIds).toEqual([]);
    expect(p.netReturn).not.toBe(50);
    expect(freedomAnalysis(fixture(), p).capital).toBe(0);
  });
  it("退休起可靠税后收入只抵缺口，提款税负再毛额化", () => {
    const s = fixture(),
      p = plan(s);
    p.annualIncome = 12000;
    p.withdrawalTax = 20;
    const a = freedomAnalysis(s, p);
    expect(a.annualGap).toBe(48000);
    expect(a.grossGap).toBe(60000);
    expect(a.portfolioTarget).toBe(2400000);
  });
  it("专项逐项独立，不按孩子数推断K，不重复读取已有医疗开支", () => {
    const s = fixture(),
      p = plan(s);
    p.goals = [
      { id: "a", name: "额外教育", amount: 20000 },
      { id: "b", name: "额外照护", amount: 30000 },
    ];
    const a = freedomAnalysis(s, p);
    expect(a.annualSpending).toBe(60000);
    expect(a.goals).toBe(50000);
    expect(a.reserve).toBe(30000);
    expect(a.totalTarget).toBe(2480000);
  });
  it("缓冲和专项先从本金隔离，不同时参与复利", () => {
    const s = fixture(),
      p = plan(s);
    p.selectedAssetIds = ["fund"];
    p.goals = [{ id: "a", name: "专项", amount: 20000 }];
    p.years = 1;
    p.netReturn = 10;
    p.monthlySaving = 0;
    const a = freedomAnalysis(s, p);
    expect(a.portfolio).toBe(50000);
    expect(a.projection.value).toBe(105000);
  });
  it("资金不够预留时新月供先补隔离资金，不能同时赚复利", () => {
    const s = fixture(),
      p = plan(s);
    p.selectedAssetIds = [];
    p.years = 1;
    p.monthlySaving = 1000;
    p.netReturn = 20;
    const a = freedomAnalysis(s, p);
    expect(a.projection.value).toBe(12000);
    expect(a.projection.invested).toBe(0);
  });
  it("通胀转换为实际回报，目标和金额同为今日购买力", () => {
    const s = fixture(),
      p = plan(s);
    p.netReturn = 5;
    p.inflation = 5;
    p.selectedAssetIds = ["fund"];
    const a = freedomAnalysis(s, p);
    expect(a.realReturn).toBeCloseTo(0);
    expect(a.projection.value).toBe(220000);
    expect(a.futureNominalTarget).toBeCloseTo(a.totalTarget * 1.05 ** 10, 1);
  });
  it("零回报月供计算有可核对的闭式解", () => {
    const s = fixture(),
      p = plan(s);
    p.selectedAssetIds = ["fund"];
    const a = freedomAnalysis(s, p);
    expect(a.requiredMonthly).toBeCloseTo((a.totalTarget - 100000) / 120, 1);
  });
  it("负实际回报仍可测算，不假定本金只涨不跌", () => {
    const s = fixture(),
      p = plan(s);
    p.selectedAssetIds = ["fund"];
    p.netReturn = -10;
    p.monthlySaving = 0;
    expect(freedomAnalysis(s, p).projection.value).toBeLessThan(100000);
  });
  it("无预算是缺失不是零；手工生活费与预算联动两种口径分开", () => {
    const s = fixture();
    s.budget = [];
    const p = plan(s);
    expect(freedomAnalysis(s, p).complete).toBe(false);
    p.spendingMode = "manual";
    p.monthlySpending = 2000;
    expect(freedomAnalysis(s, p).annualSpending).toBe(24000);
    expect(freedomAnalysis(s, p).complete).toBe(true);
  });
  it("预算改动后同一已存计划自动重算，不复制一份预算", () => {
    const s = fixture(),
      p = plan(s);
    const before = freedomAnalysis(s, p);
    s.budget![1].amount = 6000;
    expect(freedomAnalysis(s, p).portfolioTarget).toBeGreaterThan(
      before.portfolioTarget,
    );
  });
  it("额外500留存和20%压力只改变假设情景，不改估值或历史", () => {
    const s = fixture(),
      p = plan(s);
    p.selectedAssetIds = ["fund"];
    const before = structuredClone(s),
      a = freedomAnalysis(s, p);
    expect(a.extraSaving.value - a.projection.value).toBe(60000);
    expect(a.projection.value - a.stress.value).toBe(14000);
    expect(s).toEqual(before);
  });
  it("缺失账户不再计入本金，锁定或住房显式警示", () => {
    const s = fixture(),
      p = plan(s);
    p.selectedAssetIds = ["missing", "home"];
    const a = freedomAnalysis(s, p);
    expect(a.missingAssets).toEqual(["missing"]);
    expect(a.illiquid.map((a) => a.id)).toEqual(["home"]);
  });
  it("期限为0不算无穷月供；退休年数用于零实际回报覆盖检查", () => {
    const s = fixture(),
      p = plan(s);
    p.years = 0;
    const a = freedomAnalysis(s, p);
    expect(a.requiredMonthly).toBeNull();
    expect(a.retirementShortfallAtZeroReturn).toBe(60000 * 40);
  });
  it.each([NaN, Infinity, -1, 11])("无效提取率%s拒绝保存和测算", (n) => {
    const s = fixture(),
      p = plan(s);
    p.withdrawalRate = n;
    expect(validFreedomPlan(p)).toBe(false);
    expect(() => freedomAnalysis(s, p)).toThrow();
  });
  it("超过60年、小数期限、重复账户、过量目标均拒绝", () => {
    const p = plan(fixture());
    expect(validFreedomPlan({ ...p, years: 61 })).toBe(false);
    expect(validFreedomPlan({ ...p, years: 1.2 })).toBe(false);
    expect(validFreedomPlan({ ...p, selectedAssetIds: ["fund", "fund"] })).toBe(
      false,
    );
    expect(
      validFreedomPlan({
        ...p,
        goals: Array.from({ length: 11 }, (_, i) => ({
          id: String(i),
          name: "x",
          amount: 1,
        })),
      }),
    ).toBe(false);
  });
  it("只保存计划字段，不修改账本、预算、贡献或净资产目标", () => {
    const s = fixture(),
      p = plan(s),
      next = saveFreedomPlan(s, p, financialFingerprint(s));
    expect(next.assets).toEqual(s.assets);
    expect(next.budget).toEqual(s.budget);
    expect(next.contributions).toEqual(s.contributions);
    expect(next.goal).toEqual(s.goal);
    expect(next.history).toEqual(s.history);
    expect(parseFreedomPlan(next.plan.values[FREEDOM_KEY])).toEqual(p);
    validateState(next);
    expect(hasSavedData(next)).toBe(true);
  });
  it("伴侣数据变化阻止旧草稿覆盖，删除账户不能静默保存", () => {
    const s = fixture(),
      p = plan(s),
      finger = financialFingerprint(s);
    s.budget![1].amount = 6000;
    expect(() => saveFreedomPlan(s, p, finger)).toThrow(/已更新/);
    p.selectedAssetIds = ["missing"];
    expect(() => saveFreedomPlan(s, p, financialFingerprint(s))).toThrow(
      /删除/,
    );
  });
  it("JSON备份往返、共享合并入口和顾问上下文均保留", () => {
    const s = fixture(),
      p = plan(s),
      next = saveFreedomPlan(s, p, financialFingerprint(s));
    const read = JSON.parse(JSON.stringify(next));
    validateState(read);
    expect(freedomContext(read)?.targetToday).toBe(
      freedomAnalysis(s, p).totalTarget,
    );
    expect(growthContext(read).financialFreedom).not.toBeNull();
    expect(localAdvice("检视财务自由计划", read).answer).toContain(
      "已保存的财务自由情景",
    );
    expect(freedomSummary(s, p)).toContain("不提前抵扣未来养老金");
  });
  it("计划损坏拒绝整个导入，不能静默回到默认值", () => {
    const s = fixture();
    s.plan.values[FREEDOM_KEY] = "{broken";
    expect(() => validateState(s)).toThrow(/格式损坏/);
    expect(() => parseFreedomPlan(JSON.stringify({ version: 2 }))).toThrow();
  });
});
