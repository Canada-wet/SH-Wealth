"use client";
import { useEffect, useState } from "react";
import { Plus, LockKeyhole, Users } from "lucide-react";
import { cloudClient } from "@/lib/cloud";
import useActionCenter from "@/lib/useActionCenter";
import {
  ACTION_TITLE_MAX,
  type ActionItem,
  type CreateActionInput,
} from "@/lib/action-center";
import { FEATURES } from "@/lib/navigation";
import Dialog from "./Dialog";

export const ACTION_STATUSES = {
  planned: "待开始",
  doing: "进行中",
  done: "已完成",
} as const;
export function ActionFields({
  value,
  change,
  disabled = false,
}: {
  value: Pick<CreateActionInput, "title" | "note" | "owner" | "status" | "due">;
  change: (patch: Partial<typeof value>) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="action-fields" disabled={disabled}>
      <label>
        下一步做什么
        <input
          aria-label="行动标题"
          value={value.title}
          required
          maxLength={ACTION_TITLE_MAX}
          onChange={(e) => change({ title: e.target.value })}
          placeholder="用一个具体、可完成的动作描述"
        />
      </label>
      <label>
        完成标准或需要核对的证据
        <textarea
          aria-label="行动说明"
          value={value.note}
          maxLength={2000}
          rows={3}
          onChange={(e) => change({ note: e.target.value })}
          placeholder="例如：核对发行人文件后，记录三项可能推翻投资逻辑的事实。"
        />
      </label>
      <div className="action-form-row">
        <label>
          负责人
          <select
            aria-label="行动负责人"
            value={value.owner}
            onChange={(e) =>
              change({ owner: e.target.value as ActionItem["owner"] })
            }
          >
            <option value="joint">共同</option>
            <option value="first">成员一</option>
            <option value="second">成员二</option>
          </select>
        </label>
        <label>
          目标日期
          <input
            aria-label="行动目标日期"
            type="date"
            value={value.due}
            onChange={(e) => change({ due: e.target.value })}
          />
        </label>
        <label>
          进度
          <select
            aria-label="行动进度"
            value={value.status}
            onChange={(e) =>
              change({ status: e.target.value as ActionItem["status"] })
            }
          >
            {Object.entries(ACTION_STATUSES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </fieldset>
  );
}

function CaptureForm({
  householdId,
  sourceFeature,
  sourceRef,
  suggestedTitle,
  onClose,
  onSaved,
}: {
  householdId: string;
  sourceFeature: string;
  sourceRef: string;
  suggestedTitle: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const store = useActionCenter(householdId);
  const [draft, setDraft] = useState<CreateActionInput>({
    title: suggestedTitle.slice(0, ACTION_TITLE_MAX),
    note: "",
    owner: "joint",
    status: "planned",
    due: "",
    visibility: "private",
    sourceFeature,
    sourceRef,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const source = FEATURES.find((f) => f.id === sourceFeature);
  return (
    <Dialog
      title="把想法变成下一步"
      onClose={() => {
        if (!busy) onClose();
      }}
      error={error}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        if (
          draft.visibility === "household" &&
          !window.confirm(
            "将这个行动的标题、说明、负责人和日期分享给伴侣？研讨正文和附件不会自动分享。",
          )
        )
          return;
        setBusy(true);
        setError("");
        try {
          await store.create({
            ...draft,
            title: draft.title.trim(),
            sourceRef:
              draft.visibility === "household" && sourceFeature === "council"
                ? ""
                : sourceRef,
          });
          onSaved();
          onClose();
        } catch (reason) {
          setError(
            reason instanceof Error
              ? reason.message
              : "尚未确认保存，草稿仍保留。请先重新读取行动中心，再决定是否重试。",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="action-help">
        只保存你确认的行动，不自动复制研讨正文、附件或财富数据。
        {source ? ` 来源：${source.title}。` : ""}
      </p>
      <ActionFields
        value={draft}
        disabled={busy}
        change={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      />
      <fieldset className="action-visibility" disabled={busy}>
        <legend>谁可以看和跟进？</legend>
        <label>
          <input
            type="radio"
            name="action-visibility"
            checked={draft.visibility === "private"}
            onChange={() => setDraft((d) => ({ ...d, visibility: "private" }))}
          />
          <LockKeyhole size={16} />
          <span>
            仅自己<small>伴侣看不到这条行动；负责人仅为规划标签。</small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="action-visibility"
            checked={draft.visibility === "household"}
            onChange={() =>
              setDraft((d) => ({ ...d, visibility: "household" }))
            }
          />
          <Users size={16} />
          <span>
            家庭共享<small>双方可跟进和编辑。保存前再次确认分享。</small>
          </span>
        </label>
      </fieldset>
      <p className="action-help">
        保存后不更改可见范围或来源，避免私人资料被意外公开。这里不下单、不转账，也不会自动发提醒。
      </p>
      {error && (
        <p className="action-help">
          若请求已经发送，结果可能已保存。请先到
          <a href="/space#actions">行动中心核对</a>
          ，不要改写草稿后重复新建；原内容的明确重试会沿用本次创建编号。
        </p>
      )}
      <div className="button-row">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "正在确认保存…" : "保存行动"}
        </button>
        <button
          className="secondary"
          type="button"
          disabled={busy}
          onClick={onClose}
        >
          取消
        </button>
      </div>
    </Dialog>
  );
}

function ResolveCapture(props: {
  householdId?: string;
  sourceFeature: string;
  sourceRef: string;
  suggestedTitle: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [home, setHome] = useState(props.householdId || ""),
    [error, setError] = useState("");
  useEffect(() => {
    if (props.householdId) return;
    let active = true;
    void (async () => {
      try {
        const client = cloudClient();
        if (!client) throw Error("尚未连接家庭云端，不能保存行动。");
        const { data, error: authError } = await client.auth.getUser();
        if (authError || !data.user) throw Error("请先登录，再保存行动。");
        const result = await client
          .from("household_members")
          .select("household_id")
          .eq("user_id", data.user.id)
          .limit(2);
        if (result.error || result.data?.length !== 1)
          throw Error(
            "无法唯一确认家庭空间。请先到家庭首页连接云端，再试一次。",
          );
        if (active) setHome(result.data[0].household_id);
      } catch (reason) {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "家庭空间读取失败，请重试。",
          );
      }
    })();
    return () => {
      active = false;
    };
  }, [props.householdId]);
  return home ? (
    <CaptureForm {...props} householdId={home} />
  ) : (
    <Dialog title="连接行动中心" onClose={props.onClose} error={error}>
      <p role="status">
        {error ? "未创建行动，也未修改家庭记录。" : "正在核对已有家庭连接…"}
      </p>
      <a className="text-button" href="/space#actions">
        前往家庭行动中心
      </a>
    </Dialog>
  );
}

export default function ActionCapture({
  householdId,
  sourceFeature = "",
  sourceRef = "",
  suggestedTitle = "",
  label = "存为行动",
  disabled = false,
}: {
  householdId?: string;
  sourceFeature?: string;
  sourceRef?: string;
  suggestedTitle?: string;
  label?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    setOpen(false);
    setSaved(false);
  }, [householdId]);
  useEffect(() => {
    const reset = () => {
      setOpen(false);
      setSaved(false);
    };
    window.addEventListener("together-action-session-changed", reset);
    return () =>
      window.removeEventListener("together-action-session-changed", reset);
  }, []);
  return (
    <span className="action-capture">
      <button
        type="button"
        className="secondary action-capture-button"
        disabled={disabled}
        onClick={() => {
          setSaved(false);
          setOpen(true);
        }}
      >
        <Plus size={15} />
        {label}
      </button>
      {saved && (
        <small role="status">
          已保存到<a href="/space#actions">行动中心</a>
        </small>
      )}
      {open && (
        <ResolveCapture
          key={householdId || "resolve"}
          householdId={householdId}
          sourceFeature={sourceFeature}
          sourceRef={sourceRef}
          suggestedTitle={suggestedTitle}
          onClose={() => setOpen(false)}
          onSaved={() => setSaved(true)}
        />
      )}
    </span>
  );
}
