// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import Followup from "../app/council/Followup";
import Results from "../app/council/Results";
import {
  COUNCIL_MODELS,
  councilFollowupPlan,
  type CouncilRun,
} from "../lib/council";
afterEach(cleanup);
const id = "00000000-0000-4000-8000-000000000003";
function fixture(): CouncilRun {
  return {
    id,
    question: "合成原始问题",
    status: "complete",
    participants: ["openai-light", "deepseek-light"],
    judge: null,
    models: COUNCIL_MODELS.filter((m) =>
      ["openai-light", "deepseek-light"].includes(m.key),
    ),
    created_at: "2026-10-18",
    steps: [
      {
        seq: 0,
        stage: "revision",
        model_key: "openai-light",
        status: "succeeded",
        answer: "合成旧结论",
        error: "",
        usage: { input: 1, output: 1 },
        started_at: null,
        finished_at: null,
      },
    ],
  };
}
it("默认三阶段研讨准确报价，至少两人；切换方式和裁判撤销旧费用确认", async () => {
  const send = vi.fn(async () => {});
  render(<Followup run={fixture()} disabled={false} send={send} />);
  const button = () =>
    screen.getByRole("button", { name: "发送追问" }) as HTMLButtonElement;
  const consent = () =>
    screen.getByRole("checkbox", {
      name: /确认将本场资料/,
    }) as HTMLInputElement;
  expect(
    (screen.getByRole("radio", { name: /相互研讨/ }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  expect(screen.getByText(/本次 6 次新调用/)).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "现在约束变了呢？" },
  });
  fireEvent.click(consent());
  expect(button().disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("追问裁判"), {
    target: { value: "openai-light" },
  });
  expect(consent().checked).toBe(false);
  expect(screen.getByText(/本次 7 次新调用/)).toBeTruthy();
  expect(screen.getByLabelText("本轮研讨流程").textContent).toContain(
    "裁判汇总",
  );
  fireEvent.click(screen.getByRole("checkbox", { name: /DeepSeek/ }));
  fireEvent.click(consent());
  expect(button().disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toContain("至少需要 2 个模型");
  fireEvent.click(screen.getByRole("radio", { name: /直接回应/ }));
  expect(consent().checked).toBe(false);
  expect(screen.getByText(/本次 2 次新调用/)).toBeTruthy();
  fireEvent.click(consent());
  fireEvent.click(button());
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(send.mock.calls[0]).toMatchObject([
    {
      mode: "direct",
      participants: ["openai-light"],
      judge: "openai-light",
      consent: true,
      baseRound: 0,
    },
  ]);
});
it("提交默认研讨模式，网络未确认重试复用编号，更改执行模式生成新编号", async () => {
  const send = vi.fn(async (_spec: Record<string, unknown>) => {
    throw Error("保存状态未确认");
  });
  render(<Followup run={fixture()} disabled={false} send={send} />);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "请根据新条件辩论" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: /确认将本场资料/ }));
  fireEvent.click(screen.getByRole("button", { name: "发送追问" }));
  await screen.findByRole("alert");
  expect(send.mock.calls[0][0].mode).toBe("debate");
  fireEvent.click(screen.getByRole("button", { name: "发送追问" }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1][0].turnId).toBe(send.mock.calls[0][0].turnId);
  fireEvent.click(screen.getByRole("radio", { name: /直接回应/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /确认将本场资料/ }));
  fireEvent.click(screen.getByRole("button", { name: "发送追问" }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
  expect(send.mock.calls[2][0].turnId).not.toBe(send.mock.calls[0][0].turnId);
});
it("追问结论速览比较修订而非开场，保留三阶段进度，旧直接回应不受影响", () => {
  const run = fixture();
  run.turns = [
    {
      id,
      question: "新条件",
      participants: run.participants,
      judge: null,
      mode: "debate",
      created_at: run.created_at,
    },
  ];
  run.steps.push(
    ...councilFollowupPlan(run.participants, null, "debate", 1, 1).map((s) => ({
      ...run.steps[0],
      ...s,
      answer: s.stage === "revision" ? "修订后的结论" : "开场或质询内容",
    })),
  );
  render(<Results run={run} round={1} inspect={vi.fn()} />);
  expect(
    [...document.querySelectorAll(".council-comparison-grid article p")].map(
      (p) => p.textContent,
    ),
  ).toEqual(["修订后的结论", "修订后的结论"]);
  expect(screen.queryByText("开场或质询内容")).toBeNull();
  expect(
    screen.getByLabelText("模型参与进度").querySelectorAll(".council-dot"),
  ).toHaveLength(6);
});
