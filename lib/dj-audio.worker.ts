import { analyzePCM } from "./dj-audio-analysis";
import type { DJTempo } from "./lifestyle-schema";
const worker = self as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{
          samples: Float32Array;
          sampleRate: number;
          grid: DJTempo[];
        }>,
      ) => void)
    | null;
  postMessage: (data: unknown) => void;
};
worker.onmessage = (event) => {
  try {
    worker.postMessage({
      ok: true,
      result: analyzePCM(
        event.data.samples,
        event.data.sampleRate,
        event.data.grid,
      ),
    });
  } catch (error) {
    worker.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "音频分析失败。",
    });
  }
};
