import type { CouncilProgress } from "./council-stream";
export async function readCouncilResponse(
  response: Response,
  progress?: (p: CouncilProgress) => void,
) {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "研讨服务暂不可用。");
    return data;
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("无法读取生成状态，请重新读取已保存结果。");
  const decoder = new TextDecoder();
  let pending = "",
    size = 0,
    result: unknown;
  const line = (value: string) => {
    if (!value.trim()) return;
    const data = JSON.parse(value);
    if (data.type === "error")
      throw Error(data.error || "结果尚未确认，请重新读取。");
    if (data.type === "progress") progress?.(data);
    if (data.type === "result") result = { run: data.run };
  };
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > 32000000) throw Error("响应过大，请重新读取已归档结果。");
      pending += decoder.decode(item.value, { stream: true });
      let boundary;
      while ((boundary = pending.indexOf("\n")) >= 0) {
        line(pending.slice(0, boundary));
        pending = pending.slice(boundary + 1);
      }
      if (pending.length > 4200000)
        throw Error("响应格式异常，请重新读取已归档结果。");
    }
    pending += decoder.decode();
    if (pending.trim()) line(pending);
    if (!result)
      throw Error(
        "连接结束但归档尚未确认，请先重新读取；不会自动重发模型请求。",
      );
    return result as { run: import("./council").CouncilRun };
  } catch (e) {
    if (e instanceof SyntaxError)
      throw Error(
        "应用响应格式无效；请重新读取云端记录，不会自动重发模型请求。",
      );
    if (e instanceof TypeError)
      throw Error(
        "连接中断，归档状态尚待确认；请先重新读取，不会自动重发模型请求。",
      );
    throw e;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
