"use client";
import { useRef, useState } from "react";
import { Paperclip, X, FileText, LoaderCircle } from "lucide-react";
import {
  validateCouncilAttachments,
  type CouncilAttachment,
} from "@/lib/council-attachments";
import { prepareCouncilFile } from "@/lib/council-files";

export function AttachmentList({
  items,
  remove,
}: {
  items: CouncilAttachment[];
  remove?: (id: string) => void;
}) {
  return (
    <div className="council-attachment-list">
      {items.map((a) => (
        <details key={a.id} className="council-attachment">
          <summary>
            <FileText size={16} />
            <span>{a.name}</span>
            <small>
              {a.kind === "image"
                ? "图片"
                : `${a.content.length.toLocaleString()} 字`}
            </small>
          </summary>
          <p>{a.note}</p>
          {a.kind === "image" ? (
            <img src={a.content} alt={`研讨附件：${a.name}`} />
          ) : (
            <pre>{a.content}</pre>
          )}
          {remove && (
            <button
              type="button"
              onClick={() => remove(a.id)}
              aria-label={`移除 ${a.name}`}
            >
              <X size={14} />
              移除附件
            </button>
          )}
        </details>
      ))}
    </div>
  );
}
export default function Attachments({
  items,
  onChange,
  onBusy,
  disabled,
}: {
  items: CouncilAttachment[];
  onChange: (items: CouncilAttachment[]) => void;
  onBusy: (busy: boolean) => void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null),
    processing = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const add = async (files: File[]) => {
    if (disabled || processing.current || !files.length) return;
    setError("");
    if (items.length + files.length > 5) {
      setError("每场最多 5 个附件，请先移除部分材料。");
      return;
    }
    processing.current = true;
    setBusy(true);
    onBusy(true);
    try {
      const next = [...items];
      for (const file of files) next.push(await prepareCouncilFile(file));
      onChange(validateCouncilAttachments(next));
    } catch (e) {
      setError((e as Error).message + " 本批未添加，已有附件保留。");
    } finally {
      processing.current = false;
      setBusy(false);
      onBusy(false);
    }
  };
  return (
    <section
      className="council-materials"
      aria-label="研讨附件"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void add(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="council-section-label">
        <h3>带上材料，一起看清楚</h3>
        <span>{items.length}/5</span>
      </div>
      <p>
        拖入文件，或添加图片与附件。支持 PDF、DOCX、TXT / MD、CSV /
        TSV、JSON；最多 2 张图片，每份原文件不超过 10 MB，文档合计 30,000 字。
      </p>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="添加研讨附件"
        accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.txt,.md,.csv,.tsv,.json"
        onChange={(e) => {
          void add(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled || busy || items.length >= 5}
        onClick={() => input.current?.click()}
      >
        {busy ? (
          <LoaderCircle size={16} className="council-spin" />
        ) : (
          <Paperclip size={16} />
        )}
        {busy ? "正在本机处理材料…" : "添加图片 / 附件"}
      </button>
      <p className="council-muted">
        开始前仅在本机处理，尚未云端保存；开始研讨后压缩图与提取文字随个人历史私密保存。原始文档不保存，图表和扫描内容请另加截图。每轮重复读取材料会增加用量；请先预览，确认内容完整清楚。
      </p>
      {error && (
        <p role="alert" className="council-alert">
          {error}
        </p>
      )}
      <AttachmentList
        items={items}
        remove={
          disabled || busy
            ? undefined
            : (id) => onChange(items.filter((a) => a.id !== id))
        }
      />
    </section>
  );
}
