import { expect, it } from "vitest";
import {
  councilSearch,
  parseCouncilMemo,
  selectCouncilLibrary,
  validCouncilLibraryItems,
  EMPTY_COUNCIL_MEMO,
  councilMemoExport,
  COUNCIL_DEEPEN,
} from "../lib/council-library";
import { libraryItem } from "./fixtures/council-library";
it("规范搜索支持中英文多词，原样字符不是正则或SQL通配；有界请求", () => {
  expect(councilSearch("  职业   Cost\n风险 ")).toBe("职业 Cost 风险");
  expect(councilSearch("% _ [*] ")).toBe("% _ [*]");
  for (const x of [null, {}, "a".repeat(121), "a b c d e f g h i", "a\0b"])
    expect(() => councilSearch(x)).toThrow();
});
it.each([
  { title: "x".repeat(121) },
  { note: "a".repeat(2401) },
  { reviewOn: "2026-02-30" },
  { reviewOn: "2101-01-01" },
  { tags: ["a", "A"] },
  { tags: ["a\tb"] },
  { tags: Array(7).fill("x") },
  { pinned: 1 },
  { version: -1 },
  { version: 1.5 },
  { userId: "forged" },
])("无效整理信息拒绝 %j", (patch) => {
  expect(() => parseCouncilMemo({ ...EMPTY_COUNCIL_MEMO, ...patch })).toThrow();
});
it("空白、零版本和闰日有效，深拷贝标签并用固定顺序核验ACK", () => {
  const x = { ...EMPTY_COUNCIL_MEMO, tags: ["工作"], reviewOn: "2028-02-29" };
  const saved = parseCouncilMemo(
    Object.fromEntries(Object.entries(x).reverse()),
  );
  expect(JSON.stringify(saved)).toBe(JSON.stringify(x));
  saved.tags.push("试验");
  expect(x.tags).toEqual(["工作"]);
});
it("列表格式拒绝坏类型、重复id、隐藏异常状态和过多记录", () => {
  expect(validCouncilLibraryItems([libraryItem()])).toBe(true);
  for (const rows of [
    [libraryItem(), libraryItem()],
    [libraryItem({ status: "toString" as never })],
    [libraryItem({ matchSeq: 279 })],
    [libraryItem({ memo: { ...EMPTY_COUNCIL_MEMO, version: Infinity } })],
    null,
  ])
    expect(validCouncilLibraryItems(rows)).toBe(false);
});
it("置顶优先，最近讨论排序，归档/到期/状态/模型/查询组合均可逆且不修改输入", () => {
  const recent = libraryItem(),
    pinned = libraryItem({
      id: "a3000000-0000-4000-8000-000000000002",
      activityAt: "2026-09-10",
      memo: { ...EMPTY_COUNCIL_MEMO, pinned: true, reviewOn: "2026-10-19" },
    }),
    archived = libraryItem({
      id: "a3000000-0000-4000-8000-000000000003",
      memo: { ...EMPTY_COUNCIL_MEMO, archived: true },
    });
  const list = [recent, pinned, archived],
    before = JSON.stringify(list),
    spec = {
      scope: "inbox" as const,
      status: "all",
      model: "",
      sort: "recent" as const,
      today: "2026-10-20",
    };
  expect(selectCouncilLibrary(list, spec).map((x) => x.id)).toEqual([
    pinned.id,
    recent.id,
  ]);
  expect(selectCouncilLibrary(list, { ...spec, scope: "archive" })).toEqual([
    archived,
  ]);
  expect(selectCouncilLibrary(list, { ...spec, scope: "review" })).toEqual([
    pinned,
  ]);
  expect(selectCouncilLibrary(list, { ...spec, status: "paused" })).toEqual([]);
  expect(
    selectCouncilLibrary(list, { ...spec, model: "Not selected" }),
  ).toEqual([]);
  expect(selectCouncilLibrary([libraryItem({ matched: false })], spec)).toEqual(
    [],
  );
  expect(JSON.stringify(list)).toBe(before);
});
it("私人笔记导出与模型结论明确分开，深挖只提供固定草稿", () => {
  expect(councilMemoExport()).toBe("");
  expect(
    councilMemoExport({
      ...EMPTY_COUNCIL_MEMO,
      version: 1,
      note: "先验证再决定",
    }),
  ).toContain("不是模型结论");
  expect(COUNCIL_DEEPEN).toHaveLength(3);
  expect(COUNCIL_DEEPEN.every((x) => x.text.length < 4000)).toBe(true);
});
