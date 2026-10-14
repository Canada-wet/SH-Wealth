"use client";
import { useState, useEffect } from "react";
import { cloudClient } from "@/lib/cloud";
import {
  Landmark,
  LineChart,
  Users,
  WalletCards,
  Globe2,
  ArrowUpRight,
} from "lucide-react";
export default function MarketNavigator() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
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
          <a href="/markets" aria-current="page">
            <Globe2 />
            市场看板
          </a>
        </nav>
        <div className="sidebar-bottom market-sidebar-note">
          <span>MARKET RESEARCH</span>
          <p>公共市场数据与家庭账本分开。看行情，不自动改估值。</p>
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
        <a href="/markets" aria-current="page">
          市场看板
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
