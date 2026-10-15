"use client";
import { useEffect, useState } from "react";
import { cloudClient } from "@/lib/cloud";
export default function PushSettings({ householdId }: { householdId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  useEffect(() => {
    if (!supported) return;
    void navigator.serviceWorker
      .getRegistration("/")
      .then(async (registration) => {
        if (registration)
          setEnabled(Boolean(await registration.pushManager.getSubscription()));
      });
  }, [supported]);
  const subscribe = async () => {
    setBusy(true);
    setError("");
    try {
      if (!householdId) throw new Error("请先在数据设置连接家庭空间。");
      const client = cloudClient();
      const session = await client?.auth.getSession();
      if (!session?.data.session) throw new Error("请先登录。");
      if (!publicKey) throw new Error("当前部署尚未配置 Web Push。");
      const permission = await Notification.requestPermission();
      if (permission !== "granted")
        throw new Error("浏览器通知尚未允许，可在网站权限中开启。");
      await navigator.serviceWorker.register("/sw.js");
      const registration = await navigator.serviceWorker.ready;
      const binary = atob(publicKey.replace(/-/g, "+").replace(/_/g, "/"));
      const applicationServerKey = new Uint8Array(
        [...binary].map((character) => character.charCodeAt(0)),
      );
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        }));
      const response = await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.data.session.access_token}`,
        },
        body: JSON.stringify({
          householdId,
          subscription: subscription.toJSON(),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (!existing) await subscription.unsubscribe();
        throw new Error(result.error || "订阅失败");
      }
      setEnabled(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "通知订阅失败");
    } finally {
      setBusy(false);
    }
  };
  const unsubscribe = async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const client = cloudClient();
        if (client) {
          const { error } = await client
            .from("wealth_push_subscriptions")
            .delete()
            .eq("endpoint", subscription.endpoint);
          if (error) throw error;
        }
        await subscription.unsubscribe();
      }
      setEnabled(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "取消订阅失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="push-settings">
      <h3>浏览器通知通道</h3>
      <p>
        连接共同空间后，可收到家庭财富周报；每日心理学还需在学习页单独订阅。
      </p>
      <button
        type="button"
        className="secondary"
        disabled={busy || !supported || !publicKey}
        onClick={() => void (enabled ? unsubscribe() : subscribe())}
      >
        {!supported
          ? "此浏览器不支持 Web Push"
          : enabled
            ? "关闭浏览器提醒"
            : "启用浏览器提醒"}
      </button>
      {!publicKey && <small>当前部署尚未配置推送；站内提醒仍可使用。</small>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
