import {
  emptyState,
  id,
  ownerId,
  validateState,
  type Asset,
  type WealthState,
} from "./wealth";
export const STATE_KEY = "together-wealth-v3";
export const BACKUP_KEY = "together-wealth-backup-v3";
export const MIGRATION_KEY = "together-wealth-before-cloud-v3";
export type StorageLike = Pick<Storage, "getItem" | "setItem">;
export function readState(storage: StorageLike): WealthState {
  const saved = storage.getItem(STATE_KEY);
  if (saved !== null) {
    const state: unknown = JSON.parse(saved);
    validateState(state);
    return state;
  }
  const state = emptyState();
  const names = storage.getItem("together-member-names");
  if (names) state.members = JSON.parse(names);
  const rawAssets =
    storage.getItem("together-assets") ?? storage.getItem("together-assets-v2");
  const value = (input: string | number) =>
    typeof input === "number" ? input : Number(input.replace(/[$,]/g, ""));
  const migrate = (row: unknown, index: number): Asset => {
    if (Array.isArray(row))
      return {
        id: `legacy-${index}`,
        name: row[0],
        owner: ownerId(row[1], state.members),
        value: value(row[2]),
        annualReturn:
          row[3] === "—" || !row[3]
            ? null
            : Number(row[3].replace(/[%+]/g, "")),
        category: row[4] || "其他",
      };
    const asset = row as Asset;
    return {
      ...asset,
      id: asset.id || `legacy-${index}`,
      owner: ownerId(asset.owner, state.members),
      annualReturn: asset.annualReturn ?? null,
      category: asset.category || "其他",
    };
  };
  if (rawAssets)
    state.assets = (JSON.parse(rawAssets) as unknown[]).map(migrate);
  else {
    const custom = storage.getItem("together-custom-assets");
    if (custom) state.assets = (JSON.parse(custom) as unknown[]).map(migrate);
  }
  const debts = storage.getItem("together-debts");
  if (debts)
    state.debts = (JSON.parse(debts) as string[][]).map((row, index) => ({
      id: `debt-${index}`,
      name: row[0],
      owner: ownerId(row[1], state.members),
      value: value(row[2]),
    }));
  const goal = storage.getItem("together-goal");
  if (goal) state.goal = JSON.parse(goal);
  const oldPlan = storage.getItem("together-plan");
  if (!goal && oldPlan) {
    const plan = JSON.parse(oldPlan);
    state.goal.target = plan.target;
    state.goal.year = String(plan.year);
  }
  const framework = storage.getItem("together-financial-framework");
  if (framework) {
    const parsed = JSON.parse(framework);
    state.plan = { values: parsed.values ?? {}, checks: parsed.checks ?? {} };
  }
  const history = storage.getItem("together-snapshots");
  if (history)
    state.history = (
      JSON.parse(history) as { at: string; total: number }[]
    ).map((row) => ({
      id: id(),
      at: row.at,
      reason: "旧版净资产快照",
      totalAssets: row.total,
      totalDebts: 0,
      netWorth: row.total,
      assets: [],
      debts: [],
      contributions: [],
    }));
  const legacyHistory = storage.getItem("together-asset-history");
  if (legacyHistory) state.legacyHistory = JSON.parse(legacyHistory);
  // Legacy month-only labels cannot identify a date reliably; retain their raw
  // data under the original key instead of assigning an invented timestamp.
  validateState(state);
  return state;
}
export function writeState(
  storage: StorageLike,
  state: WealthState,
  expectedRevision?: number,
) {
  validateState(state);
  const previous = storage.getItem(STATE_KEY);
  if (
    previous &&
    expectedRevision !== undefined &&
    (JSON.parse(previous) as WealthState).revision !== expectedRevision
  )
    throw new Error("另一个页面已更新家庭数据，请刷新后重试。");
  const encoded = JSON.stringify(state);
  // Main document first: a failed write must never be reported as saved.
  storage.setItem(STATE_KEY, encoded);
  if (previous) {
    try {
      const old: unknown = JSON.parse(previous);
      validateState(old);
      storage.setItem(BACKUP_KEY, previous);
    } catch {
      /* never replace a valid recovery copy with corrupt data */
    }
  }
}
export function parseBackup(text: string) {
  const raw: unknown = JSON.parse(text);
  validateState(raw);
  return raw;
}
