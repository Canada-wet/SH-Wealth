"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import {
  councilStageTitle,
  type CouncilRun,
  type CouncilStage,
} from "@/lib/council";
import {
  councilRound,
  councilExcerpt,
  councilSections,
} from "@/lib/council-results";
import AdvisorMarkdown from "@/app/components/AdvisorMarkdown";
import ToolReceipts from "./ToolReceipts";
export default function Results({
  run,
  round,
  inspect,
  activeSeq,
  viewRound,
}: {
  run: CouncilRun;
  round: number;
  inspect: (stage: CouncilStage, seq?: number) => void;
  activeSeq?: number;
  viewRound?: (round: number) => void;
}) {
  const [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState("");
  const current = councilRound(run, round);
  const finals = current.steps.filter((s) => s.stage === current.finalStage);
  const judge = current.steps.find(
    (s) => s.stage === "judge" && s.status === "succeeded",
  );
  const successes = finals.filter(
    (s) =>
      s.status === "succeeded" && !s.usage?.interrupted && !s.usage?.truncated,
  );
  const judgeReliable =
    judge && !judge.usage?.interrupted && !judge.usage?.truncated;
  return (
    <section className="council-card council-results" aria-label="研讨结论速览">
      <div className="council-section-label">
        <h2>先看结论，再看依据</h2>
        <button
          disabled={!successes.length && !judgeReliable}
          onClick={async () => {
            setCopyError("");
            try {
              const text = judgeReliable
                ? judge.answer
                : successes
                    .map(
                      (s) =>
                        `${run.models.find((m) => m.key === s.model_key)?.name}\n${s.answer}`,
                    )
                    .join("\n\n---\n\n");
              await navigator.clipboard.writeText(
                `${current.question}\n\n${text}\n\nAI研讨原文，未经独立核验。`,
              );
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopyError("无法复制，请使用导出或手动选择原文。");
            }
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
          {copied ? "已复制" : "复制本轮结论"}
        </button>
      </div>
      {copyError && <p role="status">{copyError}</p>}
      <div className="council-result-metrics">
        <div>
          <strong>
            {successes.length}/{current.finalParticipants.length}
          </strong>
          <span>完整最终观点</span>
        </div>
        <div>
          <strong>
            {
              current.steps.filter((s) =>
                ["succeeded", "failed"].includes(s.status),
              ).length
            }
            /{current.steps.length}
          </strong>
          <span>步骤已归档</span>
        </div>
        <div>
          <strong>{judgeReliable ? "有" : "无"}</strong>
          <span>完整裁判汇总</span>
        </div>
      </div>
      <div className="council-model-progress" aria-label="模型参与进度">
        {current.participants.map((key) => (
          <div key={key}>
            <strong>{run.models.find((m) => m.key === key)?.name}</strong>
            <span>
              {current.steps
                .filter((s) => s.model_key === key && s.stage !== "judge")
                .map((s) => (
                  <span
                    key={s.seq}
                    title={`${councilStageTitle(run, s)}：${activeSeq === s.seq ? "生成中" : s.status}`}
                    className={`council-dot ${activeSeq === s.seq ? "running" : s.status}`}
                    aria-label={`${councilStageTitle(run, s)} ${activeSeq === s.seq ? "生成中" : s.status}`}
                  />
                ))}
            </span>
          </div>
        ))}
      </div>
      <p className="council-muted">
        圆点只表示执行状态，不是意见投票或可信度评分。汇总来自模型，未经独立事实核验。
      </p>
      {!!current.steps.some((s) => s.tool_receipts?.length) && (
        <section className="council-evidence-board">
          <h3>证据与计算记录</h3>
          <p className="council-muted">
            仅展示实际工具回执。模型相互同意不是事实核验；失败、未知和复用记录均保留。
          </p>
          <ToolReceipts
            receipts={current.steps.flatMap((s) => s.tool_receipts ?? [])}
          />
        </section>
      )}
      {judge && (
        <div className="council-synthesis">
          <h3>
            裁判的归纳 ·{" "}
            {run.models.find((m) => m.key === judge.model_key)?.name}
          </h3>
          {(judge.usage?.interrupted || judge.usage?.truncated) && (
            <p className="council-alert">
              {judge.usage?.interrupted ? "连接中断" : "达到输出上限"}
              ，仅有部分内容，不作为完整汇总。
            </p>
          )}
          <div className="council-synthesis-grid">
            {councilSections(judge.answer).map((s, i) => (
              <section key={i}>
                <h4>{s.title}</h4>
                <AdvisorMarkdown text={s.text} />
              </section>
            ))}
          </div>
        </div>
      )}
      {!judge && (
        <p className="council-muted">
          {current.judge
            ? "裁判尚无完整结果，先保留各方观点。"
            : "本轮未设裁判，以下为各模型自己的结论，不虚构统一共识。"}
        </p>
      )}
      <h3>观点对照</h3>
      <div
        className={`council-comparison-grid${finals.length === 1 ? " solo" : ""}`}
      >
        {finals.map((s) => (
          <article key={s.seq}>
            <h4>{run.models.find((m) => m.key === s.model_key)?.name}</h4>
            <span className={`council-step-status ${s.status}`}>
              {s.usage?.interrupted
                ? "部分正文 · 连接中断"
                : s.status === "succeeded"
                  ? "已归档"
                  : s.status === "failed"
                    ? "未成功"
                    : "尚待回应"}
            </span>
            <p>
              {s.answer
                ? councilExcerpt(s.answer)
                : s.error || "等待本轮结果，不预填结论。"}
            </p>
            <button onClick={() => inspect(s.stage, s.seq)}>
              查看完整依据
            </button>
          </article>
        ))}
      </div>
      {round > 0 && (
        <details className="council-round-comparison">
          <summary>对照上一轮：哪些结论值得重新检查？</summary>
          <p className="council-muted">
            并列原文摘录，不自动判定观点是否改变；部分或失败回应不当作完整结论。
          </p>
          {current.participants.map((key) => {
            const prior = councilRound(run, round - 1);
            const previous = prior.steps.find(
              (s) =>
                s.model_key === key &&
                s.stage === prior.finalStage &&
                s.status === "succeeded" &&
                !s.usage?.interrupted &&
                !s.usage?.truncated,
            );
            const next = successes.find((s) => s.model_key === key);
            return (
              <article key={key}>
                <h4>{run.models.find((m) => m.key === key)?.name}</h4>
                <div>
                  <section>
                    <small>上一轮原文</small>
                    <p>
                      {previous
                        ? councilExcerpt(previous.answer, 260)
                        : "上一轮没有该模型的完整最终观点。"}
                    </p>
                  </section>
                  <section>
                    <small>本轮原文</small>
                    <p>
                      {next
                        ? councilExcerpt(next.answer, 260)
                        : "本轮尚无完整最终观点。"}
                    </p>
                  </section>
                </div>
              </article>
            );
          })}
          {viewRound && (
            <button onClick={() => viewRound(round - 1)}>
              回看{round === 1 ? "原始研讨" : `追问 ${round - 1}`}结论
            </button>
          )}
        </details>
      )}
    </section>
  );
}
