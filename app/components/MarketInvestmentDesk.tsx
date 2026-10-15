"use client";
import { useEffect, useState } from "react";
import { instrumentKey, type MarketInstrument } from "@/lib/market";
import {
  cadScenario,
  EMPTY_RESEARCH_NOTE,
  productCaution,
  RESEARCH_THEMES,
  researchTheme,
  type ResearchNote,
  type ResearchNotes,
} from "@/lib/market-research";

const fields = [
  ["thesis", "投资逻辑", "为什么关注？增长或估值假设是什么？需要哪些证据？"],
  ["risk", "主要风险", "可能亏损的路径、资金使用期限，以及最不确定的假设。"],
  [
    "invalidation",
    "失效条件",
    "什么事实会推翻逻辑？例如现金流、订单或政策变化，而非只看股价。",
  ],
] as const;
const money = (value: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
const pct = (value: number) =>
  `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;

export default function MarketInvestmentDesk({
  rows,
  selected,
  notes,
  ready,
  syncStatus,
  onSelect,
  onChart,
  onSave,
}: {
  rows: MarketInstrument[];
  selected: string;
  notes: ResearchNotes;
  ready: boolean;
  syncStatus: string;
  onSelect: (key: string) => void;
  onChart: (row: MarketInstrument) => void;
  onSave: (
    row: MarketInstrument,
    baseline: ResearchNote | undefined,
    draft: ResearchNote,
  ) => boolean;
}) {
  const [drafts, setDrafts] = useState<
    Record<string, { baseline: ResearchNote | undefined; value: ResearchNote }>
  >({});
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState("10000"),
    [asset, setAsset] = useState("-20"),
    [fx, setFx] = useState("0"),
    [mode, setMode] = useState("cad");
  const row = rows.find((item) => instrumentKey(item) === selected) ?? rows[0];
  const key = row ? instrumentKey(row) : "";
  const draft = drafts[key],
    saved = notes[key],
    note = draft?.value ?? saved ?? EMPTY_RESEARCH_NOTE;
  const caution = row ? productCaution(row) : null;
  const theme = row
    ? RESEARCH_THEMES[researchTheme(row)]
    : RESEARCH_THEMES.other;
  const dirty = Object.keys(drafts).length > 0;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const update = (field: keyof ResearchNote, value: string) => {
    setMessage("");
    setDrafts((current) => ({
      ...current,
      [key]: {
        baseline: current[key] ? current[key].baseline : saved,
        value: { ...(current[key]?.value ?? note), [field]: value },
      },
    }));
  };
  const discard = () =>
    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  const result =
    amount.trim() && asset.trim() && (mode === "cad" || fx.trim())
      ? cadScenario(
          Number(amount),
          Number(asset),
          mode === "cad" ? 0 : Number(fx),
        )
      : null;
  const due = rows.filter((item) => {
    const date = notes[instrumentKey(item)]?.reviewDate;
    const today = new Date();
    const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return date && date <= localDate;
  });
  return (
    <section
      className="card market-section investment-desk"
      id="investment-desk"
      aria-label="投资研究工作台"
    >
      <div className="card-head">
        <div>
          <p className="eyebrow">INVESTMENT PROCESS · NOT A TRADING SIGNAL</p>
          <h2>从关注，到有依据的判断</h2>
          <p>
            一只标的，一份可复盘的逻辑。研究记录与家庭数据一同保存；不会下单或修改持仓。
          </p>
        </div>
        <span className="market-badge">研究 ≠ 建议买卖</span>
      </div>
      {due.length > 0 && (
        <div className="desk-review" aria-label="待复盘标的">
          <b>{due.length} 只到达复盘日期</b>
          <span>日期由你设置，不代表财报或交易提醒。</span>
          {due.map((item) => (
            <button
              className="text-button"
              key={instrumentKey(item)}
              onClick={() => {
                onSelect(instrumentKey(item));
                setMessage("");
              }}
            >
              {item.ticker} · {notes[instrumentKey(item)].reviewDate}
            </button>
          ))}
        </div>
      )}
      {!row ? (
        <p className="empty-note">先在自选管理添加证券，再开始记录。</p>
      ) : (
        <>
          <div className="desk-selection">
            <label>
              研究标的
              <select
                aria-label="研究标的"
                value={key}
                disabled={!ready}
                onChange={(event) => {
                  onSelect(event.target.value);
                  setMessage("");
                }}
              >
                {rows.map((item) => (
                  <option key={instrumentKey(item)} value={instrumentKey(item)}>
                    {item.ticker} · {item.exchange} · {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary" onClick={() => onChart(row)}>
              查看 {row.ticker} 图表 ↓
            </button>
          </div>
          <div className="desk-context">
            <span className="market-badge">{theme.label}</span>
            <p>{theme.question}</p>
          </div>
          {caution && (
            <aside className="desk-caution">
              <b>{caution.title}</b>
              <p>{caution.text}</p>
              <a href={caution.url} target="_blank" rel="noopener noreferrer">
                核对发行人产品说明 ↗
              </a>
              <small>产品结构核对：2026-10-14；请以最新文件为准。</small>
            </aside>
          )}
          <div className="desk-columns">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (draft) {
                  if (onSave(row, draft.baseline, draft.value)) {
                    discard();
                    setMessage(
                      `${row.ticker} 研究记录已保存到本机；云端状态见下方。`,
                    );
                  } else
                    setMessage(
                      "保存未完成，草稿仍保留。请核对页面顶部的具体原因；不要重复覆盖其他成员的更新。",
                    );
                }
              }}
            >
              <h3>研究备忘录</h3>
              <p className="desk-help">
                写下证据、反证与下一次检查点，避免只因当日涨跌改变计划。
              </p>
              {fields.map(([field, label, placeholder]) => (
                <label key={field}>
                  {label}
                  <textarea
                    aria-label={label}
                    value={note[field]}
                    maxLength={2000}
                    disabled={!ready}
                    rows={3}
                    placeholder={placeholder}
                    onChange={(event) => update(field, event.target.value)}
                  />
                </label>
              ))}
              <label>
                下次复盘日期
                <input
                  aria-label="下次复盘日期"
                  type="date"
                  value={note.reviewDate}
                  disabled={!ready}
                  onChange={(event) => update("reviewDate", event.target.value)}
                />
              </label>
              <div className="desk-actions">
                <button
                  className="primary"
                  disabled={!ready || !draft}
                  type="submit"
                >
                  保存研究记录
                </button>
                {draft && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      discard();
                      setMessage("已放弃此标的草稿，读取最新保存记录。");
                    }}
                  >
                    放弃此标的草稿
                  </button>
                )}
              </div>
              <p className="desk-help" role="status">
                {draft
                  ? "此标的有未保存草稿；切换标的会保留，离开页面不会自动保存。"
                  : saved
                    ? `已保存 · ${new Date(saved.updatedAt).toLocaleString("zh-CN")}`
                    : "尚无记录"}{" "}
                · {syncStatus}
              </p>
              {message && <p role="status">{message}</p>}
            </form>
            <div className="desk-stress">
              <h3>加币视角 · 压力试算</h3>
              <p className="desk-help">
                手动假设，不是行情、预测或目标价。仅在本次页面使用，不写入账本。
              </p>
              <label>
                收益口径
                <select
                  aria-label="压力试算收益口径"
                  value={mode}
                  onChange={(event) => setMode(event.target.value)}
                >
                  <option value="cad">已是 CAD 报价收益 · 不叠加汇率</option>
                  <option value="foreign">外币报价收益 · 折算回 CAD</option>
                </select>
              </label>
              <label>
                假设投入 · CAD
                <input
                  aria-label="压力试算投入"
                  type="number"
                  min="1"
                  max="1000000000000"
                  step="any"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
              <label>
                {mode === "cad"
                  ? "CAD 报价收益假设 · %"
                  : "外币报价收益假设 · %"}
                <input
                  aria-label="价格收益假设"
                  type="number"
                  min="-100"
                  max="1000"
                  step="any"
                  value={asset}
                  onChange={(event) => setAsset(event.target.value)}
                />
              </label>
              {mode === "foreign" && (
                <label>
                  每单位外币的 CAD 价值变化 · %
                  <input
                    aria-label="汇率变化假设"
                    type="number"
                    min="-99.999"
                    max="1000"
                    step="any"
                    value={fx}
                    onChange={(event) => setFx(event.target.value)}
                  />
                  <small>
                    正值 = 外币相对加币升值；不是 1 CAD 能买到的外币变化。
                  </small>
                </label>
              )}
              <div
                className="desk-scenario-buttons"
                role="group"
                aria-label="压力情景快捷填入"
              >
                {[-10, -20, -40].map((value) => (
                  <button
                    className="secondary"
                    key={value}
                    onClick={() => setAsset(String(value))}
                  >
                    价格 {value}%
                  </button>
                ))}
              </div>
              <div
                className="desk-result"
                aria-label="压力试算结果"
                aria-live="polite"
              >
                {result ? (
                  <>
                    <span>
                      折算回报 <b>{pct(result.rate)}</b>
                    </span>
                    <span>
                      期末金额 <b>{money(result.end)}</b>
                    </span>
                    <span>
                      账面盈亏 <b>{money(result.pnl)}</b>
                    </span>
                    {result.rate < 0 && (
                      <span>
                        回到本金所需涨幅{" "}
                        <b>
                          {result.recovery === null
                            ? "本金归零，无法用百分比恢复"
                            : pct(result.recovery)}
                        </b>
                      </span>
                    )}
                  </>
                ) : (
                  <p>
                    请填写有效数字：投入大于 0；价格收益 −100% 至
                    1000%；汇率变化大于 −100% 且不超过 1000%。
                  </p>
                )}
              </div>
              <details className="desk-method">
                <summary>计算方法与边界</summary>
                <p>
                  CAD 回报 = (1 + 价格收益) × (1 + 每单位外币 CAD 价值变化) −
                  1。已是 CAD 报价时汇率项为
                  0，避免重复计算。未计股息、税费、点差、交易时点与对冲成本。
                </p>
                <p>
                  杠杆产品请输入产品本身的假设回报，不把指数多日收益乘三。回本涨幅仅是数学关系，不代表会回本。
                </p>
                <a
                  href="https://www.investor.gov/introduction-investing/investing-basics/investment-products/international-investing"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  SEC · 国际投资与汇率风险 ↗
                </a>
              </details>
            </div>
          </div>
        </>
      )}
      <div className="desk-discipline">
        <b>组合管理的下一步</b>
        <p>
          自选并非持仓。真实集中度、行业穿透、回撤和收益归因需要份额、成本、现金流及基金最新持仓。当前不以自选数量计算仓位，不生成伪精确的风险评分或买卖信号。
        </p>
      </div>
    </section>
  );
}
