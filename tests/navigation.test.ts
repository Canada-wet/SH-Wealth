import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  FEATURES,
  featureForLocation,
  orderedFeatures,
  searchFeatures,
  validNavEntries,
  relatedFeatures,
  type NavEntry,
} from "../lib/navigation";
const entries: NavEntry[] = [
  {
    feature_id: "assets",
    pinned: true,
    pinned_at: "2026-10-01T00:00:00Z",
    last_used_at: null,
  },
  {
    feature_id: "fx-research",
    pinned: false,
    pinned_at: null,
    last_used_at: "2026-10-18T12:00:00Z",
  },
  {
    feature_id: "council",
    pinned: false,
    pinned_at: null,
    last_used_at: "2026-10-17T12:00:00Z",
  },
];
it("唯一固定目录覆盖所有主页面与功能；SQL 许可列表与前端完全对齐", () => {
  expect(new Set(FEATURES.map((f) => f.id)).size).toBe(FEATURES.length);
  expect(new Set(FEATURES.map((f) => f.href)).size).toBe(FEATURES.length);
  const sql = readFileSync("supabase/navigation.sql", "utf8");
  const ids = sql
    .match(/check\(feature_id in \(([^)]+)\)\)/)![1]
    .replaceAll("'", "")
    .split(",");
  expect(ids.sort()).toEqual(FEATURES.map((f) => f.id).sort());
  for (const f of FEATURES) {
    expect(f.href).toMatch(/^\/(?:#|markets|council|learn|lifestyle|updates)/);
    expect(f.href).not.toContain("?");
    for (const link of relatedFeatures(f.id)) expect(FEATURES).toContain(link);
  }
});
it("默认置顶在最前，其余最近使用；使用子功能也提升所属页面，置顶次序不受浏览影响", () => {
  const result = orderedFeatures(
    FEATURES.filter((f) => f.primary),
    entries,
  );
  expect(result.slice(0, 3).map((f) => f.id)).toEqual([
    "assets",
    "markets",
    "council",
  ]);
  const two = [
    ...entries,
    {
      feature_id: "learn",
      pinned: true,
      pinned_at: "2026-10-02T00:00:00Z",
      last_used_at: "2026-11-01T00:00:00Z",
    },
  ];
  expect(
    orderedFeatures(FEATURES, two)
      .slice(0, 2)
      .map((f) => f.id),
  ).toEqual(["assets", "learn"]);
});
it("按中英文关键词、多个词与分类查找，精准标题优先；空白返回最近顺序", () => {
  for (const [query, id] of [
    ["汇率", "fx-research"],
    ["CPI", "macro-research"],
    ["备份", "settings"],
    ["语音", "advisor"],
    ["DJ 编排", "sets"],
    ["ＧＤＰ", "macro-research"],
    ["funda", "research-archive"],
  ])
    expect(searchFeatures(query)[0].id).toBe(id);
  expect(searchFeatures("xyzunknown")).toEqual([]);
  expect(searchFeatures("股票", entries, "兴趣生活")).toEqual([]);
  expect(searchFeatures("", entries)[0].id).toBe("assets");
});
it("深链接只接受目录项，不把私密 run/day 参数存为搜索记录", () => {
  expect(featureForLocation("/markets", "#fx-research")?.id).toBe(
    "fx-research",
  );
  expect(featureForLocation("/markets", "#unknown")?.id).toBe("markets");
  expect(featureForLocation("/", "#members")?.id).toBe("members");
  expect(featureForLocation("/lifestyle", "#sets")?.id).toBe("sets");
  expect(featureForLocation("/learn", "#favorites")?.id).toBe(
    "learning-favorites",
  );
  expect(featureForLocation("/login", "")).toBeUndefined();
});
it("拒绝重复、未知项、坏时间和非布尔置顶，保留空的新账户", () => {
  expect(validNavEntries([])).toBe(true);
  expect(validNavEntries(entries)).toBe(true);
  expect(validNavEntries([...entries, entries[0]])).toBe(false);
  for (const patch of [
    { feature_id: "unknown" },
    { pinned: "yes" },
    { last_used_at: "bad" },
  ])
    expect(validNavEntries([{ ...entries[0], ...patch }])).toBe(false);
});
