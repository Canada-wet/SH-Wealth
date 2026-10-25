import type { CouncilModel, CouncilRun, CouncilStep } from "./council";
import type { CouncilToolReceipt } from "./council-research";

// Versioned list prices, not an invoice. Never substitute a direct tariff for a reseller.
export const COST_PRICE_DATE = "2026-10-25";
export type RateRange = [number, number];
export type CouncilPrice = {
  version: 1;
  checkedAt: string;
  model: string;
  channel: "direct" | "alibaba";
  region?: string;
  source: string;
  input: RateRange;
  output: RateRange;
  cached?: RateRange;
  write5m?: RateRange;
  write1h?: RateRange;
  note?: string;
};
export type CouncilUsage = {
  input: number | null;
  output: number | null;
  cachedInput?: number | null;
  cacheWrite5m?: number | null;
  cacheWrite1h?: number | null;
  cacheWriteUnknown?: number | null;
  reasoning?: number | null;
  requested?: boolean;
  truncated?: boolean;
  interrupted?: boolean;
  price?: CouncilPrice | null;
};
const rate = (n: number): RateRange => [n, n];
export function councilPrice(
  model: CouncilModel,
  input: number,
  region?: string,
  at = new Date(),
): CouncilPrice | null {
  const channel = model.connection?.channel ?? "direct";
  const apiModel = model.connection?.model ?? model.model;
  const common = {
    version: 1 as const,
    checkedAt: COST_PRICE_DATE,
    model: apiModel,
    channel,
    ...(region ? { region } : {}),
  };
  const quote = (
    source: string,
    incoming: number,
    outgoing: number,
    cached?: number,
  ): CouncilPrice => ({
    ...common,
    source,
    input: rate(incoming),
    output: rate(outgoing),
    ...(cached === undefined ? {} : { cached: rate(cached) }),
  });
  if (channel === "alibaba") {
    if (region !== "ap-southeast-1") return null; // No endpoint/scope guessing for historical runs.
    const prices: Record<string, [number, number]> = {
      "qwen3.8-flash": [0.15, 0.47],
      "qwen3.8-max": [2, 6],
      "kimi-k3": [3, 15],
    };
    const p = prices[apiModel];
    return p
      ? quote(
          "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
          ...p,
        )
      : null;
    // ZHIPU/GLM-5.3 is not the same product ID as glm-5.3. Its price is not verified.
  }
  if (model.provider === "openai") {
    const p = { "gpt-6-luna": [0.1, 0.5, 0.01], "gpt-6-astra": [10, 50, 1] }[
      apiModel
    ];
    return p
      ? quote(
          "https://developers.openai.com/api/docs/pricing",
          p[0],
          p[1],
          p[2],
        )
      : null;
  }
  if (model.provider === "anthropic") {
    const p = {
      "claude-haiku-5-5": input > 100000 ? [0.5, 2.5, 0.05] : [0.1, 0.5, 0.01],
      "claude-fable-5-1": [10, 50, 0.25],
      "claude-opus-5-5": [4, 20, 0.2],
    }[apiModel];
    return p
      ? {
          ...quote(
            "https://platform.claude.com/docs/en/about-claude/pricing",
            p[0],
            p[1],
            p[2],
          ),
          write5m: rate(p[0] * 1.25),
          write1h: rate(p[0] * 2),
        }
      : null;
  }
  if (model.provider === "deepseek") {
    const p = {
      "deepseek-flash": [0.15, 0.6, 0.003],
      "deepseek-v4-pro": [0.66, 1.98, 0.022],
    }[apiModel];
    return p
      ? {
          ...quote(
            "https://api-docs.deepseek.com/quick_start/pricing/",
            p[0],
            p[1],
            p[2],
          ),
          input: [p[0], p[0] * 2],
          output: [p[1], p[1] * 2],
          cached: [p[2], p[2] * 2],
          note: "峰谷价格区间；不猜服务商计费时点或节假日。",
        }
      : null;
  }
  if (model.provider === "glm") {
    const p = {
      "glm-5.3": [1.4, 4.4, 0.26],
      "glm-5.3-flash": [0.15, 0.5, 0.03],
    }[apiModel];
    return p
      ? quote("https://docs.z.ai/guides/overview/pricing", p[0], p[1], p[2])
      : null;
  }
  if (model.provider === "gemini") {
    const p =
      apiModel === "gemini-3.5-flash-lite"
        ? [0.3, 2.5, 0.03]
        : apiModel === "gemini-4-argon"
          ? at.toISOString() < "2026-12-01"
            ? [2, 10, 0.1]
            : [4, 20, 0.2]
          : null;
    return p
      ? quote("https://ai.google.dev/gemini-api/docs/pricing", p[0], p[1], p[2])
      : null;
  }
  return null;
}
const count = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 1e9;
export function normalizeCouncilUsage(
  provider: string,
  data: Record<string, any>,
): CouncilUsage {
  const n = (v: unknown) => (count(v) ? v : null);
  const u = data.usage ?? {};
  let input = n(u.input_tokens ?? u.prompt_tokens),
    output = n(u.output_tokens ?? u.completion_tokens);
  let cached = n(
    u.input_tokens_details?.cached_tokens ??
      u.prompt_tokens_details?.cached_tokens ??
      u.prompt_cache_hit_tokens,
  );
  let write5m = 0,
    write1h = 0,
    writeUnknown = 0;
  if (provider === "anthropic") {
    cached = n(u.cache_read_input_tokens) ?? 0;
    const created = n(u.cache_creation_input_tokens) ?? 0;
    write5m = n(u.cache_creation?.ephemeral_5m_input_tokens) ?? 0;
    write1h = n(u.cache_creation?.ephemeral_1h_input_tokens) ?? 0;
    writeUnknown = Math.max(0, created - write5m - write1h);
    input =
      input === null
        ? null
        : input + cached + Math.max(created, write5m + write1h);
  } else if (provider === "gemini") {
    const g = data.usageMetadata ?? {};
    input = n(g.promptTokenCount);
    const answer = n(g.candidatesTokenCount),
      thoughts = n(g.thoughtsTokenCount);
    output =
      answer !== null
        ? answer + (thoughts ?? 0)
        : input !== null && n(g.totalTokenCount) !== null
          ? n(g.totalTokenCount - input)
          : null;
    cached = n(g.cachedContentTokenCount);
  }
  return {
    input,
    output,
    cachedInput: cached,
    cacheWrite5m: write5m,
    cacheWrite1h: write1h,
    cacheWriteUnknown: writeUnknown,
    reasoning: n(
      u.output_tokens_details?.reasoning_tokens ??
        u.completion_tokens_details?.reasoning_tokens ??
        data.usageMetadata?.thoughtsTokenCount,
    ),
    requested: true,
  };
}
export type CostRow = {
  step: CouncilStep;
  low: number | null;
  high: number | null;
  reason: string;
  historical: boolean;
  price: CouncilPrice | null;
};
function validPrice(p: CouncilPrice | null | undefined): p is CouncilPrice {
  return (
    !!p &&
    p.version === 1 &&
    [
      p.input,
      p.output,
      ...(p.cached ? [p.cached] : []),
      ...(p.write5m ? [p.write5m] : []),
      ...(p.write1h ? [p.write1h] : []),
    ].every(
      (r) =>
        Array.isArray(r) &&
        r.length === 2 &&
        r.every((x) => Number.isFinite(x) && x >= 0 && x < 1e6) &&
        r[0] <= r[1],
    )
  );
}
export function councilStepCost(
  step: CouncilStep,
  model?: CouncilModel,
): CostRow {
  const u = step.usage;
  const historical = u?.price === undefined;
  const p =
    u?.price === undefined && model
      ? councilPrice(model, u?.input ?? 0)
      : u?.price;
  const base = { step, historical, price: validPrice(p) ? p : null };
  const unknown = (reason: string): CostRow => ({
    ...base,
    low: null,
    high: null,
    reason,
  });
  if (
    step.status === "pending" ||
    u?.requested === false ||
    (step.status === "failed" &&
      !step.started_at &&
      u?.requested !== true &&
      u?.input == null &&
      u?.output == null)
  )
    return { ...base, low: 0, high: 0, reason: "未调用" };
  if (!u || !count(u.input) || !count(u.output))
    return unknown("缺少服务商用量，可能已计费");
  if (!validPrice(p)) return unknown("精确型号／渠道价格待核实");
  const cached = u.cachedInput;
  const w5 = u.cacheWrite5m ?? 0,
    w1 = u.cacheWrite1h ?? 0,
    wu = u.cacheWriteUnknown ?? 0;
  if (
    ![w5, w1, wu].every(count) ||
    (cached != null && !count(cached)) ||
    (cached ?? 0) + w5 + w1 + wu > u.input
  )
    return unknown("用量细分不一致");
  if ((w5 && !p.write5m) || (w1 && !p.write1h) || wu)
    return unknown("缓存写入价格／期限不明");
  const remaining = u.input - w5 - w1;
  // Unknown cache counts produce an interval, never an invented zero-cache exact bill.
  const hitLow = cached ?? remaining,
    hitHigh = cached ?? 0;
  const cacheLow = p.cached?.[0] ?? 0,
    cacheHigh = p.cached?.[1] ?? p.input[1];
  const inputLow =
    (remaining - hitLow) * p.input[0] +
    hitLow * cacheLow +
    w5 * (p.write5m?.[0] ?? 0) +
    w1 * (p.write1h?.[0] ?? 0);
  const inputHigh =
    (remaining - hitHigh) * p.input[1] +
    hitHigh * cacheHigh +
    w5 * (p.write5m?.[1] ?? 0) +
    w1 * (p.write1h?.[1] ?? 0);
  return {
    ...base,
    low: (inputLow + u.output * p.output[0]) / 1e6,
    high: (inputHigh + u.output * p.output[1]) / 1e6,
    reason: historical
      ? "按当前价格参考重估，非当时账单"
      : "按调用时价格快照估算",
  };
}
export function councilCostReport(run: CouncilRun, round?: number) {
  const rows = run.steps
    .filter((s) => round === undefined || (s.round ?? 0) === round)
    .map((s) =>
      councilStepCost(
        s,
        run.models.find((m) => m.key === s.model_key),
      ),
    );
  const toolRows = run.steps
    .filter((s) => round === undefined || (s.round ?? 0) === round)
    .flatMap((step) =>
      (step.tool_receipts ?? []).map((receipt) => ({ step, receipt })),
    )
    .filter(
      ({ receipt }, i, all) =>
        receipt.tool === "search_public" &&
        !receipt.reusedFrom &&
        all.findIndex((r) => r.receipt.id === receipt.id) === i,
    )
    .map(({ step, receipt }) => councilSearchCost(step, receipt));
  const sum = (list: CostRow[]) => ({
    low: list.reduce((a, r) => a + (r.low ?? 0), 0),
    high: list.reduce((a, r) => a + (r.high ?? 0), 0),
    unknown: list.filter((r) => r.high === null).length,
    calls: list.filter((r) => r.reason !== "未调用").length,
  });
  const groups = (
    key: (r: CostRow) => string,
    toolKey: (r: (typeof toolRows)[number]) => string,
  ) =>
    [...new Set([...rows.map(key), ...toolRows.map(toolKey)])].map((id) => ({
      id,
      ...addTools(
        sum(rows.filter((r) => key(r) === id)),
        toolRows.filter((r) => toolKey(r) === id),
      ),
    }));
  const addTools = (
    subtotal: ReturnType<typeof sum>,
    list: typeof toolRows,
  ) => ({
    low: subtotal.low + list.reduce((a, r) => a + r.low, 0),
    high: subtotal.high + list.reduce((a, r) => a + r.high, 0),
    unknown: subtotal.unknown + list.filter((r) => r.unknown).length,
    calls:
      subtotal.calls +
      list.filter(
        (r) =>
          r.receipt.requested !== false &&
          r.receipt.billing?.usage?.requested !== false,
      ).length,
  });
  return {
    rows,
    toolRows,
    ...addTools(sum(rows), toolRows),
    models: groups(
      (r) => r.step.model_key,
      (r) => `search:${r.receipt.billing?.model ?? "unknown"}`,
    ),
    stages: groups(
      (r) => `${r.step.round ?? 0}:${r.step.phase_id ?? r.step.stage}`,
      (r) => `${r.step.round ?? 0}:${r.step.phase_id ?? r.step.stage}`,
    ),
    externalSearches: toolRows.length,
    historical: rows.some((r) => r.historical && r.reason !== "未调用"),
  };
}
function councilSearchCost(step: CouncilStep, receipt: CouncilToolReceipt) {
  const b = receipt.billing;
  const notCalled =
    receipt.requested === false || b?.usage?.requested === false;
  const tokens = councilStepCost({
    ...step,
    status: "succeeded",
    usage: b?.usage ?? {
      input: null,
      output: null,
      requested: true,
      price: null,
    },
  });
  const feeKnown =
    !!b &&
    b.version === 1 &&
    count(b.searchCalls) &&
    Number.isFinite(b.perSearchUSD) &&
    b.perSearchUSD >= 0 &&
    b.perSearchUSD < 10;
  const toolFee = feeKnown ? b!.searchCalls! * b!.perSearchUSD : 0;
  return {
    step,
    receipt,
    low: notCalled ? 0 : (tokens.low ?? 0) + toolFee,
    high: notCalled ? 0 : (tokens.high ?? 0) + toolFee,
    unknown: !notCalled && (tokens.high === null || !feeKnown),
    reason: notCalled
      ? "未调用"
      : `${tokens.reason}；${feeKnown ? `${b!.searchCalls} 次搜索调用费已计入` : "搜索调用次数／价格未知"}`,
  };
}
export function councilCostModelName(run: CouncilRun, id: string) {
  return id.startsWith("search:")
    ? `联网研究 · ${id.slice(7) === "unknown" ? "型号未知" : id.slice(7)}`
    : (run.models.find((m) => m.key === id)?.name ?? id);
}
export function usd(value: number) {
  return `US$${value.toFixed(5)}`;
}
export function costRange(low: number, high: number) {
  return Math.abs(high - low) < 1e-9 ? usd(high) : `${usd(low)}–${usd(high)}`;
}
export function councilCostExport(run: CouncilRun) {
  const r = councilCostReport(run);
  return `## 研讨成本（USD · 估算，非账单）\n\n${r.unknown ? "已知部分小计" : "调用估算合计"}：${costRange(r.low, r.high)}；${r.unknown} 项费用未知；${r.externalSearches} 项外部搜索回执（复用不重复计）。\n\n| 模型／工具 | 调用 | 已知费用区间 | 未知 |\n|---|---:|---:|---:|\n${r.models.map((g) => `| ${councilCostModelName(run, g.id)} | ${g.calls} | ${costRange(g.low, g.high)} | ${g.unknown} |`).join("\n")}\n\n搜索按实际回执中的模型用量和调用费单独核算；缺少回执用量或价格即标未知。不含税、赠送额度、折扣及订阅费；推理 tokens 已含在输出，不能再加一遍。${r.historical ? "旧记录无价格快照，仅按当前已核实价格参考重估；不是历史账单。" : "价格随步骤用量保存，回看不会重定价。"}\n\n`;
}
