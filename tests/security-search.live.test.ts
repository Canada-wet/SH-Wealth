import { it, expect, vi } from "vitest";
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
it.skipIf(process.env.RUN_SECURITY_SEARCH_INTEGRATION !== "1")(
  "真实公开证券搜索与元数据核对：拒绝即停止，不带家庭资料",
  async () => {
    const { fetchSecuritySearch } =
      await import("../lib/security-search-server");
    const result = await fetchSecuritySearch("NVDA");
    console.log(
      JSON.stringify({
        query: result.query,
        verified: result.options.map((s) => ({
          symbol: s.symbol,
          exchange: s.exchange,
          currency: s.currency,
          kind: s.kind,
        })),
        omitted: result.omitted,
      }),
    );
    expect(
      result.options.some(
        (s) =>
          s.symbol === "NVDA.US" && s.currency === "USD" && s.kind === "EQUITY",
      ),
    ).toBe(true);
  },
  30000,
);
