import { validCouncilId, type CouncilRun } from "./council";
export type CouncilMemo = {
  title: string;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  note: string;
  reviewOn: string;
  version: number;
};
export type CouncilLibraryItem = {
  id: string;
  question: string;
  status: CouncilRun["status"];
  createdAt: string;
  activityAt: string;
  rounds: number;
  models: string[];
  excerpt: string;
  matchExcerpt: string;
  matchRound: number | null;
  matchSeq: number | null;
  matched: boolean;
  memo: CouncilMemo;
};
export const EMPTY_COUNCIL_MEMO: CouncilMemo = {
  title: "",
  tags: [],
  pinned: false,
  archived: false,
  note: "",
  reviewOn: "",
  version: 0,
};
export const COUNCIL_STATUS = {
  active: "待继续",
  paused: "已暂停",
  complete: "已结束",
  cancelled: "已停止",
};
export type LibraryScope = "inbox" | "pinned" | "review" | "archive";
export type LibrarySort = "recent" | "oldest" | "title";
const safeText = (v: unknown, max: number): v is string =>
  typeof v === "string" &&
  v.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
// PostgreSQL left(text,400) counts Unicode code points, not UTF-16 units.
const safeExcerpt = (v: unknown) =>
  safeText(v, 800) && Array.from(v).length <= 400;
export function councilSearch(value: unknown) {
  if (!safeText(value, 120)) throw Error("搜索最多 120 字。");
  const query = value.trim().replace(/\s+/g, " ");
  if (query.split(" ").length > 8) throw Error("最多组合 8 个搜索关键词。");
  return query;
}
export function parseCouncilMemo(value: unknown): CouncilMemo {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("整理信息无效。");
  const v = value as CouncilMemo;
  if (
    Object.keys(v).sort().join() !==
      Object.keys(EMPTY_COUNCIL_MEMO).sort().join() ||
    !safeText(v.title, 120) ||
    v.title !== v.title.trim() ||
    !safeText(v.note, 2400) ||
    v.note !== v.note.trim() ||
    typeof v.pinned !== "boolean" ||
    typeof v.archived !== "boolean" ||
    !Number.isSafeInteger(v.version) ||
    v.version < 0 ||
    !Array.isArray(v.tags) ||
    v.tags.length > 6 ||
    v.tags.some(
      (t) =>
        !safeText(t, 24) ||
        !t.trim() ||
        t !== t.trim() ||
        /[,，\u0000-\u001f\u007f]/.test(t),
    ) ||
    new Set(v.tags.map((t) => t.toLocaleLowerCase())).size !== v.tags.length ||
    typeof v.reviewOn !== "string" ||
    (v.reviewOn !== "" &&
      (!/^(20\d{2}|2100)-\d{2}-\d{2}$/.test(v.reviewOn) ||
        !Number.isFinite(Date.parse(v.reviewOn)) ||
        new Date(v.reviewOn).toISOString().slice(0, 10) !== v.reviewOn))
  )
    throw Error(
      "请检查标题、标签、复核日期和笔记；最多 6 个标签，笔记 2,400 字。",
    );
  return {
    title: v.title,
    tags: [...v.tags],
    pinned: v.pinned,
    archived: v.archived,
    note: v.note,
    reviewOn: v.reviewOn,
    version: v.version,
  };
}
export function validCouncilLibraryItems(
  value: unknown,
): value is CouncilLibraryItem[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    new Set(value.map((x) => x?.id)).size === value.length &&
    value.every((x) => {
      try {
        return (
          validCouncilId(x.id) &&
          safeText(x.question, 6000) &&
          Object.hasOwn(COUNCIL_STATUS, x.status) &&
          typeof x.createdAt === "string" &&
          Number.isFinite(Date.parse(x.createdAt)) &&
          typeof x.activityAt === "string" &&
          Number.isFinite(Date.parse(x.activityAt)) &&
          Number.isInteger(x.rounds) &&
          x.rounds >= 0 &&
          x.rounds <= 8 &&
          Array.isArray(x.models) &&
          x.models.length <= 7 &&
          x.models.every((m: unknown) => safeText(m, 120)) &&
          safeExcerpt(x.excerpt) &&
          safeExcerpt(x.matchExcerpt) &&
          typeof x.matched === "boolean" &&
          (x.matchRound === null ||
            (Number.isInteger(x.matchRound) &&
              x.matchRound >= 0 &&
              x.matchRound <= 8)) &&
          (x.matchSeq === null ||
            (Number.isInteger(x.matchSeq) &&
              x.matchSeq >= 0 &&
              x.matchSeq < 279)) &&
          !!parseCouncilMemo(x.memo)
        );
      } catch {
        return false;
      }
    })
  );
}
export function selectCouncilLibrary(
  items: CouncilLibraryItem[],
  spec: {
    scope: LibraryScope;
    status: string;
    model: string;
    sort: LibrarySort;
    today: string;
  },
) {
  return items
    .filter(
      (x) =>
        x.matched &&
        (spec.scope === "archive" ? x.memo.archived : !x.memo.archived) &&
        (spec.scope !== "pinned" || x.memo.pinned) &&
        (spec.scope !== "review" ||
          (!!x.memo.reviewOn && x.memo.reviewOn <= spec.today)) &&
        (spec.status === "all" || x.status === spec.status) &&
        (!spec.model || x.models.includes(spec.model)),
    )
    .sort(
      (a, b) =>
        Number(b.memo.pinned) - Number(a.memo.pinned) ||
        (spec.sort === "title"
          ? (a.memo.title || a.question).localeCompare(
              b.memo.title || b.question,
              "zh-CN",
            )
          : spec.sort === "oldest"
            ? a.activityAt.localeCompare(b.activityAt)
            : b.activityAt.localeCompare(a.activityAt)) ||
        a.id.localeCompare(b.id),
    );
}
export function legacyCouncilItem(
  x: Pick<CouncilRun, "id" | "question" | "status" | "created_at">,
): CouncilLibraryItem {
  return {
    id: x.id,
    question: x.question,
    status: x.status,
    createdAt: x.created_at,
    activityAt: x.created_at,
    rounds: 0,
    models: [],
    excerpt: "",
    matchExcerpt: "",
    matchRound: null,
    matchSeq: null,
    matched: true,
    memo: structuredClone(EMPTY_COUNCIL_MEMO),
  };
}
export const COUNCIL_DEEPEN = [
  {
    label: "检验关键假设",
    text: "请围绕本轮结论，逐一列出最关键的三个假设、现有证据和证据缺口；相互质询哪一个假设最脆弱，以及什么可观察结果会改变判断。不要把模型间的一致意见当作证据。",
  },
  {
    label: "寻找最强反例",
    text: "请为本轮主要结论寻找最强反例与替代解释，先用最有说服力的方式表述它们，再相互质询；最后说明哪些分歧仍未解决、各自适用的边界是什么。",
  },
  {
    label: "设计小规模验证",
    text: "请基于本轮分歧设计一个低成本、可逆的小规模验证方案：步骤、所需信息、时间窗口、成功与停止条件；相互比较机会成本，不自动执行任何操作。",
  },
] as const;
export function councilMemoExport(memo?: CouncilMemo) {
  if (!memo || !memo.version) return "";
  return `\n\n---\n\n## 我的私人整理（不是模型结论）\n\n标题：${memo.title || "沿用原问题"}\n\n标签：${memo.tags.join("、") || "无"}\n\n复核日期：${memo.reviewOn || "未设置"}\n\n${memo.note || "未填写笔记"}\n`;
}
