"use client";
import { useState } from "react";
import { money, type WealthState } from "@/lib/wealth";
import { snapshotChanges } from "@/lib/household-workspace";
export default function HistoryComparison({ state }: { state: WealthState }) {
  const [beforeId, setBeforeId] = useState(state.history.at(-2)?.id ?? "");
  const [afterId, setAfterId] = useState(state.history.at(-1)?.id ?? "");
  if (state.history.length < 2)
    return <p className="form-help">两份财务快照后可比较账户差异。</p>;
  const a = state.history.findIndex((row) => row.id === beforeId),
    b = state.history.findIndex((row) => row.id === afterId);
  const result =
    a >= 0 && b > a
      ? snapshotChanges(state.history[a], state.history[b])
      : null;
  const options = state.history.map((row, index) => (
    <option value={row.id} key={row.id}>
      {index + 1}. {new Date(row.at).toLocaleString("zh-CN")} · {row.reason}
    </option>
  ));
  return (
    <details className="history-comparison">
      <summary>比较两次记录</summary>
      <div className="form-grid">
        <label>
          较早快照
          <select
            aria-label="较早快照"
            value={beforeId}
            onChange={(event) => setBeforeId(event.target.value)}
          >
            {options}
          </select>
        </label>
        <label>
          较晚快照
          <select
            aria-label="较晚快照"
            value={afterId}
            onChange={(event) => setAfterId(event.target.value)}
          >
            {options}
          </select>
        </label>
      </div>
      {result ? (
        <>
          <p>
            净值变化 <b>{money(result.netDelta)}</b> ·
            包含估值、投入、删除和录入修正，不等于回报。
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>账户</th>
                  <th>较早</th>
                  <th>较晚</th>
                  <th>余额变化</th>
                </tr>
              </thead>
              <tbody>
                {result.changes.map((row, index) => (
                  <tr key={index}>
                    <td>{row.label}</td>
                    <td>
                      {row.before === null ? "未存在" : money(row.before)}
                    </td>
                    <td>{row.after === null ? "已删除" : money(row.after)}</td>
                    <td>{money(row.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!result.changes.length && (
            <p>资产、负债余额无变化；回报、现金流等细节请展开下方对应快照。</p>
          )}
          <small>表格比较资产与负债余额；其他字段保留在完整快照中。</small>
        </>
      ) : (
        <p role="alert">请选择按记录顺序更晚的第二份快照。</p>
      )}
    </details>
  );
}
