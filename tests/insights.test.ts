import { describe, it, expect, vi, beforeEach } from "vitest";
import { householdPulse, proactiveInsights } from "../lib/insights";
import {
  emptyState,
  saveAsset,
  validateState,
  finishChange,
} from "../lib/wealth";
const router = vi.hoisted(() => ({ choose: vi.fn(), generate: vi.fn() }));
vi.mock("../lib/ai/router", () => ({
  chooseRoute: router.choose,
  generateAdvice: router.generate,
}));
import { ruleReview, weeklyReview } from "../lib/ai/review";
import { mutationRequested } from "../lib/advisor-actions";
const now = new Date("2030-06-15T12:00:00Z");
function fixture() {
  const state = saveAsset(emptyState(), {
    id: "a",
    name: "现金",
    owner: "first",
    category: "现金",
    value: 12000,
    annualReturn: null,
  });
  state.goal = { name: "合成目标", target: 100000, year: "2032" };
  state.budget = [
    {
      id: "i",
      name: "工资",
      owner: "first",
      amount: 5000,
      kind: "income",
      essential: false,
    },
    {
      id: "e",
      name: "开销",
      owner: "joint",
      amount: 2000,
      kind: "expense",
      essential: true,
    },
  ];
  return finishChange(emptyState(), state, "合成盘点", true);
}
beforeEach(() => {
  vi.clearAllMocks();
  router.choose.mockReturnValue({ provider: "local" });
});
describe("实时主动洞察", () => {
  it("主动讨论即使引用修改措辞，也不能变成数据操作授权", () => {
    expect(
      mutationRequested(
        "只做分析与讨论，不执行数据变更。讨论是否更新目标和记录历史出资",
      ),
    ).toBe(false);
    expect(mutationRequested("把现金本年回报改为 -2.5%")).toBe(true);
  });
  it("统一计算月结余、现金覆盖与不计收益目标基线", () => {
    const pulse = householdPulse(fixture(), now);
    expect(pulse).toMatchObject({
      income: 5000,
      expenses: 2000,
      surplus: 3000,
      coverage: 6,
      months: 31,
    });
    expect(pulse.monthlyGoal).toBeCloseTo(88000 / 31);
  });
  it("缺少收入或开支不虚构完整结余，零必要支出不产生无限覆盖", () => {
    const state = fixture();
    state.budget!.pop();
    expect(householdPulse(state, now)).toMatchObject({
      complete: false,
      coverage: null,
    });
    expect(
      proactiveInsights(state, now).some((row) =>
        row.id.startsWith("pulse-budget"),
      ),
    ).toBe(true);
  });
  it("缺口与应急金优先，不改写任何财务或聊天数据", () => {
    const state = fixture();
    state.budget![0].amount = 1000;
    state.plan.values.emergency_months = "12";
    const original = JSON.stringify(state);
    const rows = proactiveInsights(state, now);
    expect(rows[0].id).toContain("deficit");
    expect(rows[0].body).toContain("$1,000.00");
    expect(rows.find((row) => row.id.includes("buffer"))?.body).toContain(
      "6.0 个月",
    );
    expect(JSON.stringify(state)).toBe(original);
  });
  it("同月相同事项ID稳定，下月可重新复盘；聊天时间不假装财务更新", () => {
    const state = fixture();
    state.history[0].at = "2029-01-01T00:00:00Z";
    state.updatedAt = now.toISOString();
    const rows = proactiveInsights(state, now);
    expect(rows.find((row) => row.id.includes("stale"))).toBeDefined();
    expect(rows.map((row) => row.id)).toEqual(
      proactiveInsights(state, new Date("2030-06-28")).map((row) => row.id),
    );
    expect(rows[0].id).not.toBe(
      proactiveInsights(state, new Date("2030-07-01T12:00:00Z"))[0].id,
    );
  });
  it("记录变化明确不当作投资回报", () => {
    const state = fixture();
    state.history[0].at = "2030-06-14T00:00:00Z";
    state.history.push({
      ...state.history[0],
      id: "next",
      netWorth: 14000,
      reason: "新增账户",
      at: "2030-06-15T00:00:00Z",
    });
    expect(
      proactiveInsights(state, now).find((row) => row.id.includes("change"))
        ?.body,
    ).toContain("不代表投资收益");
  });
  it("旧备份兼容，主动偏好只能为布尔值", () => {
    const state = fixture();
    expect(() => validateState(state)).not.toThrow();
    state.preferences.proactive = false;
    expect(() => validateState(state)).not.toThrow();
    expect(() =>
      validateState({
        ...state,
        preferences: { ...state.preferences, proactive: "no" },
      }),
    ).toThrow();
  });
});
describe("每周AI复盘", () => {
  it("用户选择本地助手或关闭主动功能时，不调用外部模型", async () => {
    for (const enabled of [true, false]) {
      const state = fixture();
      state.preferences.proactive = enabled;
      state.preferences.model = enabled ? "local" : "auto";
      expect(await weeklyReview(state, now)).toContain("数据规则复盘");
    }
    expect(router.choose).not.toHaveBeenCalled();
    expect(router.generate).not.toHaveBeenCalled();
  });
  it("尊重手选provider，但后台复盘使用该provider快速档", async () => {
    const state = fixture();
    state.preferences.model = "anthropic-reasoning";
    await weeklyReview(state, now);
    expect(router.choose).toHaveBeenCalledWith(
      "目前家庭数据的本周简短回顾",
      "anthropic-fast",
    );
  });
  it("无模型时明确为规则复盘，不发起模型调用", async () => {
    expect(await weeklyReview(fixture(), now)).toContain("数据规则复盘");
    expect(router.generate).not.toHaveBeenCalled();
  });
  it("模型错误或无效结果降级为可读规则复盘", async () => {
    router.choose.mockReturnValue({ provider: "openai", model: "fixture" });
    router.generate.mockRejectedValueOnce(new Error("offline"));
    expect(await weeklyReview(fixture(), now)).toBe(ruleReview(fixture(), now));
    router.generate.mockResolvedValueOnce('{"answer":"","actions":[]}');
    expect(await weeklyReview(fixture(), now)).toContain("数据规则复盘");
  });
  it("真实模型格式有来源标记，排除历史聊天和写操作", async () => {
    const state = fixture();
    state.messages = [{ id: "q", role: "user", text: "PRIVATE CHAT SENTINEL" }];
    const original = JSON.stringify(state);
    router.choose.mockReturnValue({ provider: "openai", model: "fixture" });
    router.generate.mockResolvedValue(
      '{"answer":"结余值得一起核对。","actions":[{"type":"delete_asset","name":"现金"}]}',
    );
    expect(await weeklyReview(state, now)).toContain(
      "AI 周度复盘 · openai · fixture",
    );
    expect(router.generate.mock.calls[0][2]).not.toContain(
      "PRIVATE CHAT SENTINEL",
    );
    expect(JSON.stringify(state)).toBe(original);
  });
});
