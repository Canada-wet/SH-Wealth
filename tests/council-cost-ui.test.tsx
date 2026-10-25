// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
} from "@testing-library/react";
import Costs from "../app/council/Costs";
import { COUNCIL_MODELS, type CouncilRun } from "../lib/council";
import { councilPrice } from "../lib/council-cost";
afterEach(cleanup);
const fixture = (): CouncilRun => ({
  id: "synthetic",
  question: "合成问题",
  created_at: "2026-10-25",
  participants: ["openai-light", "deepseek-light"],
  judge: null,
  status: "complete",
  models: COUNCIL_MODELS.filter((m) =>
    ["openai-light", "deepseek-light"].includes(m.key),
  ),
  steps: [0, 1, 2].map((i) => ({
    seq: i,
    round: i === 2 ? 1 : 0,
    model_key: "openai-light",
    stage: i === 2 ? "judge" : "opening",
    status: i === 1 ? "failed" : "succeeded",
    answer: "合成",
    error: "",
    usage:
      i === 1
        ? { input: null, output: null, requested: true }
        : {
            input: 1000,
            output: 100,
            cachedInput: 0,
            price: councilPrice(COUNCIL_MODELS[0], 1000),
          },
    started_at: null,
    finished_at: null,
  })),
});
it("结束后展示已知小计和未知项目，切换模型/环节与当前轮次不发起网络调用", () => {
  render(<Costs run={fixture()} round={1} />);
  expect(screen.getByLabelText("研讨成本分析").textContent).toContain(
    "已知部分小计",
  );
  fireEvent.click(screen.getByText("展开费用分布与优化提示"));
  fireEvent.click(screen.getByRole("button", { name: "按环节" }));
  expect(
    screen.getByRole("button", { name: "按环节" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(document.querySelector(".council-cost-bars")?.textContent).toContain(
    "追问 1 · 裁判汇总",
  );
  fireEvent.change(screen.getByLabelText("成本统计范围"), {
    target: { value: "round" },
  });
  expect(
    document.querySelector(".council-result-metrics")?.textContent,
  ).toContain("US$0.00015");
  expect(
    document.querySelector(".council-result-metrics")?.textContent,
  ).not.toContain("已知部分小计");
  fireEvent.click(screen.getByText("逐次用量、单价与费用边界"));
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
});
it("旧历史显示参考重估，所有费用未知时不显示免费", () => {
  const r = fixture();
  r.steps = r.steps.slice(0, 1);
  r.steps[0].usage = { input: null, output: null };
  render(<Costs run={r} round={0} />);
  expect(
    document.querySelector(".council-result-metrics")?.textContent,
  ).toContain("待核实");
  expect(screen.getByLabelText("研讨成本分析").textContent).toContain(
    "不是总账单",
  );
});
