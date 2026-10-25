import { torontoDay } from "./market-briefing";
import type { WealthState } from "./wealth";

// This release pauses automatic rotation by default, including existing households.
// A fixed date, rather than "today", keeps the card frozen across visits.
export const LEARNING_PAUSED_DAY = "2026-10-25";
export type LearningSchedule = {
  version: 1;
  enabled: boolean;
  pausedDay: string;
};
export const DEFAULT_LEARNING_SCHEDULE: LearningSchedule = {
  version: 1,
  enabled: false,
  pausedDay: LEARNING_PAUSED_DAY,
};
const date = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v &&
  v >= "2026-10-15";
export function validLearningSchedule(raw: unknown): raw is LearningSchedule {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const p = raw as LearningSchedule;
  return p.version === 1 && typeof p.enabled === "boolean" && date(p.pausedDay);
}
export function learningDisplayDay(
  schedule: LearningSchedule | undefined,
  today = torontoDay(),
) {
  const p = validLearningSchedule(schedule)
    ? schedule
    : DEFAULT_LEARNING_SCHEDULE;
  return p.enabled ? today : p.pausedDay < today ? p.pausedDay : today;
}
export function learningUpdatesEnabled(raw: unknown) {
  return validLearningSchedule(raw) && raw.enabled;
}
export function changeLearningSchedule(
  state: WealthState,
  enabled: boolean,
  expected: string | undefined,
  now = new Date(),
): WealthState {
  if (JSON.stringify(state.preferences.learningSchedule) !== expected)
    throw Error("另一位成员已调整卡片更新设置，请重新核对后再操作。");
  return {
    ...state,
    preferences: {
      ...state.preferences,
      learningSchedule: {
        version: 1,
        enabled,
        pausedDay: torontoDay(now),
      },
    },
  };
}
