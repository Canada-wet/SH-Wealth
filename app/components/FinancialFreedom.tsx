"use client";
import { useEffect, useRef, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { money, numberInput, type WealthState } from "@/lib/wealth";
import {
  defaultFreedomPlan,
  freedomAnalysis,
  freedomSummary,
  saveFreedomPlan,
  parseFreedomPlan,
  FREEDOM_KEY,
  type FreedomPlan,
} from "@/lib/freedom";
import { financialFingerprint } from "@/lib/advisor-preview";
type Numeric = Exclude<
  keyof FreedomPlan,
  "version" | "spendingMode" | "selectedAssetIds" | "goals"
>;
const fields: [Numeric, string, string][] = [
  [
    "extraMonthly",
    "额外每月生活／医疗开支",
    "仅填尚未包含在上方生活费内的金额。",
  ],
  [
    "annualIncome",
    "退休起即可获得的税后年收入",
    "可填已核实租金／年金。不要填在职工资或尚未到领取年龄的 CPP/OAS。",
  ],
  [
    "withdrawalRate",
    "初始年提取率 %",
    "2.5% 对应40倍年缺口。不是存款利率或安全承诺。",
  ],
  [
    "withdrawalTax",
    "提款有效税负假设 %",
    "不是税率计算器；TFSA、RRSP和非注册账户须分别核对，默认0不代表免税。",
  ],
  ["reserveMonths", "缓冲金月数", "与生活费本金分开预留；不自动新增资产。"],
  ["years", "距离财务自由的年数", "0–60整数年，和净资产目标期限分开。"],
  [
    "retirementYears",
    "预计退休生活年数",
    "用于零实际回报的提款年限检查；不会自动指定安全提取率。",
  ],
  [
    "monthlySaving",
    "计划每月投入 · 今日 CAD",
    "初始来自已存增长计划或预算结余，需确认；情景假设每年随通胀调整。",
  ],
  [
    "netReturn",
    "税费后名义年回报假设 %",
    "不沿用资产表本年回报；不是市场预测。",
  ],
  [
    "inflation",
    "长期年通胀假设 %",
    "全部结果以今日购买力比较，另列未来名义金额。",
  ],
];
type Draft = Omit<FreedomPlan, Numeric | "goals"> &
  Record<Numeric, string> & {
    goals: { id: string; name: string; amount: string }[];
  };
const numericKeys: Numeric[] = ["monthlySpending", ...fields.map((f) => f[0])];
const draftOf = (p: FreedomPlan): Draft => ({
  ...p,
  ...(Object.fromEntries(numericKeys.map((k) => [k, String(p[k])])) as Record<
    Numeric,
    string
  >),
  goals: p.goals.map((g) => ({ ...g, amount: String(g.amount) })),
});
const parse = (d: Draft): FreedomPlan => ({
  ...d,
  ...(Object.fromEntries(
    numericKeys.map((k) => [
      k,
      numberInput(
        d[k],
        fields.find((f) => f[0] === k)?.[1] ?? "月生活费",
        k === "netReturn",
      ),
    ]),
  ) as Record<Numeric, number>),
  goals: d.goals.map((g) => ({
    ...g,
    amount: numberInput(g.amount, "专项预算"),
  })),
});
export default function FinancialFreedom({
  state,
  ready,
  syncStatus,
  onChange,
  onDiscuss,
}: {
  state: WealthState;
  ready: boolean;
  syncStatus: string;
  onChange: (
    update: (s: WealthState) => WealthState,
    reason: string,
  ) => boolean;
  onDiscuss: (prompt: string) => void;
}) {
  const read = () =>
    parseFreedomPlan(state.plan.values[FREEDOM_KEY]) ??
    defaultFreedomPlan(state);
  const [draft, setDraft] = useState<Draft>(() => draftOf(read()));
  const [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const expected = useRef(financialFingerprint(state));
  const assumptionsRef = useRef<HTMLFormElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const jump = (element: HTMLElement | null) => {
    element?.scrollIntoView({ block: "start", behavior: "smooth" });
    element?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!dirty) {
      setDraft(draftOf(read()));
      expected.current = financialFingerprint(state);
    }
  }, [state, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const edit = (p: Partial<Draft>) => {
    if (!dirty) expected.current = financialFingerprint(state);
    setDirty(true);
    setDraft((d) => ({ ...d, ...p }));
    setError("");
    setNotice("");
  };
  let analysis: ReturnType<typeof freedomAnalysis> | null = null,
    plan: FreedomPlan | undefined,
    inputError = "";
  try {
    plan = parse(draft);
    analysis = freedomAnalysis(state, plan);
  } catch (e) {
    inputError = e instanceof Error ? e.message : "请检查输入。";
  }
  const saved = state.plan.values[FREEDOM_KEY] !== undefined;
  const stale = dirty && expected.current !== financialFingerprint(state);
  return (
    <section className="freedom-planner" aria-label="财务自由规划">
      <header className="freedom-heading">
        <div>
          <p className="eyebrow">FINANCIAL FREEDOM · 有选择的生活</p>
          <h3>不是一个神奇数字，是可讨论的生活计划</h3>
          <p>
            生活费缺口本金 ＋ 缓冲金 ＋
            额外专项。只用你们确认的资金，不把房子默认变成可提款账户。
          </p>
        </div>
        <span className="freedom-save-state">
          {dirty ? "草稿未保存" : saved ? syncStatus : "未确认的初始情景"}
        </span>
      </header>
      <div className="freedom-jump" role="group" aria-label="财务自由快捷定位">
        <button
          type="button"
          className="secondary"
          onClick={() => jump(assumptionsRef.current)}
        >
          调整假设 ↓
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => jump(resultsRef.current)}
        >
          查看测算 ↓
        </button>
      </div>
      <details className="freedom-explainer">
        <summary>读懂 480 × 月开销 ＋ K × 孩子数 ＋ M</summary>
        <p>
          480个月等于40倍年支出，隐含初始年提取率2.5%，不是“40年保证够花”。孩子成本随年龄和教育安排变化；医疗取决于保障、地区和长期照护需求，不能靠统一
          K 或 M。已包含在月支出的孩子／医疗费用不应再加一遍。
        </p>
        <p>
          更合理的起点：max(0，年生活费 − 退休起可得税后收入) ÷ (1 −
          提款税负假设) ÷
          提取率。再加未重复计算的缓冲及专项资金。未来养老金开始前的桥接缺口、税制、投资顺序风险和保险需要单独规划。
        </p>
        <a
          href="https://www.morningstar.com/retirement/whats-safe-retirement-withdrawal-rate-2026"
          target="_blank"
          rel="noreferrer"
        >
          Morningstar 2025退休收入研究 ↗
        </a>
        <span> · </span>
        <a
          href="https://www.canada.ca/en/financial-consumer-agency/services/retirement-planning.html"
          target="_blank"
          rel="noreferrer"
        >
          加拿大退休规划 ↗
        </a>
        <p>
          研究中的提取率有特定资产配置、年限和成功率假设，不能直接套用于加拿大税后家庭计划。
        </p>
      </details>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="market-notice">
          {notice}
        </p>
      )}
      {stale && (
        <p className="error-banner" role="alert">
          家庭数据在编辑期间已变化。草稿仍在；保存前请重新载入并核对，避免覆盖伴侣安排。
        </p>
      )}
      <div className="freedom-layout">
        <form
          ref={assumptionsRef}
          tabIndex={-1}
          aria-label="财务自由规划假设"
          onSubmit={(e) => {
            e.preventDefault();
            setNotice("");
            try {
              const p = parse(draft);
              let failure = "未保存，请检查同步状态；草稿保留。";
              const ok = onChange((current) => {
                try {
                  return saveFreedomPlan(current, p, expected.current);
                } catch (err) {
                  failure = err instanceof Error ? err.message : failure;
                  throw err;
                }
              }, "保存财务自由规划假设");
              if (ok) {
                setDirty(false);
                setError("");
                setNotice(
                  "财务自由计划已保存；资产估值、现金流和贡献金额未改动。",
                );
              } else setError(failure);
            } catch (err) {
              setError(err instanceof Error ? err.message : "请核对输入。");
            }
          }}
        >
          <fieldset>
            <legend>1 · 怎样的生活</legend>
            <label>
              生活费来源
              <select
                aria-label="财务自由生活费来源"
                value={draft.spendingMode}
                onChange={(e) =>
                  edit({
                    spendingMode: e.target.value as FreedomPlan["spendingMode"],
                  })
                }
              >
                <option value="budget">联动当前预算支出（不减在职收入）</option>
                <option value="manual">手动设退休月生活费</option>
              </select>
            </label>
            {draft.spendingMode === "manual" ? (
              <label>
                退休月生活费 · 今日 CAD
                <input
                  aria-label="退休月生活费"
                  inputMode="decimal"
                  value={draft.monthlySpending}
                  onChange={(e) => edit({ monthlySpending: e.target.value })}
                />
              </label>
            ) : (
              <p className="freedom-help">
                已记录月支出 {money(analysis?.budget.expenses ?? 0)}
                ，编辑现金流后同步重算；未包含不定期开支请补齐。预算缺失不是零开销。
              </p>
            )}
            {fields.slice(0, 5).map(([key, label, help]) => (
              <label key={key}>
                {label}
                <input
                  inputMode="decimal"
                  aria-label={label}
                  value={draft[key]}
                  onChange={(e) => edit({ [key]: e.target.value })}
                />
                <small>{help}</small>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>2 · 资金从哪里来</legend>
            <p className="freedom-help">
              默认一个都不选。仅勾选确实能在计划中支用的账户；退休锁定、住房及车辆需自行核实变现和税费。会先从所选资金中隔离缓冲和专项，不能同时计算复利。
            </p>
            <details>
              <summary>
                选择可用于此计划的资金（{draft.selectedAssetIds.length}项）
              </summary>
              <div className="freedom-assets">
                {state.assets.map((a) => (
                  <label key={a.id}>
                    <input
                      type="checkbox"
                      aria-label={`自由计划资金：${a.name}`}
                      checked={draft.selectedAssetIds.includes(a.id)}
                      onChange={(e) =>
                        edit({
                          selectedAssetIds: e.target.checked
                            ? [...draft.selectedAssetIds, a.id]
                            : draft.selectedAssetIds.filter(
                                (id) => id !== a.id,
                              ),
                        })
                      }
                    />
                    <span>
                      {a.name}
                      <small>
                        {a.category} · {a.liquidity ?? "流动性待核对"}
                      </small>
                    </span>
                    <b>{money(a.value)}</b>
                  </label>
                ))}
                {!state.assets.length && <a href="#assets">先录入资产 →</a>}
              </div>
            </details>
            <h4>仅额外的一次性目标</h4>
            <p className="freedom-help">
              逐项填教育／搬家／照护等额外预算（今日CAD）；不包含已在月支出内的部分。此简化情景先预留全部专项，不模拟逐年支用。
            </p>
            {draft.goals.map((g, i) => (
              <div className="freedom-goal-row" key={g.id}>
                <label>
                  专项名称
                  <input
                    aria-label={`专项${i + 1}名称`}
                    maxLength={80}
                    value={g.name}
                    onChange={(e) =>
                      edit({
                        goals: draft.goals.map((x) =>
                          x.id === g.id ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  今日预算
                  <input
                    aria-label={`专项${i + 1}金额`}
                    inputMode="decimal"
                    value={g.amount}
                    onChange={(e) =>
                      edit({
                        goals: draft.goals.map((x) =>
                          x.id === g.id ? { ...x, amount: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="text-button"
                  aria-label={`移除专项${i + 1}`}
                  onClick={() =>
                    edit({ goals: draft.goals.filter((x) => x.id !== g.id) })
                  }
                >
                  移除
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              disabled={draft.goals.length >= 10}
              onClick={() =>
                edit({
                  goals: [
                    ...draft.goals,
                    { id: crypto.randomUUID(), name: "额外专项", amount: "0" },
                  ],
                })
              }
            >
              ＋ 添加专项预算
            </button>
          </fieldset>
          <fieldset>
            <legend>3 · 时间与投入假设</legend>
            {fields.slice(5).map(([key, label, help]) => (
              <label key={key}>
                {label}
                <input
                  inputMode="decimal"
                  aria-label={label}
                  value={draft[key]}
                  onChange={(e) => edit({ [key]: e.target.value })}
                />
                <small>{help}</small>
              </label>
            ))}
          </fieldset>
          {inputError && (
            <p role="alert" className="error-banner">
              {inputError}
            </p>
          )}
          <div className="freedom-actions">
            <button
              className="primary"
              disabled={!ready || !!inputError || stale}
            >
              保存财务自由计划
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setDirty(false);
                setDraft(draftOf(read()));
                expected.current = financialFingerprint(state);
                setError("");
                setNotice("已重新载入当前共享计划，未保存草稿已丢弃。");
              }}
            >
              重新载入共享计划
            </button>
          </div>
        </form>
        <div
          className="freedom-results"
          aria-label="财务自由测算结果"
          ref={resultsRef}
          tabIndex={-1}
        >
          {!analysis ? (
            <p className="error-banner" role="alert">
              输入尚未有效，暂不展示金额结论：{inputError}
            </p>
          ) : !analysis.complete ? (
            <p className="market-notice">
              尚未记录支出。先补现金流或填写退休生活费，不能将缺失当零并宣布财务自由。
            </p>
          ) : (
            <>
              <div className="freedom-target">
                <small>目标资金 · 今日 CAD 购买力</small>
                <strong>{money(analysis.totalTarget)}</strong>
                <p>
                  其中可提款本金 {money(analysis.portfolioTarget)}，缓冲{" "}
                  {money(analysis.reserve)}，额外专项 {money(analysis.goals)}。
                </p>
              </div>
              <div className="planning-metrics">
                <span>
                  退休年支出<b>{money(analysis.annualSpending)}</b>
                </span>
                <span>
                  需资产承担的税后年缺口<b>{money(analysis.annualGap)}</b>
                </span>
                <span>
                  确认纳入的账面资金<b>{money(analysis.capital)}</b>
                </span>
                <span>
                  所选资金中可参与增长的本金<b>{money(analysis.portfolio)}</b>
                </span>
              </div>
              <p className="freedom-help">
                未纳入资产 {money(analysis.excluded)}；缓冲与专项尚缺{" "}
                {money(analysis.protectedGap)}
                。日常预算中的房贷继续计支，不自动扣除／清偿贷款；若规划一次还清，请另建情景并相应调整退休支出，避免双重计算。
              </p>
              {analysis.missingAssets.length > 0 && (
                <p className="error-banner">
                  {analysis.missingAssets.length}{" "}
                  个已选账户不再存在，未计入本金；请重新选资金并保存。
                </p>
              )}
              {analysis.illiquid.length > 0 && (
                <p className="error-banner">
                  所选包含锁定或非流动资产：
                  {analysis.illiquid.map((a) => a.name).join("、")}
                  。结果暂不代表这些资金已可支用。
                </p>
              )}
              <div className="freedom-projection">
                <h4>{draft.years}年后的假设情景</h4>
                <strong>{money(analysis.projection.value)}</strong>
                <p>
                  距今日购买力目标还差 {money(analysis.shortfall)}
                  ；同一目标未来名义金额约 {money(analysis.futureNominalTarget)}
                  。
                </p>
                <p>
                  税费后实际年回报假设 {(analysis.realReturn * 100).toFixed(2)}
                  %。专项与缓冲不参与此回报，假设保值至目标日；新留存先补足它们，再增长。
                </p>
              </div>
              {Number(draft.years) > 0 && (
                <div className="freedom-chart" aria-label="财务自由资金路径图">
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={analysis.projection.points}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="year"
                        tickFormatter={(v) => `${v}年`}
                        minTickGap={24}
                      />
                      <YAxis
                        width={58}
                        tickFormatter={(v) => `${(v / 10000).toFixed(0)}万`}
                      />
                      <Tooltip
                        formatter={(v) => money(Number(v))}
                        labelFormatter={(v) => `第${v}年 · 今日CAD`}
                      />
                      <Line
                        type="linear"
                        dataKey="value"
                        name="假设资金"
                        stroke="#365b4d"
                        strokeWidth={2.5}
                        dot={false}
                      />
                      <Line
                        type="linear"
                        dataKey="target"
                        name="目标资金"
                        stroke="#b0915a"
                        strokeDasharray="5 5"
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="freedom-levers">
                <h4>先改变可控的部分</h4>
                {!analysis.cashflowComplete && (
                  <p className="error-banner">
                    当前现金流收入或支出缺失，尚不能判断月投入能力。
                  </p>
                )}
                {!!analysis.savingAboveBudget && (
                  <p className="error-banner">
                    计划月投入超过当前已录入预算结余{" "}
                    {money(analysis.savingAboveBudget)}
                    ；情景不代表这些资金已可支配。
                  </p>
                )}
                <p>
                  {analysis.requiredMonthly === null
                    ? "目标为现在，不能靠未来月供弥补当前差额。"
                    : `按这些假设，所需月投入约 ${money(analysis.requiredMonthly)}；目前计划 ${money(Number(draft.monthlySaving))}。`}
                </p>
                <p>
                  每月额外留存 $500：目标日资金增加{" "}
                  {money(
                    analysis.extraSaving.value - analysis.projection.value,
                  )}
                  。只是假设，不自动改预算或增长计划。
                </p>
                <p>
                  若长期月支出减少最多
                  $500，且不重复调整其他项目，所需总目标减少约{" "}
                  {money(analysis.spendingReduction)}
                  。这是可讨论的支出情景，不自动削减预算。
                </p>
                <p>
                  若增长本金先跌20%：目标日情景约 {money(analysis.stress.value)}
                  。仅单次压力测试，不是最大回撤或亏损概率。
                </p>
              </div>
              <details open>
                <summary>提取率不同，目标差多少</summary>
                <div className="freedom-sensitivity">
                  {analysis.sensitivity.map((s) => (
                    <div key={s.rate}>
                      <span>{s.rate}%</span>
                      <b>{money(s.target)}</b>
                    </div>
                  ))}
                </div>
                <p className="freedom-help">
                  这是敏感性比较，不是安全等级。预计退休 {draft.retirementYears}{" "}
                  年：若退休后实际回报为0，情景中的可提款本金
                  {analysis.drawdownCoverage === null
                    ? "无需承担已填生活费缺口（需确认收入保障）"
                    : `约覆盖 ${analysis.drawdownCoverage.toFixed(1)} 年`}
                  。不计市场顺序风险、突发开支及养老金桥接，不能当作成功率。
                </p>
              </details>
              <div className="freedom-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={!ready || !!inputError}
                  onClick={() =>
                    plan &&
                    onDiscuss(
                      `只做分析，不修改账本。请检视以下${dirty ? "未保存草稿" : "已保存"}，先查重复计支、可支用资金、养老金桥接、税费、退休年限和顺序风险，再给一个可控行动与季度复盘标准。${freedomSummary(state, plan)}`,
                    )
                  }
                >
                  与顾问检视此情景
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    if (!plan) return;
                    const url = URL.createObjectURL(
                      new Blob(
                        [
                          `# 财务自由规划\n\n${freedomSummary(state, plan)}\n\n${dirty ? "未保存草稿" : "已存计划"}；不保证提取率安全，投资、税务、法律事项需专业核实。\n\n## 假设\n\n${JSON.stringify(plan, null, 2)}`,
                        ],
                        { type: "text/markdown;charset=utf-8" },
                      ),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "Together-财务自由情景.md";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  导出情景与假设
                </button>
              </div>
              <div className="planning-links">
                <a href="#cashflow">补齐真实支出 →</a>
                <a href="#assets">核对可支用账户 →</a>
                <a href="#quarterly-review">季度复盘 →</a>
              </div>
            </>
          )}
          <p className="freedom-help">
            不计算真实成功概率，不自动转账、调仓或改变净资产目标。孩子／医疗／旅行／房贷金额应只计一次；真实税费、未来养老金起领和住房变现应单独复核。这里的“够不够”取决于输入假设，不是财务建议。
          </p>
        </div>
      </div>
    </section>
  );
}
