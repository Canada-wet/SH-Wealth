"use client";
import { useState, type FormEvent } from "react";
import { LockKeyhole } from "lucide-react";
import { cloudClient } from "@/lib/cloud";
import { allowedEmail, safeReturnPath } from "@/lib/access";
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!allowedEmail(email)) {
      setError("此空间仅向已授权的两位家庭成员开放。");
      return;
    }
    const client = cloudClient();
    if (!client) {
      setError("登录服务尚未配置，请联系管理员。");
      return;
    }
    setBusy(true);
    try {
      if (reset) {
        const result = await client.auth.resetPasswordForEmail(
          email.trim().toLowerCase(),
          { redirectTo: `${window.location.origin}/auth/reset-password` },
        );
        if (result.error)
          throw new Error(
            result.error.code === "email_address_not_authorized"
              ? "邮件服务尚未允许向此地址发送邮件，请管理员配置 SMTP。"
              : result.error.message,
          );
        setNotice(
          "重置邮件已发送，请在当前浏览器打开邮件链接。若未收到，请查看垃圾邮件或稍后重试。",
        );
      } else {
        const result = await client.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (result.error)
          throw new Error("邮箱或密码不正确，请重试或重置密码。");
        if (!allowedEmail(result.data.user?.email)) {
          await client.auth.signOut();
          throw new Error("此账号没有访问权限。");
        }
        window.location.assign(
          safeReturnPath(
            new URLSearchParams(window.location.search).get("next"),
          ),
        );
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "操作失败，请稍后重试。",
      );
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
        <div className="auth-icon">
          <LockKeyhole size={24} />
        </div>
        <h1>{reset ? "找回你的访问权限" : "两个人，一个财富计划"}</h1>
        <p>私密家庭空间，仅限已授权的两位成员。</p>
        <form onSubmit={submit}>
          <label>
            邮箱
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {!reset && (
            <label>
              密码
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="auth-notice" role="status">
              {notice}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "请稍候…" : reset ? "发送重置邮件" : "登录家庭空间"}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              setReset(!reset);
              setError("");
              setNotice("");
            }}
          >
            {reset ? "返回登录" : "忘记密码？通过邮箱重置"}
          </button>
        </form>
        <small>家庭数据受账号权限保护，退出登录不会删除本机记录。</small>
      </section>
    </main>
  );
}
