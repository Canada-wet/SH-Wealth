import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server-auth";
import { boundedJSON, sameOrigin } from "@/lib/backtest-http";
import { yahooRequest } from "@/lib/backtest-yahoo";
import { getYahooBatch } from "@/lib/backtest-yahoo-server";
export const maxDuration = 90;
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function POST(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200) return json({ error: auth.error }, auth.status);
  if (!sameOrigin(request)) return json({ error: "请求来源无效。" }, 403);
  let query;
  try {
    query = yahooRequest(await boundedJSON(request, 4096));
  } catch {
    return json(
      {
        error:
          "请核对1–8个真实证券代码与历史日期；不支持演示、重复、混合币种或未来区间。",
      },
      400,
    );
  }
  try {
    const slot = await auth.client.rpc("take_wealth_advisor_slot");
    if (slot.error)
      return json({ error: "研究请求频率检查失败，未访问Yahoo。" }, 503);
    if (!slot.data)
      return json(
        { error: "研究请求较频繁，请稍后再获取；已有行情不受影响。" },
        429,
      );
    return json(await getYahooBatch(query));
  } catch {
    return json(
      { error: "历史数据服务暂不可用；未自动重发，已有行情不受影响。" },
      503,
    );
  }
}
