"use client";
import { useEffect, useRef, useState } from "react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { ArrowUpRight, Check, Target } from "lucide-react";
import { money, numberInput, type WealthState } from "@/lib/wealth";
import {
  defaultGrowthPlan,
  growthAnalysis,
  growthConfig,
  growthTasks,
  saveGrowthPlan,
  setGrowthTask,
  type GrowthPlan,
  type GrowthTask,
} from "@/lib/growth";
import { financialFingerprint } from "@/lib/advisor-preview";
import { GROWTH_TASKS } from "@/lib/growth-schema";
type Draft = {
  monthlySaving: string;
  longTermMonthly: string;
  annualRate: string;
  selectedAssetIds: string[];
  reviewDate: string;
};
const draftOf = (p: GrowthPlan): Draft => ({
  ...p,
  monthlySaving: String(p.monthlySaving),
  longTermMonthly: String(p.longTermMonthly),
  annualRate: String(p.annualRate),
});
const parse = (draft: Draft): GrowthPlan => ({
  ...draft,
  monthlySaving: numberInput(draft.monthlySaving, "月度留存"),
  longTermMonthly: numberInput(draft.longTermMonthly, "长期月投入"),
  annualRate: numberInput(draft.annualRate, "回报假设", true),
  tasks: {},
});
export default function WealthGrowth({
  state,
  ready,
  syncStatus,
  onChange,
  onDiscuss,
  onDebt,
}: {
  state: WealthState;
  ready: boolean;
  syncStatus: string;
  onChange: (
    update: (s: WealthState) => WealthState,
    reason: string,
  ) => boolean;
  onDiscuss: (prompt: string) => void;
  onDebt: (id: string) => void;
}) {
  const [view, setView] = useState("actions");
  const changeView = (next: string) => {
    setView(next);
    requestAnimationFrame(() =>
      document
        .getElementById("growth")
        ?.scrollIntoView({ block: "start", behavior: "instant" }),
    );
  };
  const [draft, setDraft] = useState<Draft>(() =>
    draftOf(state.preferences.growthPlan ?? defaultGrowthPlan(state)),
  );
  const [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const expected = useRef({
    config: growthConfig(state.preferences.growthPlan),
    financial: financialFingerprint(state),
  });
  useEffect(() => {
    if (dirty) return;
    setDraft(draftOf(state.preferences.growthPlan ?? defaultGrowthPlan(state)));
    expected.current = {
      config: growthConfig(state.preferences.growthPlan),
      financial: financialFingerprint(state),
    };
  }, [state, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const edit = (update: Partial<Draft>) => {
    if (!dirty)
      expected.current = {
        config: growthConfig(state.preferences.growthPlan),
        financial: financialFingerprint(state),
      };
    setDirty(true);
    setDraft((current) => ({ ...current, ...update }));
    setError("");
    setNotice("");
  };
  let analysis: ReturnType<typeof growthAnalysis> | null = null;
  let inputError = "";
  try {
    analysis = growthAnalysis(state, parse(draft));
  } catch (e) {
    inputError = e instanceof Error ? e.message : "请核对输入。";
  }
  const tasks = growthTasks(state),
    saved = state.preferences.growthPlan;
  const savedAnalysis = saved ? growthAnalysis(state, saved) : null;
  const apply = (update: (s: WealthState) => WealthState, reason: string) => {
    let failure = "尚未保存，请查看同步提示；草稿仍保留。";
    const ok = onChange((current) => {
      try {
        return update(current);
      } catch (e) {
        failure = e instanceof Error ? e.message : failure;
        throw e;
      }
    }, reason);
    if (!ok) {
      setError(failure);
      return false;
    }
    setError("");
    return true;
  };
  const mark = (task: GrowthTask, status: "planned" | "done") => {
    if (!saved) {
      changeView("scenario");
      setNotice("先确认并保存本轮情景，再记录行动进度；不会新增资金或交易。");
      return;
    }
    if (
      apply(
        (current) => setGrowthTask(current, task, status),
        `记录增长行动：${task.title}`,
      )
    )
      setNotice("行动状态已保存；这不是银行转账或投资成交确认。");
  };
  const renderTask = (task: GrowthTask) => (
    <article className={`growth-task ${task.priority}`} key={task.id}>
      <div className="growth-task-heading">
        <h3>{task.title}</h3>
        <span>
          {
            {
              todo: "待讨论",
              planned: "已安排",
              done: "用户标记完成",
              review: "依据变化 · 需复核",
            }[task.status]
          }
        </span>
      </div>
      <p>{task.body}</p>
      <p className="growth-next-step">下一步：{task.next}</p>
      <div className="growth-task-actions">
        <a
          href={task.href}
          onClick={(event) => {
            if (task.href === "#growth-plan") {
              event.preventDefault();
              changeView("scenario");
            }
            if (task.href === "#emergency") {
              const el = document.getElementById("emergency");
              if (el instanceof HTMLDetailsElement) el.open = true;
            }
          }}
        >
          查看依据 <ArrowUpRight size={12} aria-hidden="true" />
        </a>
        <button
          className="text-button"
          disabled={!ready}
          onClick={() =>
            onDiscuss(
              `只做分析，不修改数据。请基于最新家庭数据讨论「${task.title}」：${task.body} 下一步是${task.next}。请给一个可控行动、金额依据、风险和复盘标准，不要保证回报。`,
            )
          }
        >
          和顾问推敲
        </button>
        <button
          className="secondary"
          disabled={!ready}
          onClick={() =>
            mark(task, task.status === "planned" ? "done" : "planned")
          }
        >
          {task.status === "planned"
            ? "标记完成"
            : task.status === "done"
              ? "重新安排"
              : "加入本轮"}
        </button>
        {task.status === "review" && (
          <button
            className="text-button"
            disabled={!ready}
            onClick={() => mark(task, "done")}
          >
            已重新核对
          </button>
        )}
      </div>
    </article>
  );
  return (
    <section
      className="card wealth-growth"
      id="growth"
      aria-label="财富增长行动台"
    >
      <div className="card-head">
        <div>
          <p className="eyebrow">GROWTH · DECISIONS INTO ACTION</p>
          <h2>
            <Target size={18} aria-hidden="true" /> 财富增长行动台
          </h2>
          <p>先看可控差距，再决定如何留存、安排与复盘。</p>
        </div>
        <a
          className="text-button"
          href="#growth-plan"
          onClick={(e) => {
            e.preventDefault();
            changeView(view === "actions" ? "scenario" : "actions");
          }}
        >
          {view === "actions" ? "测算增长路径 →" : "返回行动 →"}
        </a>
      </div>
      <div className="growth-tabs" role="group" aria-label="增长工作台视图">
        {[
          ["actions", "本轮行动"],
          ["scenario", "增长情景"],
        ].map(([key, label]) => (
          <button
            key={key}
            className="secondary"
            aria-pressed={view === key}
            onClick={() => changeView(key)}
          >
            {label}
          </button>
        ))}
        <span>
          {saved ? "共享计划 · " + syncStatus : "规则洞察 · 尚未保存计划"}
        </span>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="market-notice" role="status">
          {notice}
        </p>
      )}
      <div hidden={view !== "actions"}>
        <div className="growth-tracking" aria-label="计划与已记录出资">
          <span>
            每月留存计划
            <b>{saved ? money(saved.monthlySaving) : "待共同确认"}</b>
          </span>
          <span>
            其中长期月投入
            <b>{saved ? money(saved.longTermMonthly) : "尚未设定"}</b>
          </span>
          <span>
            所选账户本月净出资
            <b>
              {savedAnalysis?.recordedContribution == null
                ? "待指定跟踪账户"
                : money(savedAnalysis.recordedContribution)}
            </b>
          </span>
        </div>
        <p className="growth-help">
          本月出资仅汇总已记录、关联所选账户且不晚于今天的投入减取出，未记录不代表未发生；内部转移不等于新增储蓄。估值已包含的资金勿为进度再次新增关联贡献。
        </p>
        <div className="growth-task-list">
          {tasks.slice(0, 3).map(renderTask)}
        </div>
        {tasks.length > 3 && (
          <details className="growth-disclosure">
            <summary>其余 {tasks.length - 3} 项行动与复盘</summary>
            <div className="growth-task-list">
              {tasks.slice(3).map(renderTask)}
            </div>
          </details>
        )}
        <div id="growth-debt-review" className="growth-debt-links">
          {state.debts.map((debt) => (
            <button
              className="text-button"
              key={debt.id}
              onClick={() => onDebt(debt.id)}
            >
              核对{debt.name}成本 →
            </button>
          ))}
        </div>
        {saved && Object.keys(saved.tasks).length > 0 && (
          <details className="growth-disclosure">
            <summary>已保存的行动记录（含不再触发的事项）</summary>
            {Object.entries(saved.tasks).map(
              ([id, row]) =>
                row && (
                  <p key={id}>
                    {GROWTH_TASKS[id as keyof typeof GROWTH_TASKS]} ·{" "}
                    {row.status === "done" ? "用户标记完成" : "已安排"} ·{" "}
                    {new Date(row.at).toLocaleString("zh-CN", {
                      timeZone: "America/Toronto",
                    })}
                  </p>
                ),
            )}
          </details>
        )}
        <small className="growth-help">
          完成由你们自行核对，标记不代表收益验证，也不会修改资产、负债或实际贡献。数据依据改变后会提示重新复核。
        </small>
      </div>
      <div id="growth-plan" hidden={view !== "scenario"}>
        <p className="growth-draft-note">
          {dirty
            ? "未保存草稿"
            : saved
              ? "已保存的假设情景，不是收益预测"
              : "未确认的测算：初始留存取预算结余，不代表实际储蓄"}{" "}
          · 所有金额为 CAD
        </p>
        <div className="growth-scenario-layout">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              try {
                const plan = parse(draft);
                if (
                  apply(
                    (current) =>
                      saveGrowthPlan(
                        current,
                        plan,
                        expected.current.config,
                        expected.current.financial,
                      ),
                    "保存财富增长情景",
                  )
                ) {
                  setDirty(false);
                  setNotice(
                    "增长情景已保存；没有新增资产、出资或转账。请查看云端同步状态。",
                  );
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : "请检查输入。");
              }
            }}
          >
            <div className="growth-form-fields">
              <label>
                计划每月留存
                <input
                  aria-label="计划每月留存"
                  inputMode="decimal"
                  value={draft.monthlySaving}
                  onChange={(e) => edit({ monthlySaving: e.target.value })}
                />
              </label>
              <label>
                其中长期月投入
                <input
                  aria-label="其中长期月投入"
                  inputMode="decimal"
                  value={draft.longTermMonthly}
                  onChange={(e) => edit({ longTermMonthly: e.target.value })}
                />
              </label>
              <label>
                假设年回报（%）
                <input
                  aria-label="假设年回报"
                  inputMode="decimal"
                  value={draft.annualRate}
                  onChange={(e) => edit({ annualRate: e.target.value })}
                />
              </label>
              <label>
                下次增长复盘
                <input
                  aria-label="下次增长复盘"
                  type="date"
                  value={draft.reviewDate}
                  onChange={(e) => edit({ reviewDate: e.target.value })}
                />
              </label>
            </div>
            <details className="growth-disclosure">
              <summary>
                选择参与复利测算的本金 · {draft.selectedAssetIds.length} 项
              </summary>
              <p className="growth-help">
                不默认把房产、车辆或全部净资产当作投资本金。本年回报不会作为未来回报自动沿用；仅勾选你希望测试的账户。
              </p>
              <div className="growth-asset-picker">
                {state.assets.map((asset) => (
                  <label key={asset.id}>
                    <input
                      type="checkbox"
                      aria-label={`增长本金：${asset.name}`}
                      checked={draft.selectedAssetIds.includes(asset.id)}
                      onChange={(e) =>
                        edit({
                          selectedAssetIds: e.target.checked
                            ? [...draft.selectedAssetIds, asset.id]
                            : draft.selectedAssetIds.filter(
                                (id) => id !== asset.id,
                              ),
                        })
                      }
                    />
                    <span>
                      {asset.name}
                      <small>{money(asset.value)}</small>
                    </span>
                  </label>
                ))}
              </div>
            </details>
            {analysis?.missingAssets.length ? (
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  edit({
                    selectedAssetIds: draft.selectedAssetIds.filter((id) =>
                      state.assets.some((x) => x.id === id),
                    ),
                  })
                }
              >
                移除已不存在的所选账户
              </button>
            ) : null}
            <p className="growth-help">
              长期月投入包含在留存金额中，不是再加一笔；回报是自填假设，允许负值，默认
              0%。输入区间只是测算限制，不代表真实收益或损失的上下限。
            </p>
            <div className="button-row">
              <button
                className="primary"
                disabled={!ready || (!!saved && !dirty)}
              >
                <Check size={14} aria-hidden="true" />
                保存增长情景
              </button>
              {dirty && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setDirty(false);
                    setError("");
                    setNotice("已放弃未保存草稿，载入最新数据。");
                  }}
                >
                  放弃草稿并载入最新
                </button>
              )}
            </div>
          </form>
          <div className="growth-results" aria-label="增长情景测算结果">
            {!analysis ? (
              <p role="status">{inputError}</p>
            ) : (
              <>
                {!analysis.complete ||
                analysis.budgetGap ||
                analysis.missingAssets.length ? (
                  <p className="growth-warning">
                    {!analysis.complete
                      ? "收支未完整，无法判断这个计划是否负担得起。"
                      : analysis.budgetGap
                        ? `留存计划超过当前预算结余 ${money(analysis.budgetGap)}，需调整，不能当作已落实。`
                        : "所选账户已被删除，已排除其本金，请重新选择。"}
                  </p>
                ) : null}
                <div className="growth-result-grid">
                  <span>
                    零收益年末基线
                    <b>
                      {analysis.months
                        ? money(analysis.baseline)
                        : "请核对本月安排"}
                    </b>
                  </span>
                  <span>
                    自填假设年末情景
                    <b>
                      {analysis.months ? money(analysis.projected) : "暂不外推"}
                    </b>
                  </span>
                  <span>
                    计划留存累计<b>{money(analysis.contribution)}</b>
                  </span>
                  <span>
                    假设回报影响<b>{money(analysis.effect)}</b>
                  </span>
                </div>
                <p className="growth-help">
                  从下月起至 {state.goal.year} 年末 · {analysis.months} 个完整月
                  · 本金 {money(analysis.capital)}。目标仍差{" "}
                  {money(analysis.gap)}
                  （假设情景）。
                </p>
                {view === "scenario" && analysis.months > 0 && (
                  <div
                    className="growth-chart"
                    role="img"
                    aria-label="零收益基线与自填回报情景对比，均不是实际业绩"
                  >
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart
                        data={analysis.points}
                        margin={{ left: 0, right: 10, top: 15, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="offset"
                          type="number"
                          domain={[0, analysis.months]}
                          ticks={analysis.points.map((point) => point.offset)}
                          tickFormatter={(value) =>
                            analysis.points.find(
                              (point) => point.offset === value,
                            )?.month ?? String(value)
                          }
                          minTickGap={30}
                          tick={{ fontSize: 10 }}
                        />
                        <YAxis
                          domain={[
                            Math.min(
                              0,
                              ...analysis.points.flatMap((point) => [
                                point.baseline,
                                point.scenario,
                              ]),
                            ),
                            Math.max(
                              1,
                              state.goal.target,
                              ...analysis.points.flatMap((point) => [
                                point.baseline,
                                point.scenario,
                              ]),
                            ),
                          ]}
                          width={55}
                          tick={{ fontSize: 10 }}
                          tickFormatter={(value) =>
                            `${Number((value / 10000).toFixed(1))}万`
                          }
                        />
                        <Tooltip
                          labelFormatter={(value) =>
                            analysis.points.find(
                              (point) => point.offset === Number(value),
                            )?.month ?? String(value)
                          }
                          formatter={(value, name) => [
                            money(Number(value)),
                            name,
                          ]}
                        />
                        <ReferenceLine
                          y={state.goal.target}
                          ifOverflow="extendDomain"
                          stroke="#b0915a"
                          strokeDasharray="4 4"
                        />
                        <Line
                          type="linear"
                          dataKey="baseline"
                          name="零收益基线"
                          stroke="#89998c"
                          strokeDasharray="5 4"
                          dot={false}
                          isAnimationActive={false}
                        />
                        <Line
                          type="linear"
                          dataKey="scenario"
                          name="自填回报情景"
                          stroke="#315b4d"
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="growth-chart-key">
                  <span>— 自填假设</span>
                  <span>┄ 零收益基线</span>
                  <span>┄ 家庭目标 {money(state.goal.target)}</span>
                </div>
                <details className="growth-disclosure">
                  <summary>核对情景数值（非实际业绩）</summary>
                  <div className="growth-table">
                    <table>
                      <thead>
                        <tr>
                          <th>期间</th>
                          <th>零收益基线</th>
                          <th>自填回报情景</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.points.map((point) => (
                          <tr key={point.offset}>
                            <td>{point.month}</td>
                            <td>{money(point.baseline)}</td>
                            <td>{money(point.scenario)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
                <p className="growth-help">
                  从下一个完整月开始，仅选中本金及长期月投入按月末复利，其余留存只累加；不追加本月已发生资金，也不计算本月剩余天数的回报。其他资产估值和负债固定；未计税费、通胀及房贷本金变化。两条路径均为算术情景，不是实际业绩或达标保证。
                </p>
              </>
            )}
          </div>
        </div>
        <button
          className="secondary growth-discuss"
          onClick={() =>
            onDiscuss(
              "只分析，不修改数据。请基于已保存的财富增长情景、预算、现金缓冲、负债和行动进度，给出本轮最值得执行的三个动作。区分未保存草稿和已保存计划、不计收益基线与假设回报，解释可控资金留存和风险；不要通过提高回报假设来保证达标。",
            )
          }
        >
          让顾问检视已保存的增长计划 <ArrowUpRight size={14} />
        </button>
      </div>
      <details className="growth-disclosure">
        <summary>方法、数据依据与边界</summary>
        <p>
          规则计算帮助排列需要讨论的事项，不是个性化投资、税务或法律建议。优先识别资料缺失、预算缺口和现金缓冲，再讨论负债、目标与执行。不得据此自动买卖或转账。
        </p>
        <a
          href="https://www.canada.ca/en/financial-consumer-agency/services/savings-investments/setting-up-emergency-funds.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          FCAC：应急金与定期复盘 ↗
        </a>
        <a
          href="https://www.getsmarteraboutmoney.ca/learning-path/getting-started/getting-started-with-investing/"
          target="_blank"
          rel="noopener noreferrer"
        >
          安省证监会投资教育：回报与风险 ↗
        </a>
      </details>
    </section>
  );
}
