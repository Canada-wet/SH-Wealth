// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { analyzeLocalAudio, AUDIO_SAMPLE_RATE } from "../lib/dj-audio-client";
import { analyzePCM } from "../lib/dj-audio-analysis";
let duration = 2,
  metadata = true,
  autoWorker = true,
  workerError = false,
  captured: Float32Array | null = null;
const decode = vi.fn(),
  terminate = vi.fn(),
  create = vi.fn(),
  revoke = vi.fn();
const buffer = () => ({
  duration: 2,
  sampleRate: AUDIO_SAMPLE_RATE,
  length: AUDIO_SAMPLE_RATE * 2,
  numberOfChannels: 2,
  getChannelData: (channel: number) =>
    Float32Array.from(
      { length: AUDIO_SAMPLE_RATE * 2 },
      (_, i) => (channel ? -0.2 : 0.2) * Math.sin(i * 0.15),
    ),
});
const file = () =>
  ({
    name: "synthetic.wav",
    size: 100,
    arrayBuffer: vi.fn(async () => new ArrayBuffer(20)),
  }) as unknown as File;
beforeEach(() => {
  duration = 2;
  metadata = true;
  autoWorker = true;
  workerError = false;
  captured = null;
  vi.clearAllMocks();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    if (metadata && this.getAttribute("src"))
      queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockImplementation(
    () => duration,
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: create.mockReturnValue("blob:synthetic"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revoke,
  });
  decode.mockResolvedValue(buffer());
  vi.stubGlobal(
    "OfflineAudioContext",
    class {
      decodeAudioData = decode;
    },
  );
  vi.stubGlobal(
    "Worker",
    class {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      terminate = terminate;
      postMessage(
        data: { samples: Float32Array; sampleRate: number; grid: [] },
        transfer: Transferable[],
      ) {
        captured = data.samples;
        expect(transfer).toEqual([data.samples.buffer]);
        if (autoWorker)
          queueMicrotask(() => {
            if (workerError) this.onerror?.();
            else
              this.onmessage?.({
                data: {
                  ok: true,
                  result: analyzePCM(data.samples, data.sampleRate, data.grid),
                },
              } as MessageEvent);
          });
      }
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("只处理本地File，跨声道功率避免反相抵消，任务结束释放Worker和元数据URL", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const result = await analyzeLocalAudio(
    file(),
    [],
    new AbortController().signal,
    vi.fn(),
  );
  expect(result.candidates.length).toBeGreaterThan(0);
  expect(captured!.some((n) => n > 0.1)).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
  expect(terminate).toHaveBeenCalledTimes(1);
  expect(revoke).toHaveBeenCalledTimes(1);
});
it("元数据超长先阻止，不解码整个文件", async () => {
  duration = 721;
  const f = file();
  await expect(
    analyzeLocalAudio(f, [], new AbortController().signal, vi.fn()),
  ).rejects.toThrow(/12 分钟/);
  expect(decode).not.toHaveBeenCalled();
  expect(f.arrayBuffer).not.toHaveBeenCalled();
  expect(revoke).toHaveBeenCalled();
});
it("拒绝非音频和超64MB文件，尚未读取字节", async () => {
  const f = file();
  Object.defineProperty(f, "size", { value: 65 * 1024 * 1024 });
  await expect(
    analyzeLocalAudio(f, [], new AbortController().signal, vi.fn()),
  ).rejects.toThrow(/64MB/);
  const bad = { ...file(), name: "remote.html" } as File;
  await expect(
    analyzeLocalAudio(bad, [], new AbortController().signal, vi.fn()),
  ).rejects.toThrow(/本地音频/);
  expect(create).not.toHaveBeenCalled();
});
it("元数据阶段取消释放URL，不解码或后台继续读", async () => {
  metadata = false;
  const controller = new AbortController(),
    task = analyzeLocalAudio(file(), [], controller.signal, vi.fn());
  const rejected = expect(task).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  expect(decode).not.toHaveBeenCalled();
  expect(revoke).toHaveBeenCalled();
});
it("原生解码取消不提前释放全局锁，完成后不分析旧结果", async () => {
  let resolve!: (v: ReturnType<typeof buffer>) => void;
  decode.mockReturnValue(new Promise((r) => (resolve = r)));
  const controller = new AbortController(),
    task = analyzeLocalAudio(file(), [], controller.signal, vi.fn());
  await waitFor(() => expect(decode).toHaveBeenCalled());
  const rejected = expect(task).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await expect(
    analyzeLocalAudio(file(), [], new AbortController().signal, vi.fn()),
  ).rejects.toThrow(/前一次/);
  resolve(buffer());
  await rejected;
  expect(captured).toBeNull();
  decode.mockResolvedValue(buffer());
  await expect(
    analyzeLocalAudio(file(), [], new AbortController().signal, vi.fn()),
  ).resolves.toHaveProperty("candidates");
});
it("Worker运行中取消立即终止，不能晚到保存结果", async () => {
  autoWorker = false;
  const controller = new AbortController(),
    task = analyzeLocalAudio(file(), [], controller.signal, vi.fn());
  await waitFor(() => expect(captured).not.toBeNull());
  const rejected = expect(task).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  expect(terminate).toHaveBeenCalledTimes(1);
});
it("Worker错误或原生解码失败给出错误并释放锁以便重试", async () => {
  workerError = true;
  await expect(
    analyzeLocalAudio(file(), [], new AbortController().signal, vi.fn()),
  ).rejects.toThrow(/分析线程/);
  expect(terminate).toHaveBeenCalled();
  workerError = false;
  decode.mockRejectedValueOnce(new Error("decode failed"));
  await expect(
    analyzeLocalAudio(file(), [], new AbortController().signal, vi.fn()),
  ).rejects.toThrow(/decode failed/);
  await expect(
    analyzeLocalAudio(file(), [], new AbortController().signal, vi.fn()),
  ).resolves.toHaveProperty("waveform");
});
