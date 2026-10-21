"use client";
import { useEffect, useRef, useState } from "react";
import type { CouncilRun, CouncilFollowupMode } from "@/lib/council";
import {
  COUNCIL_MAX_FOLLOWUPS,
  councilConnectionNote,
  councilFollowupPlan,
} from "@/lib/council";
import ResearchSettings from "./ResearchSettings";
import WorkflowEditor from "./WorkflowEditor";
import {
  councilWorkflowFor,
  validateCouncilWorkflow,
  syncCouncilWorkflow,
  councilWorkflowSearches,
  type CouncilWorkflow,
} from "@/lib/council-workflow";
import {
  STANDARD_RESEARCH,
  validateCouncilResearch,
  type CouncilResearch,
} from "@/lib/council-research";
export default function Followup({
  run,
  disabled,
  send,
  seed,
}: {
  run: CouncilRun;
  disabled: boolean;
  send: (spec: Record<string, unknown>) => Promise<void>;
  seed?: { id: string; text: string };
}) {
  const [question, setQuestion] = useState(""),
    [models, setModels] = useState<string[]>(
      run.turns?.at(-1)?.participants ?? run.participants,
    ),
    [judge, setJudge] = useState(
      (run.turns?.at(-1) ? run.turns.at(-1)!.judge : run.judge) || "",
    ),
    [mode, setMode] = useState<CouncilFollowupMode>("debate"),
    [research, setResearch] = useState<CouncilResearch>(
      run.turns?.at(-1)?.research ?? run.research ?? STANDARD_RESEARCH,
    ),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [workflow, setWorkflow] = useState<CouncilWorkflow | undefined>(
    councilWorkflowFor(run, run.turns?.length ?? 0),
  );
  const draft = useRef<{ signature: string; id: string } | null>(null);
  const count = run.turns?.length || 0;
  useEffect(() => {
    setQuestion("");
    setModels(run.turns?.at(-1)?.participants ?? run.participants);
    setJudge((run.turns?.at(-1) ? run.turns.at(-1)!.judge : run.judge) || "");
    setWorkflow(councilWorkflowFor(run, run.turns?.length ?? 0));
    setMode("debate");
    setResearch(
      run.turns?.at(-1)?.research ?? run.research ?? STANDARD_RESEARCH,
    );
    setConsent(false);
    draft.current = null;
    setError("");
  }, [run.id]);
  const canAsk =
    ["complete", "cancelled"].includes(run.status) &&
    !run.steps.some((s) => s.status === "running") &&
    run.steps.some((s) => s.status === "succeeded") &&
    count < COUNCIL_MAX_FOLLOWUPS;
  useEffect(() => {
    if (!seed || !canAsk || disabled || busy) return;
    setQuestion(seed.text);
    setConsent(false);
    setError("");
    draft.current = null;
    document.getElementById("council-followup-question")?.focus();
  }, [seed]);
  const calls =
    workflow && mode === "debate"
      ? workflow.stages.reduce(
          (n, p) => n + p.participants.length,
          judge ? 1 : 0,
        )
      : councilFollowupPlan(
          models,
          judge || null,
          mode,
          count + 1,
          run.steps.length,
          mode === "debate" ? research.depth : "standard",
        ).length;
  const tooFew = models.length < (mode === "debate" ? 2 : 1);
  let researchError = "";
  let workflowError = "";
  if (mode === "debate")
    try {
      validateCouncilResearch(research);
    } catch (e) {
      researchError = (e as Error).message;
    }
  if (mode === "debate")
    try {
      validateCouncilWorkflow(workflow, models, judge || null);
    } catch (e) {
      workflowError = (e as Error).message;
    }
  return (
    <section
      id="council-followup"
      className="council-card council-followup"
      aria-label="继续追问"
    >
      <div className="council-section-label">
        <h2>把讨论继续下去</h2>
        <span>
          {count}/{COUNCIL_MAX_FOLLOWUPS} 次追问
        </span>
      </div>
      <p className="council-muted">
        接续最新一轮，沿用本场资料、原问题和历史观点。默认让模型先独立回应，再互相质询、修订结论；只新增本轮步骤，不重跑旧轮。不会修改财富账本。
      </p>
      {!canAsk && (
        <p className="council-muted">
          {count >= COUNCIL_MAX_FOLLOWUPS
            ? "已达到本场追问上限，可导出后新建研讨。"
            : "本轮结束并保留至少一份成功观点后，即可继续追问。"}
        </p>
      )}
      <label className="council-question">
        继续追问
        <textarea
          id="council-followup-question"
          value={question}
          disabled={disabled || busy || !canAsk}
          rows={3}
          maxLength={4000}
          placeholder="补充条件、质疑某个结论，或问：这些分歧中，最值得先验证什么？"
          onChange={(e) => {
            setQuestion(e.target.value);
            setConsent(false);
          }}
        />
      </label>
      <fieldset
        className="council-followup-mode"
        disabled={disabled || busy || !canAsk}
      >
        <legend>追问方式</legend>
        <label>
          <input
            type="radio"
            name={`followup-mode-${run.id}`}
            value="debate"
            checked={mode === "debate"}
            onChange={() => {
              setMode("debate");
              setConsent(false);
            }}
          />
          <span>
            相互研讨
            <small>
              {workflow
                ? "使用自定义环节"
                : `每个模型 ${research.depth === "deep" ? 5 : 3} 次调用`}{" "}
              · 至少 2 个模型
            </small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name={`followup-mode-${run.id}`}
            value="direct"
            checked={mode === "direct"}
            onChange={() => {
              setMode("direct");
              setConsent(false);
            }}
          />
          <span>
            直接回应<small>每个模型 1 次调用 · 不互相质询</small>
          </span>
        </label>
      </fieldset>
      {mode === "debate" && (
        <ResearchSettings
          value={research}
          customFlow={!!workflow}
          disabled={disabled || busy || !canAsk}
          change={(r) => {
            setResearch(r);
            setConsent(false);
          }}
        />
      )}
      {researchError && (
        <p role="alert" className="council-alert">
          {researchError}
        </p>
      )}
      <div className="council-followup-models">
        {run.models.map((m) => (
          <label key={m.key}>
            <input
              type="checkbox"
              checked={models.includes(m.key)}
              disabled={
                disabled ||
                busy ||
                !canAsk ||
                (!models.includes(m.key) && models.length >= 6)
              }
              onChange={() => {
                const next = models.includes(m.key)
                  ? models.filter((k) => k !== m.key)
                  : [...models, m.key];
                setWorkflow(syncCouncilWorkflow(workflow, models, next));
                setModels(next);
                setConsent(false);
              }}
            />
            <span>
              {m.name}
              <small>{councilConnectionNote(m)}</small>
            </span>
          </label>
        ))}
      </div>
      <label>
        本轮裁判
        <select
          aria-label="追问裁判"
          value={judge}
          disabled={disabled || busy || !canAsk}
          onChange={(e) => {
            setJudge(e.target.value);
            setConsent(false);
          }}
        >
          <option value="">不设裁判</option>
          {run.models.map((m) => (
            <option value={m.key} key={m.key}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {mode === "debate" && (
        <WorkflowEditor
          value={workflow}
          models={run.models}
          participants={models}
          judge={judge || null}
          depth={research.depth}
          tools={research.tools}
          disabled={disabled || busy || !canAsk}
          change={(w) => {
            setWorkflow(w);
            setConsent(false);
          }}
        />
      )}
      {tooFew && (
        <p className="council-alert" role="status">
          {mode === "debate"
            ? "相互研讨至少需要 2 个模型；也可切换为直接回应。"
            : "请至少选择 1 个回应模型。"}
        </p>
      )}
      <p className="council-muted">
        本次 {calls} 次新调用（
        {workflow && mode === "debate"
          ? "按自定义环节和参与者合计"
          : `${models.length} 个模型 × ${mode === "debate" ? (research.depth === "deep" ? 5 : 3) : 1}${judge ? " + 裁判 1 次" : ""}`}
        ）；每人每天最多 10 次追问。
        {mode === "debate" && research.tools && research.webConsent
          ? `另最多 ${councilWorkflowSearches(workflow, models, research.depth, research.publicQueries.length)} 次联网搜索。`
          : ""}
        失败步骤不会自动重发，未执行步骤不调用；补问同一模型仍可能再次计费。
      </p>
      <label className="council-consent">
        <input
          type="checkbox"
          checked={consent}
          disabled={disabled || busy || !canAsk}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          确认将本场资料和历史继续发送给选定的原渠道，并接受本次新增用量。
        </span>
      </label>
      {error && (
        <p role="alert" className="council-alert">
          {error}
        </p>
      )}
      <button
        className="primary-button"
        disabled={
          disabled ||
          busy ||
          !canAsk ||
          !consent ||
          question.trim().length < 2 ||
          tooFew ||
          !!researchError ||
          !!workflowError
        }
        onClick={async () => {
          const signature = JSON.stringify({
            question,
            models,
            judge,
            mode,
            research,
            workflow,
            count,
            run: run.id,
          });
          if (draft.current?.signature !== signature)
            draft.current = { signature, id: crypto.randomUUID() };
          setBusy(true);
          setError("");
          try {
            await send({
              action: "followup",
              id: run.id,
              turnId: draft.current.id,
              question,
              participants: models,
              judge: judge || null,
              mode,
              ...(mode === "debate" ? { research } : {}),
              ...(mode === "debate" && workflow ? { workflow } : {}),
              baseRound: count,
              consent,
            });
            setQuestion("");
            setConsent(false);
            draft.current = null;
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "正在保存追问…" : "发送追问"}
      </button>
    </section>
  );
}
