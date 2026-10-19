"use client";
import type { CouncilToolReceipt } from "@/lib/council-research";
const names = {
  calculate: "数字计算",
  search_documents: "本场附件检索",
  search_public: "公开资料搜索",
};
const statuses = {
  succeeded: "已返回",
  failed: "未完成",
  running: "已认领 · 结果待确认",
  unknown: "结果不确定",
};
export default function ToolReceipts({
  receipts,
}: {
  receipts: CouncilToolReceipt[];
}) {
  if (!receipts.length) return null;
  return (
    <div className="council-tool-receipts" aria-label="真实工具回执">
      {receipts.map((r) => {
        let hits: { name: string; excerpt: string; note: string }[] | null =
          null;
        if (r.tool === "search_documents")
          try {
            const parsed = JSON.parse(r.output);
            if (Array.isArray(parsed)) hits = parsed;
          } catch {}
        return (
          <details key={r.id} open={r.status !== "succeeded"}>
            <summary>
              <strong>
                {r.id} · {names[r.tool]}
              </strong>
              <span>
                {statuses[r.status]}
                {r.reusedFrom ? ` · 复用 ${r.reusedFrom}` : ""}
              </span>
            </summary>
            <p className="council-muted">请求：{r.input}</p>
            {hits ? (
              hits.map((h, i) => (
                <blockquote key={i}>
                  <p>{h.excerpt}</p>
                  <small>
                    {h.name} · {h.note}
                  </small>
                </blockquote>
              ))
            ) : (
              <pre>
                {r.output || "未收到确认结果，不视为已验证事实，也不自动重发。"}
              </pre>
            )}
            {!!r.sources?.length && (
              <ul>
                {r.sources.map((s) =>
                  /^https:\/\//.test(s.url) ? (
                    <li key={s.url}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        {s.title} ↗
                      </a>
                    </li>
                  ) : null,
                )}
              </ul>
            )}
            <p className="council-muted">
              核查时间 {new Date(r.checkedAt).toLocaleString("zh-CN")} ·
              工具返回不代表来源真实或输入假设成立。
            </p>
          </details>
        );
      })}
    </div>
  );
}
