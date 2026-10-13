import {
  deleteAsset,
  deleteContribution,
  id,
  ownerId,
  saveAsset,
  saveContribution,
  validateState,
  type WealthState,
} from "./wealth";
export type AssistantAction =
  | {
      type: "add_asset";
      name: string;
      category: string;
      owner: string;
      value: number;
      annualReturn?: number | null;
    }
  | {
      type: "update_asset";
      assetId?: string;
      existingName: string;
      name?: string;
      category?: string;
      owner?: string;
      value?: number;
      annualReturn?: number | null;
    }
  | { type: "delete_asset"; name: string; assetId?: string }
  | { type: "add_debt"; name: string; owner: string; value: number }
  | { type: "update_debt"; existingName: string; value: number; owner?: string }
  | { type: "delete_debt"; name: string }
  | {
      type: "add_contribution";
      member: string;
      assetId?: string | null;
      amount: number;
      kind: "deposit" | "withdrawal";
      date: string;
      note?: string;
    }
  | { type: "delete_contribution"; contributionId: string }
  | {
      type: "add_cashflow";
      name: string;
      owner: string;
      amount: number;
      kind: "income" | "expense";
      essential: boolean;
    }
  | {
      type: "update_cashflow";
      existingName: string;
      amount: number;
      essential?: boolean;
    }
  | { type: "delete_cashflow"; name: string }
  | { type: "set_goal"; name?: string; target?: number; year?: string }
  | { type: "set_plan_field"; key: string; value: string };
export const PLAN_FIELDS = new Set(
  "income_a income_b location_status monthly_costs goals_horizon risk_experience legacy_notes joint_use split_method transfer_rule large_purchase credit_rule meeting_date hidden_obligations essential_monthly emergency_months emergency_location short_goals medium_goals long_goals ips_purpose ips_horizon ips_capacity ips_comfort ips_allocation ips_allowed ips_excluded ips_rebalance ips_decision home_insurance auto_insurance work_benefits life_disability beneficiaries property_plan marriage_contract will_poa".split(
    " ",
  ),
);
const nonnegative = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const text = (value: unknown) =>
  typeof value === "string" && Boolean(value.trim());
const optionalText = (value: unknown) => value === undefined || text(value);
export function validAction(raw: unknown): raw is AssistantAction {
  if (!raw || typeof raw !== "object") return false;
  const action = raw as Record<string, unknown>;
  const validReturn =
    action.annualReturn === undefined ||
    action.annualReturn === null ||
    (typeof action.annualReturn === "number" &&
      Number.isFinite(action.annualReturn));
  switch (action.type) {
    case "add_asset":
      return (
        text(action.name) &&
        text(action.category) &&
        text(action.owner) &&
        nonnegative(action.value) &&
        validReturn
      );
    case "update_asset":
      return (
        text(action.existingName) &&
        optionalText(action.assetId) &&
        optionalText(action.name) &&
        optionalText(action.category) &&
        optionalText(action.owner) &&
        (action.value === undefined || nonnegative(action.value)) &&
        validReturn &&
        [
          action.name,
          action.category,
          action.owner,
          action.value,
          action.annualReturn,
        ].some((value) => value !== undefined)
      );
    case "delete_asset":
      return text(action.name) && optionalText(action.assetId);
    case "add_debt":
      return (
        text(action.name) && text(action.owner) && nonnegative(action.value)
      );
    case "update_debt":
      return (
        text(action.existingName) &&
        nonnegative(action.value) &&
        optionalText(action.owner)
      );
    case "delete_debt":
      return text(action.name);
    case "add_contribution":
      return (
        text(action.member) &&
        nonnegative(action.amount) &&
        Number(action.amount) > 0 &&
        ["deposit", "withdrawal"].includes(String(action.kind)) &&
        typeof action.date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(action.date) &&
        (action.assetId === undefined ||
          action.assetId === null ||
          text(action.assetId)) &&
        (action.note === undefined || typeof action.note === "string")
      );
    case "delete_contribution":
      return text(action.contributionId);
    case "add_cashflow":
      return (
        text(action.name) &&
        text(action.owner) &&
        nonnegative(action.amount) &&
        ["income", "expense"].includes(String(action.kind)) &&
        typeof action.essential === "boolean"
      );
    case "update_cashflow":
      return (
        text(action.existingName) &&
        nonnegative(action.amount) &&
        (action.essential === undefined ||
          typeof action.essential === "boolean")
      );
    case "delete_cashflow":
      return text(action.name);
    case "set_goal":
      return (
        optionalText(action.name) &&
        (action.target === undefined || nonnegative(action.target)) &&
        (action.year === undefined ||
          (typeof action.year === "string" && /^\d{4}$/.test(action.year))) &&
        [action.name, action.target, action.year].some(
          (value) => value !== undefined,
        )
      );
    case "set_plan_field":
      return (
        typeof action.key === "string" &&
        PLAN_FIELDS.has(action.key) &&
        typeof action.value === "string"
      );
    default:
      return false;
  }
}
function findOne<T extends { id: string; name: string }>(
  rows: T[],
  name: string,
  rowId?: string,
): T {
  const found = rows.filter((row) =>
    rowId ? row.id === rowId : row.name.toLowerCase() === name.toLowerCase(),
  );
  if (found.length !== 1)
    throw new Error(
      found.length
        ? `「${name}」对应多个项目，请指明账户。`
        : `没有找到「${name}」。`,
    );
  return found[0];
}
export function applyAssistantActions(
  state: WealthState,
  actions: AssistantAction[],
): WealthState {
  let next = structuredClone(state);
  for (const action of actions) {
    if (!validAction(action)) throw new Error("顾问返回了无效的数据变更。");
    switch (action.type) {
      case "add_asset":
        next = saveAsset(next, {
          id: id(),
          name: action.name,
          category: action.category,
          owner: ownerId(action.owner, next.members),
          value: action.value,
          annualReturn: action.annualReturn ?? null,
        });
        break;
      case "update_asset": {
        const asset = findOne(next.assets, action.existingName, action.assetId);
        next = saveAsset(next, {
          ...asset,
          name: action.name ?? asset.name,
          category: action.category ?? asset.category,
          owner:
            action.owner === undefined
              ? asset.owner
              : ownerId(action.owner, next.members),
          value: action.value ?? asset.value,
          annualReturn:
            action.annualReturn === undefined
              ? asset.annualReturn
              : action.annualReturn,
        });
        break;
      }
      case "delete_asset":
        next = deleteAsset(
          next,
          findOne(next.assets, action.name, action.assetId).id,
        );
        break;
      case "add_debt":
        next.debts.push({
          id: id(),
          name: action.name,
          owner: ownerId(action.owner, next.members),
          value: action.value,
        });
        break;
      case "update_debt": {
        const debt = findOne(next.debts, action.existingName);
        debt.value = action.value;
        if (action.owner !== undefined)
          debt.owner = ownerId(action.owner, next.members);
        break;
      }
      case "delete_debt":
        next.debts = next.debts.filter(
          (row) => row.id !== findOne(next.debts, action.name).id,
        );
        break;
      case "add_contribution":
        next = saveContribution(next, {
          id: id(),
          member: ownerId(action.member, next.members),
          assetId: action.assetId ?? null,
          amount: action.amount,
          kind: action.kind,
          date: action.date,
          note: action.note ?? "",
        });
        break;
      case "delete_contribution":
        next = deleteContribution(next, action.contributionId);
        break;
      case "add_cashflow":
        next.budget = [
          ...(next.budget ?? []),
          {
            id: id(),
            name: action.name,
            owner: ownerId(action.owner, next.members),
            amount: action.amount,
            kind: action.kind,
            essential: action.essential,
          },
        ];
        break;
      case "update_cashflow": {
        const row = findOne(next.budget ?? [], action.existingName);
        row.amount = action.amount;
        if (action.essential !== undefined) row.essential = action.essential;
        break;
      }
      case "delete_cashflow": {
        const row = findOne(next.budget ?? [], action.name);
        next.budget = (next.budget ?? []).filter((item) => item.id !== row.id);
        break;
      }
      case "set_goal":
        next.goal = {
          ...next.goal,
          ...(action.name === undefined ? {} : { name: action.name }),
          ...(action.target === undefined ? {} : { target: action.target }),
          ...(action.year === undefined ? {} : { year: action.year }),
        };
        break;
      case "set_plan_field":
        if (
          next.budget?.length &&
          ["income_a", "income_b", "essential_monthly"].includes(action.key)
        )
          throw new Error("该金额由现金流表汇总，请修改对应的现金流项目。");
        next.plan.values[action.key] = action.value;
        break;
    }
  }
  validateState(next);
  return next;
}
export function parseAdvisorResult(raw: string, allowChanges = true) {
  try {
    const parsed = JSON.parse(
      raw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim(),
    ) as { answer?: string; actions?: unknown[] };
    if (typeof parsed.answer !== "string") throw new Error("missing answer");
    return {
      answer: parsed.answer,
      actions:
        allowChanges && Array.isArray(parsed.actions)
          ? parsed.actions.filter(validAction).slice(0, 10)
          : [],
    };
  } catch {
    return { answer: raw, actions: [] as AssistantAction[] };
  }
}
export function mutationRequested(message: string) {
  return (
    /(?:请|帮我|把|将|直接)?(?:添加|新增|删除|移除|修改|改为|改成|更新|记录|设为|设置|清空)|\b(?:add|delete|remove|update|set|change|record)\b/i.test(
      message,
    ) &&
    !/(如果|假设|例如|比如|是否|能否|如何|建议|应该|要不要|\bif\b|\bshould\b|\bexample\b)/i.test(
      message,
    )
  );
}
