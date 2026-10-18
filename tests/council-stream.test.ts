import { it, expect } from "vitest";
import { readCouncilStream } from "../lib/council-stream";
import { readCouncilResponse } from "../lib/council-client";
const sse = (events: unknown[], done = true) =>
  events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join("") +
  (done ? "data: [DONE]\r\n\r\n" : "");
function streamed(text: string, part = 3) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += part)
          c.enqueue(bytes.slice(i, i + part));
        c.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
it("跨 chunk UTF-8/CRLF、多行与 usage 尾帧正常解析；从不保存隐藏推理", async () => {
  const progress: unknown[] = [];
  const result = await readCouncilStream(
    streamed(
      sse([
        {
          choices: [
            { delta: { reasoning_content: "PRIVATE_CHAIN_NEVER_PERSIST" } },
          ],
        },
        { choices: [{ delta: { content: "先看" } }] },
        { choices: [{ delta: { content: "结论。" }, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 12, completion_tokens: 35 } },
      ]),
    ),
    (p) => progress.push(p),
  );
  expect(result.choices[0].message.content).toBe("先看结论。");
  expect(result.usage?.prompt_tokens).toBe(12);
  expect(result.interrupted).toBe(false);
  expect(JSON.stringify([result, progress])).not.toContain("PRIVATE_CHAIN");
});
it("无结束帧和中途断流保留正文且标注不完整；只有推理或坏事件不冒充答案", async () => {
  const text = sse([{ choices: [{ delta: { content: "部分正文" } }] }], false);
  expect((await readCouncilStream(streamed(text))).interrupted).toBe(true);
  let index = 0;
  const broken = new Response(
    new ReadableStream({
      pull(c) {
        if (!index++) c.enqueue(new TextEncoder().encode(text));
        else c.error(Error("wire disconnected"));
      },
    }),
  );
  expect((await readCouncilStream(broken)).choices[0].message.content).toBe(
    "部分正文",
  );
  await expect(
    readCouncilStream(
      streamed(
        sse([{ choices: [{ delta: { reasoning_content: "hidden" } }] }]),
      ),
    ),
  ).rejects.toThrow("没有返回正文");
  await expect(readCouncilStream(streamed("data: broken\n\n"))).rejects.toThrow(
    "无法解析",
  );
});
it("客户端只以归档结果作为完成，不把临时正文当已保存；断流不自动请求", async () => {
  const frames =
    [
      JSON.stringify({ type: "progress", phase: "answering", preview: "临时" }),
      JSON.stringify({ type: "heartbeat" }),
      JSON.stringify({ type: "result", run: { id: "saved" } }),
    ].join("\n") + "\n";
  const response = streamed(frames, 5);
  response.headers.set("Content-Type", "application/x-ndjson");
  expect(await readCouncilResponse(response)).toEqual({ run: { id: "saved" } });
  const missing = streamed(
    JSON.stringify({ type: "progress", preview: "临时" }) + "\n",
  );
  missing.headers.set("Content-Type", "application/x-ndjson");
  await expect(readCouncilResponse(missing)).rejects.toThrow("归档尚未确认");
});
