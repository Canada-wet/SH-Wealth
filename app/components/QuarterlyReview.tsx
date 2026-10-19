"use client";
import { useState, useEffect, useRef } from "react";
import ActionCapture from "./ActionCapture";
import {
  CalendarCheck,
  ArrowUpRight,
  Check,
  Download,
  Plus,
} from "lucide-react";
import { money, ownerLabel, type WealthState } from "@/lib/wealth";
import { reviewChecks } from "@/lib/household-review";
import {
  EMPTY_QUARTERLY,
  REVIEW_CHECKS,
  emptyReview,
  type ReviewAction,
} from "@/lib/quarterly-schema";
import {
  addQuarterAction,
  completeQuarter,
  latestCompletedQuarter,
  quarterEvidence,
  quarterOptions,
  quarterPeriod,
  quarterPrompt,
  quarterlyStatus,
  reviewProgress,
  setQuarterlyPreference,
  torontoDay,
  updateQuarter,
} from "@/lib/quarterly-review";

type Change = (
  update: (s: WealthState) => WealthState,
  reason: string,
) => boolean;
function ReviewNotes({
  notes,
  disabled,
  onSave,
}: {
  notes: string;
  disabled: boolean;
  onSave: (notes: string, expected: string) => boolean;
}) {
  const [draft, setDraft] = useState(notes),
    [baseline, setBaseline] = useState(notes);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current && draft === baseline) {
      setDraft(notes);
      setBaseline(notes);
    }
  }, [notes, draft, baseline]);
  const changedElsewhere = notes !== baseline && draft !== notes;
  return (
    <>
      <label className="quarter-notes">
        这一季做对了什么？最大的风险或分歧？下季要改变什么？
        <textarea
          aria-label="季度复盘笔记"
          value={draft}
          maxLength={3000}
          disabled={disabled}
          rows={4}
          onFocus={() => {
            focused.current = true;
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            focused.current = false;
            if (draft !== baseline && onSave(draft, baseline))
              setBaseline(draft);
          }}
          placeholder="例如：先补齐房屋估值日期；共同确认应急金用途；每月固定时间核对实际投入。"
        />
      </label>
      {changedElsewhere && (
        <p role="alert">
          另一设备已更新笔记。你的草稿仍保留在输入框，请复制留存并核对新版本，未自动覆盖。
        </p>
      )}
    </>
  );
}
export function QuarterlyReminder({ state }: { state: WealthState }) {
  const status = quarterlyStatus(state);
  if (!status.due) return null;
  return (
    <a className="quarter-reminder" href="#quarterly-review">
      <CalendarCheck size={20} />
      <span>
        <b>{status.period.label}，一起做一次财富复盘</b>
        <small>
          核对记录 → 讨论变化 → 安排下一季 ·{" "}
          {reviewProgress(status.record ?? emptyReview())}/4 项核对
        </small>
      </span>
      <ArrowUpRight size={20} />
    </a>
  );
}

export default function QuarterlyReview({
  state,
  onChange,
  disabled = false,
}: {
  state: WealthState;
  onChange: Change;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState(latestCompletedQuarter());
  const [title, setTitle] = useState(""),
    [owner, setOwner] = useState("joint"),
    [due, setDue] = useState(torontoDay());
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ReviewAction | null>(null);
  const prefs = state.preferences.quarterlyReviews ?? EMPTY_QUARTERLY;
  const currentChecks = reviewChecks(state);
  const record = prefs.records[selected] ?? emptyReview(),
    period = quarterPeriod(selected);
  const evidence = record.evidence ?? quarterEvidence(state, selected);
  const frozen = !!record.completedAt,
    progress = reviewProgress(record);
  const save: Change = (update, reason) => {
    setError("");
    const ok = onChange(update, reason);
    if (!ok) setError("未保存，请查看同步提示并重试；不要关闭尚未保存的笔记。");
    return ok;
  };
  const patch = (update: Parameters<typeof updateQuarter>[2], reason: string) =>
    save((s) => updateQuarter(s, selected, update), reason);
  const onNotes = (notes: string, expected: string) => {
    return patch((r) => {
      if (r.notes !== expected)
        throw new Error(
          "伴侣已更新笔记，请先复制你的草稿，再刷新查看，不覆盖新记录。",
        );
      return { ...r, notes };
    }, "保存季度复盘笔记");
  };
  const exportReview = () => {
    const data = {
      quarter: selected,
      ...record,
      evidence,
      exportedAt: new Date().toISOString(),
      scope:
        "家庭季度复盘；未归档时为草稿。时点对比不是投资收益，预算不是实际季度现金流。",
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `Together-${selected}-review.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const openAdvisor = () =>
    window.dispatchEvent(
      new CustomEvent("together-open-advisor", {
        detail: quarterPrompt(state, selected),
      }),
    );
  const delta =
    evidence.opening &&
    evidence.closing &&
    evidence.opening.at !== evidence.closing.at &&
    torontoDay(new Date(evidence.closing.at)) >= period.start
      ? evidence.closing.netWorth - evidence.opening.netWorth
      : null;
  const unfinished = Object.entries(prefs.records).flatMap(([key, r]) =>
    key !== selected && r.completedAt
      ? r.actions.filter((a) => !a.done).map((a) => ({ ...a, quarter: key }))
      : [],
  );
  return (
    <section
      id="quarterly-review"
      className="card quarterly-review"
      aria-label="家庭季度复盘"
    >
      <div className="card-head">
        <div>
          <span className="quarter-eyebrow">PAUSE · REFLECT · PLAN</span>
          <h2>
            <CalendarCheck size={21} /> 家庭季度复盘
          </h2>
          <p>不只是看涨了多少，更是确认钱放对了地方、下一步一起做什么。</p>
        </div>
        <label className="quarter-picker">
          复盘季度
          <select
            aria-label="复盘季度"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setEditing(null);
              setTitle("");
              setError("");
            }}
          >
            {quarterOptions(state).map((k) => (
              <option key={k} value={k}>
                {quarterPeriod(k).label}
                {prefs.records[k]?.completedAt ? " · 已归档" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="quarter-toolbar">
        <span>
          {period.start} — {period.end} · Toronto
        </span>
        <span className="quarter-badge">
          {frozen
            ? `已归档 · ${torontoDay(new Date(record.completedAt!))}`
            : `共同核对 ${progress}/4`}
        </span>
        <button className="text-button" onClick={exportReview}>
          <Download size={15} /> 导出{frozen ? "复盘" : "草稿"}
        </button>
      </div>
      {!!unfinished.length && (
        <div className="quarter-gap">
          <b>上次的承诺，继续跟进</b>
          {unfinished.slice(0, 4).map((a) => (
            <p key={`${a.quarter}-${a.id}`}>
              <button
                className="text-button"
                onClick={() => setSelected(a.quarter)}
              >
                {a.quarter} · {a.title} ↗
              </button>{" "}
              · {ownerLabel(a.owner, state.members)} · {a.due}
              {a.due < torontoDay() ? " · 已到期" : ""}
            </p>
          ))}
        </div>
      )}
      <div className="quarter-metrics">
        <div>
          <span>期初前最近记录 · 净资产</span>
          <b>
            {evidence.opening ? money(evidence.opening.netWorth) : "缺少记录"}
          </b>
          <small>
            {evidence.opening
              ? torontoDay(new Date(evidence.opening.at))
              : "不使用当前余额回填历史"}
          </small>
        </div>
        <div>
          <span>期末前最近记录 · 净资产</span>
          <b>
            {evidence.closing ? money(evidence.closing.netWorth) : "缺少记录"}
          </b>
          <small>
            {evidence.closing
              ? torontoDay(new Date(evidence.closing.at))
              : "请先核对该季度账单"}
          </small>
        </div>
        <div>
          <span>两条记录的净值变化</span>
          <b>{delta === null ? "暂不可比较" : money(delta)}</b>
          <small>包含估值、出入金与补录，不是回报率</small>
        </div>
      </div>
      {(!evidence.opening ||
        !evidence.closing ||
        torontoDay(new Date(evidence.closing.at)) < period.end) && (
        <p className="quarter-gap">
          数据边界：{!evidence.opening ? "缺少期初记录；" : ""}
          {!evidence.closing
            ? "缺少期末前记录；"
            : torontoDay(new Date(evidence.closing.at)) < period.end
              ? "期末前记录早于季末，并非季末估值；"
              : ""}
          仍可记录复盘结论，缺失不等于零。已有快照也不代表当天重新核价。
        </p>
      )}
      <div className="quarter-layout">
        <div className="quarter-workspace">
          <h3>01 · 一起核对</h3>
          <details className="quarter-current">
            <summary>复盘前的数据准备（当前记录）</summary>
            <ul>
              <li>
                {currentChecks.missingReturns.length}{" "}
                项资产未填本年回报；未填不等于
                0%，住房和车辆可以保持未知。当前本年回报不套用到历史季度。
              </li>
              <li>
                {state.assets.filter((a) => !a.valuationDate).length}{" "}
                项资产未注明核价日期，先核对账单；快照保存日不等于重新估值日。
              </li>
              <li>
                {currentChecks.duplicateNames.length
                  ? `同名账户：${currentChecks.duplicateNames.join("、")}，建议用银行或成员区分。`
                  : "账户名称无重复，语音编辑时仍请明确名称与归属。"}
              </li>
            </ul>
          </details>
          <fieldset disabled={disabled || frozen} className="quarter-checks">
            {Object.entries(REVIEW_CHECKS).map(([k, label]) => (
              <label key={k}>
                <input
                  type="checkbox"
                  checked={
                    record.checks[k as keyof typeof REVIEW_CHECKS] ?? false
                  }
                  onChange={(e) =>
                    patch(
                      (r) => ({
                        ...r,
                        checks: { ...r.checks, [k]: e.target.checked },
                      }),
                      "更新季度核对清单",
                    )
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <div className="quarter-evidence">
            <b>本季已记录的净贡献</b>
            <div>
              {(["first", "second", "joint"] as const).map((k) => (
                <span key={k}>
                  {ownerLabel(k, state.members)}{" "}
                  <strong>
                    {evidence.contributionCount
                      ? money(evidence.contributionTotals[k])
                      : "未记录"}
                  </strong>
                </span>
              ))}
            </div>
            <small>
              {evidence.contributionCount} 笔投入 /
              取出，按发生日筛选；来自当前贡献账本，不代表全部储蓄，也不自动加到资产余额。
            </small>
          </div>
          <p className="quarter-caption">
            {evidence.monthlyBudget
              ? `期末前快照的月预算结余 ${money(evidence.monthlyBudget.surplus)}，不是本季度实际现金流。`
              : "该季度没有完整的历史收支预算，不用今天的预算推算过去。"}{" "}
            {evidence.target !== null && evidence.closing
              ? `当时目标差距 ${money(Math.max(0, evidence.target - evidence.closing.netWorth))}。`
              : "历史目标未记录，不代入当前目标。"}
          </p>
          <div className="quarter-links">
            <a href="#assets">核对账户与负债 ↗</a>
            <a href="#cashflow">核对现金流 ↗</a>
            <a href="#contributions">补充出资记录 ↗</a>
            <a href="/markets#market-wealth">检查市场敞口 ↗</a>
          </div>
          <h3>02 · 留下结论</h3>
          <ReviewNotes
            key={`${selected}-${record.completedAt ?? "draft"}`}
            notes={record.notes}
            disabled={disabled || frozen}
            onSave={onNotes}
          />
          <small className="quarter-caption">
            笔记离开输入框时保存；与家庭数据共用备份与云端同步。不要在未同步时清除浏览器数据。
          </small>
          <button
            className="secondary quarter-advisor"
            onClick={openAdvisor}
            disabled={disabled}
          >
            让 AI 带我们复盘 <ArrowUpRight size={16} />
          </button>
        </div>
        <div className="quarter-workspace quarter-actions">
          <h3>03 · 下一季度，落实到人</h3>
          <ActionCapture
            sourceFeature="quarterly-review"
            sourceRef={selected}
            label="另建跨模块跟进行动"
            disabled={disabled}
          />
          <p className="quarter-caption">
            最多 12 项；建议先做最重要的 1–3
            项。归档后仍可勾选完成，原结论与证据保留。
          </p>
          <ul>
            {record.actions.map((action) => (
              <li key={action.id}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`完成行动：${action.title}`}
                    disabled={disabled}
                    checked={action.done}
                    onChange={(e) =>
                      patch(
                        (r) => ({
                          ...r,
                          actions: r.actions.map((a) =>
                            a.id === action.id
                              ? { ...a, done: e.target.checked }
                              : a,
                          ),
                        }),
                        "跟进季度行动",
                      )
                    }
                  />
                  <span>
                    <b className={action.done ? "quarter-done" : ""}>
                      {action.title}
                    </b>
                    <small>
                      {ownerLabel(action.owner, state.members)} · {action.due}
                      {!action.done && action.due < torontoDay()
                        ? " · 已到期"
                        : ""}
                    </small>
                  </span>
                </label>
                {!frozen && (
                  <button
                    className="text-button"
                    aria-label={`编辑行动：${action.title}`}
                    disabled={disabled}
                    onClick={() => {
                      setEditing({ ...action });
                      setTitle(action.title);
                      setOwner(action.owner);
                      setDue(action.due);
                    }}
                  >
                    编辑
                  </button>
                )}
                {!frozen && (
                  <button
                    className="text-button"
                    aria-label={`删除行动：${action.title}`}
                    disabled={disabled}
                    onClick={() =>
                      patch(
                        (r) => ({
                          ...r,
                          actions: r.actions.filter((a) => a.id !== action.id),
                        }),
                        "移除季度草稿行动",
                      )
                    }
                  >
                    移除
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!record.actions.length && (
            <div className="quarter-empty">
              还没有下季行动。把讨论变成一个有负责人、有日期的小承诺。
            </div>
          )}
          {!frozen && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  save(
                    (s) =>
                      editing
                        ? updateQuarter(s, selected, (r) => {
                            if (
                              JSON.stringify(
                                r.actions.find((a) => a.id === editing.id),
                              ) !== JSON.stringify(editing)
                            )
                              throw new Error(
                                "该行动已在另一设备变化，请重新打开编辑。",
                              );
                            return {
                              ...r,
                              actions: r.actions.map((a) =>
                                a.id === editing.id
                                  ? {
                                      ...a,
                                      title: title.trim(),
                                      owner: owner as "joint",
                                      due,
                                    }
                                  : a,
                              ),
                            };
                          })
                        : addQuarterAction(s, selected, {
                            id: crypto.randomUUID(),
                            title: title.trim(),
                            owner: owner as "joint",
                            due,
                            done: false,
                          }),
                    "安排季度行动",
                  )
                ) {
                  setTitle("");
                  setEditing(null);
                }
              }}
            >
              <fieldset
                disabled={disabled || (!editing && record.actions.length >= 12)}
              >
                <label>
                  下季度行动
                  <input
                    aria-label="下季度行动"
                    required
                    maxLength={200}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="例如：核实 GIC 赎回条件"
                  />
                </label>
                <div className="quarter-action-inputs">
                  <label>
                    负责人
                    <select
                      aria-label="行动负责人"
                      value={owner}
                      onChange={(e) => setOwner(e.target.value)}
                    >
                      {(["joint", "first", "second"] as const).map((k) => (
                        <option key={k} value={k}>
                          {ownerLabel(k, state.members)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    到期日
                    <input
                      aria-label="行动到期日"
                      type="date"
                      required
                      min={
                        torontoDay() > period.due ? torontoDay() : period.due
                      }
                      value={due}
                      onChange={(e) => setDue(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  className="secondary"
                  type="submit"
                  disabled={!title.trim()}
                >
                  <Plus size={15} /> {editing ? "保存行动修改" : "添加行动"}
                </button>
                {editing && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setEditing(null);
                      setTitle("");
                    }}
                  >
                    取消编辑
                  </button>
                )}
              </fieldset>
            </form>
          )}
          <div className="quarter-finish">
            {frozen ? (
              <p>
                <Check size={18} />{" "}
                复盘已归档。之后的账户修改不会改写这份证据；行动进度单独跟进。
              </p>
            ) : (
              <>
                <p>
                  四项核对完成、有结论和行动后，即可结束本次复盘。允许带着明确的数据缺口归档，不要求编造历史。
                </p>
                <button
                  className="primary"
                  disabled={
                    disabled ||
                    progress !== 4 ||
                    !record.notes.trim() ||
                    !record.actions.length
                  }
                  onClick={() =>
                    save(
                      (s) => completeQuarter(s, selected),
                      "完成并归档季度复盘",
                    )
                  }
                >
                  <Check size={16} /> 完成并归档复盘
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      <details className="quarter-settings">
        <summary>提醒与下次安排</summary>
        <fieldset disabled={disabled}>
          <p>
            下一次新季度复盘从 {quarterPeriod(latestCompletedQuarter()).nextDue}{" "}
            开始提醒。已延后的待办到期后，首页会重新显示提醒入口。
          </p>
          <label>
            <input
              type="checkbox"
              checked={prefs.reminders}
              onChange={(e) =>
                save(
                  (s) =>
                    setQuarterlyPreference(s, "reminders", e.target.checked),
                  "设置季度复盘提醒",
                )
              }
            />{" "}
            季末后提醒我们复盘（1 / 4 / 7 / 10 月开始）
          </label>
          <label>
            <input
              type="checkbox"
              checked={prefs.external}
              onChange={(e) =>
                save(
                  (s) =>
                    setQuarterlyPreference(s, "external", e.target.checked),
                  "设置季度外部提醒",
                )
              }
            />{" "}
            同时发到各成员已连接并启用的邮件 / Telegram，每季度一次
          </label>
          <p>
            外部消息不包含金额。渠道仍需本人在“数据 →
            通知”连接并启用；邮件依赖发信配置，WhatsApp
            暂不发送季度模板。关闭主动提醒会同时暂停季度提醒。
          </p>
          {!frozen && selected === latestCompletedQuarter() && (
            <button
              className="secondary"
              onClick={() => {
                const d = new Date(`${torontoDay()}T12:00:00Z`);
                d.setUTCDate(d.getUTCDate() + 7);
                patch(
                  (r) => ({ ...r, snoozeUntil: d.toISOString().slice(0, 10) }),
                  "七天后提醒季度复盘",
                );
              }}
            >
              7 天后再提醒
            </button>
          )}
          {record.snoozeUntil && !frozen && (
            <p>
              已延后至 {record.snoozeUntil}。
              <button
                className="text-button"
                onClick={() =>
                  patch(
                    (r) => ({ ...r, snoozeUntil: undefined }),
                    "恢复季度提醒",
                  )
                }
              >
                恢复提醒
              </button>
            </p>
          )}
        </fieldset>
      </details>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
