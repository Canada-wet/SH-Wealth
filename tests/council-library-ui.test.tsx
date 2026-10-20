// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import Library from "../app/council/Library";
import DecisionMemo from "../app/council/DecisionMemo";
import Followup from "../app/council/Followup";
import Results from "../app/council/Results";
import { libraryItem } from "./fixtures/council-library";
import { COUNCIL_MODELS, type CouncilRun } from "../lib/council";
import { EMPTY_COUNCIL_MEMO, COUNCIL_DEEPEN } from "../lib/council-library";
import type useCouncilLibrary from "../lib/useCouncilLibrary";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function run(): CouncilRun {
  return {
    id: libraryItem().id,
    question: libraryItem().question,
    status: "complete",
    created_at: libraryItem().createdAt,
    participants: ["openai-light", "deepseek-light"],
    judge: null,
    models: COUNCIL_MODELS.filter((m) =>
      ["openai-light", "deepseek-light"].includes(m.key),
    ),
    steps: [
      {
        seq: 0,
        model_key: "openai-light",
        stage: "revision",
        status: "succeeded",
        answer: "原轮完整结论",
        error: "",
        usage: { input: 1, output: 1 },
        started_at: null,
        finished_at: null,
      },
    ],
  };
}
function store(items = [libraryItem()]): ReturnType<typeof useCouncilLibrary> {
  return {
    items,
    query: "",
    setQuery: vi.fn(),
    loading: false,
    searching: false,
    ready: true,
    error: "",
    sessionKey: "fixture",
    refresh: vi.fn(),
    save: vi.fn(),
  };
}
it("历史分类、筛选、归档入口、打开匹配轮次和搜索清除均可操作", () => {
  const open = vi.fn(),
    data = store([
      libraryItem(),
      libraryItem({
        id: "a3000000-0000-4000-8000-000000000002",
        question: "旧的已归档问题",
        memo: { ...EMPTY_COUNCIL_MEMO, archived: true },
      }),
    ]);
  render(
    <Library
      store={data}
      legacy={[]}
      selected=""
      disabled={false}
      open={open}
    />,
  );
  expect(screen.getByRole("button", { name: /合成问题/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /旧的已归档问题/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /已归档/ }));
  fireEvent.click(screen.getByRole("button", { name: /旧的已归档问题/ }));
  expect(open.mock.calls[0][0].memo.archived).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /筛选/ }));
  fireEvent.change(screen.getByLabelText("执行状态"), {
    target: { value: "paused" },
  });
  expect(screen.getByText(/没有符合条件/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("搜索研讨历史"), {
    target: { value: "搜索" },
  });
  expect(data.setQuery).toHaveBeenCalledWith("搜索");
  fireEvent.keyDown(screen.getByLabelText("搜索研讨历史"), { key: "Escape" });
  expect(data.setQuery).toHaveBeenCalledWith("");
});
it("无新SQL时保留旧列表，但说明只搜索问题且不能假装收藏成功", () => {
  const data = { ...store(), items: [], ready: false, error: "服务尚未连接" };
  render(
    <Library
      store={data}
      legacy={[
        {
          id: run().id,
          question: "原有历史仍在",
          status: "complete",
          created_at: libraryItem().createdAt,
        },
      ]}
      selected=""
      disabled={false}
      open={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: /原有历史仍在/ })).toBeTruthy();
  expect(screen.getByText(/仅能搜索原问题/)).toBeTruthy();
});
it("私人笔记显式保存，失败保留草稿，活动研讨不能归档，云端冲突可识别", async () => {
  const save = vi.fn(async () => {
    throw Error("另一设备已修改");
  });
  const props = {
    run: run(),
    value: { ...EMPTY_COUNCIL_MEMO },
    ready: true,
    disabled: false,
    save,
  };
  const dirty = vi.fn();
  const { rerender } = render(
    <DecisionMemo {...props} onDirtyChange={dirty} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "整理与笔记" }));
  fireEvent.change(screen.getByLabelText("自定义标题"), {
    target: { value: "职业验证" },
  });
  fireEvent.change(screen.getByLabelText("我的判断与待验证假设"), {
    target: { value: "先与三位从业者访谈" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存私人笔记" }));
  await screen.findByRole("alert");
  expect(
    (screen.getByLabelText("我的判断与待验证假设") as HTMLTextAreaElement)
      .value,
  ).toBe("先与三位从业者访谈");
  expect(dirty).toHaveBeenCalledWith(true);
  rerender(
    <DecisionMemo
      {...props}
      value={{ ...EMPTY_COUNCIL_MEMO, version: 2, title: "另一设备" }}
      onDirtyChange={dirty}
    />,
  );
  expect(screen.getByText(/云端整理版本已变化/)).toBeTruthy();
  cleanup();
  render(<DecisionMemo {...props} run={{ ...run(), status: "active" }} />);
  expect(
    (screen.getByRole("button", { name: "归档研讨" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it("收藏与归档等待确认且支持恢复；保存后显示私人状态，不调用模型", async () => {
  const save = vi.fn(async (memo) => ({ ...memo, version: memo.version + 1 }));
  const props = {
    run: run(),
    value: { ...EMPTY_COUNCIL_MEMO, archived: true, pinned: true, version: 1 },
    ready: true,
    disabled: false,
    save,
  };
  render(<DecisionMemo {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "恢复到全部研讨" }));
  await screen.findByText(/已私密保存/);
  expect(save.mock.calls[0][0]).toMatchObject({
    archived: false,
    pinned: true,
    version: 1,
  });
});
it("深挖模板只替换追问草稿，撤销费用确认，不自动发送且不会改选择模型", async () => {
  const send = vi.fn(),
    props = { run: run(), disabled: false, send };
  const { rerender } = render(<Followup {...props} />);
  fireEvent.click(screen.getByRole("checkbox", { name: /确认将本场资料/ }));
  rerender(
    <Followup
      {...props}
      seed={{ id: "draft-seed", text: COUNCIL_DEEPEN[0].text }}
    />,
  );
  await waitFor(() =>
    expect(
      (screen.getByRole("textbox", { name: "继续追问" }) as HTMLTextAreaElement)
        .value,
    ).toBe(COUNCIL_DEEPEN[0].text),
  );
  expect(
    (
      screen.getByRole("checkbox", {
        name: /确认将本场资料/,
      }) as HTMLInputElement
    ).checked,
  ).toBe(false);
  expect(send).not.toHaveBeenCalled();
});
it("新旧轮次仅并排原文、不猜共识，复制失败提供替代方案", async () => {
  const r = run();
  r.turns = [
    {
      id: r.id,
      question: "新条件",
      participants: r.participants,
      judge: null,
      created_at: r.created_at,
      mode: "debate",
    },
  ];
  r.steps.push({ ...r.steps[0], seq: 1, round: 1, answer: "本轮修订结论" });
  const view = vi.fn();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(async () => {
        throw Error();
      }),
    },
  });
  render(<Results run={r} round={1} inspect={vi.fn()} viewRound={view} />);
  fireEvent.click(screen.getByText(/对照上一轮/));
  expect(screen.getByText("原轮完整结论")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "回看原始研讨结论" }));
  expect(view).toHaveBeenCalledWith(0);
  fireEvent.click(screen.getByRole("button", { name: "复制本轮结论" }));
  await screen.findByText(/无法复制/);
});
