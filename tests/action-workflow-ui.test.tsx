// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { emptyState } from "../lib/wealth";
const mocks = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));
vi.mock("../lib/useActionCenter", () => ({ default: () => mocks.store }));
import ActionCenter from "../app/components/ActionCenter";
import ActionCapture from "../app/components/ActionCapture";
const home = "00000000-0000-4000-8000-000000000001";
const item = {
  id: "00000000-0000-4000-8000-000000000002",
  title: "核对研究证据",
  note: "查阅发行人报告",
  owner: "joint",
  due: "2026-01-01",
  status: "planned",
  visibility: "private",
  sourceFeature: "council",
  sourceRef: "00000000-0000-4000-8000-000000000003",
  version: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
beforeEach(() => {
  mocks.store = {
    items: [item],
    loading: false,
    error: "",
    refresh: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(item),
    update: vi.fn().mockResolvedValue(item),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("隐私遮挡不呈现标题、说明或目标日；恢复显示才显示数据", () => {
  const { container, rerender } = render(
    <ActionCenter householdId={home} state={emptyState()} hidden />,
  );
  expect(container.textContent).not.toContain(item.title);
  expect(container.textContent).not.toContain(item.note);
  rerender(<ActionCenter householdId={home} state={emptyState()} />);
  expect(screen.getByRole("heading", { name: item.title })).toBeTruthy();
  expect(screen.getByText(item.note)).toBeTruthy();
  expect(
    screen.getByRole("link", { name: /来源：多模型研讨/ }).getAttribute("href"),
  ).toContain("?run=");
});
it("筛选完成、未完成和搜索；错误时不伪装零条，恢复按钮可用", () => {
  mocks.store.items = [
    item,
    {
      ...item,
      id: "00000000-0000-4000-8000-000000000004",
      title: "已做完的事",
      status: "done",
    },
  ];
  const { rerender } = render(
    <ActionCenter householdId={home} state={emptyState()} />,
  );
  expect(screen.queryByRole("heading", { name: "已做完的事" })).toBeNull();
  fireEvent.change(screen.getByLabelText("筛选行动进度"), {
    target: { value: "done" },
  });
  expect(screen.getByRole("heading", { name: "已做完的事" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("搜索行动"), {
    target: { value: "不存在" },
  });
  expect(screen.getByText("没有符合当前筛选的行动。")).toBeTruthy();
  mocks.store.error = "云端暂不可用";
  rerender(<ActionCenter householdId={home} state={emptyState()} />);
  expect(screen.getByRole("alert").textContent).toContain("云端暂不可用");
  fireEvent.click(screen.getByRole("button", { name: "重新读取行动" }));
  expect(mocks.store.refresh).toHaveBeenCalledOnce();
});
it("完成仅保存当前项及版本，删除先明确确认，不改账本", async () => {
  render(<ActionCenter householdId={home} state={emptyState()} />);
  fireEvent.click(
    screen.getByRole("button", { name: `完成行动：${item.title}` }),
  );
  await waitFor(() =>
    expect(mocks.store.update).toHaveBeenCalledWith(item, { status: "done" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: `删除行动：${item.title}` }),
    ).not.toHaveProperty("disabled", true),
  );
  (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);
  fireEvent.click(
    screen.getByRole("button", { name: `删除行动：${item.title}` }),
  );
  expect(mocks.store.remove).not.toHaveBeenCalled();
});
it("保存失败保留编辑草稿；不更改可见范围或来源", async () => {
  mocks.store.update = vi.fn().mockRejectedValue(Error("另一设备已修改"));
  render(<ActionCenter householdId={home} state={emptyState()} />);
  fireEvent.click(
    screen.getByRole("button", { name: `编辑行动：${item.title}` }),
  );
  fireEvent.change(screen.getByLabelText("行动标题"), {
    target: { value: "我的新草稿" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("另一设备已修改"),
  );
  expect((screen.getByLabelText("行动标题") as HTMLInputElement).value).toBe(
    "我的新草稿",
  );
  expect(mocks.store.update).toHaveBeenCalledWith(item, {
    title: "我的新草稿",
    note: item.note,
    owner: "joint",
    status: "planned",
    due: item.due,
  });
});
it("新建默认个人，不自动复制正文；共享需确认且剥离私人研讨引用", async () => {
  render(
    <ActionCapture
      householdId={home}
      sourceFeature="council"
      sourceRef={item.sourceRef}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "存为行动" }));
  expect((screen.getByLabelText("行动标题") as HTMLInputElement).value).toBe(
    "",
  );
  expect(
    (screen.getByRole("radio", { name: /仅自己/ }) as HTMLInputElement).checked,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("行动标题"), {
    target: { value: "我确认要分享的行动" },
  });
  fireEvent.click(screen.getByRole("radio", { name: /家庭共享/ }));
  (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "保存行动" }));
  expect(mocks.store.create).not.toHaveBeenCalled();
  (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "保存行动" }));
  await waitFor(() =>
    expect(mocks.store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "我确认要分享的行动",
        note: "",
        visibility: "household",
        sourceFeature: "council",
        sourceRef: "",
      }),
    ),
  );
  expect(screen.getByRole("status").textContent).toContain("已保存");
});
it("家庭或账号切换时关闭私人草稿，不把旧草稿带到新范围", () => {
  const { rerender } = render(<ActionCapture householdId={home} />);
  fireEvent.click(screen.getByRole("button", { name: "存为行动" }));
  fireEvent.change(screen.getByLabelText("行动标题"), {
    target: { value: "上一家庭的私人草稿" },
  });
  rerender(
    <ActionCapture householdId="00000000-0000-4000-8000-000000000009" />,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "存为行动" }));
  expect((screen.getByLabelText("行动标题") as HTMLInputElement).value).toBe(
    "",
  );
  fireEvent.change(screen.getByLabelText("行动标题"), {
    target: { value: "另一个账号的私人草稿" },
  });
  fireEvent(window, new Event("together-action-session-changed"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.store.create).not.toHaveBeenCalled();
});
