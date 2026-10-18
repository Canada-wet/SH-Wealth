"use client";
import { useEffect, useState } from "react";
import MarketNavigator from "@/app/components/MarketNavigator";
import { APP_VERSION, RELEASES } from "@/lib/releases";
export default function Updates() {
  const [access, setAccess] = useState<{
      viewer: string;
      version: string;
    } | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    void fetch("/api/releases", { cache: "no-store", signal: c.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw Error(body.error || "版本记录暂不可用");
        setAccess(body);
        setError("");
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [retry]);
  return (
    <main className="market-shell">
      <MarketNavigator active="updates" />
      <div
        className="markets-page learning-page"
        id="page-content"
        tabIndex={-1}
      >
        <header className="markets-header">
          <div>
            <p className="eyebrow">TOGETHER · RELEASE NOTES</p>
            <h1>版本与更新</h1>
            <p>两位授权成员均为应用管理员，可查看功能变化与已知边界。</p>
          </div>
          <span className="version-badge">v{APP_VERSION}</span>
        </header>
        {error ? (
          <div role="alert" className="card">
            <p>{error}</p>
            <button
              className="secondary"
              onClick={() => setRetry((n) => n + 1)}
            >
              重试读取版本
            </button>
            <a href="/login?next=%2Fupdates">重新登录</a>
          </div>
        ) : !access ? (
          <p role="status">正在验证管理员权限…</p>
        ) : (
          <>
            <p className="admin-status">
              管理员 · {access.viewer} · 当前服务版本 v{access.version}
            </p>
            {RELEASES.map((release) => (
              <section key={release.version} className="card release-card">
                <div className="section-head">
                  <h2>
                    v{release.version} · {release.title}
                  </h2>
                  <span>{release.date ?? "历史基线 · 日期未编录"}</span>
                </div>
                <ul>
                  {release.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <details>
                  <summary>已知边界与注意事项</summary>
                  <ul>
                    {release.limitations.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </details>
              </section>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
