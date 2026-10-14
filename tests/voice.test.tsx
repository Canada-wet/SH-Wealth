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
let native: MockRecognition;
class MockRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    native = this;
  }
}
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", storage);
  Object.defineProperty(window, "SpeechRecognition", {
    value: MockRecognition,
    configurable: true,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
});
const props = () => ({
  input: "已有文字",
  onTranscript: vi.fn(),
  reply: "结论",
  disabled: false,
  active: true,
});
it("朗读去除Markdown并可停止，关闭顾问取消朗读", () => {
  const previous = Object.getOwnPropertyDescriptor(window, "speechSynthesis");
  const synthesis = { cancel: vi.fn(), speak: vi.fn() };
  Object.defineProperty(window, "speechSynthesis", {
    value: synthesis,
    configurable: true,
  });
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      lang = "";
      constructor(public text: string) {}
    },
  );
  try {
    const view = render(
      <VoiceControls {...props()} reply="**净资产** 500\n\n深度解释" />,
    );
    fireEvent.click(screen.getByText(/语音对话/));
    fireEvent.click(screen.getByLabelText("朗读最新回复"));
    expect(synthesis.speak.mock.calls[0][0].text).not.toContain("**");
    fireEvent.click(screen.getByLabelText("停止朗读"));
    expect(synthesis.cancel).toHaveBeenCalled();
    view.unmount();
    expect(synthesis.cancel.mock.calls.length).toBeGreaterThan(2);
  } finally {
    if (previous) Object.defineProperty(window, "speechSynthesis", previous);
    else delete (window as unknown as Record<string, unknown>).speechSynthesis;
  }
});
it("语音必须同意，识别只更新草稿不自动发送", async () => {
  const p = props();
  render(<VoiceControls {...p} />);
  fireEvent.click(screen.getByText(/语音对话/));
  fireEvent.click(screen.getByLabelText("开始语音输入"));
  expect(screen.getByRole("alert").textContent).toContain("先同意");
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByLabelText("开始语音输入"));
  expect(native.lang).toBe("zh-CN");
  act(() =>
    native.onresult?.({
      results: [
        Object.assign([{ transcript: "把储蓄改为五万元" }], { isFinal: true }),
      ],
    }),
  );
  expect(p.onTranscript).toHaveBeenCalledWith("已有文字\n把储蓄改为五万元");
  expect(p.onTranscript).toHaveBeenCalledTimes(1);
});
it("中间识别不进入草稿，拒绝权限提示明确，关闭停止麦克风", () => {
  const p = props();
  const view = render(<VoiceControls {...p} />);
  fireEvent.click(screen.getByText(/语音对话/));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByLabelText("开始语音输入"));
  act(() =>
    native.onresult?.({
      results: [Object.assign([{ transcript: "五万" }], { isFinal: false })],
    }),
  );
  expect(p.onTranscript).not.toHaveBeenCalled();
  act(() => native.onerror?.({ error: "not-allowed" }));
  expect(screen.getByRole("alert").textContent).toContain("权限被拒绝");
  view.unmount();
  expect(native.abort).toHaveBeenCalled();
});
it("不支持语音浏览器显示文字降级入口", () => {
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  render(<VoiceControls {...props()} />);
  fireEvent.click(screen.getByText(/语音对话/));
  expect(screen.getByText(/系统键盘听写/)).toBeTruthy();
  expect(
    (screen.getByLabelText("开始语音输入") as HTMLButtonElement).disabled,
  ).toBe(true);
});
it("语音语言保存并重挂载恢复", () => {
  const p = props();
  let view = render(<VoiceControls {...p} />);
  fireEvent.click(screen.getByText(/语音对话/));
  fireEvent.change(screen.getByLabelText("语音识别语言"), {
    target: { value: "en-CA" },
  });
  view.unmount();
  view = render(<VoiceControls {...p} />);
  expect(
    (screen.getByLabelText("语音识别语言") as HTMLSelectElement).value,
  ).toBe("en-CA");
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
