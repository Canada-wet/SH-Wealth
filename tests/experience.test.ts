import { afterEach, expect, it, vi } from "vitest";
import {
  chooseRoute,
  assessComplexity,
  generateAdvice,
} from "../lib/ai/router";
import { previewActions, financialFingerprint } from "../lib/advisor-preview";
import { emptyState, saveAsset } from "../lib/wealth";
import { reviewChecks, savingsScenario } from "../lib/household-review";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const fixture = () =>
  saveAsset(emptyState(), {
    id: "a",
    name: "储蓄",
    value: 50000,
    category: "现金",
    owner: "joint",
    annualReturn: null,
  });
it.each([
  "把储蓄余额改为50000",
  "记录2026年的账户估值",
  "目前的月结余多少",
  "请分析家庭当前财务状况",
])("日常问题 %s 优先DeepSeek，金额和年份不升级", (question) => {
  vi.stubEnv("DEEPSEEK_API_KEY", "test");
  vi.stubEnv("OPENAI_API_KEY", "test");
  expect(chooseRoute(question).provider).toBe("deepseek");
  expect(assessComplexity(question)).not.toBe("complex");
});
it.each(["帮我做退休规划", "比较房贷和税务策略", "scenario stress test"])(
  "复杂问题 %s 升级GPT6",
  (question) => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test");
    vi.stubEnv("OPENAI_API_KEY", "test");
    expect(chooseRoute(question)).toMatchObject({
      provider: "openai",
      complexity: "complex",
      model: "gpt-6-astra",
    });
  },
);
it("DeepSeek不可用按可用key选择；手动选择不改", () => {
  vi.stubEnv("DEEPSEEK_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "test");
  expect(chooseRoute("余额多少").model).toBe("gpt-6-luna");
  vi.stubEnv("DEEPSEEK_API_KEY", "test");
  expect(chooseRoute("余额多少", "openai-reasoning").model).toBe("gpt-6-astra");
});
it("便宜档不发送思考token，周报也选择DeepSeek", async () => {
  vi.stubEnv("DEEPSEEK_API_KEY", "test");
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "answer" } }] }),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  const route = chooseRoute("目前家庭数据的本周简短回顾");
  await generateAdvice(route, "instructions", "question");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
    model: "deepseek-flash",
    thinking: { type: "disabled" },
  });
});
it("预览不变更原状态，显示金额回报归属前后差异", () => {
  const state = fixture();
  const before = JSON.stringify(state);
  const rows = previewActions(state, [
    {
      type: "update_asset",
      existingName: "储蓄",
      value: 60000,
      annualReturn: -2.5,
      owner: "first",
    },
  ]);
  expect(rows.join()).toContain("$50,000");
  expect(rows.join()).toContain("$60,000");
  expect(rows.join()).toContain("-2.5%");
  expect(JSON.stringify(state)).toBe(before);
});
it("贡献预览说明账户联动；非法批量操作拒绝", () => {
  const state = fixture();
  expect(
    previewActions(state, [
      {
        type: "add_contribution",
        member: "first",
        assetId: "a",
        amount: 100,
        kind: "deposit",
        date: "2026-10-13",
      },
    ]).join(),
  ).toContain("联动账户余额");
  expect(() =>
    previewActions(state, [{ type: "delete_asset", name: "不存在" }]),
  ).toThrow();
});
it("聊天变化不使预览失效，财务变化会", () => {
  const state = fixture();
  const original = financialFingerprint(state);
  state.messages.push({ id: "m", role: "user", text: "hi" });
  expect(financialFingerprint(state)).toBe(original);
  state.assets[0].value = 1;
  expect(financialFingerprint(state)).not.toBe(original);
});
it("零收益假设计算、支出、亏损月储蓄均正确且不改真实数据", () => {
  expect(savingsScenario(100000, 1000, 12, 5000, 120000)).toMatchObject({
    projected: 107000,
    gap: 13000,
  });
  expect(savingsScenario(100000, -1000, 12, 0, 120000).projected).toBe(88000);
  expect(() => savingsScenario(100, 10, 0, 0, 120)).toThrow();
  expect(() => savingsScenario(100, 10, 12, -1, 120)).toThrow();
  expect(() => savingsScenario(100, NaN, 12, 0, 120)).toThrow();
});
it("复盘识别重复名称、未填回报、未录入收支，不将未知当零", () => {
  const state = fixture();
  state.assets.push({ ...state.assets[0], id: "b" });
  const review = reviewChecks(state);
  expect(review.duplicateNames).toEqual(["储蓄"]);
  expect(review.missingReturns).toHaveLength(2);
  expect(review.completeBudget).toBe(false);
  expect(review.delta).toBeNull();
});
