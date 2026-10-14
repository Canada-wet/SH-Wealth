"use client";
import { useState, type FormEvent } from "react";
import Dialog from "./Dialog";
import { money, numberInput, type WealthState } from "@/lib/wealth";
import { financialFingerprint } from "@/lib/advisor-preview";
import { todayToronto, updateValuations } from "@/lib/household-workspace";
export default function ValuationTable({
  state,
  onChange,
  onClose,
}: {
  state: WealthState;
  onClose: () => void;
  onChange: (
    update: (state: WealthState) => WealthState,
    reason: string,
    financial?: boolean,
  ) => boolean;
}) {
  const [base] = useState(() => structuredClone(state));
  const [rows, setRows] = useState(() =>
    base.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      value: String(asset.value),
      annualReturn:
        asset.annualReturn === null ? "" : String(asset.annualReturn),
      selected: false,
    })),
  );
  const [date, setDate] = useState(todayToronto());
  const [error, setError] = useState("");
  const save = (event: FormEvent) => {
    event.preventDefault();
    try {
      const edits = rows
        .filter((row) => row.selected)
        .map((row) => ({
          id: row.id,
          value: numberInput(row.value, "当前价值"),
          annualReturn: row.annualReturn.trim()
            ? numberInput(row.annualReturn, "本年回报", true)
            : null,
          valuationDate: date,
        }));
      if (date > todayToronto()) throw new Error("核对日期不能在未来。");
      if (
        onChange(
          (current) =>
            updateValuations(current, edits, financialFingerprint(base)),
          `批量核对 ${edits.length} 项资产`,
          true,
        )
      )
        onClose();
      else setError("保存未完成，可能数据已更新。请关闭并重新打开表格。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "请检查表格。");
    }
  };
  return (
    <Dialog
      title="批量核对资产"
      wide
      onClose={onClose}
      onSubmit={save}
      error={error}
    >
      <p className="form-help">
        只更新勾选项目；回报留空会清除原回报。一次保存、一份历史快照；不修改贡献记录。
      </p>
      <label>
        本次核对日期
        <input
          type="date"
          required
          aria-label="批量核对日期"
          max={todayToronto()}
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={rows.length > 0 && rows.every((row) => row.selected)}
          onChange={(event) =>
            setRows(
              rows.map((row) => ({ ...row, selected: event.target.checked })),
            )
          }
        />
        选择全部资产
      </label>
      <div className="table-scroll">
        <table className="valuation-table">
          <thead>
            <tr>
              <th>核对</th>
              <th>资产</th>
              <th>当前价值 · CAD</th>
              <th>本年回报 %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`核对${row.name}`}
                    checked={row.selected}
                    onChange={(event) =>
                      setRows(
                        rows.map((item) =>
                          item.id === row.id
                            ? { ...item, selected: event.target.checked }
                            : item,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  {row.name}
                  <small className="cell-note">
                    原值{" "}
                    {money(
                      base.assets.find((asset) => asset.id === row.id)!.value,
                    )}
                  </small>
                </td>
                <td>
                  <input
                    aria-label={`批量价值${row.name}`}
                    inputMode="decimal"
                    value={row.value}
                    onChange={(event) =>
                      setRows(
                        rows.map((item) =>
                          item.id === row.id
                            ? {
                                ...item,
                                value: event.target.value,
                                selected: true,
                              }
                            : item,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    aria-label={`批量回报${row.name}`}
                    inputMode="decimal"
                    placeholder="未填"
                    value={row.annualReturn}
                    onChange={(event) =>
                      setRows(
                        rows.map((item) =>
                          item.id === row.id
                            ? {
                                ...item,
                                annualReturn: event.target.value,
                                selected: true,
                              }
                            : item,
                        ),
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="dialog-actions">
        <span>{rows.filter((row) => row.selected).length} 项待保存</span>
        <button
          className="primary"
          disabled={!rows.some((row) => row.selected)}
        >
          保存勾选估值
        </button>
      </div>
    </Dialog>
  );
}
