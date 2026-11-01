"use client";
import { useEffect, useState } from "react";
import { Eye, EyeOff, FlaskConical } from "lucide-react";
import MarketNavigator from "@/app/components/MarketNavigator";
import { ModuleBridge } from "@/app/components/AppNavigation";
import useWealth from "@/lib/useWealth";
import BacktestWorkspace from "@/app/components/backtest/BacktestWorkspace";
import { changeBacktestLab } from "@/lib/backtest-context";
import "./backtest.css";
export default function BacktestPage() {
  const store = useWealth();
  const [privacy, setPrivacy] = useState(false);
  useEffect(() => {
    setPrivacy(sessionStorage.getItem("together-privacy") === "on");
  }, []);
  return (
    <main className="market-shell">
      <MarketNavigator active="backtest" />
      <div className="markets-page bt-page" id="page-content" tabIndex={-1}>
        <header className="markets-header">
          <div>
            <p className="eyebrow">TOGETHER · INVESTMENT LAB</p>
            <h1>
              <FlaskConical size={29} /> 投资回测
            </h1>
            <p>先检验历史，再讨论未来。把策略放在同一把尺上。</p>
          </div>
          <div className="bt-header-tools">
            <span role="status">{store.cloudStatus}</span>
            <button
              className="icon-button"
              aria-label={privacy ? "显示回测" : "隐藏回测"}
              onClick={() => {
                setPrivacy(!privacy);
                sessionStorage.setItem(
                  "together-privacy",
                  privacy ? "off" : "on",
                );
              }}
            >
              {privacy ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
          </div>
        </header>
        <ModuleBridge featureId="backtest" />
        {store.error && (
          <p className="form-error" role="alert">
            {store.error}
          </p>
        )}
        {store.cloudChoice && (
          <p className="bt-notice" role="alert">
            家庭数据有版本冲突，保存已暂停。<a href="/">返回财富页处理同步 →</a>
          </p>
        )}
        {!store.ready || store.cloudLoading ? (
          <p role="status" className="card">
            正在读取家庭空间…
          </p>
        ) : privacy ? (
          <div className="card bt-empty">
            <EyeOff />
            <h2>回测空间已隐藏</h2>
            <p>点击右上角眼睛恢复。</p>
          </div>
        ) : (
          <BacktestWorkspace
            key={store.cloudHousehold || "local"}
            state={store.state}
            scope={store.cloudHousehold}
            editable={!store.cloudChoice}
            onSaveLab={(next, expected) => {
              store.commit(
                (s) => changeBacktestLab(s, expected, next),
                "保存投资回测计划",
                false,
              );
            }}
          />
        )}
      </div>
    </main>
  );
}
