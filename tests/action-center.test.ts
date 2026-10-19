import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FEATURES } from "../lib/navigation";
import {
  actionDueState,
  actionSourceHref,
  actionToday,
  parseActionInput,
  parseActionPatch,
  sortActionItems,
  validActionDue,
  validActionItem,
  validActionItems,
  type ActionItem,
} from "../lib/action-center";

const id = "10000000-0000-4000-8000-000000000001";
const item = (patch: Partial<ActionItem> = {}): ActionItem => ({
  id,
  title: "一起核对账户",
  note: "",
  owner: "joint",
  status: "planned",
  due: "",
  visibility: "private",
  sourceFeature: "",
  sourceRef: "",
  version: 1,
  createdAt: "2026-10-19T12:00:00Z",
  updatedAt: "2026-10-19T12:00:00Z",
  ...patch,
});
describe("行动的独立数据与来源边界", () => {
  it("默认私有，不用负责人字段推导访问权限，文本清理不改变用户含义", () => {
    expect(
      parseActionInput({ title: "  一起核对  ", owner: "second" }),
    ).toEqual({
      title: "一起核对",
      note: "",
      owner: "second",
      status: "planned",
      due: "",
      visibility: "private",
      sourceFeature: "",
      sourceRef: "",
    });
    expect(
      parseActionInput({ title: "shared", visibility: "household" }).visibility,
    ).toBe("household");
  });
  it.each([
    {},
    { title: "  " },
    { title: "x".repeat(161) },
    { title: "ok", note: "x".repeat(2001) },
    { title: "bad\0" },
    { title: "\ud800" },
    { title: "ok", due: "2026-02-30" },
    { title: "ok", owner: "partner" },
    { title: "ok", status: "pending" },
    { title: "ok", visibility: "public" },
    { title: "ok", createdBy: "partner" },
    { title: "ok", sourceFeature: "https://evil.test" },
    { title: "ok", note: null },
  ])("拒绝坏格式、越界和身份注入 %j", (raw) =>
    expect(() => parseActionInput(raw)).toThrow(),
  );
  it("只接收固定功能和受限引用，不自动分享私有研讨", () => {
    expect(
      parseActionInput({
        title: "User-written title",
        sourceFeature: "council",
        sourceRef: id,
      }).sourceRef,
    ).toBe(id);
    expect(() =>
      parseActionInput({
        title: "User-written title",
        visibility: "household",
        sourceFeature: "council",
        sourceRef: id,
      }),
    ).toThrow();
    expect(
      parseActionInput({
        title: "我明确共享的行动",
        visibility: "household",
        sourceFeature: "council",
      }).sourceRef,
    ).toBe("");
    for (const ref of [
      "https://example.test/private",
      "?run=private",
      "private-run",
      "x/../../secret",
      "x@y.test",
    ])
      expect(() =>
        parseActionInput({
          title: "x",
          sourceFeature: "council",
          sourceRef: ref,
        }),
      ).toThrow();
    expect(
      parseActionInput({
        title: "x",
        sourceFeature: "quarterly-review",
        sourceRef: "2026-Q3",
      }).sourceRef,
    ).toBe("2026-Q3");
    expect(() =>
      parseActionInput({
        title: "x",
        sourceFeature: "quarterly-review",
        sourceRef: "2026-Q5",
      }),
    ).toThrow();
    expect(() => parseActionInput({ title: "x", sourceRef: id })).toThrow();
    expect(actionSourceHref({ sourceFeature: "markets" })).toBe("/markets");
    expect(actionSourceHref({ sourceFeature: "https://evil.test" })).toBeNull();
  });
  it("编辑仅允许五项业务字段，不允许升级共享或改写来源", () => {
    expect(
      parseActionPatch({ title: "  更新  ", due: "", status: "done" }),
    ).toEqual({ title: "更新", due: "", status: "done" });
    for (const patch of [
      {},
      { visibility: "household" },
      { sourceFeature: "council" },
      { sourceRef: id },
      { version: 2 },
      { owner: "unknown" },
    ])
      expect(() => parseActionPatch(patch)).toThrow();
  });
  it("读取确认拒绝泄漏字段、共享研讨引用、重复项及版本错误", () => {
    expect(validActionItem(item())).toBe(true);
    for (const patch of [
      { version: 0 },
      { version: 1.5 },
      { createdAt: "bad" },
      { visibility: "household", sourceFeature: "council", sourceRef: id },
      { createdBy: "person" },
    ])
      expect(validActionItem({ ...item(), ...patch })).toBe(false);
    expect(validActionItems([item(), item()])).toBe(false);
    expect(validActionItems([])).toBe(true);
    expect(validActionItems([item()])).toBe(true);
  });
  it("排序与到期按日期而非伪造时间，函数不修改输入", () => {
    const rows = [
      item({ status: "done", due: "2026-01-01" }),
      item({ id: "10000000-0000-4000-8000-000000000002" }),
      item({ id: "10000000-0000-4000-8000-000000000003", due: "2026-10-18" }),
    ];
    const copy = structuredClone(rows);
    expect(sortActionItems(rows).map((row) => row.id)).toEqual([
      rows[2].id,
      rows[1].id,
      rows[0].id,
    ]);
    expect(rows).toEqual(copy);
    expect(actionToday(new Date("2026-10-19T03:59:59Z"))).toBe("2026-10-18");
    expect(actionDueState(item({ due: "2026-10-18" }), "2026-10-19")).toBe(
      "overdue",
    );
    expect(actionDueState(item({ due: "2026-10-19" }), "2026-10-19")).toBe(
      "today",
    );
    expect(actionDueState(item(), "2026-10-19")).toBe("undated");
    expect(
      actionDueState(item({ status: "done", due: "2026-10-18" }), "2026-10-19"),
    ).toBe("done");
    expect(validActionDue("2024-02-29")).toBe(true);
    expect(validActionDue("2101-01-01")).toBe(false);
  });
  it("SQL只允许目录固定来源；版本、私有源引用与权限边界存在", () => {
    const sql = readFileSync("supabase/actions.sql", "utf8");
    for (const feature of FEATURES) expect(sql).toContain(`'${feature.id}'`);
    expect(sql).toContain("expected_version");
    expect(sql).toContain("item.created_by=auth.uid()");
    expect(sql).toContain("not(feature='council' and scope='household')");
    expect(sql).toContain("from public,anon,authenticated,service_role");
    expect(sql).not.toMatch(
      /(?:insert into|update) (?:public\.)?household_documents/i,
    );
  });
});
