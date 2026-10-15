import { describe, it, expect } from "vitest";
import {
  emptyState,
  validateState,
  totals,
  finishChange,
  type WealthState,
} from "../lib/wealth";
import {
  defaultGrowthPlan,
  growthAnalysis,
  growthTasks,
  growthConfig,
  saveGrowthPlan,
  setGrowthTask,
  growthContext,
} from "../lib/growth";
import { validGrowthPlan } from "../lib/growth-schema";
import { financialFingerprint } from "../lib/advisor-preview";
import { connectionPlan, hasSavedData } from "../lib/cloud-plan";
import { localAdvice } from "../lib/ai/local";
const now = new Date("2026-10-15T16:00:00Z");
function fixture(): WealthState {
  const s = emptyState();
  s.assets = [
    {
      id: "home",
      name: "住房",
      category: "住房",
      owner: "first",
      value: 600000,
      annualReturn: 20,
      liquidity: "illiquid",
    },
    {
      id: "fund",
      name: "长期账户",
      category: "投资",
      owner: "joint",
      value: 20000,
      annualReturn: 15,
    },
    {
      id: "cash",
      name: "现金",
      category: "现金",
      owner: "second",
      value: 10000,
      annualReturn: null,
      liquidity: "available",
    },
    {
      id: "gic",
      name: "未核对GIC",
      category: "现金",
      owner: "first",
      value: 8000,
      annualReturn: 4,
    },
    {
      id: "locked",
      name: "锁定",
      category: "现金",
      owner: "first",
      value: 5000,
      annualReturn: null,
      liquidity: "locked",
    },
  ];
  s.debts = [
    {
      id: "mortgage",
      name: "房贷",
      value: 100000,
      owner: "first",
      annualRate: null,
    },
  ];
  s.budget = [
    {
      id: "i",
      name: "收入",
      owner: "joint",
      amount: 10000,
      kind: "income",
      essential: false,
    },
    {
      id: "e",
      name: "必要开支",
      owner: "joint",
      amount: 3000,
      kind: "expense",
      essential: true,
    },
  ];
  s.goal = { name: "目标", target: 800000, year: "2027" };
  s.plan.values.emergency_months = "6";
  return s;
}
describe("财富增长算术与边界", () => {
  it("默认0回报、不选全部净资产，预算结余只是未确认初值", () => {
    const s = fixture(),
      p = defaultGrowthPlan(s, now);
    expect(p.monthlySaving).toBe(7000);
    expect(p.selectedAssetIds).toEqual([]);
    expect(p.annualRate).toBe(0);
    expect(s.preferences.growthPlan).toBeUndefined();
    const a = growthAnalysis(s, p, now);
    expect(a.months).toBe(14);
    expect(a.projected).toBe(totals(s).netWorth + 7000 * 14);
    expect(a.projected).toBe(a.baseline);
    expect(a.points.at(-1)!.month).toBe("2027-12");
  });
  it("只有收入没有支出时不拿收入当可留存资金的默认值", () => {
    const s = fixture();
    s.budget = s.budget!.filter((row) => row.kind === "income");
    expect(defaultGrowthPlan(s, now).monthlySaving).toBe(0);
    expect(growthAnalysis(s, defaultGrowthPlan(s, now), now).complete).toBe(
      false,
    );
  });
  it("只对指定本金与长期月投入复利，留存不重复累计，住房债务不自动增长", () => {
    const s = fixture(),
      p = {
        ...defaultGrowthPlan(s, now),
        monthlySaving: 2000,
        longTermMonthly: 500,
        annualRate: 6,
        selectedAssetIds: ["fund"],
      };
    const a = growthAnalysis(s, p, now),
      rate = Math.pow(1.06, 1 / 12) - 1;
    const future =
      20000 * Math.pow(1 + rate, 14) +
      (500 * (Math.pow(1 + rate, 14) - 1)) / rate;
    expect(a.capital).toBe(20000);
    expect(a.projected).toBeCloseTo(
      totals(s).netWorth - 20000 + future + 1500 * 14,
      2,
    );
    expect(a.contribution).toBe(28000);
    expect(a.effect).toBeCloseTo(a.projected - a.baseline, 2);
    expect(s.assets[0].value).toBe(600000);
    expect(s.history).toEqual([]);
  });
  it("负回报、无本金与零长期投入、逾期目标均不编造正收益", () => {
    const s = fixture(),
      p = {
        ...defaultGrowthPlan(s, now),
        monthlySaving: 0,
        annualRate: -10,
        selectedAssetIds: ["fund"],
      };
    expect(growthAnalysis(s, p, now).effect).toBeLessThan(0);
    expect(growthAnalysis(s, { ...p, selectedAssetIds: [] }, now).effect).toBe(
      0,
    );
    s.goal.year = "2025";
    const a = growthAnalysis(s, p, now);
    expect(a.months).toBe(0);
    expect(a.projected).toBe(totals(s).netWorth);
    expect(a.points).toHaveLength(1);
  });
  it("缓冲只用已确认可动用现金，未知与锁定GIC不当可投资资金", () => {
    const s = fixture(),
      a = growthAnalysis(s, defaultGrowthPlan(s, now), now);
    expect(a.verifiedCash).toBe(10000);
    expect(a.unverifiedCash).toBe(8000);
    expect(a.reserveTarget).toBe(18000);
    expect(a.reserveGap).toBe(8000);
    expect(a.aboveReserve).toBe(0);
    expect(growthTasks(s, now)[0].id).toBe("buffer");
    expect(growthTasks(s, now).find((x) => x.id === "debt")!.body).toContain(
      "1 项余额利率未填",
    );
    s.budget = [];
    expect(growthAnalysis(s, undefined, now).reserveTarget).toBeNull();
  });
  it("出资仅跟踪本月非未来所选账户，独立历史出资与其他账户不混入", () => {
    const s = fixture(),
      p = { ...defaultGrowthPlan(s, now), selectedAssetIds: ["fund"] };
    s.contributions = [
      ["fund", "2026-10-01", "deposit", 1000],
      ["fund", "2026-10-14", "withdrawal", 200],
      [null, "2026-10-01", "deposit", 9000],
      ["cash", "2026-10-01", "deposit", 9000],
      ["fund", "2026-11-01", "deposit", 9000],
      ["fund", "2026-10-16", "deposit", 9000],
    ].map(([assetId, date, kind, amount], i) => ({
      id: String(i),
      member: "joint",
      assetId: assetId as string | null,
      date: String(date),
      kind: kind as "deposit" | "withdrawal",
      amount: Number(amount),
      note: "synthetic",
    }));
    const a = growthAnalysis(s, p, now);
    expect(a.recordedContribution).toBe(800);
    expect(a.recordedCount).toBe(2);
  });
  it("预算不足明确量化，缺收入不能当作零，月边界使用多伦多时间", () => {
    const s = fixture(),
      p = { ...defaultGrowthPlan(s, now), monthlySaving: 8000 };
    expect(growthAnalysis(s, p, now).budgetGap).toBe(1000);
    s.budget = s.budget!.filter((x) => x.kind === "expense");
    expect(growthAnalysis(s, p, now).budgetGap).toBeNull();
    expect(growthAnalysis(s, p, new Date("2026-11-01T01:00:00Z")).months).toBe(
      14,
    );
  });
  it("目标就在本年12月时不再追加当前月留存，日期不是错误地往后推一年", () => {
    const s = fixture();
    s.goal.year = "2026";
    const a = growthAnalysis(
      s,
      defaultGrowthPlan(s, now),
      new Date("2026-12-15T12:00:00Z"),
    );
    expect(a.months).toBe(0);
    expect(a.contribution).toBe(0);
    expect(a.projected).toBe(totals(s).netWorth);
  });
  it("已删除本金排除并标明缺失，而非继续用旧估值", () => {
    const s = fixture(),
      p = { ...defaultGrowthPlan(s, now), selectedAssetIds: ["fund", "gone"] };
    const a = growthAnalysis(s, p, now);
    expect(a.capital).toBe(20000);
    expect(a.missingAssets).toEqual(["gone"]);
    expect(() =>
      saveGrowthPlan(
        s,
        p,
        growthConfig(s.preferences.growthPlan),
        financialFingerprint(s),
      ),
    ).toThrow(/账户无效/);
  });
});
describe("持久化、冲突与行动闭环", () => {
  it("月度执行跨月、已完成复盘到期时重新提示，避免永久静默", () => {
    let s = fixture();
    s.preferences.growthPlan = {
      ...defaultGrowthPlan(s, now),
      reviewDate: "2026-10-20",
    };
    for (const id of ["execution", "review"] as const)
      s = setGrowthTask(
        s,
        growthTasks(s, now).find((x) => x.id === id)!,
        "done",
        now,
      );
    const nextMonth = growthTasks(s, new Date("2026-11-01T12:00:00Z"));
    expect(nextMonth.find((x) => x.id === "execution")!.status).toBe("review");
    expect(nextMonth.find((x) => x.id === "review")!.status).toBe("review");
  });
  it("计划与任务备份可恢复，不改资产、负债、贡献或财务历史", () => {
    const s = fixture(),
      p = defaultGrowthPlan(s, now);
    const next = finishChange(
      s,
      saveGrowthPlan(s, p, "not-saved", financialFingerprint(s)),
      "growth",
      false,
      now,
    );
    const task = growthTasks(next, now)[0];
    const done = setGrowthTask(next, task, "done", now);
    validateState(JSON.parse(JSON.stringify(done)));
    expect(done.assets).toBe(s.assets);
    expect(done.contributions).toBe(s.contributions);
    expect(done.debts).toBe(s.debts);
    expect(done.history).toBe(s.history);
    expect(growthTasks(done, now).find((x) => x.id === task.id)!.status).toBe(
      "done",
    );
  });
  it("完成后依据变化会要求复核，过期行动拒绝标记", () => {
    let s = fixture();
    s.preferences.growthPlan = defaultGrowthPlan(s, now);
    const task = growthTasks(s, now).find((x) => x.id === "buffer")!;
    s = setGrowthTask(s, task, "done", now);
    s = {
      ...s,
      assets: s.assets.map((x) =>
        x.id === "cash" ? { ...x, value: 9000 } : x,
      ),
    };
    expect(growthTasks(s, now).find((x) => x.id === "buffer")!.status).toBe(
      "review",
    );
    expect(() => setGrowthTask(s, task, "done", now)).toThrow(/依据已有变化/);
    const updated = growthTasks(s, now).find((x) => x.id === "buffer")!;
    expect(
      growthTasks(setGrowthTask(s, updated, "done", now), now).find(
        (x) => x.id === "buffer",
      )!.status,
    ).toBe("done");
  });
  it("同一依据下的旧行动按钮不能覆盖伴侣新进度", () => {
    const s = fixture();
    s.preferences.growthPlan = defaultGrowthPlan(s, now);
    const task = growthTasks(s, now)[0];
    const changed = setGrowthTask(s, task, "planned", now);
    expect(() => setGrowthTask(changed, task, "done", now)).toThrow(
      /进度已被更新/,
    );
  });
  it("伴侣更改财务或情景时拒绝旧草稿；其他行动更新不丢失", () => {
    const s = fixture(),
      p = defaultGrowthPlan(s, now),
      financial = financialFingerprint(s);
    s.preferences.growthPlan = p;
    const config = growthConfig(p);
    const changed = { ...s, goal: { ...s.goal, target: 900000 } };
    expect(() => saveGrowthPlan(changed, p, config, financial)).toThrow(
      /已更新/,
    );
    const newer = {
      ...s,
      preferences: {
        ...s.preferences,
        growthPlan: { ...p, monthlySaving: 3000 },
      },
    };
    expect(() => saveGrowthPlan(newer, p, config, financial)).toThrow(/已更新/);
    const task = growthTasks(s, now)[0];
    const marked = setGrowthTask(s, task, "planned", now);
    const saved = saveGrowthPlan(
      marked,
      { ...p, monthlySaving: 4000 },
      config,
      financial,
    );
    expect(saved.preferences.growthPlan!.tasks[task.id]!.status).toBe(
      "planned",
    );
  });
  it("只存增长计划也属于用户数据，不被空云端吞掉或聊天合并覆盖", () => {
    const s = emptyState();
    s.preferences.growthPlan = defaultGrowthPlan(s, now);
    expect(hasSavedData(s)).toBe(true);
    expect(connectionPlan(s, emptyState())).toBe("upload");
    const cloud = fixture();
    expect(connectionPlan(s, cloud)).toBe("choice");
  });
  it("边界校验拒绝NaN、重复ID、长期投入超总留存、错误日期和任意任务", () => {
    const p = defaultGrowthPlan(fixture(), now);
    for (const bad of [
      { ...p, annualRate: 21 },
      { ...p, monthlySaving: NaN },
      { ...p, longTermMonthly: p.monthlySaving + 1 },
      { ...p, selectedAssetIds: ["x", "x"] },
      { ...p, reviewDate: "2026-02-30" },
      {
        ...p,
        tasks: {
          arbitrary: { status: "done", at: now.toISOString(), evidence: "x" },
        },
      },
    ])
      expect(validGrowthPlan(bad)).toBe(false);
    const s = fixture();
    s.preferences.growthPlan = { ...p, annualRate: Infinity };
    expect(() => validateState(s)).toThrow(/增长计划无效/);
  });
  it("本地顾问使用同一行动与已保存情景，只分析不写入", () => {
    const s = fixture();
    s.preferences.growthPlan = defaultGrowthPlan(s, now);
    const before = JSON.stringify(s),
      advice = localAdvice("分析增长计划与留存", s);
    expect(advice.actions).toEqual([]);
    expect(advice.answer).toContain("零收益基线");
    expect(advice.answer).toContain("先守住现金缓冲");
    expect(growthContext(s, now).boundary).toContain("不是预测");
    expect(JSON.stringify(s)).toBe(before);
  });
});
