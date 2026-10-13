import { type SupabaseClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import type { WealthState } from "./wealth";
export type CloudDocument = {
  household_id: string;
  revision: number;
  document: WealthState | null;
};
let client: SupabaseClient | null = null;
export function cloudClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client ??= createBrowserClient(url, key, {
    cookieOptions: { secure: typeof window !== "undefined" && window.location.protocol === "https:" },
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
  if (error)
    throw new Error(
      error.message.includes("conflict")
        ? "伴侣已更新云端数据，请加载云端版本后重新修改。"
        : error.message,
    );
  return Number(data);
}
