// @vitest-environment jsdom
import { vi, it, expect, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/cloud", () => ({ cloudClient: () => ({ auth: mocks }) }));
import ResetPassword from "../app/auth/reset-password/page";
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.clearAllMocks();
});
it("恢复链接验证后才能更新密码，拒绝不一致的密码，成功后退出登录", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: { email: "henrywhy233@gmail.com" } },
    error: null,
  });
  mocks.verifyOtp.mockResolvedValue({ error: null });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  window.history.replaceState(
    {},
    "",
    "/auth/reset-password?token_hash=fixture",
  );
  render(<ResetPassword />);
  await waitFor(() => expect(screen.getByLabelText("新密码")).toBeTruthy());
  expect(mocks.verifyOtp).toHaveBeenCalledWith({
    token_hash: "fixture",
    type: "recovery",
  });
  fireEvent.change(screen.getByLabelText("新密码"), {
    target: { value: "new-fixture-password" },
  });
  fireEvent.change(screen.getByLabelText("确认新密码"), {
    target: { value: "different-fixture" },
  });
  fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
  expect(screen.getByRole("alert").textContent).toContain("不一致");
  expect(mocks.updateUser).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("确认新密码"), {
    target: { value: "new-fixture-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
  await waitFor(() =>
    expect(screen.getByRole("heading").textContent).toBe("密码已更新"),
  );
  expect(mocks.updateUser).toHaveBeenCalledWith({
    password: "new-fixture-password",
  });
  expect(mocks.signOut).toHaveBeenCalled();
});
it("过期令牌和非授权身份不能更新密码", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: { email: "outsider@example.com" } },
    error: null,
  });
  render(<ResetPassword />);
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(screen.queryByRole("button", { name: "更新密码" })).toBeNull();
  expect(mocks.updateUser).not.toHaveBeenCalled();
});
