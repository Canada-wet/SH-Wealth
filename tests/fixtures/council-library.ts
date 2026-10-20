import {
  EMPTY_COUNCIL_MEMO,
  type CouncilLibraryItem,
} from "../../lib/council-library";
export function libraryItem(
  overrides: Partial<CouncilLibraryItem> = {},
): CouncilLibraryItem {
  return {
    id: "a3000000-0000-4000-8000-000000000001",
    question: "合成问题：如何验证职业选择",
    status: "complete",
    createdAt: "2026-10-19T15:00:00Z",
    activityAt: "2026-10-19T16:00:00Z",
    rounds: 1,
    models: ["Synthetic Model A", "Synthetic Model B"],
    excerpt: "先做小规模验证",
    matchExcerpt: "",
    matchRound: null,
    matchSeq: null,
    matched: true,
    memo: structuredClone(EMPTY_COUNCIL_MEMO),
    ...overrides,
  };
}
