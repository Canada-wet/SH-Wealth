import { AUDIO_MAX_SECONDS, type AudioAnalysis } from "./dj-audio-analysis";
import type { DJTempo } from "./lifestyle-schema";
export const AUDIO_MAX_BYTES = 64 * 1024 * 1024;
export const AUDIO_SAMPLE_RATE = 11025;
const aborted = () => new DOMException("分析已取消。", "AbortError");
function check(signal: AbortSignal) {
  if (signal.aborted) throw aborted();
}
export function readAudioDuration(
  file: File,
  signal: AbortSignal,
): Promise<number> {
  return new Promise((resolve, reject) => {
    check(signal);
    const audio = document.createElement("audio"),
      url = URL.createObjectURL(file);
    let finished = false;
    const finish = (error?: Error, seconds?: number) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve(seconds!);
    };
    const cancel = () => finish(aborted());
    const timer = window.setTimeout(
      () =>
        finish(
          new Error(
            "读取音频信息超时；请尝试未加密的 MP3 / WAV，或换用桌面浏览器。",
          ),
        ),
      15000,
    );
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      finish(
        Number.isFinite(duration) &&
          duration >= 1 &&
          duration <= AUDIO_MAX_SECONDS
          ? undefined
          : new Error("仅支持 1 秒–12 分钟的本地音频，请先裁剪练习副本。"),
        duration,
      );
    };
    audio.onerror = () =>
      finish(
        new Error(
          "浏览器无法读取此音频格式；不支持受 DRM 保护文件，可尝试本地 MP3 / WAV。",
        ),
      );
    signal.addEventListener("abort", cancel, { once: true });
    audio.src = url;
    audio.load();
  });
}
let analyzing = false;
export async function analyzeLocalAudio(
  file: File,
  grid: DJTempo[],
  signal: AbortSignal,
  progress: (message: string) => void,
): Promise<AudioAnalysis> {
  if (analyzing)
    throw new Error(
      "前一次音频仍在解码 / 释放，请稍后再试。为保护内存，一次只分析一首。",
    );
  if (
    !/\.(mp3|wav|flac|m4a|aac|ogg|aif|aiff)$/i.test(file.name) ||
    !file.size ||
    file.size > AUDIO_MAX_BYTES
  )
    throw new Error(
      "请选择不超过 64MB 的本地音频（MP3 / WAV / FLAC / M4A / AAC / OGG / AIFF）。",
    );
  check(signal);
  analyzing = true;
  try {
    progress("检查本地音频时长…");
    await readAudioDuration(file, signal);
    check(signal);
    const Offline =
      window.OfflineAudioContext ??
      (
        window as Window & {
          webkitOfflineAudioContext?: typeof OfflineAudioContext;
        }
      ).webkitOfflineAudioContext;
    if (!Offline || typeof Worker === "undefined")
      throw new Error(
        "此浏览器不支持本机音频分析，请使用新版 Safari / Chrome / Edge；仍可手动维护 Cue。",
      );
    progress("正在本机解码，音频不会上传…");
    const context = new Offline(1, 1, AUDIO_SAMPLE_RATE);
    const bytes = await file.arrayBuffer();
    check(signal);
    // Native decoding cannot be interrupted. Keep the global lock until it settles.
    const decoded = await context.decodeAudioData(bytes);
    check(signal);
    if (
      decoded.duration < 1 ||
      decoded.duration > AUDIO_MAX_SECONDS ||
      decoded.numberOfChannels > 8 ||
      decoded.sampleRate !== AUDIO_SAMPLE_RATE
    )
      throw new Error("解码后时长、声道或采样率超出范围，未继续分析。");
    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const samples = decoded.getChannelData(channel);
      for (let i = 0; i < samples.length; i += 200000) {
        check(signal);
        const end = Math.min(i + 200000, samples.length);
        for (let j = i; j < end; j++)
          mono[j] += samples[j] ** 2 / decoded.numberOfChannels;
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }
    // Opposite-phase stereo must not look silent: retain power across channels.
    for (let i = 0; i < mono.length; i++) mono[i] = Math.sqrt(mono[i]);
    check(signal);
    progress("正在本机检查能量变化与 Cue 候选…");
    return await new Promise<AudioAnalysis>((resolve, reject) => {
      const worker = new Worker(
        new URL("./dj-audio.worker.ts", import.meta.url),
        { type: "module" },
      );
      let done = false;
      const finish = (result?: AudioAnalysis, error?: Error) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        worker.terminate();
        if (error) reject(error);
        else resolve(result!);
      };
      const cancel = () => finish(undefined, aborted());
      const timer = window.setTimeout(
        () =>
          finish(
            undefined,
            new Error("本机分析超时，已停止；请缩短音频后重试。"),
          ),
        30000,
      );
      signal.addEventListener("abort", cancel, { once: true });
      worker.onerror = () =>
        finish(
          undefined,
          new Error("分析线程无法运行；请刷新或使用新版浏览器。"),
        );
      worker.onmessage = (
        event: MessageEvent<{
          ok: boolean;
          result?: AudioAnalysis;
          error?: string;
        }>,
      ) => {
        if (signal.aborted) {
          cancel();
          return;
        }
        event.data.ok && event.data.result
          ? finish(event.data.result)
          : finish(undefined, new Error(event.data.error ?? "音频分析失败。"));
      };
      try {
        worker.postMessage(
          { samples: mono, sampleRate: AUDIO_SAMPLE_RATE, grid },
          [mono.buffer],
        );
      } catch {
        finish(undefined, new Error("无法启动本机分析，未上传任何音频。"));
      }
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new Error(
      error instanceof Error
        ? `未完成分析：${error.message}`
        : "无法解码；请尝试本地 MP3 / WAV。",
    );
  } finally {
    analyzing = false;
  }
}
