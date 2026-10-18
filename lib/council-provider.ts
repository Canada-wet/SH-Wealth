import {
  COUNCIL_MODELS,
  type CouncilModel,
  type CouncilProvider,
  type CouncilAvailability,
} from "./council";
const KEY: Record<CouncilProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  qwen: "QWEN_API_KEY",
  glm: "ZAI_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  gemini: "GEMINI_API_KEY",
  meta: "MODEL_API_KEY",
};
function qwenBase() {
  const value = process.env.QWEN_BASE_URL?.replace(/\/$/, "");
  if (!value) return null;
  // Server-only endpoint; no arbitrary host, port, query, credentials or redirects.
  return /^https:\/\/[a-z\d-]+\.(ap-southeast-1|us-east-1|cn-beijing|cn-hongkong|ap-northeast-1)\.maas\.aliyuncs\.com\/compatible-mode\/v1$/.test(
    value,
  )
    ? value
    : null;
}
export function councilAvailability(): CouncilAvailability[] {
  return COUNCIL_MODELS.map((m) => ({
    key: m.key,
    ready:
      !!process.env[KEY[m.provider]] && (m.provider !== "qwen" || !!qwenBase()),
    detail: !process.env[KEY[m.provider]]
      ? `需配置 ${KEY[m.provider]}`
      : m.provider === "qwen" && !qwenBase()
        ? "需配置同地域 QWEN_BASE_URL（官方业务空间地址）"
        : "已配置凭证；模型权限与余额以实际调用为准",
  }));
}
export class CouncilProviderError extends Error {}
const tokenCount = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
export async function callCouncilModel(
  model: CouncilModel,
  system: string,
  input: string,
) {
  const key = process.env[KEY[model.provider]];
  if (!key) throw new CouncilProviderError("该服务尚未配置凭证，未发起调用。");
  const p = model.provider,
    messages = [
      { role: "system", content: system },
      { role: "user", content: input },
    ];
  let endpoint: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    };
  const limit = 4096;
  if (["openai", "meta"].includes(p)) {
    endpoint =
      p === "openai"
        ? "https://api.openai.com/v1/responses"
        : "https://api.meta.ai/v1/responses";
    body = {
      model: model.model,
      instructions: system,
      input,
      max_output_tokens: limit,
      store: false,
      ...(p === "openai"
        ? { reasoning: { effort: model.tier === "light" ? "low" : "medium" } }
        : p === "meta"
          ? { reasoning: { effort: "high" } }
          : { reasoning: { effort: "low" } }),
    };
  } else if (p === "anthropic") {
    endpoint = "https://api.anthropic.com/v1/messages";
    headers = {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    };
    body = {
      model: model.model,
      system,
      messages: [{ role: "user", content: input }],
      max_tokens: limit,
    };
  } else if (p === "gemini") {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model.model}:generateContent`;
    headers = { "Content-Type": "application/json", "x-goog-api-key": key };
    body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: input }] }],
      generationConfig: {
        maxOutputTokens: limit,
        ...(model.tier === "flagship"
          ? { thinkingConfig: { thinkingLevel: "low" } }
          : {}),
      },
    };
  } else {
    const base =
      p === "deepseek"
        ? "https://api.deepseek.com"
        : p === "moonshot"
          ? "https://api.moonshot.ai/v1"
          : p === "glm"
            ? "https://api.z.ai/api/paas/v4"
            : qwenBase();
    if (!base)
      throw new CouncilProviderError("Qwen 地域地址尚未正确配置，未发起调用。");
    endpoint = base + "/chat/completions";
    body = {
      model: model.model,
      messages,
      max_tokens: limit,
      ...(p === "glm"
        ? { thinking: { type: "enabled" }, reasoning_effort: "low" }
        : {}),
      ...(p === "deepseek"
        ? {
            thinking: { type: model.tier === "light" ? "disabled" : "enabled" },
          }
        : {}),
      ...(p === "moonshot"
        ? model.model === "kimi-k3"
          ? { reasoning_effort: "low" }
          : { thinking: { type: "disabled" } }
        : {}),
    };
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(50000),
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new CouncilProviderError(
        response.status === 429
          ? "服务限流或额度不足；未自动重试。"
          : response.status === 401 || response.status === 403
            ? "凭证、地域或模型访问权限不匹配；请检查服务商设置。"
            : response.status === 404
              ? "此账号或地域尚不支持该模型；请检查官方模型权限。"
              : `服务商请求未成功（${response.status}）；未自动重试。`,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      bytes += r.value.byteLength;
      if (bytes > 1000000) {
        await reader.cancel();
        throw Error();
      }
      chunks.push(r.value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const c of chunks) {
      buffer.set(c, offset);
      offset += c.length;
    }
    // Never persist hidden reasoning, tool requests or raw provider error bodies.
    const data = JSON.parse(new TextDecoder().decode(buffer));
    let text: string,
      incoming: unknown,
      outgoing: unknown,
      truncated = false;
    if (["openai", "meta"].includes(p)) {
      text = (data.output ?? [])
        .filter((o: { type: string }) => o.type === "message")
        .flatMap(
          (o: { content?: { type: string; text?: string }[] }) =>
            o.content ?? [],
        )
        .filter((c: { type: string }) => c.type === "output_text")
        .map((c: { text: string }) => c.text)
        .join("\n");
      incoming = data.usage?.input_tokens;
      outgoing = data.usage?.output_tokens;
      truncated = data.status === "incomplete";
    } else if (p === "anthropic") {
      text = (data.content ?? [])
        .filter((c: { type: string }) => c.type === "text")
        .map((c: { text: string }) => c.text)
        .join("\n");
      incoming = data.usage?.input_tokens;
      outgoing = data.usage?.output_tokens;
      truncated = data.stop_reason === "max_tokens";
    } else if (p === "gemini") {
      text = (data.candidates?.[0]?.content?.parts ?? [])
        .filter(
          (c: { thought?: boolean; text?: string }) =>
            !c.thought && typeof c.text === "string",
        )
        .map((c: { text: string }) => c.text)
        .join("\n");
      incoming = data.usageMetadata?.promptTokenCount;
      outgoing =
        data.usageMetadata?.totalTokenCount == null
          ? null
          : data.usageMetadata.totalTokenCount - (tokenCount(incoming) ?? 0);
      truncated = data.candidates?.[0]?.finishReason === "MAX_TOKENS";
    } else {
      text = data.choices?.[0]?.message?.content;
      incoming = data.usage?.prompt_tokens;
      outgoing = data.usage?.completion_tokens;
      truncated = data.choices?.[0]?.finish_reason === "length";
    }
    if (typeof text !== "string" || !text.trim())
      throw new CouncilProviderError(
        "未收到可展示的回答（可能触发内容限制或推理耗尽预算）；保留其他结果，不自动重试。",
      );
    return {
      answer: text.trim().slice(0, 16000),
      usage: {
        input: tokenCount(incoming),
        output: tokenCount(outgoing),
        truncated: truncated || text.length > 16000,
      },
    };
  } catch (e) {
    if (e instanceof CouncilProviderError) throw e;
    throw new CouncilProviderError(
      "请求超时、连接中断或响应无效；服务商可能已计费，未自动重发。",
    );
  }
}
