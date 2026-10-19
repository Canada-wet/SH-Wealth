"use client";
import { useEffect, useRef, useState } from "react";
export default function BackupBundle({
  householdId,
  userId,
  disabled = false,
}: {
  householdId: string;
  userId: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  return (
    <div className="settings-block" aria-label="跨模块数据导出">
      <h3>跨模块数据包 · 当前账号可见范围</h3>
      <p>
        一次导出云端家庭文档与有界版本历史、本人研讨、导航、学习收藏，以及可见的研究归档和行动。伴侣的私人研讨不会导出；登录凭证、渠道地址和密钥不包含在内。
      </p>
      <p>
        数据包是敏感明文，请妥善保存。它不是全库备份，不含未同步的本机草稿；容量或数据表缺失会明确标为部分导出。请同时保留上方家庭文档备份，不能把数据包直接导入账本。
      </p>
      <button
        type="button"
        className="secondary"
        disabled={disabled || busy || !householdId}
        onClick={async () => {
          if (
            !window.confirm(
              "下载当前账号可见的云端数据？包含敏感家庭记录和个人研讨。请保存在私密位置；此操作只读取，不改写数据。",
            )
          )
            return;
          setBusy(true);
          setMessage("");
          setError("");
          const abort = new AbortController();
          controller.current = abort;
          const timer = setTimeout(() => abort.abort(), 45000);
          try {
            const response = await fetch("/api/backup", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ householdId, confirm: true }),
              signal: abort.signal,
            });
            const raw = await response.text();
            if (raw.length > 4200000)
              throw Error(
                "数据包超过页面接收上限，未下载。请保留原有备份，并按恢复说明分段导出。",
              );
            let data;
            try {
              data = JSON.parse(raw);
            } catch {
              throw Error("导出服务响应无效，未下载或改写任何数据。");
            }
            if (!response.ok)
              throw Error(
                typeof data.error === "string"
                  ? data.error
                  : "导出未完成，请重试。",
              );
            if (
              data.kind !== "together-user-visible-export" ||
              data.schemaVersion !== 1 ||
              !["complete", "partial"].includes(data.status)
            )
              throw Error("数据包格式无法确认，未下载。");
            if (
              abort.signal.aborted ||
              data.scope?.householdId !== householdId ||
              data.scope?.userId !== userId
            )
              throw Error(
                "导出期间账号或家庭范围无法确认，未下载；请在当前账号重新发起。",
              );
            const href = URL.createObjectURL(
              new Blob([raw], { type: "application/json;charset=utf-8" }),
            );
            const a = document.createElement("a");
            a.href = href;
            a.download = `Together-visible-data-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(href), 1000);
            setMessage(
              data.status === "partial"
                ? "已下载部分数据包：存在未导出的记录或读取失败。请查看包内 sections、limits 和 restorePlan，保留原家庭备份；不要把它当作完整恢复点。"
                : "当前账号可见的约定范围已导出。仍不等于全库备份；恢复步骤与排除项见包内说明。",
            );
          } catch (reason) {
            if (!abort.signal.aborted)
              setError(
                reason instanceof Error
                  ? reason.message
                  : "导出失败，未改写数据。",
              );
            else setError("导出已取消或超时，没有自动重发。");
          } finally {
            clearTimeout(timer);
            controller.current = null;
            setBusy(false);
          }
        }}
      >
        {busy ? "正在整理可见数据…" : "导出跨模块数据包"}
      </button>
      {message && (
        <p role="status" className="action-help">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
