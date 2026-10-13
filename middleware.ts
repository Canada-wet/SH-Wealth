import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { allowedEmail } from "@/lib/access";
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Recovery is public; the cron route independently validates its secret.
  if (
    path === "/login" ||
    path.startsWith("/auth/") ||
    path === "/api/advisor/digest" ||
    path === "/api/notifications/telegram" ||
    path === "/api/notifications/whatsapp"
  )
    return NextResponse.next();
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let authorized = false;
  if (url && key) {
    const client = createServerClient(url, key, {
      cookieOptions: { secure: request.nextUrl.protocol === "https:" },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (
          cookies: { name: string; value: string; options: CookieOptions }[],
        ) => {
          cookies.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookies.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });
    const { data } = await client.auth.getUser();
    authorized =
      allowedEmail(data.user?.email) && !!data.user?.email_confirmed_at;
  }
  if (authorized) {
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  // API handlers independently verify cookies or Bearer tokens.
  if (path.startsWith("/api/")) return response;
  const redirect = request.nextUrl.clone();
  redirect.pathname = "/login";
  redirect.search = "";
  redirect.searchParams.set("next", path);
  const denied = NextResponse.redirect(redirect);
  response.cookies.getAll().forEach((cookie) => denied.cookies.set(cookie));
  denied.headers.set("Cache-Control", "private, no-store");
  return denied;
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
