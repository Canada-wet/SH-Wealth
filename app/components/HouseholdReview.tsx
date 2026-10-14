"use client";
import { useState } from "react";
import { CalendarCheck, SlidersHorizontal } from "lucide-react";
import { money, type WealthState } from "@/lib/wealth";
import { reviewChecks, savingsScenario } from "@/lib/household-review";

export default function HouseholdReview({ state }: { state: WealthState }) {
  const review = reviewChecks(state);
  const [monthly, setMonthly] = useState<string | null>(null);
  const [months, setMonths] = useState("12");
  const [oneOff, setOneOff] = useState("0");
  const saving =
    monthly ?? String(review.completeBudget ? review.budget.surplus : 0);
  let result: ReturnType<typeof savingsScenario> | null = null;
  try {
    if ([saving, months, oneOff].every((value) => value.trim()))
      result = savingsScenario(
        review.balance.netWorth,
        Number(saving),
        Number(months),
        Number(oneOff),
        state.goal.target,
      );
  } catch {}
  const discuss = (prompt: string) =>
    window.dispatchEvent(
      new CustomEvent("together-open-advisor", { detail: prompt }),
    );
  return (
    <div className="household-tools">
      <details className="household-review">
        <summary>
          <CalendarCheck size={18} /> 一起复盘{" "}
          <span>15 分钟 · 核对记录与下一步</span>
        </summary>
        <div className="household-tool-body">
          <p>
            最近财务记录：
            {review.age === null ? "尚无快照" : `${review.age} 天前`}
            {review.delta !== null
              ? ` · 上次记录净值变化 ${money(review.delta)}`
              : ""}
            。记录变化包含新增、删除、投入和估值，不等于投资收益。
          </p>
          <ul>
            <li>
              {review.completeBudget
                ? `已录入收支，账面月结余 ${money(review.budget.surplus)}；一起核对旅行、维修和年度账单。`
                : "收支未完整录入，先补齐收入和支出；缺失值不是零。"}
            </li>
            <li>
              {review.missingReturns.length
                ? `${review.missingReturns.length} 项资产未填本年回报。未填不等于0%；住房和车辆可以保持未知。`
                : "已有回报记录仍需核对时间范围；记录值不代表未来收益。"}
            </li>
            <li>
              {review.duplicateNames.length
                ? `同名账户：${review.duplicateNames.join("、")}。建议用银行或成员区分，避免对话改错。`
                : "账户名称无重复；语音编辑请清楚说出名称与归属。"}
            </li>
            <li>
              {state.contributions.length
                ? `已记录 ${state.contributions.length} 笔贡献；一起核对实际出资和转账。`
                : "尚无实际贡献记录，持有资产占比不能替代出资占比。"}
            </li>
          </ul>
          <button className="secondary" onClick={() => discuss(review.prompt)}>
            让顾问带我们复盘
          </button>
        </div>
      </details>
      <details className="household-scenario">
        <summary>
          <SlidersHorizontal size={18} /> 如果我们…{" "}
          <span>只做测算 · 不修改真实数据</span>
        </summary>
        <div className="household-tool-body">
          <p>
            从当前净资产 {money(review.balance.netWorth)}{" "}
            出发，假定每月储蓄都增加净资产。不计投资回报、房贷本金变化、估值和税费，不是预测。
          </p>
          {!review.completeBudget && (
            <p className="negative">预算未完整录入，请自己填写假设月储蓄。</p>
          )}
          <div className="scenario-inputs">
            <label>
              假设月储蓄（CAD）
              <input
                aria-label="假设月储蓄（CAD）"
                type="number"
                step="100"
                value={saving}
                onChange={(event) => setMonthly(event.target.value)}
              />
            </label>
            <label>
              测算期限（月）
              <input
                aria-label="测算期限（月）"
                type="number"
                min="1"
                max="120"
                value={months}
                onChange={(event) => setMonths(event.target.value)}
              />
            </label>
            <label>
              一次性支出（CAD）
              <input
                aria-label="一次性支出（CAD）"
                type="number"
                min="0"
                step="100"
                value={oneOff}
                onChange={(event) => setOneOff(event.target.value)}
              />
            </label>
          </div>
          {result ? (
            <div className="scenario-result" aria-live="polite">
              <span>
                假设期末净资产 <b>{money(result.projected)}</b>
              </span>
              <span>
                距当前财富目标 <b>{money(result.gap)}</b>
              </span>
              <span>
                同一期限达标所需月储蓄 <b>{money(result.requiredMonthly)}</b>
              </span>
            </div>
          ) : (
            <p role="alert">
              请填写有效数字；期限为1–120个月，一次性支出不小于零。
            </p>
          )}
          <div className="scenario-actions">
            <button
              className="secondary"
              disabled={!result}
              onClick={() =>
                discuss(
                  `只做分析与讨论，不执行数据变更。这是一个假设，不是新预算或目标：每月储蓄${saving} CAD，期限${months}个月，一次性支出${oneOff} CAD，不计收益。算术期末净资产${result?.projected} CAD。帮我们检查可行性、遗漏开支和需要共同确认的问题。`,
                )
              }
            >
              与顾问讨论这个假设
            </button>
            <button
              className="text-button"
              onClick={() => {
                setMonthly(null);
                setMonths("12");
                setOneOff("0");
              }}
            >
              重置假设
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
