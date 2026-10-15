"use client";
import { useEffect, useState } from "react";
import { Link2, Plus, Trash2 } from "lucide-react";
import {
  EXPOSURES,
  linkBaseline,
  portfolioExposure,
  portfolioInsights,
  portfolioStress,
  savePortfolioLinks,
  type PortfolioLink,
} from "@/lib/portfolio-links";
import { id, money, ownerLabel, type WealthState } from "@/lib/wealth";
import {
  instrumentKey,
  type MarketData,
  type MarketInstrument,
} from "@/lib/market";
export default function MarketWealth({
  state,
  data,
  list,
  onChange,
  disabled,
}: {
  state: WealthState;
  data: MarketData | null;
  list: MarketInstrument[];
  onChange: (update: (state: WealthState) => WealthState) => unknown;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState<PortfolioLink[] | null>(null),
    [baseline, setBaseline] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [price, setPrice] = useState("-20"),
    [fx, setFx] = useState("-5");
  const [privateView, setPrivateView] = useState(true);
  useEffect(() => {
    try {
      setPrivateView(sessionStorage.getItem("together-privacy") === "on");
    } catch {}
  }, []);
  useEffect(() => {
    if (draft === null) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft]);
  const exposure = portfolioExposure(state),
    insights = portfolioInsights(state, data);
  let stress: ReturnType<typeof portfolioStress> | null = null;
  try {
    if (price.trim() && fx.trim())
      stress = portfolioStress(state, Number(price), Number(fx));
  } catch {}
  const edit = () => {
    setDraft(structuredClone(state.preferences.portfolioLinks ?? []));
    setBaseline(linkBaseline(state));
    setError("");
    setNotice("");
  };
  const patch = (key: string, update: Partial<PortfolioLink>) =>
    setDraft((rows) =>
      rows!.map((r) => (r.id === key ? { ...r, ...update } : r)),
    );
  const save = () => {
    try {
      if (disabled) throw new Error("请先处理云端连接或数据冲突。");
      onChange((current) => savePortfolioLinks(current, baseline, draft!));
      setDraft(null);
      setNotice("关联已保存；请以上方云端同步状态为准。未改写资产估值。");
    } catch (r) {
      setError(r instanceof Error ? r.message : "未保存");
    }
  };
  if (privateView)
    return (
      <section
        id="market-wealth"
        className="card portfolio-workspace"
        aria-label="市场与家庭联动"
      >
        <h2>家庭联动内容已隐藏</h2>
        <p>隐私模式下不展示账户、敞口和压力测算。</p>
        <button
          className="secondary"
          onClick={() => {
            try {
              sessionStorage.setItem("together-privacy", "off");
              setPrivateView(false);
            } catch {
              setError("无法读取隐私偏好，请在首页恢复显示。");
            }
          }}
        >
          显示家庭联动数据
        </button>
        {error && <p role="alert">{error}</p>}
      </section>
    );
  return (
    <section
      className="card portfolio-workspace"
      id="market-wealth"
      aria-label="市场与家庭联动"
    >
      <div className="section-head">
        <div>
          <p className="eyebrow">MARKET × YOUR WEALTH</p>
          <h2>
            <Link2 size={19} /> 市场变化，与你们有什么关系？
          </h2>
          <p>先明确持有，再看风险与行动。自选不是持仓，关联不会自动改账。</p>
        </div>
        <button
          className="secondary"
          disabled={disabled || draft !== null}
          onClick={edit}
        >
          管理账户关联
        </button>
      </div>
      <div className="portfolio-metrics">
        <div>
          <small>已关联 · CAD</small>
          <b>{money(exposure.linked)}</b>
          <span>家庭总资产 {exposure.coverage.toFixed(1)}%</span>
        </div>
        <div>
          <small>未关联 · 保持未知</small>
          <b>{money(exposure.unknown)}</b>
          <span>不推断账户底层持仓</span>
        </div>
        <div>
          <small>已关联标的</small>
          <b>{exposure.byInstrument.length}</b>
          <span>同证券跨账户合并 · ETF 未穿透</span>
        </div>
      </div>
      {notice && <p role="status">{notice}</p>}
      {draft !== null && (
        <div className="portfolio-editor" aria-label="账户关联编辑器">
          <p>
            所有账户估值已是
            CAD。比例随最新账户金额重算，不是份额或券商自动同步。币种指你确认的经济敞口，不按交易所自动判断；CAD
            计价 ETF 也可能未对冲。
          </p>
          {draft.map((r, i) => (
            <div className="portfolio-edit-row" key={r.id}>
              <label>
                账户 {i + 1}
                <select
                  value={r.assetId}
                  onChange={(e) => patch(r.id, { assetId: e.target.value })}
                >
                  {!state.assets.some((a) => a.id === r.assetId) && (
                    <option value={r.assetId}>已删除账户 · 请移除此行</option>
                  )}
                  {state.assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {ownerLabel(a.owner, state.members)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                证券 {i + 1}
                <select
                  value={instrumentKey(r.instrument)}
                  onChange={(e) =>
                    patch(r.id, {
                      instrument: [...list, r.instrument].find(
                        (x) => instrumentKey(x) === e.target.value,
                      )!,
                    })
                  }
                >
                  {[
                    ...list,
                    ...(!list.some(
                      (x) => instrumentKey(x) === instrumentKey(r.instrument),
                    )
                      ? [r.instrument]
                      : []),
                  ].map((x) => (
                    <option key={instrumentKey(x)} value={instrumentKey(x)}>
                      {instrumentKey(x)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                账户配置 % {i + 1}
                <input
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  value={Number.isFinite(r.weight) ? r.weight : ""}
                  onChange={(e) =>
                    patch(r.id, {
                      weight: e.target.value ? Number(e.target.value) : NaN,
                    })
                  }
                />
              </label>
              <label>
                外币敞口 {i + 1}
                <select
                  value={r.currency}
                  onChange={(e) =>
                    patch(r.id, {
                      currency: e.target.value as PortfolioLink["currency"],
                    })
                  }
                >
                  {Object.entries(EXPOSURES).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="icon-button"
                aria-label={`移除关联 ${i + 1}`}
                onClick={() => setDraft(draft.filter((x) => x.id !== r.id))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <div className="portfolio-controls">
            <button
              className="secondary"
              disabled={
                !state.assets.length || !list.length || draft.length >= 180
              }
              onClick={() =>
                setDraft([
                  ...draft,
                  {
                    id: id(),
                    assetId: state.assets[0].id,
                    instrument: list[0],
                    weight: 100,
                    currency: "unknown",
                  },
                ])
              }
            >
              <Plus size={15} /> 添加关联
            </button>
            <button className="primary" disabled={disabled} onClick={save}>
              保存账户关联
            </button>
            <button
              className="text-button"
              onClick={() => {
                setDraft(null);
                setError("");
              }}
            >
              放弃关联草稿
            </button>
          </div>
          {!state.assets.length && <p>先到家庭财富页添加资产账户。</p>}
          {!list.length && <p>先在自选管理添加证券。</p>}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </div>
      )}
      <div className="portfolio-insights">
        {insights.map((r) => (
          <article key={r.id}>
            <h3>{r.title}</h3>
            <p>{r.body}</p>
            <small>下一步 · {r.next}</small>
            {r.source && (
              <a href={r.source} target="_blank" rel="noopener noreferrer">
                核对官方来源 ↗
              </a>
            )}
          </article>
        ))}
      </div>
      {!!exposure.rows.length && (
        <details>
          <summary>查看关联明细与压力试算</summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>账户 / 归属</th>
                  <th>证券</th>
                  <th>配置</th>
                  <th>关联 CAD</th>
                  <th>经济敞口</th>
                </tr>
              </thead>
              <tbody>
                {exposure.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.account} · {ownerLabel(r.owner, state.members)}
                    </td>
                    <td>{instrumentKey(r.instrument)}</td>
                    <td>{r.weight}%</td>
                    <td>{money(r.value)}</td>
                    <td>{EXPOSURES[r.currency]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="portfolio-stress">
            <label>
              关联标的统一价格冲击 %
              <input
                type="number"
                min="-100"
                max="100"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
            <label>
              已确认未对冲外币相对 CAD 变动 %
              <input
                type="number"
                min="-99"
                max="100"
                value={fx}
                onChange={(e) => setFx(e.target.value)}
              />
            </label>
            <div role="status">
              {stress ? (
                <>
                  <b>假设影响 {money(stress.effect)}</b>
                  <p>
                    假设净资产 {money(stress.netWorth)} · 目标差距{" "}
                    {money(stress.goalGap)}
                  </p>
                  {stress.recoveryMonths !== null && (
                    <p>
                      约相当于 {stress.recoveryMonths.toFixed(1)}{" "}
                      个月已保存的计划留存，不是预计回本时间。
                    </p>
                  )}
                </>
              ) : (
                "请输入有效的价格与汇率假设。"
              )}
            </div>
          </div>
          <p className="muted">
            仅关联部分参与：金额 × [(1 + 价格冲击) × (1 + 已确认未对冲汇率冲击)
            − 1]。未知、CAD
            与已对冲部分不追加汇率冲击；未知不代表无风险。其余资产与负债不变，不计税费、相关性和
            ETF 穿透。这是统一压力假设，不是
            VaR、预测、今日盈亏或交易建议；美债也不直接等于加拿大房贷成本。
          </p>
        </details>
      )}
      <div className="portfolio-controls">
        <a className="secondary" href="/#growth">
          回到家庭增长行动 →
        </a>
        <a
          className="secondary"
          href="/#overview"
          onClick={() => {
            try {
              sessionStorage.setItem(
                "together-advisor-intent",
                "只分析，不修改数据：结合已保存的账户与证券关联、当前可用官方市场数据和家庭增长计划，解释最相关的三项风险、未知信息和下一步核对动作。不要把压力假设说成已发生收益。",
              );
            } catch {}
          }}
        >
          请顾问结合家庭计划分析 →
        </a>
      </div>
    </section>
  );
}
