// Server-side OpenAI-compatible SSE reader. Hidden reasoning is deliberately discarded.
export type CouncilProgress = {
  phase: "waiting" | "thinking" | "answering" | "tools";
  preview?: string;
  seq?: number;
};
export class CouncilStreamError extends Error {}
export async function readCouncilStream(
  response: Response,
  onProgress?: (p: CouncilProgress) => void,
) {
  const reader = response.body?.getReader();
  if (!reader) throw new CouncilStreamError("服务商返回空响应流；未自动重发。");
  const decoder = new TextDecoder();
  let pending = "",
    text = "",
    wire = 0,
    terminal = false,
    ended = false;
  let usage: Record<string, unknown> | undefined, finish: string | undefined;
  const event = (block: string) => {
    const payload = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!payload) return;
    if (payload.trim() === "[DONE]") {
      ended = true;
      return;
    }
    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      throw new CouncilStreamError(
        "服务商返回无法解析的流式数据；未自动重发。",
      );
    }
    if (data.error)
      throw new CouncilStreamError(
        "服务商在生成途中返回错误；可能已计费，未自动重发。",
      );
    if (data.usage && typeof data.usage === "object") usage = data.usage;
    const choice = data.choices?.[0];
    if (choice?.finish_reason) {
      terminal = true;
      finish = choice.finish_reason;
    }
    const delta = choice?.delta;
    if (typeof delta?.reasoning_content === "string" && delta.reasoning_content)
      onProgress?.({ phase: "thinking" });
    if (typeof delta?.content === "string" && delta.content) {
      text += delta.content;
      if (text.length > 50000)
        throw new CouncilStreamError("服务商输出超过安全长度，已停止接收。");
      onProgress?.({ phase: "answering", preview: text.slice(0, 16000) });
    }
  };
  let interrupted = false;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      wire += part.value.byteLength;
      if (wire > 4000000)
        throw new CouncilStreamError("服务商响应超过安全大小，已停止接收。");
      pending += decoder.decode(part.value, { stream: true });
      pending = pending.replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = pending.indexOf("\n\n")) >= 0) {
        event(pending.slice(0, boundary));
        pending = pending.slice(boundary + 2);
      }
      if (ended) break;
      if (pending.length > 500000)
        throw new CouncilStreamError("服务商事件格式或大小异常。");
    }
    pending += decoder.decode();
    if (pending.trim()) event(pending);
    interrupted = !terminal && !ended;
  } catch (e) {
    if (!text.trim()) throw e;
    interrupted = true;
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!text.trim())
    throw new CouncilStreamError(
      "推理已结束但没有返回正文，可能耗尽推理预算或被内容策略拦截；未自动重发。",
    );
  return {
    choices: [{ message: { content: text }, finish_reason: finish }],
    usage,
    interrupted,
  };
}
