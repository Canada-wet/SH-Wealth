import { describe, it, expect } from "vitest";
import {
  COUNCIL_MODELS,
  councilExport,
  type CouncilRun,
  type CouncilStep,
} from "../lib/council";
import {
  councilPrice,
  normalizeCouncilUsage,
  councilStepCost,
  councilCostReport,
  councilCostExport,
} from "../lib/council-cost";
const model = COUNCIL_MODELS[0];
const step = (overrides: Partial<CouncilStep> = {}): CouncilStep => ({
  seq: 0,
  model_key: model.key,
  stage: "opening",
  status: "succeeded",
  answer: "合成回答",
  error: "",
  usage: {
    input: 1000,
    output: 200,
    cachedInput: 100,
    reasoning: 100,
    requested: true,
    price: councilPrice(model, 1000),
  },
  started_at: "2026-10-25T10:00:00Z",
  finished_at: "2026-10-25T10:01:00Z",
  ...overrides,
});
const run = (steps: CouncilStep[]): CouncilRun => ({
  id: "synthetic",
  question: "合成测试",
  models: [model],
  participants: [model.key],
  judge: null,
  status: "complete",
  created_at: "2026-10-25T10:00:00Z",
  steps,
});
describe("研讨成本：不能把估计伪装成发票", () => {
  it("原轮取消后从未认领的旧步骤不计费；认领后提交不明仍标未知", () => {
    const s = step({
      status: "failed",
      started_at: null,
      usage: { input: null, output: null },
    });
    expect(councilStepCost(s, model).reason).toBe("未调用");
    s.started_at = "2026-10-25T10:00:00Z";
    expect(councilStepCost(s, model).high).toBeNull();
  });
  it("使用实际输入、缓存折扣及含推理的输出，不把推理再加一遍", () => {
    const c = councilStepCost(step(), model);
    expect(c.low).toBeCloseTo(0.000191);
    expect(c.high).toBeCloseTo(c.low!);
    expect(c.historical).toBe(false);
  });
  it("快照价格冻结，不因新目录或结束日期变化而重定价", () => {
    const p = councilPrice(model, 1000)!;
    p.output = [50, 50];
    expect(
      councilStepCost(
        step({ usage: { input: 0, output: 1000, cachedInput: 0, price: p } }),
        model,
      ).high,
    ).toBe(0.05);
  });
  it("原生Anthropic输入不含缓存，正确相加且区分5分钟/1小时写入", () => {
    const u = normalizeCouncilUsage("anthropic", {
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 40,
        cache_creation: {
          ephemeral_5m_input_tokens: 10,
          ephemeral_1h_input_tokens: 30,
        },
      },
    });
    expect(u.input).toBe(340);
    expect(u.cachedInput).toBe(200);
    expect(u.cacheWrite5m).toBe(10);
    expect(u.cacheWrite1h).toBe(30);
    const m = COUNCIL_MODELS.find((m) => m.provider === "anthropic")!;
    u.price = councilPrice(m, u.input!);
    expect(councilStepCost(step({ usage: u }), m).high).toBeCloseTo(
      (100 * 0.1 + 200 * 0.01 + 10 * 0.125 + 30 * 0.2 + 50 * 0.5) / 1e6,
    );
  });
  it("Anthropic超过100K上下文按总输入（含缓存）选择高档", () => {
    const u = normalizeCouncilUsage("anthropic", {
      usage: {
        input_tokens: 90000,
        output_tokens: 1,
        cache_read_input_tokens: 20000,
      },
    });
    const m = COUNCIL_MODELS.find((m) => m.provider === "anthropic")!;
    expect(councilPrice(m, u.input!)?.input).toEqual([0.5, 0.5]);
  });
  it("Gemini将候选与思考相加，不丢失推理费用", () => {
    const u = normalizeCouncilUsage("gemini", {
      usageMetadata: {
        promptTokenCount: 500,
        candidatesTokenCount: 100,
        thoughtsTokenCount: 900,
        totalTokenCount: 1500,
        cachedContentTokenCount: 200,
      },
    });
    expect(u).toMatchObject({
      input: 500,
      output: 1000,
      reasoning: 900,
      cachedInput: 200,
    });
  });
  it("Gemini缺少总输出时保留未知，不把思考数猜成全部输出", () => {
    expect(
      normalizeCouncilUsage("gemini", {
        usageMetadata: { promptTokenCount: 10 },
      }).output,
    ).toBeNull();
  });
  it("DeepSeek使用缓存命中计数与峰谷区间", () => {
    const m = COUNCIL_MODELS.find((m) => m.provider === "deepseek")!;
    const u = normalizeCouncilUsage("deepseek", {
      usage: {
        prompt_tokens: 1000,
        prompt_cache_hit_tokens: 500,
        completion_tokens: 200,
      },
    });
    u.price = councilPrice(m, 1000);
    const c = councilStepCost(step({ usage: u }), m);
    expect(c.low).toBeCloseTo((500 * 0.15 + 500 * 0.003 + 200 * 0.6) / 1e6);
    expect(c.high).toBeCloseTo(c.low! * 2);
  });
  it("未知缓存命中给区间，不伪造零命中", () => {
    const c = councilStepCost(
      step({
        usage: { input: 1000, output: 100, price: councilPrice(model, 1000) },
      }),
      model,
    );
    expect(c.low).toBeCloseTo(0.00006);
    expect(c.high).toBeCloseTo(0.00015);
  });
  it.each([null, -1, NaN, Infinity, 1.5])("无效计数%s不能产生伪费用", (n) => {
    expect(
      councilStepCost(step({ usage: { input: n, output: 100 } }), model).high,
    ).toBeNull();
  });
  it("失败或中断如已有用量仍计费，未知用量不能当零", () => {
    expect(
      councilStepCost(step({ status: "failed" }), model).high,
    ).toBeGreaterThan(0);
    expect(
      councilStepCost(
        step({ usage: { input: null, output: null, requested: true } }),
        model,
      ).high,
    ).toBeNull();
    expect(
      councilStepCost(
        step({ usage: { input: null, output: null, requested: false } }),
        model,
      ).high,
    ).toBe(0);
  });
  it("尚未发起的步骤不算调用", () => {
    const r = councilCostReport(run([step({ status: "pending" })]));
    expect(r.calls).toBe(0);
    expect(r.unknown).toBe(0);
  });
  it("未知原厂/转售渠道价格不互相套用", () => {
    const m = COUNCIL_MODELS.find((m) => m.key === "glm-flagship")!;
    expect(
      councilPrice(
        { ...m, connection: { channel: "alibaba", model: "ZHIPU/GLM-5.3" } },
        1000,
        "ap-southeast-1",
      ),
    ).toBeNull();
    expect(councilPrice(m, 1000)).not.toBeNull();
  });
  it("百炼Qwen按精确新加坡地域，不能默认为其他部署范围", () => {
    const m = COUNCIL_MODELS.find((m) => m.key === "qwen-light")!;
    const q = {
      ...m,
      connection: { channel: "alibaba" as const, model: m.model },
    };
    expect(councilPrice(q, 1000)?.input).toBeUndefined();
    expect(councilPrice(q, 1000, "ap-southeast-1")?.input).toEqual([
      0.15, 0.15,
    ]);
    expect(councilPrice(q, 1000, "cn-beijing")).toBeNull();
  });
  it("历史没有价格快照仅参考重估，不写回旧记录", () => {
    const s = step({ usage: { input: 1000, output: 100 } });
    const before = structuredClone(s);
    expect(councilStepCost(s, model).historical).toBe(true);
    expect(s).toEqual(before);
  });
  it("明确存下未知价格后不随目录新增自动回填", () => {
    expect(
      councilStepCost(
        step({ usage: { input: 1000, output: 100, price: null } }),
        model,
      ).high,
    ).toBeNull();
  });
  it("缓存大于总输入或缓存写入TTL缺失显示未知", () => {
    expect(
      councilStepCost(
        step({
          usage: {
            input: 1,
            output: 1,
            cachedInput: 2,
            price: councilPrice(model, 1),
          },
        }),
        model,
      ).high,
    ).toBeNull();
    expect(
      councilStepCost(
        step({
          usage: {
            input: 100,
            output: 1,
            cacheWriteUnknown: 10,
            price: councilPrice(model, 100),
          },
        }),
        model,
      ).high,
    ).toBeNull();
  });
  it("按模型、重复自定义环节、轮次统计，全部加总一致", () => {
    const r = run([
      step({ phase_id: "first" }),
      step({ seq: 1, phase_id: "repeat" }),
      step({ seq: 2, round: 1, stage: "judge" }),
    ]);
    const all = councilCostReport(r);
    expect(all.calls).toBe(3);
    expect(all.stages).toHaveLength(3);
    expect(councilCostReport(r, 1).calls).toBe(1);
    expect(all.models.reduce((a, g) => a + g.high, 0)).toBeCloseTo(all.high);
    expect(all.stages.reduce((a, g) => a + g.high, 0)).toBeCloseTo(all.high);
  });
  it("公开搜索回执复用不重复算次数，未知费用不掩盖", () => {
    const s = step({
      tool_receipts: [
        {
          id: "T1",
          tool: "search_public",
          status: "succeeded",
          input: "public",
          output: "synthetic",
          checkedAt: "2026-10-25",
        },
        {
          id: "T2",
          tool: "search_public",
          status: "succeeded",
          input: "public",
          output: "synthetic",
          checkedAt: "2026-10-25",
          reusedFrom: "T1",
        },
      ],
    });
    expect(councilCostReport(run([s])).externalSearches).toBe(1);
    expect(councilCostReport(run([s])).unknown).toBe(1);
    expect(councilCostExport(run([s]))).toContain("缺少回执用量或价格即标未知");
  });
  it("实际搜索的模型 tokens 和工具费都纳入合计，复用回执不重复计", () => {
    const billing = {
      version: 1 as const,
      model: model.model,
      usage: step().usage!,
      searchCalls: 1,
      perSearchUSD: 0.01,
      source: model.source,
      checkedAt: "2026-10-25",
    };
    const receipt = {
      id: "T1",
      tool: "search_public" as const,
      status: "succeeded" as const,
      input: "public",
      output: "synthetic",
      checkedAt: "2026-10-25",
      billing,
    };
    const r = councilCostReport(
      run([
        step({
          tool_receipts: [receipt, { ...receipt, id: "T2", reusedFrom: "T1" }],
        }),
      ]),
    );
    expect(r.high).toBeCloseTo(0.01 + 0.000191 * 2);
    expect(r.calls).toBe(2);
    expect(r.unknown).toBe(0);
    expect(r.models.find((g) => g.id.startsWith("search:"))?.high).toBeCloseTo(
      0.010191,
    );
    expect(r.stages.reduce((n, g) => n + g.high, 0)).toBeCloseTo(r.high);
  });
  it("搜索已知工具费但模型未核价仍显示小计加未知；未发请求不计费", () => {
    const receipt = {
      id: "T1",
      tool: "search_public" as const,
      status: "failed" as const,
      input: "public",
      output: "",
      checkedAt: "2026-10-25",
      billing: {
        version: 1 as const,
        model: "future-model",
        usage: { input: 100, output: 100, requested: true, price: null },
        searchCalls: 1,
        perSearchUSD: 0.01,
        source: model.source,
        checkedAt: "2026-10-25",
      },
    };
    const r = councilCostReport(run([step({ tool_receipts: [receipt] })]));
    expect(r.high).toBeCloseTo(0.010191);
    expect(r.unknown).toBe(1);
    receipt.billing.usage.requested = false;
    const skipped = councilCostReport(
      run([step({ tool_receipts: [receipt] })]),
    );
    expect(skipped.high).toBeCloseTo(0.000191);
    expect(skipped.calls).toBe(1);
    expect(skipped.unknown).toBe(0);
  });
  it("导出含费用和边界，不引入密钥或家庭预算", () => {
    const output = councilExport(run([step()]));
    expect(output).toContain("研讨成本（USD");
    expect(output).toContain("非账单");
    expect(output).toContain("推理 tokens 已含在输出");
  });
});
