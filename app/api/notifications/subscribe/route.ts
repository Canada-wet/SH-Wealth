import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { pushReady } from "@/lib/push";
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !pushReady())
    return NextResponse.json({ error: "云端推送尚未配置。" }, { status: 503 });
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token)
    return NextResponse.json({ error: "请先登录家庭空间。" }, { status: 401 });
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const user = await client.auth.getUser(token);
  if (!user.data.user)
    return NextResponse.json(
      { error: "登录已过期，请重新登录。" },
      { status: 401 },
    );
  let body: {
    householdId?: string;
    subscription?: {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
  }
  if (
    !body.householdId ||
    !body.subscription?.endpoint ||
    !body.subscription.keys?.auth ||
    !body.subscription.keys?.p256dh
  )
    return NextResponse.json({ error: "订阅信息不完整。" }, { status: 400 });
  const { error } = await client
    .from("wealth_push_subscriptions")
    .upsert(
      {
        household_id: body.householdId,
        user_id: user.data.user.id,
        endpoint: body.subscription.endpoint,
        subscription: body.subscription,
      },
      { onConflict: "user_id,endpoint" },
    );
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
