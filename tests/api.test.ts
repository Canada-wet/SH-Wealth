import { describe, it, expect, vi } from "vitest";
import { emptyState, saveAsset } from "../lib/wealth";
vi.mock("@/lib/ai/router", () => ({
  chooseRoute: vi.fn(() => ({
    provider: "local",
    model: "test",
    reason: "test",
    complexity: "simple",
  })),
  generateAdvice: vi.fn(),
}));
import { POST } from "../app/api/advisor/route";
import { chooseRoute, generateAdvice } from "../lib/ai/router";
const request = (body: unknown) =>
  new Request("http://localhost/api/advisor", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
describe("顾问API", () => {
  it("非法JSON和空问题返回400", async () => {
    expect(
      (
        await POST(
          new Request("http://localhost/api/advisor", {
            method: "POST",
            body: "broken",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(request({ message: "", state: emptyState() }))).status,
    ).toBe(400);
  });
  it("非法数据快照返回400", async () =>
    expect(
      (await POST(request({ message: "hi", state: { version: 3 } }))).status,
    ).toBe(400));
  it("本地助手端到端产生真实回报变更", async () => {
    const state = saveAsset(emptyState(), {
      id: "a",
      name: "储蓄",
      category: "现金",
      owner: "joint",
      value: 500,
      annualReturn: 3,
    });
    const response = await POST(
      request({ message: "把储蓄本年回报改为 -5%", state }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).actions[0].annualReturn).toBe(-5);
  });
  it("外部模型输出包含无效actions时被过滤，分析问题不允许任何写操作", async () => {
    vi.mocked(chooseRoute).mockReturnValueOnce({
      provider: "openai",
      model: "test",
      reason: "test",
      complexity: "simple",
    });
    vi.mocked(generateAdvice).mockResolvedValueOnce(
      '{"answer":"分析","actions":[{"type":"delete_asset","name":"储蓄"}]}',
    );
    const response = await POST(
      request({ message: "如果删除储蓄会怎样？", state: emptyState() }),
    );
    expect((await response.json()).actions).toEqual([]);
  });
  it("provider异常返回503且没有伪造成功", async () => {
    vi.mocked(chooseRoute).mockImplementationOnce(() => {
      throw new Error("provider failed");
    });
    const response = await POST(
      request({ message: "hi", state: emptyState() }),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("provider failed");
  });
});
