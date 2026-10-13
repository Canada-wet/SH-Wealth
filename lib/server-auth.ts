import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { allowedEmail } from "./access";
export async function authorizeRequest(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    return { status: 503, error: "登录服务尚未配置。" } as const;
  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/i)?.[1];
  const client = bearer
    ? createClient(url, key, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${bearer}` } },
      })
    : createServerClient(url, key, {
        cookies: {
          getAll: () =>
            parseCookieHeader(request.headers.get("cookie") ?? "").map(
              ({ name, value }) => ({ name, value: value ?? "" }),
            ),
          setAll: () => {},
        },
      });
  const { data, error } = await client.auth.getUser(bearer);
  if (error || !data.user) return { status: 401, error: "请先登录。" } as const;
  if (!allowedEmail(data.user.email) || !data.user.email_confirmed_at)
    return { status: 403, error: "此账号没有家庭空间访问权限。" } as const;
  return { status: 200, user: data.user, client } as const;
}
