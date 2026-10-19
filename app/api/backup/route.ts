import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server-auth";
import {
  buildBackupBundle,
  type BackupReader,
  type BackupReadResult,
} from "@/lib/backup-bundle";
export const maxDuration = 60;
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers });
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
export async function GET() {
  return NextResponse.json(
    { error: "请在应用内明确确认后导出。" },
    { status: 405, headers: { ...headers, Allow: "POST" } },
  );
}
export async function POST(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200) return fail(auth.error, auth.status);
  if (
    request.headers.get("origin") !== new URL(request.url).origin ||
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    return fail("请在应用内确认导出，不接受跨站或隐式请求。", 403);
  let body: { householdId: string; confirm: true };
  try {
    const reader = request.body?.getReader();
    if (!reader || Number(request.headers.get("content-length")) > 1024)
      throw Error();
    let text = "",
      bytes = 0;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1024) {
        await reader.cancel();
        throw Error();
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    const raw = JSON.parse(text);
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      Object.keys(raw).some((k) => !["householdId", "confirm"].includes(k)) ||
      !uuid(raw.householdId) ||
      raw.confirm !== true
    )
      throw Error();
    body = raw;
  } catch {
    return fail("请确认导出本人可见资料，并指定已加入的家庭。", 400);
  }
  try {
    // Read-only membership check. Never calls ensure/create/join or service_role.
    const member = await auth.client.rpc("is_wealth_member", {
      target_household: body.householdId,
    });
    if (member.error) return fail("家庭权限暂不可核验，未导出任何资料。", 503);
    if (member.data !== true) return fail("没有此家庭的访问权限。", 403);
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(45000),
    ]);
    let actions: Promise<BackupReadResult> | undefined;
    const read: BackupReader = async (spec, offset, limit, readSignal) => {
      if (spec.filter === "actions-rpc") {
        actions ??= (async () => {
          const result = await auth.client
            .rpc("list_wealth_actions", { target_household: body.householdId })
            .abortSignal(signal);
          if (result.error || !Array.isArray(result.data))
            return { data: [], count: null, error: true };
          // The JSON aggregate RPC returns all visible actions, with no LIMIT.
          // Its own RLS-equivalent scope also redacts another author's sourceRef.
          return { data: result.data, count: result.data.length };
        })();
        const result = await actions;
        return {
          ...result,
          data: Array.isArray(result.data)
            ? result.data.slice(offset, offset + limit)
            : [],
        };
      }
      let query = auth.client
        .from(spec.table)
        .select(spec.columns.join(","), { count: "exact" });
      if (["household", "both"].includes(spec.filter))
        query = query.eq("household_id", body.householdId);
      if (["user", "both"].includes(spec.filter))
        query = query.eq("user_id", auth.user.id);
      for (const order of spec.order)
        query = query.order(order.column, { ascending: order.ascending });
      const result = await query
        .range(offset, offset + limit - 1)
        .abortSignal(readSignal ?? signal);
      return { data: result.data, count: result.count, error: result.error };
    };
    const bundle = await buildBackupBundle(
      { userId: auth.user.id, householdId: body.householdId },
      read,
      { signal },
    );
    const stamp = bundle.exportedAt.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    return NextResponse.json(bundle, {
      headers: {
        ...headers,
        "Content-Disposition": `attachment; filename="together-visible-backup-${stamp}.json"`,
        "X-Backup-Status": bundle.status,
      },
    });
  } catch {
    return fail(
      "导出未能完成，请保留已有备份并稍后重试；未修改任何数据。",
      503,
    );
  }
}
