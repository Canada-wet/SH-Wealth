import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server-auth";
import { validCouncilId } from "@/lib/council";
import {
  councilSearch,
  parseCouncilMemo,
  validCouncilLibraryItems,
} from "@/lib/council-library";
const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status = 503) =>
  NextResponse.json({ error }, { status, headers });
export async function POST(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200) return fail(auth.error, auth.status);
  if (
    request.headers.get("origin") !== new URL(request.url).origin ||
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    return fail("请在应用内整理研讨。", 403);
  let raw: Record<string, unknown>;
  try {
    const reader = request.body?.getReader();
    if (!reader || Number(request.headers.get("content-length")) > 16000)
      throw Error();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 16000) {
        await reader.cancel();
        throw Error();
      }
      parts.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let n = 0;
    for (const p of parts) {
      bytes.set(p, n);
      n += p.length;
    }
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error();
  } catch {
    return fail("整理请求无效或内容过长。", 400);
  }
  let rpc: string,
    args: Record<string, unknown>,
    memo: ReturnType<typeof parseCouncilMemo> | undefined;
  try {
    if (
      raw.action === "search" &&
      Object.keys(raw).every((k) => ["action", "query"].includes(k))
    ) {
      rpc = "read_wealth_council_library";
      args = { search_text: councilSearch(raw.query) };
    } else if (
      raw.action === "save" &&
      validCouncilId(raw.id) &&
      Object.keys(raw).every((k) => ["action", "id", "memo"].includes(k))
    ) {
      memo = parseCouncilMemo(raw.memo);
      const { version, ...content } = memo;
      rpc = "save_wealth_council_memo";
      args = { target_run: raw.id, expected_version: version, content };
    } else throw Error("整理操作无效。");
  } catch (e) {
    return fail(e instanceof Error ? e.message : "整理信息无效。", 400);
  }
  try {
    const result = await auth.client.rpc(rpc, args);
    if (result.error) {
      const msg = result.error.message ?? "";
      if (msg.includes("library_conflict"))
        return fail(
          "另一设备已修改整理信息；请重新读取后核对，草稿已保留。",
          409,
        );
      if (
        msg.includes("library_not_found") ||
        msg.includes("library_forbidden")
      )
        return fail("研讨不存在或没有访问权限。", 404);
      if (msg.includes("library_active"))
        return fail("请先结束当前研讨，再归档；归档不会替你停止模型。", 409);
      if (msg.includes("library_invalid"))
        return fail("整理信息无效，请检查标签和日期。", 400);
      return fail(
        "研讨整理服务尚不可用；请确认已安装 council-library.sql。未改写原研讨，也不会自动重发。",
      );
    }
    if (memo) {
      const saved = parseCouncilMemo(result.data);
      if (
        saved.version !== memo.version + 1 ||
        JSON.stringify({ ...memo, version: saved.version }) !==
          JSON.stringify(saved)
      )
        throw Error();
      return NextResponse.json(
        { userId: auth.user.id, id: raw.id, memo: saved },
        { headers },
      );
    }
    if (!validCouncilLibraryItems(result.data)) throw Error();
    return NextResponse.json(
      { userId: auth.user.id, items: result.data },
      { headers },
    );
  } catch {
    return fail("整理结果尚未确认，请重新读取；未自动重发或在本机假装保存。");
  }
}
