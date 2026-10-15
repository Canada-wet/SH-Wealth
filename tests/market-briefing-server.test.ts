import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketData } from "../lib/market";
import { MARKET_INDICATORS } from "../lib/market-indicators";
const mocks = vi.hoisted(() => ({
  market: vi.fn(),
  advice: vi.fn(),
  route: vi.fn(),
}));
vi.mock("../lib/market-server", () => ({ getOfficialMarket: mocks.market }));
vi.mock("../lib/channel-server", () => ({ channelAdmin: vi.fn() }));
vi.mock("../lib/ai/router", () => ({
  chooseRoute: mocks.route,
  generateAdvice: mocks.advice,
}));
import { ensureMarketBrief } from "../lib/market-briefing-server";
const data: MarketData = {
  fetchedAt: "2026-10-15T14:00:00Z",
  fx: [],
  yields: [],
  macro: [],
  failures: [],
  indicators: MARKET_INDICATORS.slice(0, 3).map((d) => ({
    ...d,
    date: "2026-10-14",
    value: 20,
    source: `https://fred.stlouisfed.org/series/${d.id}`,
    trend: [],
  })),
};
function database(
  claim = true,
  error: unknown = null,
  saveError: unknown = null,
) {
  const rpc = vi.fn(async () => ({ data: claim, error }));
  const save = vi.fn(async () => ({
    data: [{ day: "2026-10-15" }],
    error: saveError,
  }));
  const chain = { eq: vi.fn(() => chain), select: save };
  const update = vi.fn(
    (_row: { report: import("../lib/market-briefing").MarketBrief }) => chain,
  );
  const read = {
    eq: () => read,
    order: () => read,
    limit: async () => ({ data: [], error: null }),
  };
  return { rpc, update, from: vi.fn(() => ({ update, select: () => read })) };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.market.mockResolvedValue(data);
  mocks.route.mockReturnValue({
    provider: "deepseek",
    model: "synthetic-cheap",
    complexity: "simple",
  });
});
it("每日已领取或数据库未就绪时，不启动数据抓取或付费模型", async () => {
  await ensureMarketBrief(database(false) as unknown as SupabaseClient);
  expect(mocks.advice).not.toHaveBeenCalled();
  expect(mocks.market).not.toHaveBeenCalled();
  await expect(
    ensureMarketBrief(
      database(false, new Error("private")) as unknown as SupabaseClient,
    ),
  ).rejects.toThrow("未调用模型");
});
it("成功生成只发送公共指标，写回包含日期与来源的固定快照并使用fencing token", async () => {
  mocks.advice.mockResolvedValue(
    JSON.stringify({
      summary: "观察波动",
      points: [
        { title: "情绪与波动", text: "仅为合成叙述", evidence: ["VIXCLS"] },
        { title: "经济前瞻", text: "仅为合成叙述", evidence: ["ICSA"] },
      ],
      watchNext: "核对日期",
      limitations: "不是建议",
    }),
  );
  const db = database();
  await ensureMarketBrief(
    db as unknown as SupabaseClient,
    new Date("2026-10-15T14:00:00Z"),
  );
  const report = db.update.mock.calls[0][0].report;
  expect(report.mode).toBe("ai");
  expect(report.provider).toBe("deepseek");
  expect(report.facts).toHaveLength(3);
  expect(report.day).toBe("2026-10-15");
  expect(mocks.advice).toHaveBeenCalledOnce();
  expect(mocks.advice.mock.calls[0][2]).not.toMatch(
    /household|members|messages|assets/,
  );
});
it("模型错误或伪造引用降级规则摘要，不循环调用昂贵备选", async () => {
  for (const raw of [
    new Error("secret should not echo"),
    '{"summary":"broken"}',
  ]) {
    if (raw instanceof Error) mocks.advice.mockRejectedValueOnce(raw);
    else mocks.advice.mockResolvedValueOnce(raw);
    const db = database();
    await ensureMarketBrief(db as unknown as SupabaseClient);
    const report = db.update.mock.calls[0][0].report;
    expect(report.mode).toBe("rules");
    expect(report.limitations).toContain("降级");
    expect(JSON.stringify(report)).not.toContain("secret");
  }
  expect(mocks.advice).toHaveBeenCalledTimes(2);
});
it("无可用指标不调用AI，保存失败不会冒充已持久化", async () => {
  mocks.market.mockResolvedValue({ ...data, indicators: [] });
  await ensureMarketBrief(database() as unknown as SupabaseClient);
  expect(mocks.advice).not.toHaveBeenCalled();
  await expect(
    ensureMarketBrief(
      database(true, null, new Error("save")) as unknown as SupabaseClient,
    ),
  ).rejects.toThrow("未能确认保存");
});
