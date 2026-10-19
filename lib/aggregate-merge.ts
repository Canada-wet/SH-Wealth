import { stableJSON } from "./cloud-plan";
import { validateState, type WealthState } from "./wealth";

// This is intentionally not a recursive JSON merge. Financial records and their
// dependent snapshots/plans must always be selected from the same document.
const GROUPS = {
  financial: {
    root: [
      "members",
      "assets",
      "debts",
      "contributions",
      "budget",
      "goal",
      "history",
      "legacyHistory",
      "plan",
    ],
    preferences: ["growthPlan", "portfolioLinks", "quarterlyReviews"],
  },
  chat: { root: ["messages", "chatCurrent", "chatArchives"], preferences: [] },
  lifestyle: { root: [], preferences: ["lifestyle"] },
  market: { root: [], preferences: ["marketWatchlist", "marketResearch"] },
  settings: {
    root: ["readAlerts"],
    preferences: [
      "model",
      "allocation",
      "months",
      "proactive",
      "webSearch",
      "searchTopic",
    ],
  },
} as const;

export type AggregateDomain = keyof typeof GROUPS;
export const AGGREGATE_LABELS: Record<AggregateDomain, string> = {
  financial: "资产与规划",
  chat: "顾问聊天",
  lifestyle: "兴趣生活",
  market: "市场研究",
  settings: "其他设置",
};
export type AggregateMerge =
  | {
      status: "merged";
      document: WealthState;
      localDomains: AggregateDomain[];
      remoteDomains: AggregateDomain[];
    }
  | {
      status: "conflict";
      domains: AggregateDomain[];
      reason: "overlap" | "unknown-fields" | "invalid-document";
    };

const names = Object.keys(GROUPS) as AggregateDomain[];
const rootKeys = new Set<string>([
  "version",
  "revision",
  "updatedAt",
  "preferences",
  ...names.flatMap((name) => [...GROUPS[name].root]),
]);
const preferenceKeys = new Set<string>(
  names.flatMap((name) => [...GROUPS[name].preferences]),
);
function knownFields(state: WealthState) {
  return (
    Object.keys(state).every((key) => rootKeys.has(key)) &&
    Object.keys(state.preferences).every((key) => preferenceKeys.has(key))
  );
}
function project(state: WealthState, domain: AggregateDomain) {
  const group = GROUPS[domain];
  return {
    root: Object.fromEntries(group.root.map((key) => [key, state[key]])),
    preferences: Object.fromEntries(
      group.preferences.map((key) => [key, state.preferences[key]]),
    ),
  };
}

/**
 * Three-way content merge only. The caller must supply a trusted, in-memory
 * acknowledged baseline and independently enforce household/user/CAS checks.
 * No revision, timestamp, financial snapshot or original input is mutated here.
 * Unknown root/preference fields fail closed until explicitly assigned a domain.
 */
export function mergeHouseholdAggregates(
  baseline: WealthState,
  local: WealthState,
  remote: WealthState,
): AggregateMerge {
  try {
    [baseline, local, remote].forEach(validateState);
    if (
      ![baseline, local, remote].every((state) =>
        Number.isSafeInteger(state.revision),
      )
    )
      return { status: "conflict", domains: [], reason: "invalid-document" };
    if (![baseline, local, remote].every(knownFields))
      return { status: "conflict", domains: [], reason: "unknown-fields" };
    const localDomains: AggregateDomain[] = [],
      remoteDomains: AggregateDomain[] = [];
    const overlap: AggregateDomain[] = [];
    const selected = new Map<AggregateDomain, WealthState>();
    for (const domain of names) {
      const base = stableJSON(project(baseline, domain));
      const a = stableJSON(project(local, domain));
      const b = stableJSON(project(remote, domain));
      if (a !== base) localDomains.push(domain);
      if (b !== base) remoteDomains.push(domain);
      if (a !== base && b !== base && a !== b) overlap.push(domain);
      selected.set(domain, a !== base ? local : remote);
    }
    if (overlap.length)
      return { status: "conflict", domains: overlap, reason: "overlap" };
    const combined = structuredClone(local);
    for (const domain of names) {
      const source = selected.get(domain)!;
      const group = GROUPS[domain];
      // Keep optional-field deletion, not just assignment of present fields.
      for (const key of group.root) {
        if (Object.prototype.hasOwnProperty.call(source, key))
          Object.assign(combined, { [key]: structuredClone(source[key]) });
        else Reflect.deleteProperty(combined, key);
      }
      for (const key of group.preferences) {
        if (Object.prototype.hasOwnProperty.call(source.preferences, key))
          Object.assign(combined.preferences, {
            [key]: structuredClone(source.preferences[key]),
          });
        else Reflect.deleteProperty(combined.preferences, key);
      }
    }
    validateState(combined);
    return {
      status: "merged",
      document: combined,
      localDomains,
      remoteDomains,
    };
  } catch {
    return { status: "conflict", domains: [], reason: "invalid-document" };
  }
}
