import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server-auth";
import { validResearchArchive } from "@/lib/research-archive";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200)
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers },
    );
  const household = new URL(request.url).searchParams.get("household");
  if (
    !household ||
    !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(household)
  )
    return NextResponse.json(
      { error: "请先连接共同家庭。" },
      { status: 400, headers },
    );
  const membership = await auth.client.rpc("is_wealth_member", {
    target_household: household,
  });
  if (membership.error || !membership.data)
    return NextResponse.json(
      { error: "没有此家庭权限。" },
      { status: 403, headers },
    );
  const result = await auth.client
    .from("wealth_research_archive")
    .select(
      "id,source,source_url,captured_at,prompt,response,citations,status,verification",
    )
    .eq("household_id", household)
    .order("captured_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(90);
  if (
    result.error ||
    !Array.isArray(result.data) ||
    !result.data.every(validResearchArchive)
  )
    return NextResponse.json(
      { error: "研究归档暂不可用，请稍后重试。" },
      { status: 503, headers },
    );
  return NextResponse.json({ reports: result.data }, { headers });
}
