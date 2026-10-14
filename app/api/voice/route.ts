import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server-auth";
import {
  AUDIO_TYPES,
  MAX_AUDIO_BYTES,
  MAX_SPOKEN_CHARS,
  spokenText,
} from "@/lib/voice";
export const maxDuration = 40;
const json = (error: string, status: number) =>
  NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
export async function POST(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200) return json(auth.error, auth.status);
  if (!process.env.OPENAI_API_KEY)
    return json("自然语音服务尚未配置；仍可使用文字对话。", 503);
  if (Number(request.headers.get("content-length")) > MAX_AUDIO_BYTES + 16000)
    return json("录音过大，请缩短这一句话。", 413);
  let endpoint: string, body: FormData | string;
  let transcription = false;
  try {
    if (
      request.headers.get("content-type")?.startsWith("multipart/form-data")
    ) {
      const input = await request.formData();
      const audio = input.get("audio");
      if (
        !(audio instanceof File) ||
        !audio.size ||
        audio.size > MAX_AUDIO_BYTES
      )
        return json("请提供不超过 2 MB 的录音。", 400);
      const extension = AUDIO_TYPES[audio.type.split(";")[0]];
      if (!extension)
        return json("录音格式不支持，请换用 Chrome / Safari。", 400);
      const form = new FormData();
      form.set("file", audio, `utterance.${extension}`);
      form.set(
        "model",
        process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-transcribe",
      );
      // No fixed language hint: recognize the original language and code-switching.
      form.set("response_format", "json");
      endpoint = "transcriptions";
      body = form;
      transcription = true;
    } else {
      const input = await request.json();
      if (
        typeof input?.text !== "string" ||
        !input.text.trim() ||
        input.text.length > MAX_SPOKEN_CHARS
      )
        return json("语音回复长度无效。", 400);
      const text = spokenText(input.text);
      if (!text) return json("没有可朗读的内容。", 400);
      endpoint = "speech";
      body = JSON.stringify({
        model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
        voice: "marin",
        input: text,
        instructions:
          "Speak naturally and warmly, like a thoughtful conversation partner, not a newsreader. Use the language of the text, pronounce financial amounts and account names clearly. Relaxed pace, natural pauses. Do not add or change words or numbers.",
        response_format: "mp3",
      });
    }
  } catch {
    return json("语音请求格式无效。", 400);
  }
  const slot = await auth.client.rpc("take_wealth_voice_slot");
  if (slot.error) return json("语音访问检查失败，请稍后重试。", 503);
  if (!slot.data) return json("语音请求较频繁，请稍后再试。", 429);
  try {
    const response = await fetch(
      `https://api.openai.com/v1/audio/${endpoint}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          ...(typeof body === "string"
            ? { "Content-Type": "application/json" }
            : {}),
        },
        body,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(32000)]),
      },
    );
    // Do not echo provider errors, text, recordings or credentials to logs.
    if (!response.ok) return json("语音服务暂不可用，请重试或改用文字。", 503);
    if (transcription) {
      const result = await response.json();
      if (typeof result.text !== "string" || result.text.length > 6000)
        return json("这一句话无法识别，请再说一次。", 502);
      return NextResponse.json(
        { text: result.text.trim() },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return new Response(response.body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return json("语音请求已停止或超时，请重试。", 503);
  }
}
