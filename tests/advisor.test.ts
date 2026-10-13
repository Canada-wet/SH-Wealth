import { afterEach, describe, it, expect, vi } from "vitest";
import {
  applyAssistantActions,
  mutationRequested,
  parseAdvisorResult,
  validAction,
} from "../lib/advisor-actions";
import { emptyState, saveAsset } from "../lib/wealth";
import { localAdvice } from "../lib/ai/local";
import {
  assessComplexity,
  chooseRoute,
  generateAdvice,
} from "../lib/ai/router";
const state = () =>
  saveAsset(emptyState(), {
    id: "a",
    name: "共同储蓄",
    owner: "joint",
    value: 10000,
    category: "现金",
    annualReturn: 2,
  });
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("AI 变更", () => {
  it("现金流增删改可以通过顾问执行，自动计算字段不能被覆盖", () => {
    let current = applyAssistantActions(state(), [
      {
        type: "add_cashflow",
        name: "房租",
        owner: "joint",
        amount: 1000,
        kind: "expense",
        essential: true,
      },
    ]);
    current = applyAssistantActions(current, [
      { type: "update_cashflow", existingName: "房租", amount: 2000 },
    ]);
    expect(current.budget?.[0].amount).toBe(2000);
    expect(() =>
      applyAssistantActions(current, [
        { type: "set_plan_field", key: "essential_monthly", value: "300" },
      ]),
    ).toThrow(/现金流/);
    expect(
      applyAssistantActions(current, [
        { type: "delete_cashflow", name: "房租" },
      ]).budget,
    ).toEqual([]);
  });
  it("回报的负数、零、null正确执行", () => {
    for (const annualReturn of [-2, 0, null])
      expect(
        applyAssistantActions(state(), [
          { type: "update_asset", existingName: "共同储蓄", annualReturn },
        ]).assets[0].annualReturn,
      ).toBe(annualReturn);
  });
  it("对资产、负债、贡献、目标、规划一并原子更新", () => {
    const next = applyAssistantActions(state(), [
      { type: "add_debt", name: "房贷", owner: "共同", value: 1000 },
      {
        type: "add_contribution",
        member: "Lin",
        assetId: "a",
        amount: 200,
        kind: "deposit",
        date: "2026-10-12",
      },
      { type: "set_goal", target: 20000 },
      { type: "set_plan_field", key: "essential_monthly", value: "1500" },
    ]);
    expect(next.assets[0].value).toBe(10200);
    expect(next.debts[0].owner).toBe("joint");
    expect(next.contributions[0].member).toBe("first");
    expect(next.goal.target).toBe(20000);
    expect(next.plan.values.essential_monthly).toBe("1500");
  });
  it("不存在或同名歧义时拒绝，原状态不改变", () => {
    const original = state();
    expect(() =>
      applyAssistantActions(original, [
        {
          type: "add_asset",
          name: "新资产",
          owner: "joint",
          value: 10,
          category: "其他",
        },
        { type: "update_asset", existingName: "不存在", value: 1 },
      ]),
    ).toThrow();
    expect(original.assets).toHaveLength(1);
    original.assets.push({ ...original.assets[0], id: "b" });
    expect(() =>
      applyAssistantActions(original, [
        { type: "update_asset", existingName: "共同储蓄", value: 1 },
      ]),
    ).toThrow();
  });
  it.each([null, "10", NaN, -1])("拒绝非法 AI 金额 %s", (value) =>
    expect(
      validAction({
        type: "add_asset",
        name: "A",
        category: "投资",
        owner: "joint",
        value,
      }),
    ).toBe(false),
  );
  it("建议和假设不会应用 actions", () => {
    expect(mutationRequested("如果把共同储蓄改为5000会怎样？")).toBe(false);
    expect(mutationRequested("建议我是否修改目标")).toBe(false);
    expect(
      parseAdvisorResult(
        '{"answer":"建议","actions":[{"type":"delete_asset","name":"共同储蓄"}]}',
        false,
      ).actions,
    ).toEqual([]);
  });
  it("支持围栏 JSON，非 JSON 回复不会执行操作", () => {
    expect(
      parseAdvisorResult('```json\n{"answer":"完成","actions":[]}\n```').answer,
    ).toBe("完成");
    expect(parseAdvisorResult("普通文字").actions).toEqual([]);
  });
  it("本地助手无需API key即可修改回报和贡献", () => {
    const annual = localAdvice("把共同储蓄本年回报改为 -2.5%", state());
    expect(annual.actions[0]).toMatchObject({ annualReturn: -2.5 });
    const contribution = localAdvice("记录 Lin 向共同储蓄投入 500", state());
    expect(contribution.actions[0]).toMatchObject({
      type: "add_contribution",
      amount: 500,
      member: "first",
    });
  });
});
describe("多模型路由与适配器", () => {
  it("复杂度分档支持中文英文", () => {
    expect(assessComplexity("目前余额多少")).toBe("simple");
    expect(assessComplexity("退休税务与压力测试规划")).toBe("complex");
    expect(assessComplexity("retirement tax scenario forecast")).toBe(
      "complex",
    );
  });
  it("无key自动使用本地助手，手动缺少key明确报错", () => {
    for (const key of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "DEEPSEEK_API_KEY",
    ])
      vi.stubEnv(key, "");
    expect(chooseRoute("余额多少").provider).toBe("local");
    expect(() => chooseRoute("hi", "openai-fast")).toThrow(/尚未配置/);
    expect(() => chooseRoute("hi", "bad" as never)).toThrow(/未知/);
  });
  it("已配置provider按复杂度路由", () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.stubEnv("DEEPSEEK_API_KEY", "test");
    expect(chooseRoute("目前余额多少").model).toBe("gpt-6-luna");
    expect(chooseRoute("退休税务情景规划").model).toBe("gpt-6-astra");
    expect(chooseRoute("请分析我们投资账户配置").provider).toBe("deepseek");
  });
  it("Anthropic适配器发送请求并只拼接文本块", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            { type: "text", text: "answer" },
            { type: "thinking", text: "hidden" },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    expect(
      await generateAdvice(
        {
          provider: "anthropic",
          model: "claude-test",
          complexity: "simple",
          reason: "test",
        },
        "instructions",
        "q",
      ),
    ).toBe("answer");
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe("claude-test");
  });
  it("DeepSeek深度档启用thinking且不发送temperature", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "answer" } }] }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    expect(
      await generateAdvice(
        {
          provider: "deepseek",
          model: "deepseek-v4-pro",
          complexity: "complex",
          reason: "test",
        },
        "instructions",
        "q",
      ),
    ).toBe("answer");
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.temperature).toBeUndefined();
  });
  it("provider失败不会伪造回复", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("failed", { status: 429 })),
    );
    await expect(
      generateAdvice(
        {
          provider: "anthropic",
          model: "test",
          complexity: "simple",
          reason: "test",
        },
        "",
        "q",
      ),
    ).rejects.toThrow("429");
  });
});
