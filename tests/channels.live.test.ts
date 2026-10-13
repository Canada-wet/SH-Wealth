import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { it, expect, vi } from "vitest";
import { channelHash, encryptRecipient, recipientHash } from "../lib/channels";
import { emptyState, saveAsset, validateState } from "../lib/wealth";
it.skipIf(process.env.RUN_SUPABASE_INTEGRATION !== "1")(
  "真实渠道数据库：一次性绑定、外部只读聊天、回调去重与RLS隔离",
  async () => {
    loadEnvConfig(process.cwd());
    vi.stubEnv(
      "NOTIFICATION_ENCRYPTION_KEY",
      Buffer.alloc(32, 9).toString("base64"),
    );
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
      key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const options = {
      auth: { persistSession: false, autoRefreshToken: false },
    };
    const admin = createClient(
        url,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        options,
      ),
      owner = createClient(url, key, options),
      partner = createClient(url, key, options);
    let home: string | undefined;
    const events: string[] = [];
    const nonce = crypto.randomUUID();
    try {
      const first = await owner.auth.signInWithPassword({
        email: "henrywhy233@gmail.com",
        password: process.env.TEST_MEMBER_ONE_PASSWORD!,
      });
      if (first.error) throw first.error;
      const second = await partner.auth.signInWithPassword({
        email: "sallyxie0378@gmail.com",
        password: process.env.TEST_MEMBER_TWO_PASSWORD!,
      });
      if (second.error) throw second.error;
      const created = await owner.rpc("create_wealth_household", {
        display_name: "Channel fixture",
      });
      if (created.error) throw created.error;
      home = created.data;
      const seed = saveAsset(emptyState(), {
        id: "fixture",
        name: "合成现金",
        category: "现金",
        owner: "joint",
        value: 500,
        annualReturn: null,
      });
      seed.messages = [{ id: "old", role: "user", text: "已保留的旧会话" }];
      const saved = await owner.rpc("save_household_document", {
        target_household: home,
        expected_revision: 0,
        next_document: seed,
      });
      if (saved.error) throw saved.error;
      const token = "fixture-" + nonce;
      const inserted = await admin
        .from("wealth_channel_links")
        .insert({
          token_hash: channelHash(token),
          household_id: home,
          user_id: first.data.user!.id,
          channel: "telegram",
          advisor_enabled: true,
          expires_at: new Date(Date.now() + 60000).toISOString(),
        });
      if (inserted.error) throw inserted.error;
      const bind = {
        link_hash: channelHash(token),
        link_channel: "telegram",
        recipient_cipher: encryptRecipient(nonce),
        recipient_hash: recipientHash("telegram", nonce),
        recipient_label: "Synthetic private recipient",
        event_id: "bind-" + nonce,
      };
      events.push(bind.event_id);
      expect(
        (await owner.rpc("consume_wealth_channel_link", bind)).error,
      ).toBeTruthy();
      const connected = await admin.rpc("consume_wealth_channel_link", bind);
      if (connected.error) throw connected.error;
      const channel = connected.data;
      expect(channel).toBeTruthy();
      expect(
        (await admin.rpc("consume_wealth_channel_link", bind)).data,
      ).toBeNull();
      expect(
        (
          await partner
            .from("wealth_notification_channels")
            .select("id")
            .eq("household_id", home)
        ).data,
      ).toEqual([]);
      expect(
        (
          await owner
            .from("wealth_notification_channels")
            .select("id")
            .eq("household_id", home)
        ).data,
      ).toHaveLength(1);
      await owner
        .from("wealth_notification_channels")
        .update({ enabled: false })
        .eq("id", channel);
      expect(
        (
          await admin
            .from("wealth_notification_channels")
            .select("enabled")
            .eq("id", channel)
            .single()
        ).data?.enabled,
      ).toBe(true);
      const message = {
        target_channel: channel,
        message_id: "u-" + nonce,
        message_role: "user",
        message_text: "目前净资产多少？",
        source_event_id: "q-" + nonce,
      };
      events.push(message.source_event_id);
      expect(
        (await owner.rpc("append_wealth_channel_message", message)).error,
      ).toBeTruthy();
      const received = await admin.rpc(
        "append_wealth_channel_message",
        message,
      );
      if (received.error) throw received.error;
      validateState(received.data);
      expect(received.data.assets).toEqual(seed.assets);
      expect(received.data.messages).toEqual(seed.messages);
    expect(received.data.chatArchives?.[0]?.messages).toHaveLength(1);
      expect(
        (await admin.rpc("append_wealth_channel_message", message)).data,
      ).toBeNull();
      const reply = await admin.rpc("append_wealth_channel_message", {
        ...message,
        message_id: "a-" + nonce,
        message_role: "assistant",
        message_text: "当前净资产为 CAD 500（合成测试）。",
        source_event_id: null,
      });
      if (reply.error) throw reply.error;
      validateState(reply.data);
    expect(reply.data.chatArchives?.[0]?.messages).toHaveLength(2);
      expect(reply.data.assets).toEqual(seed.assets);
      const alertId = crypto.randomUUID();
      const alert = await admin
        .from("advisor_alerts")
        .insert({
          id: alertId,
          household_id: home,
          title: "Synthetic notice",
          body: "Fixture only",
        });
      if (alert.error) throw alert.error;
      const claims = await Promise.all([
        admin.rpc("claim_wealth_channel_delivery", {
          target_channel: channel,
          target_alert: alertId,
        }),
        admin.rpc("claim_wealth_channel_delivery", {
          target_channel: channel,
          target_alert: alertId,
        }),
      ]);
      for (const claim of claims) if (claim.error) throw claim.error;
      expect(claims.map((row) => row.data).sort()).toEqual([false, true]);
      const stopEvent = "stop-" + nonce;
      events.push(stopEvent);
      const stop = await admin.rpc("stop_wealth_channel", {
        target_channel: "telegram",
        recipient_hash: bind.recipient_hash,
        source_event_id: stopEvent,
      });
      if (stop.error) throw stop.error;
      expect(stop.data).toBe(true);
      expect(
        (
          await admin.rpc("append_wealth_channel_message", {
            ...message,
            source_event_id: "blocked-" + nonce,
          })
        ).error,
      ).toBeTruthy();
    } finally {
      if (home) {
        const cleaned = await admin.from("households").delete().eq("id", home);
        if (cleaned.error) throw cleaned.error;
      }
      if (events.length)
        await admin
          .from("wealth_channel_events")
          .delete()
          .in("event_id", events);
      await owner.auth.signOut({ scope: "local" });
      await partner.auth.signOut({ scope: "local" });
      vi.unstubAllEnvs();
    }
  },
  60000,
);
