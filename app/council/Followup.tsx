"use client";
import { useEffect, useRef, useState } from "react";
import type { CouncilRun } from "@/lib/council";
import { COUNCIL_MAX_FOLLOWUPS, councilConnectionNote } from "@/lib/council";
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
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const draft = useRef<{ signature: string; id: string } | null>(null);
  const count = run.turns?.length || 0;
  useEffect(() => {
    setQuestion("");
    setModels(run.participants);
    setJudge(run.judge || "");
    setConsent(false);
    draft.current = null;
    setError("");
  }, [run.id]);
  const canAsk =
    ["complete", "cancelled"].includes(run.status) &&
    !run.steps.some((s) => s.status === "running") &&
    run.steps.some((s) => s.status === "succeeded") &&
    count < COUNCIL_MAX_FOLLOWUPS;
  return (
    <section className="council-card council-followup" aria-label="继续追问">
      <div className="council-section-label">
        <h2>把讨论继续下去</h2>
        <span>
          {count}/{COUNCIL_MAX_FOLLOWUPS} 次追问
        </span>
      </div>
      <p className="council-muted">
        接续最新一轮，沿用本场资料、原问题和历史观点；可只问一个模型，也可邀请多方回应，不重跑三阶段。这里只处理本场上下文，不会修改财富账本。
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
      <p className="council-muted">
        本次 {models.length + (judge ? 1 : 0)} 次新调用；每人每天最多 10
        次追问。原失败请求不会自动重发；补问同一模型仍可能再次计费。
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
          !models.length
        }
        onClick={async () => {
          const signature = JSON.stringify({
            question,
            models,
            judge,
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
