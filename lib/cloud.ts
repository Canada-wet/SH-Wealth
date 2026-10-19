import { type SupabaseClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import type { WealthState } from "./wealth";
export type CloudDocument = {
  household_id: string;
  revision: number;
  document: WealthState | null;
};
let client: SupabaseClient | null = null;
export class CloudConflictError extends Error {
  readonly code = "HOUSEHOLD_REVISION_CONFLICT";
  constructor() {
    super("伴侣已更新云端数据，请加载云端版本后重新修改。");
    this.name = "CloudConflictError";
  }
}
export function cloudClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client ??= createBrowserClient(url, key, {
    cookieOptions: {
      secure:
        typeof window !== "undefined" && window.location.protocol === "https:",
    },
  });
  return client;
}
export async function cloudRead(householdId: string) {
  const client = cloudClient();
  if (!client) throw new Error("尚未配置 Supabase。");
  const { data, error } = await client
    .from("household_documents")
    .select("household_id,revision,document")
    .eq("household_id", householdId)
    .single();
  if (error) throw new Error(error.message);
  return data as CloudDocument;
}
export async function sharedHousehold() {
  const client = cloudClient();
  if (!client) throw new Error("尚未配置 Supabase。");
  const { data, error } = await client.rpc("ensure_shared_wealth_household");
  if (error) throw new Error(error.message);
  if (typeof data !== "string") throw new Error("共同家庭初始化失败。");
  return data;
}
export async function cloudWrite(
  householdId: string,
  revision: number,
  document: WealthState,
) {
  const client = cloudClient();
  if (!client) throw new Error("尚未配置 Supabase。");
  const { data, error } = await client.rpc("save_household_document", {
    target_household: householdId,
    expected_revision: revision,
    next_document: document,
  });
  if (error) {
    // Only the RPC's exact, known revision rejection is safe to re-read/merge.
    // Network failures can have an unknown billing/write outcome: never replay.
    if (error.code === "P0001" && error.message === "revision conflict")
      throw new CloudConflictError();
    throw new Error(error.message);
  }
  const acknowledgedRevision = Number(data);
  if (
    (typeof data !== "number" &&
      !(typeof data === "string" && /^[1-9]\d*$/.test(data))) ||
    !Number.isSafeInteger(acknowledgedRevision) ||
    acknowledgedRevision !== revision + 1
  )
    throw new Error("云端保存响应无效，本机数据已保留，请重新连接确认版本。");
  return acknowledgedRevision;
}
