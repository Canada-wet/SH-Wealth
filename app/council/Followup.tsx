"use client";
import { useEffect, useRef, useState } from "react";
import type { CouncilRun, CouncilFollowupMode } from "@/lib/council";
import {
  COUNCIL_MAX_FOLLOWUPS,
  councilConnectionNote,
  councilFollowupPlan,
} from "@/lib/council";
export default function Followup({
  run,
  disabled,
  send,
}: {
  run: CouncilRun;
  disabled: boolean;
  send: (spec: Record<string, unknown>) => Promise<void>;
}) {
  const [question, setQuestion] = useState(""),
    [models, setModels] = useState<string[]>(run.participants),
    [judge, setJudge] = useState(run.judge || ""),
    [mode, setMode] = useState<CouncilFollowupMode>("debate"),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const draft = useRef<{ signature: string; id: string } | null>(null);
  const count = run.turns?.length || 0;
  useEffect(() => {
    setQuestion("");
    setModels(run.participants);
    setJudge(run.judge || "");
    setMode("debate");
    setConsent(false);
    draft.current = null;
    setError("");
  }, [run.id]);
  const canAsk =
    ["complete", "cancelled"].includes(run.status) &&
    !run.steps.some((s) => s.status === "running") &&
    run.steps.some((s) => s.status === "succeeded") &&
    count < COUNCIL_MAX_FOLLOWUPS;
  const calls = councilFollowupPlan(
    models,
    judge || null,
    mode,
    count + 1,
    run.steps.length,
  ).length;
  const tooFew = models.length < (mode === "debate" ? 2 : 1);
  return (
    <section className="council-card council-followup" aria-label="继续追问">
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
            相互研讨<small>每个模型 3 次调用 · 至少 2 个模型</small>
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
        <ol className="council-followup-flow" aria-label="本轮研讨流程">
          <li>
            <strong>1 · 独立回应</strong>
            <span>基于新问题更新各自判断</span>
          </li>
          <li>
            <strong>2 · 交叉质询</strong>
            <span>阅读彼此观点，指出分歧与证据缺口</span>
          </li>
          <li>
            <strong>3 · 修订结论</strong>
            <span>回应质疑，说明采纳与保留的意见</span>
          </li>
          {judge && (
            <li>
              <strong>4 · 裁判汇总</strong>
              <span>汇总本轮共识、分歧和下一步</span>
            </li>
          )}
        </ol>
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
                setModels((list) =>
                  list.includes(m.key)
                    ? list.filter((k) => k !== m.key)
                    : [...list, m.key],
                );
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
      {tooFew && (
        <p className="council-alert" role="status">
          {mode === "debate"
            ? "相互研讨至少需要 2 个模型；也可切换为直接回应。"
            : "请至少选择 1 个回应模型。"}
        </p>
      )}
      <p className="council-muted">
        本次 {calls} 次新调用（{models.length} 个模型 ×{" "}
        {mode === "debate" ? 3 : 1}
        {judge ? " + 裁判 1 次" : ""}）；每人每天最多 10
        次追问。失败步骤不会自动重发，未执行步骤不调用；补问同一模型仍可能再次计费。
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
          tooFew
        }
        onClick={async () => {
          const signature = JSON.stringify({
            question,
            models,
            judge,
            mode,
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
