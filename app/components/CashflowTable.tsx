"use client";
import { useRef, useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  budgetTotals,
  id,
  money,
  numberInput,
  ownerLabel,
  type BudgetItem,
  type WealthState,
} from "@/lib/wealth";
import Dialog from "./Dialog";
export default function CashflowTable({
  state,
  onChange,
}: {
  state: WealthState;
  onChange: (
    update: (state: WealthState) => WealthState,
    reason: string,
    financial?: boolean,
  ) => boolean;
}) {
  const [editing, setEditing] = useState<BudgetItem | null | undefined>(
    undefined,
  );
  const [error, setError] = useState("");
  const editBase = useRef("");
  const budget = state.budget ?? [];
  const total = budgetTotals(state);
  const save = (event: FormEvent) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    try {
      const row: BudgetItem = {
        id: editing?.id ?? id(),
        name: String(data.get("name") ?? "").trim(),
        owner: String(data.get("owner")),
        amount: numberInput(String(data.get("amount")), "每月金额"),
        kind: String(data.get("kind")) as BudgetItem["kind"],
        essential: data.get("essential") === "on",
      };
      if (
        onChange(
          (current) => {
            if (JSON.stringify(current.budget ?? []) !== editBase.current)
              throw new Error("现金流已更新，请关闭并重新打开编辑。");
            return {
              ...current,
              budget: editing
                ? (current.budget ?? []).map((item) =>
                    item.id === editing.id ? row : item,
                  )
                : [...(current.budget ?? []), row],
            };
          },
          "更新每月现金流",
          true,
        )
      )
        setEditing(undefined);
      else setError("现金流未保存。数据可能已更新，请关闭并重新打开编辑。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "金额无效");
    }
  };
  return (
    <section className="card cashflow-card" id="cashflow">
      <div className="card-head">
        <div>
          <h2>每月现金流</h2>
          <p>灵活维护收入与开支；必要开支自动用于应急金目标</p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setError("");
            editBase.current = JSON.stringify(budget);
            setEditing(null);
          }}
        >
          <Plus size={14} />
          添加项目
        </button>
      </div>
      <div className="cashflow-summary">
        <span>
          税后收入 <b>{money(total.income)}</b>
        </span>
        <span>
          预算开支 <b>{money(total.expenses)}</b>
        </span>
        <span>
          每月结余{" "}
          <b className={total.surplus < 0 ? "negative" : ""}>
            {money(total.surplus)}
          </b>
        </span>
      </div>
      {budget.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>项目</th>
                <th>归属</th>
                <th>类型</th>
                <th>必要开支</th>
                <th className="numeric">每月 CAD</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {budget.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{ownerLabel(row.owner, state.members)}</td>
                  <td>{row.kind === "income" ? "收入" : "开支"}</td>
                  <td>
                    {row.kind === "expense" && row.essential ? "是" : "—"}
                  </td>
                  <td className="numeric">{money(row.amount)}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        aria-label={`编辑现金流${row.name}`}
                        onClick={() => {
                          setError("");
                          editBase.current = JSON.stringify(budget);
                          setEditing(row);
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        aria-label={`删除现金流${row.name}`}
                        onClick={() => {
                          if (window.confirm(`删除「${row.name}」现金流项目？`))
                            onChange(
                              (current) => ({
                                ...current,
                                budget: (current.budget ?? []).filter(
                                  (item) => item.id !== row.id,
                                ),
                              }),
                              "删除现金流项目",
                              true,
                            );
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="table-empty">
          把工资、房租、日常开支逐行加入，计划中会自动汇总。
        </p>
      )}
      {editing !== undefined && (
        <Dialog
          title={editing ? "编辑现金流项目" : "添加现金流项目"}
          onClose={() => setEditing(undefined)}
          onSubmit={save}
          error={error}
        >
          <label>
            项目名称
            <input
              name="name"
              required
              defaultValue={editing?.name}
              placeholder="例如：税后工资、房租"
              autoFocus
            />
          </label>
          <div className="form-grid">
            <label>
              类型
              <select name="kind" defaultValue={editing?.kind ?? "expense"}>
                <option value="expense">开支</option>
                <option value="income">收入</option>
              </select>
            </label>
            <label>
              归属
              <select name="owner" defaultValue={editing?.owner ?? "joint"}>
                {["joint", "first", "second"].map((owner) => (
                  <option key={owner} value={owner}>
                    {ownerLabel(owner, state.members)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            每月金额（CAD）
            <input
              name="amount"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={editing?.amount}
            />
          </label>
          <label className="checkbox-label">
            <input
              name="essential"
              type="checkbox"
              defaultChecked={editing?.essential ?? true}
            />
            必要开支（仅对开支有效）
          </label>
          <div className="dialog-actions">
            <button className="primary">保存现金流</button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
