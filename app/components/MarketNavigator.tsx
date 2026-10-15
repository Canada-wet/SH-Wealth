"use client";
import { useState, useEffect } from "react";
import { cloudClient } from "@/lib/cloud";
import { APP_VERSION } from "@/lib/releases";
import {
  Landmark,
  LineChart,
  Users,
  WalletCards,
  Globe2,
  ArrowUpRight,
  Target,
} from "lucide-react";
export default function MarketNavigator({
  active = "markets",
}: {
  active?: "markets" | "learn" | "updates";
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
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
      if (!client) throw new Error("登录服务尚未配置。");
      const result = await client.auth.signOut({ scope: "local" });
      if (result.error) throw new Error("暂时无法退出，请检查网络后重试。");
      // The market page owns the SIGNED_OUT redirect; avoid a second navigation.
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "退出失败，请重试。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <aside className="sidebar market-sidebar">
        <a className="brand" href="/#overview">
          <span>t</span>ogether
        </a>
        <nav aria-label="主导航">
          <a href="/#overview">
            <LineChart />
            全景
          </a>
          <a href="/#growth">
            <Target />
            增长行动
          </a>
          <a href="/#assets">
            <WalletCards />
            资产与负债
          </a>
          <a href="/#cashflow">
            <WalletCards />
            每月现金流
          </a>
          <a href="/#contributions">
            <Users />
            成员贡献
          </a>
          <a href="/#framework">
            <Landmark />
            家庭计划
          </a>
          <a
            href="/markets"
            aria-current={active === "markets" ? "page" : undefined}
          >
            <Globe2 />
            市场看板
          </a>
          <a
            href="/learn"
            aria-current={active === "learn" ? "page" : undefined}
          >
            <Target />
            每日心理学
          </a>
          <a
            href="/updates"
            aria-current={active === "updates" ? "page" : undefined}
          >
            <Users />
            版本更新 · Admin
          </a>
        </nav>
        <div className="sidebar-bottom market-sidebar-note">
          <a className="version-link" href="/updates">
            Together v{APP_VERSION} · Admin
          </a>
          <p>市场与家庭决策联动，不自动改估值。</p>
          <a href="/#overview">
            返回家庭工作台 <ArrowUpRight size={14} />
          </a>
          <button
            className="text-button"
            disabled={!ready || busy}
            onClick={() => void logout()}
          >
            {busy ? "正在退出…" : "退出当前设备登录"}
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      </aside>
      <nav className="market-mobile-nav" aria-label="手机主导航">
        <a href="/#overview">家庭财富</a>
        <a
          href="/markets"
          aria-current={active === "markets" ? "page" : undefined}
        >
          市场看板
        </a>
        <a href="/learn" aria-current={active === "learn" ? "page" : undefined}>
          心理学
        </a>
        <a
          href="/updates"
          aria-current={active === "updates" ? "page" : undefined}
        >
          v{APP_VERSION}
        </a>
        <button
          className="text-button"
          disabled={!ready || busy}
          onClick={() => void logout()}
        >
          退出登录
        </button>
        {error && <p role="alert">{error}</p>}
      </nav>
    </>
  );
}
