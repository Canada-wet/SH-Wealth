"use client";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { householdPulse, type Insight } from "@/lib/insights";
import { money, type WealthState } from "@/lib/wealth";
export default function WealthPulse({
  state,
  insights,
  onDiscuss,
  onDismiss,
}: {
  state: WealthState;
  insights: Insight[];
  onDiscuss: (prompt: string) => void;
  onDismiss: (id: string) => void;
}) {
  const pulse = householdPulse(state);
  const first = insights[0];
  return (
    <>
      <div className="pulse-metrics" aria-label="家庭关键指标">
        <a href="#cashflow">
          <span>
            每月账面结余 <ArrowUpRight size={14} />
          </span>
          <b className={pulse.surplus < 0 ? "negative" : ""}>
            {pulse.complete ? money(pulse.surplus) : "待补齐收支"}
          </b>
          <small>
            {pulse.complete
              ? `收入 ${money(pulse.income)} · 支出 ${money(pulse.expenses)}`
              : "缺失项目不作为零计算"}
          </small>
        </a>
        <a
          href="#emergency"
          onClick={() => {
            const el = document.getElementById("emergency");
            if (el instanceof HTMLDetailsElement) el.open = true;
          }}
        >
          <span>
            现金缓冲参考 <ArrowUpRight size={14} />
          </span>
          <b>
            {pulse.coverage === null
              ? "待填写必要开支"
              : `${pulse.coverage.toFixed(1)} 个月`}
          </b>
          <small>
            已排除明确锁定 / 不易变现现金
            {pulse.cashUnverified > 0 ? " · 含待核对资金" : ""}
          </small>
        </a>
        <a href="#overview">
          <span>目标月度参考</span>
          <b>
            {pulse.monthlyGoal === null
              ? "目标期限已到"
              : money(pulse.monthlyGoal)}
          </b>
          <small>不计收益 · 按目标年末平摊差额</small>
        </a>
      </div>
      {first && (
        <section
          className={`pulse-next ${first.priority}`}
          aria-label="下一步建议"
        >
          <Sparkles size={19} />
          <div>
            <span className="eyebrow">下一步 · {first.source}</span>
            <h3>{first.title}</h3>
            <p>{first.body}</p>
          </div>
          <div className="pulse-actions">
            <button
              className="secondary"
              onClick={() => onDiscuss(first.prompt)}
            >
              和顾问讨论 <ArrowUpRight size={14} />
            </button>
            <button className="text-button" onClick={() => onDismiss(first.id)}>
              本月已处理
            </button>
          </div>
        </section>
      )}
    </>
  );
}
