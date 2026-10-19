import { describe, expect, it } from "vitest";
import { mergeHouseholdAggregates } from "../lib/aggregate-merge";
import { EMPTY_LIFESTYLE } from "../lib/lifestyle-schema";
import { emptyState, finishChange, type WealthState } from "../lib/wealth";

const asset = {
  id: "a",
  name: "账户",
  owner: "joint",
  category: "现金",
  value: 100,
  annualReturn: null,
};
const base = (): WealthState => ({ ...emptyState(), assets: [asset] });
const financial = (state: WealthState, value: number) =>
  finishChange(
    state,
    {
      ...state,
      assets: [{ ...asset, value }],
    },
    "估值",
    true,
    new Date("2026-10-19T12:00:00Z"),
  );
const lifestyle = (state: WealthState) => ({
  ...state,
  preferences: {
    ...state.preferences,
    lifestyle: {
      ...structuredClone(EMPTY_LIFESTYLE),
      settings: {
        ...structuredClone(EMPTY_LIFESTYLE.settings),
        energyDelta: 2,
      },
    },
  },
});
const chat = (state: WealthState, text = "问题"): WealthState => ({
  ...state,
  messages: [{ id: "m", role: "user", text }],
});

describe("家庭文档保守的三向聚合合并", () => {
  it("财务与兴趣不同聚合可合并，保留原始财务历史而不追加假快照", () => {
    const baseline = base(),
      local = financial(baseline, 200),
      remote = lifestyle(baseline);
    const before = JSON.stringify([baseline, local, remote]);
    const merged = mergeHouseholdAggregates(baseline, local, remote);
    expect(merged.status).toBe("merged");
    if (merged.status !== "merged") return;
    expect(merged.localDomains).toEqual(["financial"]);
    expect(merged.remoteDomains).toEqual(["lifestyle"]);
    expect(merged.document.assets[0].value).toBe(200);
    expect(merged.document.history).toEqual(local.history);
    expect(merged.document.preferences.lifestyle?.settings.energyDelta).toBe(2);
    expect(merged.document.revision).toBe(local.revision);
    expect(JSON.stringify([baseline, local, remote])).toBe(before);
    merged.document.assets[0].value = 900;
    expect(local.assets[0].value).toBe(200);
  });

  it("聊天、市场研究与设置按整聚合选择", () => {
    const baseline = base(),
      local = chat(baseline);
    const remote: WealthState = {
      ...baseline,
      readAlerts: ["a"],
      preferences: {
        ...baseline.preferences,
        model: "deepseek-chat",
        marketWatchlist: [
          { ticker: "NVDA", exchange: "NASDAQ", name: "Nvidia" },
        ],
      },
    };
    const merged = mergeHouseholdAggregates(baseline, local, remote);
    expect(merged.status).toBe("merged");
    if (merged.status !== "merged") return;
    expect(merged.document.messages).toEqual(local.messages);
    expect(merged.document.preferences.model).toBe("deepseek-chat");
    expect(merged.document.preferences.marketWatchlist).toEqual(
      remote.preferences.marketWatchlist,
    );
    expect(merged.document.readAlerts).toEqual(["a"]);
  });

  it("即使修改不同资产，也不拼接两个财务聚合", () => {
    const baseline = base();
    expect(
      mergeHouseholdAggregates(baseline, financial(baseline, 200), {
        ...baseline,
        debts: [{ id: "d", name: "借款", owner: "first", value: 20 }],
      }),
    ).toEqual({
      status: "conflict",
      domains: ["financial"],
      reason: "overlap",
    });
  });

  it("增长计划、持仓关联、季度复盘与账本视为同一财务原子域", () => {
    const baseline = base(),
      local = financial(baseline, 200);
    for (const preferences of [
      {
        growthPlan: {
          monthlySaving: 10,
          longTermMonthly: 0,
          annualRate: 0,
          selectedAssetIds: ["a"],
          reviewDate: "2026-10-19",
          tasks: {},
        },
      },
      { portfolioLinks: [] },
      { quarterlyReviews: { reminders: false, external: false, records: {} } },
    ]) {
      const remote = {
        ...baseline,
        preferences: { ...baseline.preferences, ...preferences },
      };
      expect(mergeHouseholdAggregates(baseline, local, remote)).toEqual({
        status: "conflict",
        domains: ["financial"],
        reason: "overlap",
      });
    }
  });

  it("不同会话并发也不自动拼接聊天域", () => {
    const baseline = base();
    expect(
      mergeHouseholdAggregates(
        baseline,
        chat(baseline, "问题一"),
        chat(baseline, "问题二"),
      ),
    ).toEqual({
      status: "conflict",
      domains: ["chat"],
      reason: "overlap",
    });
  });

  it("同域两边完全相同的变更是幂等兼容的", () => {
    const baseline = base(),
      local = chat(baseline);
    const remote = {
      ...structuredClone(local),
      revision: 8,
      updatedAt: "2026-10-19T14:00:00Z",
    };
    expect(mergeHouseholdAggregates(baseline, local, remote).status).toBe(
      "merged",
    );
  });

  it("缺省 optional 字段与有意删除被保留，不复活已清空的聊天归档", () => {
    const baseline: WealthState = {
      ...base(),
      chatArchives: [
        {
          id: "old",
          title: "旧聊天",
          messages: [{ id: "old-message", role: "user", text: "旧问题" }],
        },
      ],
    };
    const local = { ...baseline };
    delete local.chatArchives;
    const merged = mergeHouseholdAggregates(
      baseline,
      local,
      lifestyle(baseline),
    );
    expect(merged.status).toBe("merged");
    if (merged.status === "merged")
      expect(Object.hasOwn(merged.document, "chatArchives")).toBe(false);
  });

  it("未知顶层或偏好字段即使相同也关闭自动合并", () => {
    for (const baseline of [
      { ...base(), futureLedger: [] },
      { ...base(), preferences: { ...base().preferences, futureModule: true } },
    ]) {
      expect(
        mergeHouseholdAggregates(baseline, chat(baseline), lifestyle(baseline)),
      ).toEqual({
        status: "conflict",
        domains: [],
        reason: "unknown-fields",
      });
    }
  });

  it("无效输入关闭合并，包括不一致的 contribution 外键", () => {
    const baseline = base();
    const local: WealthState = {
      ...baseline,
      contributions: [
        {
          id: "c",
          member: "first",
          assetId: "missing",
          amount: 10,
          kind: "deposit",
          date: "2026-10-19",
          note: "",
        },
      ],
    };
    expect(
      mergeHouseholdAggregates(baseline, local, lifestyle(baseline)),
    ).toEqual({
      status: "conflict",
      domains: [],
      reason: "invalid-document",
    });
  });

  it("标量设置即使不同字段也作为一整个保守域，不 last-write-wins", () => {
    const baseline = base();
    expect(
      mergeHouseholdAggregates(
        baseline,
        {
          ...baseline,
          preferences: { ...baseline.preferences, model: "deepseek-chat" },
        },
        { ...baseline, preferences: { ...baseline.preferences, months: 12 } },
      ),
    ).toEqual({
      status: "conflict",
      domains: ["settings"],
      reason: "overlap",
    });
  });

  it("市场自选与研究不可逐条合并，移除证券不会复活", () => {
    const baseline = base();
    const local = {
      ...baseline,
      preferences: { ...baseline.preferences, marketWatchlist: [] },
    };
    const remote = {
      ...baseline,
      preferences: { ...baseline.preferences, marketResearch: {} },
    };
    expect(mergeHouseholdAggregates(baseline, local, remote)).toEqual({
      status: "conflict",
      domains: ["market"],
      reason: "overlap",
    });
  });

  it("超出精确整数范围的本机版本不参与自动合并", () => {
    const baseline = base();
    expect(
      mergeHouseholdAggregates(
        baseline,
        {
          ...chat(baseline),
          revision: Number.MAX_SAFE_INTEGER + 1,
        },
        lifestyle(baseline),
      ),
    ).toEqual({
      status: "conflict",
      domains: [],
      reason: "invalid-document",
    });
  });
});
