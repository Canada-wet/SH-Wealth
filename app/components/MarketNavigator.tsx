"use client";
import { useState, useEffect } from "react";
import { cloudClient } from "@/lib/cloud";
import AppNavigation from "./AppNavigation";
export default function MarketNavigator({
  active = "markets",
}: {
  active?: "markets" | "learn" | "updates" | "lifestyle" | "council";
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (active === "markets") return;
    const sub = cloudClient()?.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") window.location.replace("/login");
    });
    return () => sub?.data.subscription.unsubscribe();
  }, [active]);
  const logout = async () => {
    setBusy(true);
    setError("");
    try {
      const client = cloudClient();
      if (!client) throw Error("登录服务尚未配置。");
      const result = await client.auth.signOut({ scope: "local" });
      if (result.error) throw Error("暂时无法退出，请检查网络后重试。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AppNavigation
      active={active}
      footer={
        <>
          <button
            className="app-signout"
            disabled={busy}
            onClick={() => void logout()}
          >
            {busy ? "正在退出…" : "退出当前设备登录"}
          </button>
          {error && <p role="alert">{error}</p>}
        </>
      }
    />
  );
}
