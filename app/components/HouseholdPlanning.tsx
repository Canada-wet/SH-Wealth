"use client";
import { money, type WealthState } from "@/lib/wealth";
import {
  costSharing,
  debtCosts,
  goalPace,
  valuationReview,
} from "@/lib/household-workspace";
export default function HouseholdPlanning({
  state,
  onChange,
  onAsset,
  onDebt,
  onBatch,
}: {
  state: WealthState;
  onChange: (
    update: (state: WealthState) => WealthState,
    reason: string,
  ) => boolean;
  onAsset: (id: string) => void;
  onDebt: (id: string) => void;
  onBatch: () => void;
}) {
  const pace = goalPace(state),
    stale = valuationReview(state),
    debts = debtCosts(state);
  const method =
    state.plan.values.cost_share_method === "income" ? "income" : "equal";
  const split = costSharing(state, method);
  const discuss = () =>
    window.dispatchEvent(
      new CustomEvent("together-open-advisor", {
        detail:
          "只做分析，不执行修改。请结合我们的目标所需月储蓄、收支缺口、共同开支分摊和负债成本，给出下一次夫妻复盘的三个重点。不要假定未知利率和流动性。",
      }),
    );
  return (
    <>
      <details className="household-next">
        <summary>
          目标与共同安排<span>把收支、负债和目标连起来</span>
        </summary>
        <div className="household-tool-body">
          <h3>目标储蓄节奏</h3>
          <div className="planning-metrics">
            <span>
              距目标差额<b>{money(pace.gap)}</b>
            </span>
            <span>
              至 {state.goal.year} 年末
              <b>{pace.months ? `约 ${pace.months} 个月` : "目标期限已到"}</b>
            </span>
            <span>
              零收益基线所需月储蓄
              <b>
                {pace.required === null ? "请更新期限" : money(pace.required)}
              </b>
            </span>
          </div>
          <p>
            {pace.surplus === null
              ? "收支尚不完整，不能判断预算是否覆盖所需储蓄。"
              : `已录入预算月结余 ${money(pace.surplus)}${pace.shortfall === null ? "" : `；与所需月储蓄相比还差 ${money(pace.shortfall)}`}。`}
          </p>
          <small>
            仅为账面零收益算术基线，不计回报、房贷本金变化、税费或漏记支出；预算结余不等于实际储蓄。
          </small>
          <h3>共同开支怎么分</h3>
          <label>
            共同开支分摊方式
            <select
              aria-label="共同开支分摊方式"
              value={method}
              onChange={(event) =>
                onChange(
                  (current) => ({
                    ...current,
                    plan: {
                      ...current.plan,
                      values: {
                        ...current.plan.values,
                        cost_share_method: event.target.value,
                      },
                    },
                  }),
                  "更新分摊测算方式",
                )
              }
            >
              <option value="equal">双方均分</option>
              <option value="income">按各自已录入收入比例</option>
            </select>
          </label>
          <div className="planning-metrics">
            <span>
              共同预算开支<b>{money(split.joint)}</b>
            </span>
            <span>
              {state.members.first} 参考份额
              <b>
                {split.first === null ? "缺少各自收入" : money(split.first)}
              </b>
            </span>
            <span>
              {state.members.second} 参考份额
              <b>
                {split.second === null ? "缺少各自收入" : money(split.second)}
              </b>
            </span>
          </div>
          <small>
            只分摊归属“共同”的预算开支，不含个人开支和共同收入；不是已付款或实际贡献，不自动新增转账。
          </small>
          <h3>负债成本核对</h3>
          <p>
            已填利率部分：当前余额 × 年利率 = 约 {money(debts.annualInterest)}
            /年。
            {debts.unknown
              ? `另有 ${debts.unknown} 项余额的利率未知，不计为零。`
              : ""}
          </p>
          <p>
            已填计划月还款合计 {money(debts.payments)}。
            {debts.missingPayments
              ? `${debts.missingPayments} 项未填还款。`
              : ""}
            此处不自动加入现金流，避免重复计支。
          </p>
          <small>利息仅静态参考，不是房贷摊销或银行实际账单。</small>
          <div className="planning-links">
            {state.debts.map((row) => (
              <button
                type="button"
                className="text-button"
                key={row.id}
                onClick={() => onDebt(row.id)}
              >
                核对{row.name}利率与还款
              </button>
            ))}
          </div>
          <button type="button" className="secondary" onClick={discuss}>
            和顾问讨论共同安排
          </button>
        </div>
      </details>
      <details className="valuation-review">
        <summary>
          账户更新检查<span>{stale.length} 项日期待核对或超过 30 天</span>
        </summary>
        <div className="household-tool-body">
          <p>
            逐项使用实际核对日期，不用最近一次现金流或聊天保存时间代替。未填写不推断为已更新。
          </p>
          {stale.length ? (
            stale.map((row) => (
              <button
                type="button"
                className="valuation-review-row"
                key={row.asset.id}
                onClick={() => onAsset(row.asset.id)}
              >
                <span>{row.asset.name}</span>
                <span>
                  {row.age === null
                    ? "日期未知"
                    : row.age < 0
                      ? "日期在未来，请核对"
                      : `${row.age} 天未核对`}{" "}
                  →
                </span>
              </button>
            ))
          ) : (
            <p>所有已记录账户均在近 30 天内核对。</p>
          )}
          <button
            type="button"
            className="secondary"
            disabled={!state.assets.length}
            onClick={onBatch}
          >
            批量核对估值与回报
          </button>
        </div>
      </details>
    </>
  );
}
