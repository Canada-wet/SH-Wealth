import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server-auth";
import {
  COUNCIL_MODELS,
  CATALOG_DATE,
  councilSpec,
  validCouncilId,
  type CouncilRun,
} from "@/lib/council";
import {
  councilAvailability,
  checkAlibabaConnection,
} from "@/lib/council-provider";
import {
  advanceCouncil,
  councilCommand,
  CouncilError,
  createCouncil,
  publicCouncil,
} from "@/lib/council-server";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status = 503) =>
  NextResponse.json({ error }, { status, headers });
export async function GET(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200) return fail(auth.error, auth.status);
  const id = new URL(request.url).searchParams.get("id");
  if (id && !validCouncilId(id)) return fail("研讨编号无效。", 400);
  if (id) {
    const result = await auth.client
      .from("wealth_council_runs")
      .select("document")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (result.error)
      return fail("研讨历史尚不可用。请确认已安装研讨数据库，再重试。");
    if (!result.data) return fail("研讨不存在或没有访问权限。", 404);
    return NextResponse.json(
      { run: publicCouncil(result.data.document as CouncilRun) },
      { headers },
    );
  }
  const result = await auth.client
    .from("wealth_council_runs")
    .select("id,question,status,created_at")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const serverReady = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  return NextResponse.json(
    {
      models: COUNCIL_MODELS,
      checkedAt: CATALOG_DATE,
      availability: councilAvailability(),
      runs: result.data ?? [],
      storageReady: !result.error && serverReady,
      ...(result.error || !serverReady
        ? {
            storageError: result.error
              ? "研讨历史尚未连接：请安装 supabase/council.sql；暂不能开始付费调用。"
              : "研讨写入服务尚未配置 SUPABASE_SERVICE_ROLE_KEY；暂不能开始付费调用。",
          }
        : {}),
    },
    { headers },
  );
}
export async function POST(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200) return fail(auth.error, auth.status);
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== new URL(request.url).origin) ||
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    return fail("请在应用内操作。", 403);
  let raw: Record<string, unknown>;
  try {
    if (Number(request.headers.get("content-length")) > 700000) throw Error();
    const reader = request.body?.getReader();
    if (!reader) throw Error();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 700000) {
        await reader.cancel();
        throw Error();
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    raw = JSON.parse(text);
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      (raw.action !== "create" && text.length > 16000)
    )
      throw Error();
  } catch {
    return fail("请求格式无效或内容过长。", 400);
  }
  try {
    if (raw.action === "check-alibaba") {
      const slot = await auth.client.rpc("take_wealth_advisor_slot");
      if (slot.error || !slot.data)
        return fail("连接检查暂不可用或过于频繁，请稍后重试。", 429);
      return NextResponse.json(
        { check: await checkAlibabaConnection() },
        { headers },
      );
    }
    if (raw.action === "create") {
      let spec;
      try {
        spec = councilSpec(raw);
      } catch (e) {
        return fail((e as Error).message, 400);
      }
      const run = await createCouncil(auth.user.id, spec);
      return NextResponse.json({ run: publicCouncil(run) }, { headers });
    }
    if (
      !validCouncilId(raw.id) ||
      !["advance", "pause", "resume", "cancel", "delete", "abandon"].includes(
        String(raw.action),
      )
    )
      return fail("操作或研讨编号无效。", 400);
    if (
      raw.action === "abandon" &&
      (!Number.isInteger(raw.seq) ||
        Number(raw.seq) < 0 ||
        Number(raw.seq) > 18)
    )
      return fail("步骤编号无效。", 400);
    const run =
      raw.action === "advance"
        ? await advanceCouncil(auth.user.id, raw.id)
        : await councilCommand(
            String(raw.action),
            auth.user.id,
            raw.id,
            raw.action === "abandon" ? { seq: raw.seq } : {},
          );
    return NextResponse.json(
      raw.action === "delete" ? { deleted: true } : { run: publicCouncil(run) },
      { headers },
    );
  } catch (e) {
    return fail(
      e instanceof CouncilError
        ? e.message
        : "研讨服务暂不可用，已保存的结果不会被覆盖；请重新读取。",
      e instanceof CouncilError ? e.status : 503,
    );
  }
}
