"use client";
import { useState } from "react";
import {
  councilCostReport,
  councilCostModelName,
  costRange,
  COST_PRICE_DATE,
} from "@/lib/council-cost";
import { councilStageTitle, type CouncilRun } from "@/lib/council";

export default function Costs({
  run,
  round,
}: {
  run: CouncilRun;
  round: number;
}) {
  const [scope, setScope] = useState<"all" | "round">("all");
  const [group, setGroup] = useState<"models" | "stages">("models");
  const report = councilCostReport(run, scope === "round" ? round : undefined);
  const groups = report[group];
  const name = (id: string) =>
    group === "models"
      ? councilCostModelName(run, id)
      : (() => {
          const row = report.rows.find(
            (r) =>
              `${r.step.round ?? 0}:${r.step.phase_id ?? r.step.stage}` === id,
          );
          return row
            ? `${row.step.round ? `追问 ${row.step.round}` : "原始研讨"} · ${councilStageTitle(run, row.step)}`
            : id;
        })();
  return (
    <section className="council-card council-costs" aria-label="研讨成本分析">
      <div className="council-section-label">
        <div>
          <p className="council-muted">COST · USD · 费用透明</p>
          <h2>这次研讨，花在哪里</h2>
        </div>
        <label>
          统计范围
          <select
            aria-label="成本统计范围"
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            <option value="all">整场（含全部追问）</option>
            <option value="round">当前轮次</option>
          </select>
        </label>
      </div>
      <div className="council-result-metrics">
        <div>
          <strong>
            {report.calls === 0
              ? "尚未调用"
              : report.high === 0 && report.unknown > 0
                ? "待核实"
                : costRange(report.low, report.high)}
          </strong>
          <span>
            {report.unknown
              ? "已知部分小计 · 不是总账单"
              : "模型与搜索估算合计"}
          </span>
        </div>
        <div>
          <strong>{report.calls}</strong>
          <span>模型／搜索提交次数</span>
        </div>
        <div>
          <strong>{report.unknown}</strong>
          <span>用量或价格未知</span>
        </div>
      </div>
      <p className="council-muted">
        {run.status === "active"
          ? "随已归档步骤累计；未运行步骤不计费用。"
          : "结束后仍保留失败、截断与中断步骤，不能把它们当作免费。"}
        推理 tokens 已含在输出，不重复计费。
        {report.externalSearches > 0
          ? ` 含 ${report.externalSearches} 项搜索回执的模型费与搜索调用费；复用不重复计。`
          : ""}
      </p>
      <details className="council-cost-distribution">
        <summary>展开费用分布与优化提示</summary>
        <div
          className="council-cost-switch"
          role="group"
          aria-label="成本分布维度"
        >
          <button
            aria-pressed={group === "models"}
            onClick={() => setGroup("models")}
          >
            按模型
          </button>
          <button
            aria-pressed={group === "stages"}
            onClick={() => setGroup("stages")}
          >
            按环节
          </button>
        </div>
        <div className="council-cost-bars">
          {groups.map((g) => (
            <div key={g.id} className="council-cost-row">
              <div>
                <b>{name(g.id)}</b>
                <span>
                  {costRange(g.low, g.high)}
                  {g.unknown > 0 ? ` ＋ ${g.unknown} 项未知` : ""}
                </span>
              </div>
              <div className="council-cost-track" aria-hidden="true">
                <i
                  style={{
                    width: `${report.high > 0 ? Math.min(100, (g.high / report.high) * 100) : 0}%`,
                  }}
                />
              </div>
              <small>
                {g.calls} 次调用 ·{" "}
                {report.high > 0
                  ? `${((g.high / report.high) * 100).toFixed(1)}% 已知估算上界`
                  : "暂无可比费用"}
              </small>
            </div>
          ))}
        </div>
        <p className="council-muted">
          费用占比不代表答案质量。下次可以先用两位轻量模型梳理问题，再让旗舰或裁判只处理仍有争议的环节；本页不会自动替换型号、重发请求或增加费用。
        </p>
      </details>
      <details>
        <summary>逐次用量、单价与费用边界</summary>
        <div className="council-cost-table">
          <table>
            <caption>USD，单价为每百万 tokens；区间不是供应商发票</caption>
            <thead>
              <tr>
                <th>轮次／环节／模型</th>
                <th>输入／输出／推理</th>
                <th>估算费用</th>
                <th>计价依据</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.step.seq}>
                  <td>
                    {r.step.round ? `追问 ${r.step.round}` : "原始研讨"} ·{" "}
                    {councilStageTitle(run, r.step)}
                    <br />
                    {run.models.find((m) => m.key === r.step.model_key)?.name}
                  </td>
                  <td>
                    {r.step.usage?.input?.toLocaleString() ?? "未知"} /{" "}
                    {r.step.usage?.output?.toLocaleString() ?? "未知"} /{" "}
                    {r.step.usage?.reasoning?.toLocaleString() ?? "未知"}
                    <br />
                    缓存命中{" "}
                    {r.step.usage?.cachedInput?.toLocaleString() ?? "未知"}
                  </td>
                  <td>
                    {r.high === null
                      ? "未知（不按零计）"
                      : costRange(r.low!, r.high)}
                  </td>
                  <td>
                    {r.reason}
                    {r.price && (
                      <>
                        <br />
                        <a
                          href={r.price.source}
                          target="_blank"
                          rel="noreferrer"
                        >
                          官方价格 · {r.price.checkedAt}
                        </a>
                        <br />
                        {r.price.model} · {r.price.channel}
                        {r.price.region ? ` · ${r.price.region}` : ""}
                        <br />
                        输入 {r.price.input.join("–")}；输出{" "}
                        {r.price.output.join("–")} USD / MTok
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {report.toolRows.map((r) => (
                <tr key={`tool:${r.receipt.id}`}>
                  <td>
                    {r.step.round ? `追问 ${r.step.round}` : "原始研讨"} ·{" "}
                    {councilStageTitle(run, r.step)}
                    <br />
                    联网研究 · {r.receipt.billing?.model ?? "型号未知"}
                    <br />
                    {r.receipt.id}
                  </td>
                  <td>
                    {r.receipt.billing?.usage.input?.toLocaleString() ?? "未知"}{" "}
                    /{" "}
                    {r.receipt.billing?.usage.output?.toLocaleString() ??
                      "未知"}{" "}
                    /{" "}
                    {r.receipt.billing?.usage.reasoning?.toLocaleString() ??
                      "未知"}
                    <br />
                    搜索调用 {r.receipt.billing?.searchCalls ?? "未知"} 次
                  </td>
                  <td>
                    {costRange(r.low, r.high)}
                    {r.unknown ? " ＋ 待核实费用" : ""}
                  </td>
                  <td>
                    {r.reason}
                    {r.receipt.billing && (
                      <>
                        <br />
                        <a
                          href={r.receipt.billing.source}
                          target="_blank"
                          rel="noreferrer"
                        >
                          官方搜索价格 · {r.receipt.billing.checkedAt}
                        </a>
                        <br />
                        US${r.receipt.billing.perSearchUSD} /
                        次；模型单价随回执保存
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="council-muted">
          历史记录没有价格快照时，仅按 {COST_PRICE_DATE}{" "}
          核实价格参考重估；百炼不能套用原厂直连价格。未知缓存命中及峰谷计费显示区间。新调用的用量与价格快照随本人研讨持久保存，不回写旧记录。联网搜索包含其模型
          tokens 与实际搜索调用费，本地算式及附件检索没有额外 API
          费。不含税费、赠送额度、折扣及订阅费；最终以服务商账单为准。成本不自动写入家庭支出。
        </p>
      </details>
    </section>
  );
}
