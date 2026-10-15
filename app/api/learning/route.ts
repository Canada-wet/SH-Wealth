import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server-auth";
import { EMPTY_LEARNING, validLearningPreferences } from "@/lib/learning";
const headers = { "Cache-Control": "private, no-store" };
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v);
export async function GET(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200)
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers },
    );
  const household = new URL(request.url).searchParams.get("household");
  if (!uuid(household))
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
    .from("wealth_learning_preferences")
    .select("version,daily,favorites")
    .eq("household_id", household)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (result.error)
    return NextResponse.json(
      { error: "收藏服务暂不可用，请重试。" },
      { status: 503, headers },
    );
  const deliveries = await auth.client
    .from("wealth_learning_deliveries")
    .select("day,transport,status,created_at")
    .eq("household_id", household)
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(8);
  return NextResponse.json(
    {
      preferences: result.data ?? EMPTY_LEARNING,
      deliveries: deliveries.data ?? [],
      deliveryStatusAvailable: !deliveries.error,
    },
    { headers },
  );
}
export async function PUT(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200)
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers },
    );
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== new URL(request.url).origin) ||
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    return NextResponse.json(
      { error: "请在应用内保存。" },
      { status: 403, headers },
    );
  let raw: { household?: unknown; preferences?: unknown };
  try {
    const text = await request.text();
    if (text.length > 10000) throw Error();
    raw = JSON.parse(text);
    if (
      !raw ||
      !uuid(raw.household) ||
      !validLearningPreferences(raw.preferences)
    )
      throw Error();
  } catch {
    return NextResponse.json(
      { error: "收藏或偏好格式无效。" },
      { status: 400, headers },
    );
  }
  const p = raw.preferences as import("@/lib/learning").LearningPreferences;
  const row = {
    household_id: raw.household,
    user_id: auth.user.id,
    version: p.version + 1,
    daily: p.daily,
    favorites: p.favorites,
    updated_at: new Date().toISOString(),
  };
  const result =
    p.version === 0
      ? await auth.client
          .from("wealth_learning_preferences")
          .insert(row)
          .select("version,daily,favorites")
          .single()
      : await auth.client
          .from("wealth_learning_preferences")
          .update(row)
          .eq("household_id", raw.household)
          .eq("user_id", auth.user.id)
          .eq("version", p.version)
          .select("version,daily,favorites")
          .maybeSingle();
  if (result.error?.code === "23505" || (!result.error && !result.data))
    return NextResponse.json(
      { error: "另一设备已更新收藏或提醒偏好。请重新读取后再操作。" },
      { status: 409, headers },
    );
  if (result.error)
    return NextResponse.json(
      { error: "未能保存，请检查权限或稍后重试。" },
      { status: 503, headers },
    );
  return NextResponse.json({ preferences: result.data }, { headers });
}
