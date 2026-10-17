import { emptyState, type WealthState } from "./wealth";
export function stableJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJSON((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function hasFinancialData(state: WealthState) {
  const empty = emptyState();
  return !!(
    state.assets.length ||
    state.debts.length ||
    state.contributions.length ||
    state.budget?.length ||
    state.history.length ||
    state.legacyHistory?.length ||
    Object.keys(state.plan.values).length ||
    Object.keys(state.plan.checks).length ||
    stableJSON(state.members) !== stableJSON(empty.members) ||
    stableJSON(state.goal) !== stableJSON(empty.goal)
  );
}
export function hasSavedData(state: WealthState) {
  return (
    hasFinancialData(state) ||
    state.preferences.marketWatchlist !== undefined ||
    state.preferences.marketResearch !== undefined ||
    state.preferences.growthPlan !== undefined ||
    state.preferences.portfolioLinks !== undefined ||
    state.preferences.quarterlyReviews !== undefined ||
    state.preferences.lifestyle !== undefined ||
    !!state.messages.length ||
    !!state.chatArchives?.length
  );
}
export function sameData(a: WealthState, b: WealthState) {
  const content = (state: WealthState) => ({
    ...state,
    revision: 0,
    updatedAt: "",
    chatArchives: state.chatArchives ?? [],
  });
  return stableJSON(content(a)) === stableJSON(content(b));
}
export function connectionPlan(
  local: WealthState,
  cloud: WealthState | null,
): "load" | "upload" | "merge-chat" | "choice" {
  if (!cloud || !hasSavedData(cloud))
    return hasSavedData(local) ? "upload" : "load";
  if (sameData(local, cloud) || !hasSavedData(local)) return "load";
  if (
    !hasFinancialData(local) &&
    local.preferences.marketWatchlist === undefined &&
    local.preferences.marketResearch === undefined &&
    local.preferences.growthPlan === undefined &&
    local.preferences.portfolioLinks === undefined &&
    local.preferences.quarterlyReviews === undefined &&
    local.preferences.lifestyle === undefined
  )
    return "merge-chat";
  return "choice";
}
