import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server-auth";
import { sameOrigin } from "@/lib/backtest-http";
import { securityQuery } from "@/lib/security-search";
import {
  allowSecuritySearch,
  getSecuritySearch,
} from "@/lib/security-search-server";
export const maxDuration = 30;
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200) return json({ error: auth.error }, auth.status);
  if (!sameOrigin(request)) return json({ error: "请求来源无效。" }, 403);
  let q;
  try {
    q = securityQuery(new URL(request.url).searchParams.get("q"));
  } catch {
    return json(
      {
        error:
          "请输入有效证券代码或公司名称（最多48字）；仅搜索美股与TSX股票／ETF。",
      },
      400,
    );
  }
  if (!allowSecuritySearch(auth.user.id))
    return json({ error: "证券搜索较频繁，请稍后手动重试；原持仓不变。" }, 429);
  try {
    return json(await getSecuritySearch(q));
  } catch {
    return json(
      {
        error:
          "证券搜索或在线核对暂不可用，未改持仓。请稍后手动重试；不会自动选择相似证券。",
      },
      503,
    );
  }
}
