import { unstable_cache } from "next/cache";
import { boundedJSON } from "./backtest-http";
import { SYMBOL } from "./backtest-schema";
import { yahooSymbol } from "./backtest-yahoo";
import { coolDownYahoo, yahooIsCoolingDown } from "./backtest-yahoo-server";
import {
  securityCandidates,
  verifySecurity,
  type SecurityCandidate,
  type SecuritySearch,
} from "./security-search";

async function publicJSON(url: URL) {
  if (yahooIsCoolingDown())
    throw Error("Yahoo暂时拒绝或限流，请稍后手动重试；原持仓不变。");
  const r = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    redirect: "error",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if ([401, 403, 429].includes(r.status)) {
    coolDownYahoo();
    throw Error("Yahoo拒绝或限流，已停止新请求，不会绕过限制；原持仓不变。");
  }
  if (!r.ok) throw Error("证券数据源暂不可用，请稍后手动重试。");
  return boundedJSON(r, 1_000_000);
}
async function lookup(candidate: SecurityCandidate) {
  const u = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(candidate.providerSymbol)}`,
  );
  u.search = new URLSearchParams({ range: "5d", interval: "1d" }).toString();
  return verifySecurity(await publicJSON(u), candidate);
}
const cachedLookup = unstable_cache(lookup, ["backtest-security-identity-v1"], {
  revalidate: 3600,
});
const pendingLookups = new Map<string, ReturnType<typeof cachedLookup>>();
function sharedLookup(candidate: SecurityCandidate) {
  const key = `${candidate.providerSymbol}:${candidate.exchange}:${candidate.kind}`;
  const pending = pendingLookups.get(key);
  if (pending) return pending;
  if (pendingLookups.size >= 100)
    return Promise.reject(Error("证券核对繁忙，请稍后重试。"));
  const work = cachedLookup(candidate).finally(() =>
    pendingLookups.delete(key),
  );
  pendingLookups.set(key, work);
  return work;
}
export async function fetchSecuritySearch(
  query: string,
): Promise<SecuritySearch> {
  const u = new URL("https://query1.finance.yahoo.com/v1/finance/search");
  const upper = query.toUpperCase();
  u.search = new URLSearchParams({
    q: SYMBOL.test(upper) ? yahooSymbol(upper) : query,
    quotesCount: "10",
    newsCount: "0",
    enableFuzzyQuery: "false",
  }).toString();
  const candidates = securityCandidates(await publicJSON(u)),
    options: SecuritySearch["options"] = [];
  let omitted = 0;
  // Two in flight at most. On provider denial no subsequent batch is submitted.
  for (let i = 0; i < candidates.length; i += 2) {
    if (yahooIsCoolingDown())
      throw Error("证券数据源限流，已停止后续核对；请稍后手动重试。");
    const batch = await Promise.allSettled(
      candidates.slice(i, i + 2).map(sharedLookup),
    );
    for (const r of batch) {
      if (r.status === "fulfilled") options.push(r.value);
      else omitted++;
    }
    if (yahooIsCoolingDown())
      throw Error("证券数据源限流，未提供未经核对的候选项。");
  }
  if (candidates.length && !options.length)
    throw Error(
      "没有候选证券通过在线核对；原持仓不变，请稍后重试或换个关键词。",
    );
  return {
    version: 1,
    query,
    options,
    omitted,
    checkedAt: new Date().toISOString(),
  };
}
export const getSecuritySearch = unstable_cache(
  fetchSecuritySearch,
  ["backtest-security-search-v1"],
  { revalidate: 300 },
);

const requests = new Map<
  string,
  { start: number; count: number; last: number }
>();
/** Best-effort per-instance abuse guard, independent of paid-advisor quotas. */
export function allowSecuritySearch(user: string, now = Date.now()) {
  for (const [id, r] of requests)
    if (now - r.start >= 60000) requests.delete(id);
  const r = requests.get(user) ?? { start: now, count: 0, last: 0 };
  if (requests.size >= 1000 && !requests.has(user)) return false;
  if (r.count >= 30 || (r.count > 0 && now - r.last < 500)) return false;
  r.count++;
  r.last = now;
  requests.set(user, r);
  return true;
}
