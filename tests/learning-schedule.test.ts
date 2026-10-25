import { it, expect } from "vitest";
import { emptyState, validateState, finishChange } from "../lib/wealth";
import {
  learningDisplayDay,
  learningUpdatesEnabled,
  changeLearningSchedule,
  validLearningSchedule,
  DEFAULT_LEARNING_SCHEDULE,
} from "../lib/learning-schedule";
import { connectionPlan, hasSavedData } from "../lib/cloud-plan";
import { mergeHouseholdAggregates } from "../lib/aggregate-merge";
it("旧家庭默认暂停，跨日期不换卡片，只有显式启用才跟随多伦多日期", () => {
  expect(learningUpdatesEnabled(undefined)).toBe(false);
  expect(learningDisplayDay(undefined, "2026-10-26")).toBe("2026-10-25");
  expect(learningDisplayDay(undefined, "2027-06-01")).toBe("2026-10-25");
  expect(
    learningDisplayDay(
      { ...DEFAULT_LEARNING_SCHEDULE, enabled: true },
      "2026-11-01",
    ),
  ).toBe("2026-11-01");
});
it("暂停冻结当天，恢复只改设置，不改财富、历史、消息和个人订阅", () => {
  const s = emptyState();
  const enabled = changeLearningSchedule(
    s,
    true,
    undefined,
    new Date("2026-10-26T03:00:00Z"),
  );
  expect(enabled.preferences.learningSchedule).toMatchObject({
    enabled: true,
    pausedDay: "2026-10-25",
  });
  const paused = changeLearningSchedule(
    enabled,
    false,
    JSON.stringify(enabled.preferences.learningSchedule),
    new Date("2026-10-27T15:00:00Z"),
  );
  expect(
    learningDisplayDay(paused.preferences.learningSchedule, "2027-01-01"),
  ).toBe("2026-10-27");
  expect(paused.assets).toBe(s.assets);
  expect(paused.history).toBe(s.history);
  expect(paused.messages).toBe(s.messages);
  expect(Object.keys(paused.preferences).sort()).toEqual(
    [...Object.keys(s.preferences), "learningSchedule"].sort(),
  );
});
it("设置在空家庭也作为已保存内容，备份往返、合并不丢失也不伪造财务快照", () => {
  const s = emptyState(),
    n = changeLearningSchedule(s, true, undefined);
  const saved = finishChange(s, n, "开启每日学习", false);
  const read = JSON.parse(JSON.stringify(saved));
  validateState(read);
  expect(hasSavedData(read)).toBe(true);
  expect(connectionPlan(read, s)).toBe("upload");
  const remote = {
    ...s,
    messages: [{ id: "m", role: "user" as const, text: "合成消息" }],
  };
  const merged = mergeHouseholdAggregates(s, read, remote);
  expect(merged.status).toBe("merged");
  if (merged.status === "merged") {
    expect(merged.document.preferences.learningSchedule?.enabled).toBe(true);
    expect(merged.document.messages).toEqual(remote.messages);
    expect(merged.document.history).toEqual([]);
  }
});
it("另一成员改开关后拒绝旧操作，坏日期、版本、字符串开关不被接受", () => {
  const s = changeLearningSchedule(emptyState(), false, undefined);
  expect(() => changeLearningSchedule(s, true, undefined)).toThrow(
    "另一位成员",
  );
  for (const p of [
    { ...DEFAULT_LEARNING_SCHEDULE, enabled: "yes" },
    { ...DEFAULT_LEARNING_SCHEDULE, pausedDay: "2026-02-30" },
    { ...DEFAULT_LEARNING_SCHEDULE, version: 2 },
  ])
    expect(validLearningSchedule(p)).toBe(false);
  expect(() =>
    validateState({
      ...s,
      preferences: { ...s.preferences, learningSchedule: { enabled: true } },
    }),
  ).toThrow("卡片");
});
