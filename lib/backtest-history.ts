import { yahooRequest, type YahooRequest } from "./backtest-yahoo";
export type HistoryProvider = "auto" | "yahoo" | "tiingo";
export type HistoryRequest = YahooRequest & { provider?: HistoryProvider };
export function historyRequest(raw: unknown): HistoryRequest {
  const query = yahooRequest(raw),
    provider = (raw as { provider?: unknown })?.provider;
  if (
    provider !== undefined &&
    (typeof provider !== "string" ||
      !["auto", "yahoo", "tiingo"].includes(provider))
  )
    throw Error("不支持的历史供方。");
  return {
    ...query,
    ...(provider !== undefined
      ? { provider: provider as HistoryProvider }
      : {}),
  };
}
