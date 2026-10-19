// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { allowedEmail, safeReturnPath } from "../lib/access";
import AdvisorMarkdown from "../app/components/AdvisorMarkdown";
afterEach(cleanup);
describe("私密账号白名单", () => {
  it("仅精确匹配两个邮箱，忽略大小写，不接受伪造域名", () => {
    expect(allowedEmail(" HENRYWHY233@gmail.com ")).toBe(true);
    expect(allowedEmail("sallyxie0378@gmail.com")).toBe(true);
    for (const email of [
      null,
      "other@gmail.com",
      "henrywhy233@gmail.com.evil",
      "sallyxie0378+other@gmail.com",
      "",
    ])
      expect(allowedEmail(email)).toBe(false);
  });
  it("回跳地址不能指向外部站点或循环登录", () => {
    for (const path of [
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "/\n/evil.test",
      "/login",
      "/auth/reset-password",
      null,
    ])
      expect(safeReturnPath(path)).toBe("/space");
    expect(safeReturnPath("/#assets")).toBe("/#assets");
    expect(safeReturnPath("/")).toBe("/");
    expect(safeReturnPath("/?section=assets")).toBe("/?section=assets");
  });
});
describe("顾问可读回复", () => {
  it("旧回复的多余粗体空格被修复，段落、列表和数字语义渲染", () => {
    const { container } = render(
      <AdvisorMarkdown
        text={
          "结论：家庭财务稳健。\n\n### 资产与净值\n\n- **净资产： ** **$992,410**\n- 月结余充足\n\n下一步：复盘预算。"
        }
      />,
    );
    expect(screen.getByRole("heading", { name: "资产与净值" })).toBeTruthy();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("净资产：");
    expect(container.textContent).not.toContain("**");
  });
  it("支持表格，禁用原始HTML和危险链接", () => {
    const { container } = render(
      <AdvisorMarkdown
        text={
          "| 项目 | 金额 |\n| --- | --- |\n| 现金 | 500 |\n\n<script>alert(1)</script>\n\n[坏链接](javascript:alert%281%29)"
        }
      />,
    );
    expect(container.querySelectorAll("table")).toHaveLength(1);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});
