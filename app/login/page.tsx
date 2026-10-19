"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
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
  const [checking, setChecking] = useState(true),
    [showPassword, setShowPassword] = useState(false),
    [hydrated, setHydrated] = useState(false);
  const submitting = useRef(false);
  const interacted = useRef(false);
  useEffect(() => {
    setHydrated(true);
    let active = true;
    const client = cloudClient();
    if (
      !client ||
      new URLSearchParams(window.location.search).get("reauth") === "1"
    ) {
      setChecking(false);
      return;
    }
    void client.auth
      .getUser()
      .then(({ data }) => {
        if (
          active &&
          !submitting.current &&
          !interacted.current &&
          allowedEmail(data.user?.email) &&
          data.user?.email_confirmed_at
        )
          window.location.replace(
            safeReturnPath(
              new URLSearchParams(window.location.search).get("next"),
            ),
          );
      })
      .catch(() => {})
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    interacted.current = true;
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
    submitting.current = true;
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
        if (result.error) {
          const failure = result.error;
          throw new Error(
            failure.status === 429
              ? "登录尝试过于频繁，请稍后重试。"
              : failure.status === 0 ||
                  (failure.status ?? 0) >= 500 ||
                  /fetch|network/i.test(failure.message)
                ? "登录服务暂时无法连接，请检查网络后重试。"
                : failure.code === "email_not_confirmed"
                  ? "邮箱尚未完成验证，请联系管理员。"
                  : "邮箱或密码不正确，请重试或重置密码。",
          );
        }
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
      submitting.current = false;
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
        <h1>{reset ? "找回你的访问权限" : "两个人，一个共同空间"}</h1>
        <p>私密家庭空间，仅限已授权的两位成员。</p>
        {checking && (
          <small role="status">
            {hydrated
              ? "正在检查已有登录；也可直接填写邮箱和密码。"
              : "正在准备登录表单；若长时间停留，请启用 JavaScript 或刷新页面。"}
          </small>
        )}
        <form
          onSubmit={submit}
          onInput={() => {
            interacted.current = true;
          }}
        >
          <label>
            邮箱
            <input
              type="email"
              autoComplete="username"
              required
              disabled={!hydrated || busy}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {!reset && (
            <label>
              密码
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                disabled={!hydrated || busy}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          {!reset && (
            <button
              className="text-button"
              type="button"
              disabled={!hydrated || busy}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? "隐藏密码" : "显示密码"}
            </button>
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
          <button className="primary" disabled={!hydrated || busy}>
            {busy ? "请稍候…" : reset ? "发送重置邮件" : "登录家庭空间"}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={!hydrated || busy}
            onClick={() => {
              interacted.current = true;
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
