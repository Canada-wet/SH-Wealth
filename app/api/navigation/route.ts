import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server-auth";
import { featureById, validNavEntries } from "@/lib/navigation";
const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status = 503) =>
  NextResponse.json({ error }, { status, headers });
export async function GET(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200) return fail(auth.error, auth.status);
  const { data, error } = await auth.client
    .from("wealth_navigation_preferences")
    .select("feature_id,pinned,last_used_at,pinned_at")
    .eq("user_id", auth.user.id);
  if (error || !validNavEntries(data))
    return fail("个人导航暂未连接云端；页面入口仍可使用。");
  return NextResponse.json(
    { userId: auth.user.id, entries: data },
    { headers },
  );
}
export async function POST(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200) return fail(auth.error, auth.status);
  if (
    request.headers.get("origin") !== new URL(request.url).origin ||
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    return fail("请在应用内调整导航。", 403);
  let raw;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw Error();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const p = await reader.read();
      if (p.done) break;
      size += p.value.length;
      if (size > 1024) {
        await reader.cancel();
        throw Error();
      }
      chunks.push(p.value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    raw = JSON.parse(new TextDecoder().decode(bytes));
    if (
      !raw ||
      typeof raw.featureId !== "string" ||
      !featureById(raw.featureId) ||
      !["visit", "pin", "unpin"].includes(raw.action)
    )
      throw Error();
  } catch {
    return fail("导航操作格式无效。", 400);
  }
  // Identity and timestamps are server-owned. A visit cannot overwrite a pin.
  const { data, error } = await auth.client.rpc("update_wealth_navigation", {
    target_feature: raw.featureId,
    operation: raw.action,
  });
  if (error || !validNavEntries(data))
    return fail("尚未确认导航保存，请重试；未修改其他数据。");
  return NextResponse.json(
    { userId: auth.user.id, entries: data },
    { headers },
  );
}
