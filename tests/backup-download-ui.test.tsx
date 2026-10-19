// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import BackupBundle from "../app/components/BackupBundle";
beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn().mockReturnValue("blob:test"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("导出需确认，拒绝后没有请求", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);
  render(<BackupBundle householdId="synthetic-home" userId="synthetic-user" />);
  fireEvent.click(screen.getByRole("button", { name: "导出跨模块数据包" }));
  expect(fetcher).not.toHaveBeenCalled();
});
it("只读云端导出明确标注partial，不把包称为完整恢复点", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          kind: "together-user-visible-export",
          schemaVersion: 1,
          status: "partial",
          scope: { householdId: "synthetic-home", userId: "synthetic-user" },
        }),
      ),
    ),
  );
  render(<BackupBundle householdId="synthetic-home" userId="synthetic-user" />);
  fireEvent.click(screen.getByRole("button", { name: "导出跨模块数据包" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "已下载部分数据包",
    ),
  );
  expect(fetch).toHaveBeenCalledWith(
    "/api/backup",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ householdId: "synthetic-home", confirm: true }),
    }),
  );
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
});
it("401或无效响应不下载、不显示成功，失败后可重试", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "请重新登录" }), { status: 401 }),
      ),
  );
  render(<BackupBundle householdId="synthetic-home" userId="synthetic-user" />);
  fireEvent.click(screen.getByRole("button", { name: "导出跨模块数据包" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("请重新登录"),
  );
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  expect(
    (
      screen.getByRole("button", {
        name: "导出跨模块数据包",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});
it("账号或家庭范围不匹配的响应不下载", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            kind: "together-user-visible-export",
            schemaVersion: 1,
            status: "complete",
            scope: { householdId: "another-home", userId: "another-user" },
          }),
        ),
      ),
  );
  render(<BackupBundle householdId="synthetic-home" userId="synthetic-user" />);
  fireEvent.click(screen.getByRole("button", { name: "导出跨模块数据包" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("账号或家庭范围"),
  );
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});
it("组件卸载后即使旧响应晚到，也不会下载", async () => {
  let resolve!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
  );
  const { unmount } = render(
    <BackupBundle householdId="synthetic-home" userId="synthetic-user" />,
  );
  fireEvent.click(screen.getByRole("button", { name: "导出跨模块数据包" }));
  unmount();
  resolve(
    new Response(
      JSON.stringify({
        kind: "together-user-visible-export",
        schemaVersion: 1,
        status: "complete",
        scope: { householdId: "synthetic-home", userId: "synthetic-user" },
      }),
    ),
  );
  await new Promise((done) => setTimeout(done, 10));
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});
