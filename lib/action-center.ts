import { featureById } from "./navigation";

export const ACTION_STATUSES = ["planned", "doing", "done"] as const;
export const ACTION_OWNERS = ["first", "second", "joint"] as const;
export const ACTION_VISIBILITIES = ["private", "household"] as const;
export const ACTION_TITLE_MAX = 160;
export const ACTION_NOTE_MAX = 2000;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export type ActionOwner = (typeof ACTION_OWNERS)[number];
export type ActionVisibility = (typeof ACTION_VISIBILITIES)[number];
export type ActionItem = {
  id: string;
  title: string;
  note: string;
  owner: ActionOwner;
  status: ActionStatus;
  due: string;
  visibility: ActionVisibility;
  sourceFeature: string;
  sourceRef: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type CreateActionInput = {
  title: string;
  note?: string;
  owner?: ActionOwner;
  status?: ActionStatus;
  due?: string;
  visibility?: ActionVisibility;
  sourceFeature?: string;
  sourceRef?: string;
};
export type ActionPatch = Partial<
  Pick<ActionItem, "title" | "note" | "owner" | "status" | "due">
>;
export const validActionId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const safeText = (
  value: unknown,
  max: number,
  required = false,
): value is string =>
  typeof value === "string" &&
  value.length <= max &&
  (!required || !!value.trim()) &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) &&
  value.isWellFormed();
export function validActionDue(value: unknown): value is string {
  return (
    value === "" ||
    (typeof value === "string" &&
      /^(?:20\d{2}|2100)-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value)
  );
}
export function validActionSource(
  feature: unknown,
  ref: unknown,
  visibility: unknown,
): boolean {
  if (
    typeof feature !== "string" ||
    (feature !== "" && !featureById(feature)) ||
    typeof ref !== "string"
  )
    return false;
  if (!ref) return true;
  if (!feature || (feature === "council" && visibility !== "private"))
    return false;
  return feature === "quarterly-review"
    ? /^(?:20\d{2}|2100)-Q[1-4]$/.test(ref)
    : validActionId(ref);
}
export function parseActionInput(raw: unknown): Required<CreateActionInput> {
  if (
    !object(raw) ||
    Object.values(raw).some((value) => value === null) ||
    Object.keys(raw).some(
      (key) =>
        ![
          "title",
          "note",
          "owner",
          "status",
          "due",
          "visibility",
          "sourceFeature",
          "sourceRef",
        ].includes(key),
    )
  )
    throw Error("行动格式无效。");
  const value = {
    title: raw.title,
    note: raw.note ?? "",
    owner: raw.owner ?? "joint",
    status: raw.status ?? "planned",
    due: raw.due ?? "",
    visibility: raw.visibility ?? "private",
    sourceFeature: raw.sourceFeature ?? "",
    sourceRef: raw.sourceRef ?? "",
  };
  if (
    !safeText(value.title, ACTION_TITLE_MAX, true) ||
    !safeText(value.note, ACTION_NOTE_MAX) ||
    !ACTION_OWNERS.includes(value.owner as ActionOwner) ||
    !ACTION_STATUSES.includes(value.status as ActionStatus) ||
    !ACTION_VISIBILITIES.includes(value.visibility as ActionVisibility) ||
    !validActionDue(value.due) ||
    !validActionSource(value.sourceFeature, value.sourceRef, value.visibility)
  )
    throw Error(
      "请检查行动标题、日期、可见范围和来源；共享研讨不能携带私人引用。",
    );
  return {
    ...value,
    title: value.title.trim(),
    note: value.note.trim(),
  } as Required<CreateActionInput>;
}
export function parseActionPatch(raw: unknown): ActionPatch {
  if (
    !object(raw) ||
    !Object.keys(raw).length ||
    Object.keys(raw).some(
      (key) => !["title", "note", "owner", "status", "due"].includes(key),
    )
  )
    throw Error(
      "只能编辑标题、备注、负责人、进度与日期；可见范围和来源创建后不能更改。",
    );
  const parsed = parseActionInput({ title: "validate", ...raw });
  return Object.fromEntries(
    Object.keys(raw).map((key) => [key, parsed[key as keyof typeof parsed]]),
  ) as ActionPatch;
}
export function validActionItem(raw: unknown): raw is ActionItem {
  if (
    !object(raw) ||
    !validActionId(raw.id) ||
    !Number.isSafeInteger(raw.version) ||
    Number(raw.version) < 1 ||
    ![raw.createdAt, raw.updatedAt].every(
      (value) =>
        typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}T/.test(value) &&
        Number.isFinite(Date.parse(value)),
    )
  )
    return false;
  const keys = [
    "id",
    "title",
    "note",
    "owner",
    "status",
    "due",
    "visibility",
    "sourceFeature",
    "sourceRef",
    "version",
    "createdAt",
    "updatedAt",
  ];
  if (
    Object.keys(raw).some((key) => !keys.includes(key)) ||
    keys.some((key) => !(key in raw))
  )
    return false;
  try {
    const parsed = parseActionInput(
      Object.fromEntries(
        keys
          .filter(
            (key) => !["id", "version", "createdAt", "updatedAt"].includes(key),
          )
          .map((key) => [key, raw[key]]),
      ),
    );
    return parsed.title === raw.title && parsed.note === raw.note;
  } catch {
    return false;
  }
}
export function validActionItems(raw: unknown): raw is ActionItem[] {
  return (
    Array.isArray(raw) &&
    raw.length <= 1000 &&
    raw.every(validActionItem) &&
    new Set(raw.map((item) => item.id)).size === raw.length
  );
}
export function actionSourceHref(
  item: Pick<ActionItem, "sourceFeature">,
): string | null {
  return featureById(item.sourceFeature)?.href ?? null;
}
export function actionToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function actionDueState(
  item: Pick<ActionItem, "status" | "due">,
  today = actionToday(),
): "done" | "overdue" | "today" | "later" | "undated" {
  if (item.status === "done") return "done";
  if (!item.due) return "undated";
  return item.due < today ? "overdue" : item.due === today ? "today" : "later";
}
export function sortActionItems(items: ActionItem[]): ActionItem[] {
  return [...items].sort(
    (a, b) =>
      Number(a.status === "done") - Number(b.status === "done") ||
      (a.due || "9999-12-31").localeCompare(b.due || "9999-12-31") ||
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
      a.id.localeCompare(b.id),
  );
}
