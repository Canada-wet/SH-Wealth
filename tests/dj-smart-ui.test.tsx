// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock("../lib/dj-audio-client", () => ({
  analyzeLocalAudio: mocks.analyze,
  AUDIO_MAX_BYTES: 64 * 1024 * 1024,
}));
import AudioCueStudio from "../app/components/lifestyle/AudioCueStudio";
import SmartSetPlanner from "../app/components/lifestyle/SmartSetPlanner";
import { lifestyleFixture } from "./fixtures/lifestyle";
import { lifestyleFingerprint } from "../lib/dj";
const evidence = () => ({
  duration: 330,
  waveform: [0.1, 0.8, 0.5],
  candidates: [
    {
      id: "intro",
      kind: "intro",
      label: "混入参考",
      seconds: 10,
      reason: "synthetic",
    },
  ],
  warnings: ["Not a Drop classifier"],
});
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:local"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  mocks.analyze.mockResolvedValue(evidence());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("智能编排预览不保存；过期后禁用确认，重新生成才能保存", () => {
  const life = lifestyleFixture(),
    save = vi.fn(() => true),
    close = vi.fn();
  const props = {
    life,
    save,
    disabled: false,
    onClose: close,
    onSaved: vi.fn(),
  };
  const view = render(<SmartSetPlanner {...props} />);
  fireEvent.click(screen.getByText("生成编排预览"));
  expect(save).not.toHaveBeenCalled();
  const changed = structuredClone(life);
  changed.tracks[0].title = "Changed";
  view.rerender(<SmartSetPlanner {...props} life={changed} />);
  expect(
    (screen.getByText("确认保存为新 Set") as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("重新生成");
  fireEvent.click(screen.getByText("生成编排预览"));
  fireEvent.click(screen.getByText("确认保存为新 Set"));
  expect(save).toHaveBeenCalledWith(
    expect.any(Function),
    "确认智能 DJ 编排",
    lifestyleFingerprint(changed),
  );
  expect(close).toHaveBeenCalledTimes(1);
});
it("编排设置变化取消旧预览，保存失败保留方案", () => {
  const save = vi.fn(() => false);
  render(
    <SmartSetPlanner
      life={lifestyleFixture()}
      save={save}
      disabled={false}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("生成编排预览"));
  fireEvent.change(screen.getByLabelText("智能 Set 目标分钟"), {
    target: { value: "20" },
  });
  expect(screen.queryByRole("region", { name: "智能编排预览" })).toBeNull();
  fireEvent.click(screen.getByText("生成编排预览"));
  fireEvent.click(screen.getByText("确认保存为新 Set"));
  expect(screen.getByRole("alert").textContent).toContain("保存未完成");
  expect(screen.getByRole("region", { name: "智能编排预览" })).toBeTruthy();
});
const choose = () =>
  fireEvent.change(screen.getByLabelText("选择智能 Cue 本地音频"), {
    target: {
      files: [new File(["synthetic"], "synthetic.wav", { type: "audio/wav" })],
    },
  });
it("音频仅明确确认才保存，修改候选重置试听确认，保存排除波形与文件", async () => {
  const life = lifestyleFixture(),
    save = vi.fn(() => true),
    close = vi.fn();
  render(
    <AudioCueStudio
      life={life}
      trackId="a"
      save={save}
      disabled={false}
      onClose={close}
    />,
  );
  choose();
  await screen.findByRole("region", { name: "音频 Cue 预览" });
  expect(save).not.toHaveBeenCalled();
  const button = screen.getByText("确认追加所选 Cue") as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  const matched = screen.getByLabelText(
      "我确认这个音频对应「Soft Arrival」的正确版本",
    ),
    listened = screen.getByLabelText(
      "我已试听、核对所选候选位置，理解它们不是已识别的 Drop / 副歌",
    );
  fireEvent.click(matched);
  fireEvent.click(listened);
  expect(button.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("候选开始：intro"), {
    target: { value: "12.125" },
  });
  expect(button.disabled).toBe(true);
  fireEvent.click(listened);
  fireEvent.click(button);
  expect(save).toHaveBeenCalledWith(
    expect.any(Function),
    "确认本机音频 Cue 候选",
    lifestyleFingerprint(life),
  );
  const next = (
    save.mock.calls as unknown as [
      (l: typeof life) => typeof life,
      string,
      string,
    ][]
  )[0][0](life);
  expect(next.tracks[0].cues[0].seconds).toBe(12.125);
  expect(JSON.stringify(next)).not.toContain("waveform");
  expect(JSON.stringify(next)).not.toContain("synthetic.wav");
  expect(close).toHaveBeenCalled();
});
it("分析期间曲库改变，晚到结果不能覆盖；关闭回收URL", async () => {
  const life = lifestyleFixture(),
    save = vi.fn(() => true);
  let resolve!: (r: ReturnType<typeof evidence>) => void;
  mocks.analyze.mockReturnValue(new Promise((r) => (resolve = r)));
  const props = { life, trackId: "a", save, disabled: false, onClose: vi.fn() };
  const view = render(<AudioCueStudio {...props} />);
  choose();
  const signal = mocks.analyze.mock.calls[0][2] as AbortSignal;
  const changed = structuredClone(life);
  changed.tracks[1].title = "Other update";
  view.rerender(<AudioCueStudio {...props} life={changed} />);
  resolve(evidence());
  await screen.findByRole("region", { name: "音频 Cue 预览" });
  expect(screen.getByRole("alert").textContent).toContain("重新分析");
  expect(
    (screen.getByText("确认追加所选 Cue") as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(save).not.toHaveBeenCalled();
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local");
});
it("分析仍在运行时关闭会取消；晚到结果不创建试听URL或保存", async () => {
  let resolve!: (value: ReturnType<typeof evidence>) => void;
  mocks.analyze.mockReturnValue(new Promise((r) => (resolve = r)));
  const save = vi.fn(() => true),
    view = render(
      <AudioCueStudio
        life={lifestyleFixture()}
        trackId="a"
        save={save}
        disabled={false}
        onClose={vi.fn()}
      />,
    );
  choose();
  const signal = mocks.analyze.mock.calls[0][2] as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  resolve(evidence());
  await Promise.resolve();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
it("满Hot槽不覆盖旧标记，保存失败保留预览", async () => {
  const life = lifestyleFixture();
  life.tracks[0].cues = Array.from({ length: 8 }, (_, i) => ({
    id: String(i),
    label: String(i),
    seconds: i,
    type: 0,
    num: i,
  }));
  const save = vi.fn(() => false);
  render(
    <AudioCueStudio
      life={life}
      trackId="a"
      save={save}
      disabled={false}
      onClose={vi.fn()}
    />,
  );
  choose();
  await screen.findByRole("region", { name: "音频 Cue 预览" });
  fireEvent.change(screen.getByLabelText("智能 Cue 保存方式"), {
    target: { value: "hot" },
  });
  fireEvent.click(
    screen.getByLabelText("我确认这个音频对应「Soft Arrival」的正确版本"),
  );
  fireEvent.click(
    screen.getByLabelText(
      "我已试听、核对所选候选位置，理解它们不是已识别的 Drop / 副歌",
    ),
  );
  fireEvent.click(screen.getByText("确认追加所选 Cue"));
  expect(screen.getByRole("alert").textContent).toContain("槽位不足");
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("智能 Cue 保存方式"), {
    target: { value: "memory" },
  });
  fireEvent.click(screen.getByText("确认追加所选 Cue"));
  expect(save).toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("未完成");
});
