"use client";
import { useEffect, useState, type ChangeEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { cloudClient, cloudRead, sharedHousehold } from "@/lib/cloud";
import { parseBackup, MIGRATION_KEY } from "@/lib/storage";
import type { WealthState } from "@/lib/wealth";
import type { CloudChoice } from "@/lib/useWealth";
import { allChats } from "@/lib/conversations";
import Dialog from "./Dialog";
import BackupBundle from "./BackupBundle";
export default function DataSettings({
  state,
  onClose,
  restore,
  recoverPrevious,
  connectCloud,
  disconnectCloud,
  cloudStatus,
  householdId,
  cloudChoice,
}: {
  state: WealthState;
  onClose: () => void;
  restore: (state: WealthState) => void;
  recoverPrevious: () => void;
  connectCloud: (id: string, mode: "load" | "upload" | "auto") => Promise<void>;
  disconnectCloud: () => void;
  cloudStatus: string;
  householdId: string;
  cloudChoice?: CloudChoice | null;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const client = cloudClient();
  useEffect(() => {
    if (!client) return;
    void client.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, [client]);
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
  const download = (payload: WealthState, label = "together-wealth") => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download =
      label + "-" + new Date().toISOString().slice(0, 10) + ".json";
    link.click();
    URL.revokeObjectURL(url);
  };
  const importData = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file)
      void run(async () => {
        const text = await file.text();
        if (JSON.parse(text)?.kind === "together-user-visible-export")
          throw new Error(
            "这是跨模块导出数据包，不是家庭账本导入格式。未修改数据；请按包内 restorePlan 在隔离环境恢复，或使用原家庭 JSON 备份。",
          );
        const next = parseBackup(text);
        const messages = allChats(next).reduce(
          (sum, chat) => sum + chat.messages.length,
          0,
        );
        if (
          !window.confirm(
            "导入备份：" +
              next.assets.length +
              " 项资产、" +
              next.debts.length +
              " 项负债、" +
              next.history.length +
              " 条历史、" +
              messages +
              " 条聊天。替换当前版本并同步到家庭云端？当前版本会保留为本机备份。",
          )
        )
          return;
        restore(next);
        setNotice("备份已恢复并保存；云端是否完成同步以上方状态为准。");
      });
    event.target.value = "";
  };
  return (
    <Dialog title="备份与家庭同步" onClose={onClose} error={error} wide>
      <div className="settings-block">
        <div className="status-row">
          <b>{cloudStatus}</b>
          <span>数据版本 {state.revision}</span>
        </div>
        <p>
          登录后自动连接你们的共同家庭。资产、规划、完整历史及聊天随修改同步到
          Supabase，同一账号换设备也能恢复。
        </p>
        {session && (
          <p>
            已登录：{session.user.email}
            {householdId && <small> · 家庭 {householdId.slice(0, 8)}</small>}
          </p>
        )}
        <div className="button-row">
          <button
            type="button"
            className="primary"
            disabled={busy || !client || !session}
            onClick={() =>
              void run(async () => {
                await connectCloud(
                  householdId || (await sharedHousehold()),
                  "auto",
                );
                setNotice(
                  "连接检查已完成，请查看保存状态；若出现版本选择，请先确认来源。",
                );
              })
            }
          >
            重新连接云端
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy || !householdId}
            onClick={() =>
              void run(async () => {
                const row = await cloudRead(householdId);
                if (!row.document) throw new Error("云端暂时没有保存文档。");
                download(row.document, "together-cloud-backup");
              })
            }
          >
            导出云端备份
          </button>
        </div>
      </div>
      {cloudChoice && (
        <div
          className="settings-block migration-choice"
          role="region"
          aria-label="选择数据版本"
        >
          <h3>发现两份不同的数据</h3>
          <p>
            两份都不会自动被覆盖。请确认保留哪份作为家庭共享版本；原本本机数据会另存一份迁移备份。
          </p>
          <table>
            <thead>
              <tr>
                <th>内容</th>
                <th>本机</th>
                <th>云端</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["资产", state.assets.length, cloudChoice.assets],
                ["负债", state.debts.length, cloudChoice.debts],
                ["历史", state.history.length, cloudChoice.history],
                [
                  "聊天",
                  allChats(state).reduce(
                    (sum, chat) => sum + chat.messages.length,
                    0,
                  ),
                  cloudChoice.messages,
                ],
              ].map(([label, local, cloud]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>{local}</td>
                  <td>{cloud}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="button-row">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (
                    !window.confirm(
                      "使用云端版本？当前本机版本将保留为迁移备份。",
                    )
                  )
                    return;
                  await connectCloud(cloudChoice.householdId, "load");
                  setNotice("已加载云端版本。");
                })
              }
            >
              使用云端数据
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (
                    !window.confirm(
                      "使用本机版本更新家庭云端？云端旧版本仍保留在文档历史中。",
                    )
                  )
                    return;
                  await connectCloud(cloudChoice.householdId, "upload");
                  setNotice("本机版本已上传家庭云端。");
                })
              }
            >
              使用本机数据
            </button>
          </div>
        </div>
      )}
      <div className="settings-block">
        <h3>完整备份与本地迁移</h3>
        <p>
          localhost 与 Vercel
          的浏览器存储互不相通。旧本地数据可导出后在这里导入；备份包含所有财务历史和全部聊天会话。
          这是家庭文档的完整备份，不包含独立保存的个人研讨、导航、收藏、行动或研究归档。
        </p>
        <div className="button-row">
          <button
            type="button"
            className="secondary"
            onClick={() => download(state)}
          >
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
                setNotice("已恢复上一份本机备份，请查看云端同步状态。");
              })
            }
          >
            恢复上一版本
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              void run(async () => {
                const raw = localStorage.getItem(MIGRATION_KEY);
                if (!raw)
                  throw new Error(
                    "这个浏览器尚无迁移前备份；原 localhost 备份请在原浏览器导出。",
                  );
                download(parseBackup(raw), "together-before-cloud");
              })
            }
          >
            导出迁移前本机备份
          </button>
        </div>
      </div>
      <BackupBundle
        key={`${householdId}:${session?.user.id ?? ""}`}
        householdId={householdId}
        userId={session?.user.id ?? ""}
        disabled={busy || !session}
      />
      <div className="button-row">
        <a className="text-button" href="/login">
          通过邮箱重置密码
        </a>
        {session && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                disconnectCloud();
                await client!.auth.signOut();
                window.location.assign("/login");
              })
            }
          >
            退出登录
          </button>
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
