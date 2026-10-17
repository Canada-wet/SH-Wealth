import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  ready: vi.fn(() => ({ ready: true })),
  decrypt: vi.fn(() => "synthetic-chat"),
}));
vi.mock("../lib/channels", () => ({
  ChannelSendError: class extends Error {},
  channelReadiness: mocks.ready,
  decryptRecipient: mocks.decrypt,
  sendChannelNotice: mocks.send,
}));
import { dispatchChannelNotices } from "../lib/channel-server";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue(undefined);
});
it("季度复盘复用原子发件箱，重复检查不外发，未配置季度模板的WhatsApp不认领", async () => {
  const claimed = new Set<string>(),
    claims: string[] = [];
  const chain = {
    eq: () => chain,
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data: [
          { id: "t", channel: "telegram", destination_cipher: "fixture" },
          { id: "w", channel: "whatsapp", destination_cipher: "fixture" },
        ],
        error: null,
      }).then(resolve),
  };
  const db = {
    from: () => ({ select: () => chain, update: () => ({ eq: () => chain }) }),
    rpc: async (
      _: string,
      args: { target_channel: string; target_alert: string },
    ) => {
      const k = JSON.stringify(args);
      claims.push(args.target_channel);
      if (claimed.has(k)) return { data: false };
      claimed.add(k);
      return { data: true };
    },
  } as unknown as SupabaseClient;
  expect(await dispatchChannelNotices(db, "home", "alert", "2026-Q3")).toEqual({
    accepted: 1,
    failures: 0,
  });
  expect(await dispatchChannelNotices(db, "home", "alert", "2026-Q3")).toEqual({
    accepted: 0,
    failures: 0,
  });
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
    "telegram",
    "synthetic-chat",
    "wealth-alert-t",
    false,
    undefined,
    "2026-Q3",
  );
  expect(claims).toEqual(["t", "t"]);
});
