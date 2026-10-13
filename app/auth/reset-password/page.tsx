"use client";
import { useEffect, useState, type FormEvent } from "react";
import { cloudClient } from "@/lib/cloud";
import { allowedEmail } from "@/lib/access";
export default function ResetPassword() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    let active = true;
    const client = cloudClient();
    void (async () => {
      if (!client) throw new Error("登录服务尚未配置。");
      const params = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.slice(1));
      if (params.has("error") || hash.has("error"))
        throw new Error("重置链接已过期或失效，请重新申请。");
      const token = params.get("token_hash");
      if (token) {
        const result = await client.auth.verifyOtp({
          token_hash: token,
          type: "recovery",
        });
        if (result.error) throw result.error;
      }
      // Also supports default PKCE email links and existing hash-based links.
      const { data, error } = await client.auth.getUser();
      if (error || !allowedEmail(data.user?.email))
        throw new Error(
          "请从重置邮件打开有效链接；PKCE 链接需使用发送邮件时的浏览器。",
        );
      window.history.replaceState({}, "", "/auth/reset-password");
      if (active) setReady(true);
    })().catch((reason) => {
      if (active)
        setError(reason instanceof Error ? reason.message : "链接验证失败。");
    });
    return () => {
      active = false;
    };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 10) {
      setError("新密码至少需要 10 个字符。");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致。");
      return;
    }
    setBusy(true);
    try {
      const client = cloudClient()!;
      const { data } = await client.auth.getUser();
      if (!allowedEmail(data.user?.email))
        throw new Error("此账号没有访问权限。");
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      await client.auth.signOut();
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "密码更新失败。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <a className="auth-brand" href="/login">
          <span>t</span>ogether
        </a>
        <h1>{done ? "密码已更新" : "设置新密码"}</h1>
        <p>
          {done
            ? "请用新密码重新登录家庭空间。"
            : "使用独立的新密码，让家庭记录更安全。"}
        </p>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        {ready && !done && (
          <form onSubmit={submit}>
            <label>
              新密码
              <input
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label>
              确认新密码
              <input
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "正在保存…" : "更新密码"}
            </button>
          </form>
        )}
        {!ready && !error && <p role="status">正在验证邮件链接…</p>}
        <a className="text-button" href="/login">
          返回登录
        </a>
      </section>
    </main>
  );
}
