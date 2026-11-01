"use client";
import { useMemo, useState } from "react";
import {
  Copy,
  FolderHeart,
  Search,
  Trash2,
  ArrowRight,
  Save,
} from "lucide-react";
import type { BacktestLab } from "@/lib/backtest-schema";

export default function PortfolioCollection({
  lab,
  selected,
  editable,
  onLoad,
  onRemove,
  onSave,
  onBack,
}: {
  lab: BacktestLab;
  selected: string;
  editable: boolean;
  onLoad: (id: string, copy: boolean) => void;
  onRemove: (id: string) => void;
  onSave: () => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const [currency, setCurrency] = useState("all");
  const plans = useMemo(
    () =>
      lab.saved
        .filter(
          (p) =>
            (currency === "all" || p.config.currency === currency) &&
            `${p.config.name} ${p.config.holdings.map((h) => h.symbol).join(" ")}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
        )
        .sort((a, b) => b.at.localeCompare(a.at)),
    [lab, query, currency],
  );
  return (
    <section className="bt-collection" aria-label="组合Collection">
      <header className="bt-comparison-header">
        <div>
          <p className="bt-kicker">COLLECTION / REUSE</p>
          <h2>你的组合库</h2>
          <p>
            保存配置、搜索标的，载入或复制后继续研究。最多12个家庭共享组合。
          </p>
        </div>
        <div className="bt-action-row">
          <button className="secondary" onClick={onBack}>
            回到工作台
          </button>
          <button className="primary" disabled={!editable} onClick={onSave}>
            <Save size={15} />
            保存当前组合
          </button>
        </div>
      </header>
      <div className="card bt-collection-filter">
        <label>
          <span>
            <Search size={15} />
            搜索组合或股票代码
          </span>
          <input
            type="search"
            value={query}
            placeholder="例如：长期组合、NVDA、ZSP"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          组合计价币种
          <select
            aria-label="组合计价币种"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            <option value="all">全部币种</option>
            <option>USD</option>
            <option>CAD</option>
          </select>
        </label>
        <small>
          {plans.length} / {lab.saved.length} 个 · 最近保存优先
        </small>
      </div>
      <details className="bt-details">
        <summary>配置云端同步 · 行情仅本机</summary>
        <p className="bt-help">
          是否保存成功以页顶状态为准。Collection不重复存真实资产或聊天；行情跨设备请用研究包／对照包。对照快照与可编辑配置分开管理。
        </p>
      </details>
      {!plans.length && (
        <div className="card bt-collection-empty">
          <FolderHeart size={28} />
          <h3>{lab.saved.length ? "没有匹配的组合" : "把常用组合留在这里"}</h3>
          <p>
            {lab.saved.length
              ? "换个名称、股票代码或币种试试。"
              : "在工作台填写代码、权重与假设后，保存即可反复使用；不必先完成回测。"}
          </p>
        </div>
      )}
      <div className="bt-portfolio-cards">
        {plans.map((p) => (
          <article className="card bt-collection-card" key={p.id}>
            <div className="bt-row">
              <span className="bt-pill">
                {p.config.currency} · {p.config.holdings.length}项
              </span>
              {selected === p.id && <span className="bt-pill">当前载入</span>}
            </div>
            <h3>{p.config.name}</h3>
            <p className="bt-collection-holdings">
              {p.config.holdings
                .map((h) => `${h.symbol} ${h.weight}%`)
                .join(" · ")}
            </p>
            <small>
              {p.config.start} → {p.config.end}
              <br />
              保存于 {new Date(p.at).toLocaleString()}
            </small>
            <div className="bt-action-row">
              <button className="secondary" onClick={() => onLoad(p.id, false)}>
                载入编辑 <ArrowRight size={15} />
              </button>
              <button
                className="bt-text-button"
                onClick={() => onLoad(p.id, true)}
              >
                <Copy size={15} />
                复制为新组合
              </button>
              <button
                className="bt-text-button"
                aria-label={`删除组合：${p.config.name}`}
                disabled={!editable}
                onClick={() => onRemove(p.id)}
              >
                <Trash2 size={15} />
                删除
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
