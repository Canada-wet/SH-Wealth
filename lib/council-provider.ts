import {
  COUNCIL_MODELS,
  type CouncilModel,
  type CouncilProvider,
  type CouncilAvailability,
} from "./council";
import { createHash } from "node:crypto";
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
export function qwenBase() {
  const value = process.env.QWEN_BASE_URL?.trim().replace(/\/$/, "");
  if (!value) return null;
  // Server-only endpoint; no arbitrary host, port, query, credentials or redirects.
  return /^https:\/\/[a-z\d-]+\.(ap-southeast-1|us-east-1|cn-beijing|cn-hongkong|ap-northeast-1)\.maas\.aliyuncs\.com\/compatible-mode\/v1$/.test(
    value,
  )
    ? value
    : null;
}
// Verified Alibaba catalogue IDs, NOT aliases borrowed from the original vendors.
// GLM Flash has no verified Alibaba mapping; do not silently substitute GLM 5.2.
const ALIBABA_MODELS: Record<string, string> = {
  "qwen-light": "qwen3.8-flash",
  "qwen-flagship": "qwen3.8-max",
  "moonshot-alternative": "kimi-k2.6",
  "moonshot-flagship": "kimi-k3",
  "glm-flagship": "ZHIPU/GLM-5.3",
};
const fingerprint = (base: string) =>
  createHash("sha256").update(base).digest("hex");
type Selection = { connection?: CouncilModel["connection"]; error?: string };
function directConnection(model: CouncilModel): Selection {
  if (model.provider === "qwen")
    return { error: "Qwen 使用百炼渠道，不支持原厂直连设置。" };
  if (!process.env[KEY[model.provider]])
    return { error: `需配置 ${KEY[model.provider]}` };
  return { connection: { channel: "direct", model: model.model } };
}
function alibabaConnection(model: CouncilModel): Selection {
  if (!ALIBABA_MODELS[model.key])
    return {
      error:
        "此型号尚无已核实的百炼映射；可配置原厂 key 直连，不会自动换成其他型号。",
    };
  if (!process.env.QWEN_API_KEY) return { error: "需配置百炼 QWEN_API_KEY" };
  const base = qwenBase();
  if (!base) return { error: "需配置同地域 QWEN_BASE_URL（官方业务空间地址）" };
  return {
    connection: {
      channel: "alibaba",
      model: ALIBABA_MODELS[model.key],
      endpointHash: fingerprint(base),
    },
  };
}
function selectConnection(model: CouncilModel): Selection {
  if (model.provider === "qwen") return alibabaConnection(model);
  if (model.provider !== "glm" && model.provider !== "moonshot")
    return directConnection(model);
  const setting =
    model.provider === "glm"
      ? process.env.COUNCIL_GLM_CHANNEL
      : process.env.COUNCIL_MOONSHOT_CHANNEL;
  const preference = setting?.trim() || "auto";
  if (!["auto", "direct", "alibaba"].includes(preference))
    return { error: "渠道设置无效，仅支持 auto / direct / alibaba。" };
  if (
    preference === "direct" ||
    (preference === "auto" && process.env[KEY[model.provider]])
  )
    return directConnection(model);
  if (preference === "alibaba" || process.env.QWEN_API_KEY)
    return alibabaConnection(model);
  return {
    error: `需配置百炼 QWEN_API_KEY + QWEN_BASE_URL，或原厂 ${KEY[model.provider]}`,
  };
}
export function councilModelSnapshot(model: CouncilModel): CouncilModel {
  const selection = selectConnection(model);
  if (!selection.connection)
    throw new CouncilProviderError(selection.error || "模型渠道尚未配置。");
  return { ...model, connection: selection.connection };
}
export function councilAvailability(): CouncilAvailability[] {
  return COUNCIL_MODELS.map((m) => {
    const selected = selectConnection(m);
    return {
      key: m.key,
      ready: !!selected.connection,
      connection: selected.connection,
      detail:
        selected.error ||
        `${selected.connection?.channel === "alibaba" ? "阿里云百炼" : "原厂直连"} · ${selected.connection?.model} · 凭证已配置，权限和额度以实际调用为准`,
    };
  });
}
export class CouncilProviderError extends Error {}
async function boundedJson(response: Response) {
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
  return JSON.parse(new TextDecoder().decode(buffer));
}
export async function checkAlibabaConnection() {
  const base = qwenBase(),
    key = process.env.QWEN_API_KEY;
  if (!base || !key)
    return {
      ok: false,
      message: "百炼 key 或业务空间地址尚未配置完整。",
      modelKeys: [] as string[],
    };
  try {
    // Read-only catalogue request. Never auto-fallback to a paid generation call.
    const response = await fetch(base + "/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        ok: false,
        message:
          response.status === 401 || response.status === 403
            ? "百炼拒绝凭证或访问权限，请核对 key 所属地域与业务空间。"
            : `型号目录检查返回 ${response.status}，暂不能确认连接；没有发起付费生成。`,
        modelKeys: [] as string[],
      };
    }
    const data = await boundedJson(response);
    if (!Array.isArray(data.data)) throw Error();
    const ids = new Set(
      data.data
        .filter(
          (m: unknown) =>
            m &&
            typeof m === "object" &&
            typeof (m as { id?: unknown }).id === "string",
        )
        .map((m: { id: string }) => m.id),
    );
    return {
      ok: true,
      message: "百炼型号目录连接成功；目录覆盖不等于已实测生成权限或免费额度。",
      modelKeys: Object.keys(ALIBABA_MODELS).filter((k) =>
        ids.has(ALIBABA_MODELS[k]),
      ),
    };
  } catch {
    return {
      ok: false,
      message: "百炼目录检查超时、网络不可达或响应无效；没有发起付费生成。",
      modelKeys: [] as string[],
    };
  }
}
const tokenCount = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
export async function callCouncilModel(
  model: CouncilModel,
  system: string,
  input: string,
) {
  // Legacy runs had direct Kimi/GLM connections. Never silently migrate them.
  const connection =
    model.connection ??
    (model.provider === "qwen"
      ? alibabaConnection(model)
      : directConnection(model)
    ).connection;
  if (!connection)
    throw new CouncilProviderError("该服务尚未配置凭证或渠道，未发起调用。");
  const viaAlibaba = connection.channel === "alibaba";
  if (
    !["direct", "alibaba"].includes(connection.channel) ||
    (!viaAlibaba && model.provider === "qwen") ||
    (viaAlibaba
      ? connection.model !== ALIBABA_MODELS[model.key]
      : connection.model !== model.model)
  )
    throw new CouncilProviderError("模型渠道快照无效，未发起调用。");
  const base = qwenBase();
  if (
    viaAlibaba &&
    (!base ||
      (connection.endpointHash &&
        connection.endpointHash !== fingerprint(base)))
  )
    throw new CouncilProviderError(
      "百炼业务空间地址已变化或无效；未切换渠道，也未发起调用。请重新配置或新建研讨。",
    );
  const key = process.env[viaAlibaba ? "QWEN_API_KEY" : KEY[model.provider]];
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
  if (viaAlibaba) {
    endpoint = base + "/chat/completions";
    body = {
      model: connection.model,
      messages,
      max_tokens: limit,
      stream: false,
      ...(p === "qwen" ? { enable_thinking: model.tier !== "light" } : {}),
    };
  } else if (["openai", "meta"].includes(p)) {
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
    // Never persist hidden reasoning, tool requests or raw provider error bodies.
    const data = await boundedJson(response);
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
