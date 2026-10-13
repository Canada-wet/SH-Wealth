import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { it, expect } from "vitest";
import { emptyState, saveAsset } from "../lib/wealth";
it.skipIf(process.env.RUN_SUPABASE_INTEGRATION !== "1")(
  "真实Supabase：成员登录、共享、持久化、版本冲突与RLS隔离",
  async () => {
    loadEnvConfig(process.cwd());
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const users: string[] = [];
    let householdId: string | undefined;
    const account = async () => {
      const email = `together-test-${crypto.randomUUID()}@example.com`;
      const password = crypto.randomUUID() + "Aa1!";
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw error;
      users.push(data.user.id);
      const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const login = await client.auth.signInWithPassword({ email, password });
      if (login.error) throw login.error;
      return client;
    };
    try {
      const first = await account();
      const second = await account();
      const outsider = await account();
      const created = await first.rpc("create_wealth_household", {
        display_name: "Integration test",
      });
      expect(created.error).toBeNull();
      householdId = created.data;
      expect(householdId).toBeTruthy();
      const state = saveAsset(emptyState(), {
        id: "fixture",
        name: "Test account",
        category: "现金",
        owner: "joint",
        value: 1234.56,
        annualReturn: -2.5,
      });
      state.contributions = [
        {
          id: "c",
          member: "first",
          assetId: null,
          amount: 100,
          kind: "deposit",
          date: "2026-10-12",
          note: "Fixture",
        },
      ];
      state.messages = [{ id: "m", role: "user", text: "Fixture chat" }];
      const saved = await first.rpc("save_household_document", {
        target_household: householdId,
        expected_revision: 0,
        next_document: state,
      });
      expect(saved.error).toBeNull();
      expect(saved.data).toBe(1);
      const invite = await first.rpc("household_invite_token", {
        target_household: householdId,
      });
      expect(invite.error).toBeNull();
      const joined = await second.rpc("join_wealth_household", {
        invite_token: invite.data,
        display_name: "Test partner",
      });
      expect(joined.error).toBeNull();
      const loaded = await second
        .from("household_documents")
        .select("revision,document")
        .eq("household_id", householdId!)
        .single();
      expect(loaded.error).toBeNull();
      expect(loaded.data?.document).toEqual(state);
      const updated = {
        ...state,
        revision: 1,
        assets: [{ ...state.assets[0], annualReturn: 0 }],
      };
      const partnerSave = await second.rpc("save_household_document", {
        target_household: householdId,
        expected_revision: 1,
        next_document: updated,
      });
      expect(partnerSave.error).toBeNull();
      expect(partnerSave.data).toBe(2);
      const conflict = await first.rpc("save_household_document", {
        target_household: householdId,
        expected_revision: 1,
        next_document: state,
      });
      expect(conflict.error?.message).toContain("conflict");
      const stranger = await outsider
        .from("household_documents")
        .select("household_id")
        .eq("household_id", householdId!);
      expect(stranger.data).toEqual([]);
      const forbidden = await outsider.rpc("save_household_document", {
        target_household: householdId,
        expected_revision: 2,
        next_document: state,
      });
      expect(forbidden.error?.message).toContain("Unauthorized");
      const history = await first
        .from("household_document_history")
        .select("revision")
        .eq("household_id", householdId!)
        .order("revision");
      expect(history.data?.map((row) => row.revision)).toEqual([1, 2]);
      const subscription = await first
        .from("wealth_push_subscriptions")
        .insert({
          household_id: householdId,
          user_id: users[0],
          endpoint: `https://example.invalid/fixture-${crypto.randomUUID()}`,
          subscription: {
            endpoint: "fixture",
            keys: { auth: "fixture", p256dh: "fixture" },
          },
        });
      expect(subscription.error).toBeNull();
      const hiddenSubscriptions = await outsider
        .from("wealth_push_subscriptions")
        .select("endpoint")
        .eq("household_id", householdId!);
      expect(hiddenSubscriptions.data).toEqual([]);
      const forbiddenSubscription = await second
        .from("wealth_push_subscriptions")
        .insert({
          household_id: householdId,
          user_id: users[0],
          endpoint: "https://example.invalid/forbidden",
          subscription: {},
        });
      expect(forbiddenSubscription.error).not.toBeNull();
    } finally {
      if (householdId) {
        const deleted = await admin
          .from("households")
          .delete()
          .eq("id", householdId);
        if (deleted.error) throw deleted.error;
      }
      for (const userId of users) {
        const removed = await admin.auth.admin.deleteUser(userId);
        if (removed.error) throw removed.error;
      }
    }
  },
  60000,
);
