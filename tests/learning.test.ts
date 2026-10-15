import { it, expect } from "vitest";
import {
  LESSONS,
  lessonForDay,
  lessonArchive,
  validLearningPreferences,
  EMPTY_LEARNING,
} from "../lib/learning";
import { APP_VERSION, RELEASES } from "../lib/releases";
it("卡片映射固定，按多伦多日期回看，拒绝无效日期，不生成上线前内容", () => {
  expect(lessonForDay("2026-10-15")?.id).toBe("if-then-v1");
  expect(lessonForDay("2026-10-23")?.id).toBe("if-then-v1");
  expect(lessonForDay("2026-02-30")).toBeNull();
  expect(lessonForDay("2026-10-14")).toBeNull();
  expect(lessonArchive(new Date("2026-10-16T01:00:00Z"))[0].day).toBe(
    "2026-10-15",
  );
  expect(lessonArchive(new Date("2026-10-16T16:00:00Z"))).toHaveLength(2);
});
it("八个模型有原研究链接、三类应用和明确边界，无收益或治疗保证", () => {
  expect(LESSONS).toHaveLength(8);
  expect(new Set(LESSONS.map((x) => x.id)).size).toBe(8);
  for (const row of LESSONS) {
    expect(row.source).toMatch(
      /^https:\/\/(doi.org|pubmed.ncbi.nlm.nih.gov|www.nobelprize.org)\//,
    );
    expect([row.investment, row.work, row.life, row.limit].every(Boolean)).toBe(
      true,
    );
  }
});
it("收藏只接受目录内唯一 ID、显式本人提醒偏好和安全版本", () => {
  expect(validLearningPreferences(EMPTY_LEARNING)).toBe(true);
  for (const v of [
    { ...EMPTY_LEARNING, version: -1 },
    { ...EMPTY_LEARNING, daily: "true" },
    { ...EMPTY_LEARNING, favorites: ["made-up"] },
    { ...EMPTY_LEARNING, favorites: [LESSONS[0].id, LESSONS[0].id] },
  ])
    expect(validLearningPreferences(v)).toBe(false);
});
it("发行版本与包版本一致，旧基线不捏造发布日期", () => {
  expect(APP_VERSION).toBe(RELEASES[0].version);
  expect(RELEASES[1].date).toBeNull();
});
