"use client";
import { useEffect, useState, type ChangeEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { cloudClient } from "@/lib/cloud";
import { allowedEmail } from "@/lib/access";
import { parseBackup } from "@/lib/storage";
import type { WealthState } from "@/lib/wealth";
import Dialog from "./Dialog";
export default function DataSettings({
  state,
  onClose,
  restore,
  recoverPrevious,
  connectCloud,
  disconnectCloud,
  cloudStatus,
  householdId,
}: {
  state: WealthState;
  onClose: () => void;
  restore: (state: WealthState) => void;
  recoverPrevious: () => void;
  connectCloud: (id: string, mode: "load" | "upload") => Promise<void>;
  disconnectCloud: () => void;
  cloudStatus: string;
  householdId: string;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [households, setHouseholds] = useState<
    { household_id: string; display_name: string; role: "owner" | "member" }[]
  >([]);
  const [selected, setSelected] = useState(householdId);
  const [invite, setInvite] = useState("");
  const [inviteToShare, setInviteToShare] = useState("");
  const client = cloudClient();
  const reload = async () => {
    if (!client) return;
    const { data, error } = await client
      .from("household_members")
      .select("household_id,display_name,role");
    if (error)
      throw new Error(`${error.message}。请先运行数据库 persistence.sql。`);
    setHouseholds(data ?? []);
  };
  useEffect(() => {
    if (!client) return;
    void client.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, [client]);
  useEffect(() => {
    if (session) void reload().catch((reason) => setError(reason.message));
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  const auth = () =>
    run(async () => {
      if (!client) return;
      if (!allowedEmail(email)) throw new Error("此账号没有访问权限。");
      const { error } = await client.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) throw error;
    });
  const create = () =>
    run(async () => {
      const { data, error } = await client!.rpc("create_wealth_household", {
        display_name: state.members.first,
      });
      if (error) throw error;
      await reload();
      setSelected(data);
      setNotice("家庭空间已创建；选择上传本机数据即可开始同步。");
    });
  const join = () =>
    run(async () => {
      const { data, error } = await client!.rpc("join_wealth_household", {
        invite_token: invite.trim(),
        display_name: state.members.second,
      });
      if (error) throw error;
      await reload();
      setSelected(data);
      setNotice("已加入家庭空间，点击加载云端数据。");
    });
  const exportData = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `together-wealth-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const importData = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file)
      void run(async () => {
        const next = parseBackup(await file.text());
        if (
          !window.confirm("用这份备份恢复家庭数据？当前版本会保留为本机备份。")
        )
          return;
        restore(next);
        setNotice("备份已恢复并保存。");
      });
    event.target.value = "";
  };
  return (
    <Dialog title="数据与共同空间" onClose={onClose} error={error} wide>
      <div className="settings-block">
        <div className="status-row">
          <b>{cloudStatus}</b>
          <span>数据版本 {state.revision}</span>
        </div>
        <p>
          资产、回报、负债、贡献、规划、历史和聊天统一保存。连接 Supabase
          后，两位成员可在自己的设备上共享同一家庭。
        </p>
        <div className="button-row">
          <button type="button" className="secondary" onClick={exportData}>
            导出完整备份
          </button>
          <label className="secondary file-button">
            导入备份
            <input
              type="file"
              accept="application/json,.json"
              onChange={importData}
            />
          </label>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              void run(async () => {
                recoverPrevious();
                setNotice("已恢复上一份本机备份。");
              })
            }
          >
            恢复上一版本
          </button>
        </div>
      </div>
      <div className="settings-block">
        <h3>Supabase 家庭同步</h3>
        {!client ? (
          <p>
            当前未配置 Supabase，数据持久保存在此浏览器。配置项目
            URL、公开密钥并运行数据库脚本后，这里可登录并连接家庭空间。
          </p>
        ) : !session ? (
          <>
            <label>
              邮箱
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
            <label>
              密码
              <input
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <div className="button-row">
              <button
                type="button"
                className="primary"
                disabled={busy || !email || password.length < 8}
                onClick={() => void auth()}
              >
                登录
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => window.location.assign("/login")}
              >
                邮箱重置密码
              </button>
            </div>
          </>
        ) : (
          <>
            <p>已登录：{session.user.email}</p>
            <label>
              选择家庭
              <select
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setInviteToShare("");
                }}
              >
                <option value="">选择家庭空间</option>
                {households.map((row) => (
                  <option key={row.household_id} value={row.household_id}>
                    {row.display_name} 的家庭 · {row.household_id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <div className="button-row">
              <button
                type="button"
                className="primary"
                disabled={busy || !selected}
                onClick={() =>
                  void run(async () => {
                    if (
                      state.assets.length &&
                      !window.confirm(
                        "加载云端版本会替换当前页面数据，当前数据会保留为本机备份。继续？",
                      )
                    )
                      return;
                    await connectCloud(selected, "load");
                    setNotice("云端家庭已连接。");
                  })
                }
              >
                加载云端数据
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy || !selected}
                onClick={() =>
                  void run(async () => {
                    if (
                      !window.confirm(
                        "将当前本机数据上传到这个家庭？现有云端版本会留在云端历史中。",
                      )
                    )
                      return;
                    await connectCloud(selected, "upload");
                    setNotice("本机数据已上传。");
                  })
                }
              >
                上传本机数据
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void create()}
              >
                新建家庭
              </button>
            </div>
            <label>
              伴侣邀请代码
              <input
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                placeholder="输入伴侣分享的邀请代码"
              />
            </label>
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={busy || !invite.trim()}
                onClick={() => void join()}
              >
                加入家庭
              </button>
              <button
                type="button"
                className="text-button"
                disabled={
                  busy ||
                  !selected ||
                  households.find((row) => row.household_id === selected)
                    ?.role !== "owner"
                }
                onClick={() =>
                  void run(async () => {
                    const { data, error } = await client.rpc(
                      "household_invite_token",
                      { target_household: selected },
                    );
                    if (error) throw error;
                    setInviteToShare(data);
                  })
                }
              >
                显示邀请代码
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    disconnectCloud();
                    await client.auth.signOut();
                    setHouseholds([]);
                    window.location.assign("/login");
                  })
                }
              >
                退出登录
              </button>
            </div>
            {inviteToShare && (
              <p className="invite-code">
                邀请代码：<code>{inviteToShare}</code>
              </p>
            )}
          </>
        )}
      </div>
      {notice && (
        <p className="success-note" role="status">
          {notice}
        </p>
      )}
    </Dialog>
  );
}
