// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { JSDOM } from "jsdom";
import VoiceControls from "../app/components/VoiceControls";
import useChatDraft from "../lib/useChatDraft";
const storage = new JSDOM("", { url: "http://localhost" }).window.localStorage;
const track = { enabled: true, stop: vi.fn() };
const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
let amplitude = 0,
  recorder: Recorder,
  source: Sound;
class Recorder {
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  onstop: (() => void) | null = null;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  static isTypeSupported = () => true;
  constructor() {
    recorder = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["test"], { type: this.mimeType }),
    });
    this.onstop?.();
  }
}
class Sound {
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop() {
    this.onended?.();
  }
  constructor() {
    source = this;
  }
}
class Context {
  state = "running";
  destination = {};
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  decodeAudioData = vi.fn(async () => ({}));
  createBufferSource = () => new Sound();
  createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  createAnalyser = () => ({
    fftSize: 2048,
    disconnect: vi.fn(),
    getFloatTimeDomainData: (values: Float32Array) => values.fill(amplitude),
  });
}
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("AudioContext", Context);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) =>
      options.body instanceof FormData
        ? new Response(JSON.stringify({ text: "把储蓄本年回报改为负百分之三" }))
        : new Response(new Uint8Array([1, 2, 3]), {
            headers: { "Content-Type": "audio/mpeg" },
          }),
    ),
  );
  amplitude = 0;
  track.enabled = true;
  track.stop.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const props = () => ({
  onTurn: vi.fn(async (_text: string, _signal: AbortSignal) => ({
    reply: "已准备修改，请确认。",
    pending: false,
  })),
  onListeningChange: vi.fn(),
  disabled: false,
  active: true,
  pending: false,
});
async function start() {
  await act(async () => fireEvent.click(screen.getByLabelText("开始语音对话")));
}
async function utterance() {
  amplitude = 0.08;
  await act(async () => vi.advanceTimersByTimeAsync(600));
  amplitude = 0;
  await act(async () => vi.advanceTimersByTimeAsync(1260));
}
it("一键开始，无语种选择和转写确认；停顿自动发送，播报后继续聆听", async () => {
  vi.useFakeTimers();
  const p = props();
  render(<VoiceControls {...p} />);
  expect(screen.queryByLabelText("语音识别语言")).toBeNull();
  await start();
  expect(recorder.state).toBe("recording");
  await utterance();
  expect(p.onTurn).toHaveBeenCalledTimes(1);
  expect(p.onTurn.mock.calls[0][0]).toBe("把储蓄本年回报改为负百分之三");
  expect(track.enabled).toBe(false);
  expect(source.start).toHaveBeenCalledOnce();
  await act(async () => source.onended?.());
  expect(track.enabled).toBe(true);
  expect(recorder.state).toBe("recording");
  expect(screen.getByRole("status").textContent).toContain("我在听");
});
it("自然回复可以打断，然后继续听下一句", async () => {
  vi.useFakeTimers();
  render(<VoiceControls {...props()} />);
  await start();
  await utterance();
  await act(async () => fireEvent.click(screen.getByLabelText("打断语音回复")));
  expect(recorder.state).toBe("recording");
  expect(track.enabled).toBe(true);
});
it("财务修改播报后暂停，确认或取消后才恢复收音", async () => {
  vi.useFakeTimers();
  const p = props();
  p.onTurn.mockResolvedValue({ reply: "待确认", pending: true });
  const view = render(<VoiceControls {...p} />);
  await start();
  await utterance();
  view.rerender(<VoiceControls {...p} pending />);
  await act(async () => source.onended?.());
  expect(track.enabled).toBe(false);
  expect(screen.getByRole("status").textContent).toContain("修改预览");
  view.rerender(<VoiceControls {...p} pending={false} />);
  expect(track.enabled).toBe(true);
  expect(recorder.state).toBe("recording");
});
it("静默和短噪声不会上传音频，30秒自动关闭麦克风", async () => {
  vi.useFakeTimers();
  const p = props();
  render(<VoiceControls {...p} />);
  await start();
  amplitude = 0.03;
  await act(async () => vi.advanceTimersByTimeAsync(60));
  amplitude = 0;
  await act(async () => vi.advanceTimersByTimeAsync(30060));
  expect(fetch).not.toHaveBeenCalled();
  expect(p.onTurn).not.toHaveBeenCalled();
  expect(track.stop).toHaveBeenCalled();
});
it("关闭窗口或卸载会中止请求、释放麦克风，晚到识别不得发送", async () => {
  vi.useFakeTimers();
  const p = props();
  let resolve!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    ),
  );
  const view = render(<VoiceControls {...p} />);
  await start();
  await utterance();
  const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
  view.rerender(<VoiceControls {...p} active={false} />);
  expect(signal.aborted).toBe(true);
  expect(track.stop).toHaveBeenCalled();
  await act(async () =>
    resolve(new Response(JSON.stringify({ text: "删除储蓄" }))),
  );
  expect(p.onTurn).not.toHaveBeenCalled();
  view.unmount();
});
it("授权迟到时结束已生效，迟到麦克风也会释放", async () => {
  const p = props();
  let resolve!: (value: typeof stream) => void;
  vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r as unknown as typeof resolve;
      }),
  );
  render(<VoiceControls {...p} />);
  await start();
  fireEvent.click(screen.getByLabelText("结束语音对话"));
  await act(async () => resolve(stream));
  expect(track.stop).toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
it("权限拒绝和不支持的浏览器明确降级到文字", async () => {
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
    new DOMException("denied", "NotAllowedError"),
  );
  const view = render(<VoiceControls {...props()} />);
  await start();
  expect(screen.getByRole("alert").textContent).toContain("权限被拒绝");
  view.unmount();
  vi.stubGlobal("MediaRecorder", undefined);
  render(<VoiceControls {...props()} />);
  expect(
    (screen.getByLabelText("开始语音对话") as HTMLButtonElement).disabled,
  ).toBe(true);
});
it("识别失败不会发送，更不会继续录音", async () => {
  vi.useFakeTimers();
  const p = props();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "服务暂不可用" }), {
          status: 503,
        }),
    ),
  );
  render(<VoiceControls {...p} />);
  await start();
  await utterance();
  expect(p.onTurn).not.toHaveBeenCalled();
  expect(track.stop).toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("暂不可用");
});
it("草稿按会话隔离，刷新恢复，发送清空", async () => {
  let hook = renderHook(({ chatId }) => useChatDraft(chatId), {
    initialProps: { chatId: "first" },
  });
  act(() => hook.result.current[1]("我的草稿"));
  hook.unmount();
  hook = renderHook(({ chatId }) => useChatDraft(chatId), {
    initialProps: { chatId: "first" },
  });
  await waitFor(() => expect(hook.result.current[0]).toBe("我的草稿"));
  hook.rerender({ chatId: "second" });
  expect(hook.result.current[0]).toBe("");
  hook.rerender({ chatId: "first" });
  expect(hook.result.current[0]).toBe("我的草稿");
  act(() => hook.result.current[1](""));
  expect(storage.getItem("together-chat-draft:first")).toBeNull();
});
