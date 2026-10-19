import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server-auth";
import {
  parseActionInput,
  parseActionPatch,
  validActionId,
  validActionItem,
  validActionItems,
} from "@/lib/action-center";
const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status = 503) =>
  NextResponse.json({ error }, { status, headers });
const storageError = (message: string) => {
  if (message.includes("action_conflict"))
    return fail("另一设备已更新此行动，请刷新后重新修改。", 409);
  if (
    message.includes("action_not_found") ||
    message.includes("action_forbidden")
  )
    return fail("行动不存在或没有访问权限。", 404);
  if (message.includes("action_capacity"))
    return fail("此范围已达 500 条行动，请先整理已完成的项目。", 409);
  if (message.includes("action_invalid"))
    return fail("行动格式无效，来源和可见范围不能更改。", 400);
  return fail(
    "行动保存服务暂不可用，未确认操作成功；请刷新后核对，不会自动重发。",
  );
};
export async function GET(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200) return fail(auth.error, auth.status);
  const household = new URL(request.url).searchParams.get("household");
  if (!validActionId(household)) return fail("请先连接家庭空间。", 400);
  try {
    const { data, error } = await auth.client.rpc("list_wealth_actions", {
      target_household: household,
    });
    if (error) return storageError(error.message ?? "");
    if (!validActionItems(data))
      return fail("行动读取确认无效，请重试；没有使用本机模拟数据。");
    return NextResponse.json({ items: data }, { headers });
  } catch {
    return fail("暂时无法读取行动，请重新连接。");
  }
}
export async function POST(request: Request) {
  const auth = await authorizeRequest(request);
  if (auth.status !== 200) return fail(auth.error, auth.status);
  if (
    request.headers.get("origin") !== new URL(request.url).origin ||
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    return fail("请在应用内保存行动。", 403);
  let args: {
    operation: string;
    target_household: string;
    target_id: string;
    expected_version: number | null;
    payload: unknown;
  };
  try {
    const reader = request.body?.getReader();
    if (!reader || Number(request.headers.get("content-length")) > 16000)
      throw Error();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 16000) {
        await reader.cancel();
        throw Error();
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const raw = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      Object.keys(raw).some(
        (key) =>
          ![
            "operation",
            "household",
            "id",
            "version",
            "input",
            "patch",
          ].includes(key),
      ) ||
      !["create", "update", "delete"].includes(raw.operation) ||
      !validActionId(raw.household) ||
      !validActionId(raw.id)
    )
      throw Error();
    if (
      raw.operation !== "create" &&
      (!Number.isSafeInteger(raw.version) || raw.version < 1)
    )
      throw Error();
    if (
      raw.operation === "create" &&
      (raw.patch !== undefined || raw.version !== undefined)
    )
      throw Error();
    if (raw.operation === "update" && raw.input !== undefined) throw Error();
    if (
      raw.operation === "delete" &&
      (raw.input !== undefined || raw.patch !== undefined)
    )
      throw Error();
    const payload =
      raw.operation === "create"
        ? parseActionInput(raw.input)
        : raw.operation === "update"
          ? parseActionPatch(raw.patch)
          : {};
    args = {
      operation: raw.operation,
      target_household: raw.household,
      target_id: raw.id,
      expected_version: raw.operation === "create" ? null : raw.version,
      payload,
    };
  } catch {
    return fail("行动格式无效或内容过长，请检查标题、日期和可见范围。", 400);
  }
  try {
    const { data, error } = await auth.client.rpc("mutate_wealth_action", args);
    if (error) return storageError(error.message ?? "");
    if (args.operation === "delete") {
      if (data?.deleted !== true || data?.id !== args.target_id)
        return fail("尚未确认删除成功，请刷新后核对。");
      return NextResponse.json(
        { deleted: true, id: args.target_id },
        { headers },
      );
    }
    if (
      !validActionItem(data) ||
      data.id !== args.target_id ||
      (args.operation === "update" &&
        data.version !== args.expected_version! + 1)
    )
      return fail("尚未确认保存成功，请刷新后核对。");
    return NextResponse.json({ item: data }, { headers });
  } catch {
    return fail("操作结果未确认，请刷新后核对；未自动重发。");
  }
}
