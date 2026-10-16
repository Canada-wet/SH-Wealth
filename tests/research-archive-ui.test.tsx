// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import MarketResearchArchive from "../app/components/MarketResearchArchive";
const report = {
  id: "one",
  source: "funda",
  source_url: "https://funda.ai/agent-chat?c=fixture",
  captured_at: "2026-10-16T03:30:00Z",
  prompt: "合成问题",
  response:
    '**合成原文** <reference url="https://www.bea.gov/">BEA</reference>',
  citations: [{ title: "BEA", url: "https://www.bea.gov/" }],
  status: "complete",
  verification: "ai-unverified",
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("不连接家庭不读取，连接后展示原文、未核验身份和来源；切换家庭不会泄露旧结果", async () => {
  const request = vi.fn(async () => Response.json({ reports: [report] }));
  vi.stubGlobal("fetch", request);
  const view = render(<MarketResearchArchive household="" />);
  expect(request).not.toHaveBeenCalled();
  view.rerender(<MarketResearchArchive household="first" />);
  await waitFor(() =>
    expect(screen.getByLabelText("选择外部研究归档")).toBeTruthy(),
  );
  expect(screen.getByText(/未经独立核验/)).toBeTruthy();
  fireEvent.click(screen.getByText("查看研究原文与来源"));
  expect(screen.getByText("合成原文").tagName).toBe("STRONG");
  expect(screen.getByRole("link", { name: "BEA" }).getAttribute("href")).toBe(
    "https://www.bea.gov/",
  );
  expect(
    screen.getByRole("link", { name: /在 Funda/ }).getAttribute("href"),
  ).toBe(report.source_url);
  view.rerender(<MarketResearchArchive household="" />);
  expect(screen.queryByText("合成原文")).toBeNull();
});
it("历史切换不重新付费或调用 Funda，失败明确显示并能重试", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(Error("offline"))
    .mockImplementation(async () =>
      Response.json({
        reports: [
          report,
          {
            ...report,
            id: "older",
            response: "更早的合成原文",
            captured_at: "2026-10-15T03:30:00Z",
            status: "partial",
          },
        ],
      }),
    );
  vi.stubGlobal("fetch", request);
  render(<MarketResearchArchive household="first" />);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("offline"),
  );
  fireEvent.click(screen.getByRole("button", { name: "刷新研究归档" }));
  await waitFor(() =>
    expect(screen.getByLabelText("选择外部研究归档")).toBeTruthy(),
  );
  fireEvent.change(screen.getByLabelText("选择外部研究归档"), {
    target: { value: "older" },
  });
  fireEvent.click(screen.getByText("查看研究原文与来源"));
  expect(screen.getByText("更早的合成原文")).toBeTruthy();
  expect(request).toHaveBeenCalledTimes(2);
});
