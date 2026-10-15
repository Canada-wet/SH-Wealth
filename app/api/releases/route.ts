import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server-auth";
import { APP_VERSION, RELEASES } from "@/lib/releases";
export async function GET(request: Request) {
  const auth = await authorizeRequest(request);
  const headers = { "Cache-Control": "private, no-store" };
  if (auth.status !== 200)
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers },
    );
  // Both verified allowlisted accounts are app admins; this does not elevate database keys or household roles.
  return NextResponse.json(
    {
      version: APP_VERSION,
      role: "admin",
      viewer: auth.user.email,
      releases: RELEASES,
    },
    { headers },
  );
}
