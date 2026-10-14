import OpenAI from "openai";

export type Provider = "openai" | "anthropic" | "deepseek" | "local";
export type Complexity = "simple" | "standard" | "complex";
export type Preference =
  | "auto"
  | "local"
  | "openai-fast"
  | "openai-balanced"
  | "openai-reasoning"
  | "anthropic-fast"
  | "anthropic-reasoning"
  | "deepseek-chat"
  | "deepseek-reasoner";

export type Route = {
  provider: Provider;
  model: string;
  complexity: Complexity;
  reason: string;
};

const models: Record<
  Exclude<Preference, "auto" | "local">,
  { provider: Provider; model: string; complexity: Complexity }
> = {
  "openai-fast": {
    provider: "openai",
    model: process.env.OPENAI_FAST_MODEL || "gpt-6-luna",
    complexity: "simple",
  },
  "openai-reasoning": {
    provider: "openai",
    model: process.env.OPENAI_REASONING_MODEL || "gpt-6-astra",
    complexity: "complex",
  },
  "openai-balanced": {
    provider: "openai",
    model: process.env.OPENAI_STANDARD_MODEL || "gpt-6.1-sol",
    complexity: "standard",
  },
  "anthropic-fast": {
    provider: "anthropic",
    model: process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-5-5",
    complexity: "simple",
  },
  "anthropic-reasoning": {
    provider: "anthropic",
    model: process.env.ANTHROPIC_REASONING_MODEL || "claude-sonnet-5-5",
    complexity: "complex",
  },
  "deepseek-chat": {
    provider: "deepseek",
    model: process.env.DEEPSEEK_CHAT_MODEL || "deepseek-flash",
    complexity: "standard",
  },
  "deepseek-reasoner": {
    provider: "deepseek",
    model: process.env.DEEPSEEK_REASONING_MODEL || "deepseek-v4-pro",
    complexity: "complex",
  },
};

const complexSignals = [
  "退休",
  "税务",
  "报税",
  "规划",
  "预测",
  "情景",
  "压力测试",
  "比较",
  "组合",
  "再平衡",
  "如何分配",
  "风险",
  "房贷",
  "retirement",
  "tax",
  "forecast",
  "scenario",
  "rebalance",
  "risk",
  "mortgage",
];
const simpleSignals = [
  "多少",
  "是什么",
  "解释",
  "本月",
  "目前",
  "余额",
  "进度",
  "balance",
  "what is",
  "progress",
  "修改",
  "改为",
  "添加",
];

export function assessComplexity(question: string): Complexity {
  const normalized = question.toLowerCase();
  const complexHits = complexSignals.filter((signal) =>
    normalized.includes(signal),
  ).length;
  // A balance of 50000 or a recorded year is not a planning problem.
  const planning =
    /压力测试|情景|退休规划|税务规划|报税策略|再平衡|scenario|stress.test|retirement.plan|tax.plan|rebalance/i.test(
      question,
    );
  if (
    planning ||
    complexHits >= 2 ||
    (complexHits > 0 && question.length > 180)
  )
    return "complex";
  if (complexHits === 1 || question.length > 42) return "standard";
  if (simpleSignals.some((signal) => normalized.includes(signal)))
    return "simple";
  return "standard";
}

function enabled(provider: Provider) {
  return Boolean(
    provider === "openai"
      ? process.env.OPENAI_API_KEY
      : provider === "anthropic"
        ? process.env.ANTHROPIC_API_KEY
        : process.env.DEEPSEEK_API_KEY,
  );
}

export function chooseRoute(
  question: string,
  preference: Preference = "auto",
): Route {
  if (preference === "local")
    return {
      provider: "local",
      model: "家庭数据助手",
      complexity: "simple",
      reason: "本地规则，不调用外部模型",
    };
  if (preference !== "auto") {
    const route = models[preference];
    if (!route) throw new Error("未知的模型选项。");
    if (!enabled(route.provider))
      throw new Error(`${route.provider} 尚未配置 API key。`);
    return { ...route, reason: "用户手动选择" };
  }
  const complexity = assessComplexity(question);
  // Auto prefers low-latency inexpensive answers for simple questions, then
  // a broad general model, and reserves deeper reasoning for planning tasks.
  const candidates: Record<
    Complexity,
    Exclude<Preference, "auto" | "local">[]
  > = {
    simple: ["deepseek-chat", "openai-fast", "anthropic-fast"],
    standard: ["deepseek-chat", "openai-balanced", "anthropic-fast"],
    complex: ["openai-reasoning", "anthropic-reasoning", "deepseek-reasoner"],
  };
  const choice = candidates[complexity].find((key) =>
    enabled(models[key].provider),
  );
  if (!choice)
    return {
      provider: "local",
      model: "家庭数据助手",
      complexity,
      reason: "未连接外部模型，使用本地数据助手",
    };
  return {
    ...models[choice],
    complexity,
    reason: `自动路由：${complexity === "complex" ? "深度规划" : choice === "deepseek-chat" ? "省钱优先" : "低成本备选"}`,
  };
}

export async function generateAdvice(
  route: Route,
  instructions: string,
  question: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
) {
  const signal = options.signal
    ? AbortSignal.any([
        options.signal,
        AbortSignal.timeout(options.timeoutMs ?? 60000),
      ])
    : AbortSignal.timeout(options.timeoutMs ?? 60000);
  if (route.provider === "openai") {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: options.timeoutMs ?? 60000,
      maxRetries: options.timeoutMs ? 0 : 1,
    });
    const response = await client.responses.create(
      {
        model: route.model,
        instructions,
        input: question,
        max_output_tokens: 4096,
      },
      { signal },
    );
    return response.output_text;
  }
  if (route.provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: route.model,
        max_tokens: 4096,
        system: instructions,
        messages: [{ role: "user", content: question }],
      }),
    });
    if (!response.ok) throw new Error(`Anthropic 请求失败：${response.status}`);
    const data = (await response.json()) as {
      content: { type: string; text?: string }[];
    };
    return data.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
  }
  if (route.provider !== "deepseek")
    throw new Error("本地助手不使用模型 API。");
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: route.model,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: question },
      ],
      max_tokens: 4096,
      thinking: {
        type: route.complexity === "complex" ? "enabled" : "disabled",
      },
      ...(route.complexity === "complex" ? {} : { temperature: 0.35 }),
    }),
  });
  if (!response.ok) throw new Error(`DeepSeek 请求失败：${response.status}`);
  const data = (await response.json()) as {
    choices: { message: { content: string } }[];
  };
  return data.choices[0]?.message.content || "未获得模型回复。";
}
