import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  MAX_AUDIO_BYTES,
  spokenText,
  readSpokenAnswer,
  VoiceActivity,
} from "../lib/voice";
const auth = vi.hoisted(() => ({
  status: 200,
  error: "请先登录。",
  user: {},
  client: { rpc: vi.fn() },
}));
vi.mock("../lib/server-auth", () => ({
  authorizeRequest: vi.fn(async () => auth),
}));
import { POST } from "../app/api/voice/route";
beforeEach(() => {
  vi.clearAllMocks();
  auth.status = 200;
  auth.client.rpc.mockResolvedValue({ data: true, error: null });
  vi.stubEnv("OPENAI_API_KEY", "private-test-only");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const speech = (text = "家庭净资产为五百元。") =>
  new Request("http://localhost/api/voice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
function recording(type = "audio/webm", size = 20) {
  const form = new FormData();
  form.set(
    "audio",
    new Blob([new Uint8Array(size)], { type }),
    "recording.webm",
  );
  return new Request("http://localhost/api/voice", {
    method: "POST",
    body: form,
  });
}
it("只允许已登录成员使用，未授权不调用服务", async () => {
  auth.status = 401;
  const call = vi.fn();
  vi.stubGlobal("fetch", call);
  expect((await POST(speech())).status).toBe(401);
  expect(call).not.toHaveBeenCalled();
  expect(auth.client.rpc).not.toHaveBeenCalled();
});
it("自动识别无需language，音频只发给固定服务，不保存文件", async () => {
  const call = vi.fn(
    async (_url: string, _options: RequestInit) =>
      new Response(JSON.stringify({ text: "Check 我的 TFSA balance" })),
  );
  vi.stubGlobal("fetch", call);
  const response = await POST(recording());
  expect(await response.json()).toEqual({ text: "Check 我的 TFSA balance" });
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = call.mock.calls[0][1].body as FormData;
  expect(body.get("language")).toBeNull();
  expect(body.get("languages")).toBeNull();
  expect(body.get("model")).toBe("gpt-transcribe");
});
it("朗读用自然神经语音，不使用浏览器机械朗读，无持久缓存", async () => {
  const call = vi.fn(
    async (_url: string, _options: RequestInit) =>
      new Response(new Uint8Array([1, 2, 3])),
  );
  vi.stubGlobal("fetch", call);
  const response = await POST(speech("**净资产** 五百元。"));
  expect(response.status).toBe(200);
  const body = JSON.parse(call.mock.calls[0][1].body as string);
  expect(body.model).toBe("gpt-4o-mini-tts");
  expect(body.voice).toBe("marin");
  expect(body.input).not.toContain("**");
  expect(response.headers.get("content-type")).toBe("audio/mpeg");
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("拒绝超长、空白、非法格式，不消耗额度", async () => {
  for (const request of [
    speech(" "),
    speech("x".repeat(1201)),
    recording("text/plain"),
    recording("audio/webm", MAX_AUDIO_BYTES + 1),
  ])
    expect((await POST(request)).status).toBe(400);
  expect(auth.client.rpc).not.toHaveBeenCalled();
});
it("独立语音额度拒绝后不调用供应商", async () => {
  auth.client.rpc.mockResolvedValue({ error: null, data: false });
  const call = vi.fn();
  vi.stubGlobal("fetch", call);
  expect((await POST(speech())).status).toBe(429);
  expect(call).not.toHaveBeenCalled();
  expect(auth.client.rpc).toHaveBeenCalledWith("take_wealth_voice_slot");
});
it("供应商错误不泄露密钥或输入，不自动重试计费", async () => {
  const call = vi.fn(
    async () => new Response("private-test-only", { status: 500 }),
  );
  vi.stubGlobal("fetch", call);
  const response = await POST(speech());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private-test-only");
  expect(call).toHaveBeenCalledOnce();
});
it("口语摘要独立于详细分析，旧模型兼容，不读技术元数据", () => {
  expect(
    readSpokenAnswer('{"spokenAnswer":"Let’s check your savings."}', "报告"),
  ).toBe("Let’s check your savings.");
  expect(readSpokenAnswer("{}", "结论\n\n长报告")).toBe("结论");
  expect(
    spokenText("**五百元** [详情](https://example.com)\n\ndeepseek · model"),
  ).toBe("五百元 详情");
});
it("检测留出1200ms停顿，持续短噪声不提交，无限静默会关闭", () => {
  const vad = new VoiceActivity(0);
  for (let t = 60; t <= 600; t += 60)
    expect(vad.sample(0.05, t)).toBe("listen");
  expect(vad.sample(0, 1500)).toBe("listen");
  expect(vad.sample(0, 1800)).toBe("submit");
  expect(new VoiceActivity(0).sample(0, 30000)).toBe("idle");
});
