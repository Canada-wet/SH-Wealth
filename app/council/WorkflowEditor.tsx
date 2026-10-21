"use client";
import { useId, useState } from "react";
import {
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  SlidersHorizontal,
} from "lucide-react";
import type { CouncilModel } from "@/lib/council";
import {
  defaultCouncilWorkflow,
  validateCouncilWorkflow,
  WORKFLOW_LABELS,
  WORKFLOW_MAX_STAGES,
  type CouncilWorkflow,
  type WorkflowStage,
  type WorkflowStageType,
} from "@/lib/council-workflow";

export default function WorkflowEditor({
  value,
  models,
  participants,
  judge,
  depth,
  tools,
  change,
  disabled = false,
}: {
  value?: CouncilWorkflow;
  models: CouncilModel[];
  participants: string[];
  judge: string | null;
  depth: "standard" | "deep";
  tools: boolean;
  change: (value: CouncilWorkflow | undefined) => void;
  disabled?: boolean;
}) {
  const uid = useId();
  const [openId, setOpenId] = useState<string | null>(
    value?.stages[1]?.id ?? null,
  );
  const workflow = value ?? defaultCouncilWorkflow(participants, depth);
  let error = "";
  if (value)
    try {
      validateCouncilWorkflow(value, participants, judge);
    } catch (e) {
      error = (e as Error).message;
    }
  const calls = workflow.stages.reduce(
    (n, p) => n + p.participants.length,
    judge ? 1 : 0,
  );
  const update = (index: number, patch: Partial<WorkflowStage>) =>
    change({
      ...workflow,
      stages: workflow.stages.map((p, i) =>
        i === index ? { ...p, ...patch } : p,
      ),
    });
  const move = (index: number, direction: -1 | 1) => {
    const stages = [...workflow.stages],
      target = index + direction;
    if (
      index < 1 ||
      index >= stages.length - 1 ||
      target < 1 ||
      target >= stages.length - 1
    )
      return;
    [stages[index], stages[target]] = [stages[target], stages[index]];
    change({ ...workflow, stages });
  };
  return (
    <fieldset
      className="council-flow-editor"
      disabled={disabled}
      aria-label="流程编排"
    >
      <legend>
        <SlidersHorizontal size={16} /> 流程编排
      </legend>
      <div className="council-flow-heading">
        <div>
          <h3>让讨论按你的思路展开</h3>
          <p>
            选择默认模板，或为每个环节安排任务和模型。开始后冻结；追问可另设新流程。
          </p>
        </div>
        <label>
          流程方式
          <select
            aria-label="流程方式"
            value={value ? "custom" : "default"}
            onChange={(e) => {
              const next =
                e.target.value === "custom"
                  ? defaultCouncilWorkflow(participants, depth)
                  : undefined;
              setOpenId(next?.stages[1]?.id ?? null);
              change(next);
            }}
          >
            <option value="default">
              默认{depth === "deep" ? "五" : "三"}阶段
            </option>
            <option value="custom">自定义环节</option>
          </select>
        </label>
      </div>
      {!value ? (
        <ol className="council-flow-preview" aria-label="默认研讨流程">
          {workflow.stages.map((p, i) => (
            <li key={p.id}>
              <b>{i + 1}</b>
              <span>
                {p.title}
                <small>{participants.length} 个模型</small>
              </span>
            </li>
          ))}
          {judge && (
            <li>
              <b>{workflow.stages.length + 1}</b>
              <span>
                裁判汇总
                <small>{models.find((m) => m.key === judge)?.name}</small>
              </span>
            </li>
          )}
        </ol>
      ) : (
        <>
          <p className="council-flow-boundary">
            首轮全员独立开场，末轮形成结论。中间可增删、排序、重复质询或加入专题；每轮
            2–8 环节，含裁判最多 31 次调用。
          </p>
          <ol className="council-flow-list" aria-label="自定义研讨环节">
            {value.stages.map((p, index) => {
              const boundary = index === 0 || index === value.stages.length - 1;
              return (
                <li key={p.id} className="council-flow-stage">
                  <div className="council-flow-stage-top">
                    <b className="council-flow-number">{index + 1}</b>
                    <span>
                      <strong>{p.title || WORKFLOW_LABELS[p.type]}</strong>
                      <small>
                        {WORKFLOW_LABELS[p.type]}
                        {boundary ? " · 固定边界" : ""} ·{" "}
                        {p.participants.length} 个模型
                      </small>
                    </span>
                    {!boundary && (
                      <div className="council-flow-controls">
                        <button
                          type="button"
                          aria-label={`上移环节 ${index + 1}`}
                          disabled={disabled || index === 1}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          type="button"
                          aria-label={`下移环节 ${index + 1}`}
                          disabled={
                            disabled || index === value.stages.length - 2
                          }
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown size={15} />
                        </button>
                        <button
                          type="button"
                          aria-label={`删除环节 ${index + 1}`}
                          onClick={() =>
                            change({
                              ...value,
                              stages: value.stages.filter((s) => s.id !== p.id),
                            })
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      className="council-flow-edit"
                      aria-label={`${openId === p.id ? "收起" : "编辑"}环节 ${index + 1}`}
                      aria-expanded={openId === p.id}
                      aria-controls={`${uid}-${p.id}-body`}
                      onClick={() => setOpenId(openId === p.id ? null : p.id)}
                    >
                      {openId === p.id ? "收起" : "编辑"}
                    </button>
                  </div>
                  {openId !== p.id && p.instructions && (
                    <p className="council-flow-summary">
                      {p.instructions.slice(0, 100)}
                      {p.instructions.length > 100 ? "…" : ""}
                    </p>
                  )}
                  <div id={`${uid}-${p.id}-body`} hidden={openId !== p.id}>
                    <div className="council-flow-fields">
                      <label htmlFor={`${uid}-${p.id}-title`}>
                        环节名称
                        <input
                          id={`${uid}-${p.id}-title`}
                          value={p.title}
                          maxLength={60}
                          onChange={(e) =>
                            update(index, { title: e.target.value })
                          }
                        />
                      </label>
                      {!boundary && (
                        <label>
                          环节类型
                          <select
                            aria-label={`环节 ${index + 1} 类型`}
                            value={p.type}
                            onChange={(e) => {
                              const type = e.target.value as WorkflowStageType;
                              update(index, {
                                type,
                                ...(p.title === WORKFLOW_LABELS[p.type]
                                  ? { title: WORKFLOW_LABELS[type] }
                                  : {}),
                              });
                            }}
                          >
                            {(
                              [
                                "custom",
                                "critique",
                                "investigation",
                                "rebuttal",
                              ] as const
                            ).map((type) => (
                              <option
                                key={type}
                                value={type}
                                disabled={
                                  type === "investigation" &&
                                  p.type !== type &&
                                  value.stages.some((s) => s.type === type)
                                }
                              >
                                {WORKFLOW_LABELS[type]}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                    <label htmlFor={`${uid}-${p.id}-task`}>
                      环节任务{p.type === "custom" ? " · 必填" : " · 可补充"}
                      <textarea
                        id={`${uid}-${p.id}-task`}
                        value={p.instructions}
                        rows={2}
                        maxLength={1200}
                        placeholder={
                          p.type === "custom"
                            ? "例如：从执行成本、三种情景和停止条件比较方案，用一张表展示。"
                            : "留空沿用默认任务；也可指定本环节需要回答的问题与输出格式。"
                        }
                        onChange={(e) =>
                          update(index, { instructions: e.target.value })
                        }
                      />
                    </label>
                    <fieldset
                      className="council-flow-models"
                      disabled={disabled || index === 0}
                    >
                      <legend>
                        本环节参与模型
                        {index === 0 ? " · 开场全员" : " · 至少一个"}
                      </legend>
                      {participants.map((key) => (
                        <label key={key}>
                          <input
                            type="checkbox"
                            checked={p.participants.includes(key)}
                            onChange={() =>
                              update(index, {
                                participants: p.participants.includes(key)
                                  ? p.participants.filter((k) => k !== key)
                                  : [...p.participants, key],
                              })
                            }
                          />
                          <span>
                            {models.find((m) => m.key === key)?.name ?? key}
                          </span>
                        </label>
                      ))}
                      {!participants.length && (
                        <small>先选择本场参与模型。</small>
                      )}
                    </fieldset>
                    {p.type === "investigation" && (
                      <small className="council-flow-tool-note">
                        {tools
                          ? "仅此环节可请求已授权工具，每模型最多两项；同轮公共检索词不会重复付费请求。"
                          : "工具未启用：本环节只能分析已有证据，不能联网或执行计算工具。"}
                      </small>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          <button
            className="council-flow-add"
            type="button"
            disabled={disabled || value.stages.length >= WORKFLOW_MAX_STAGES}
            onClick={() => {
              const phase: WorkflowStage = {
                id: `p-${crypto.randomUUID()}`,
                type: "custom",
                title: "专题分析",
                instructions: "",
                participants: [...participants],
              };
              change({
                ...value,
                stages: [
                  ...value.stages.slice(0, -1),
                  phase,
                  value.stages[value.stages.length - 1],
                ],
              });
              setOpenId(phase.id);
            }}
          >
            <Plus size={16} /> 添加环节 · 插入最终结论之前
          </button>
          {judge && (
            <p className="council-flow-judge">
              最后追加裁判汇总 · {models.find((m) => m.key === judge)?.name} · 1
              次调用
            </p>
          )}
          {tools && !value.stages.some((p) => p.type === "investigation") && (
            <p className="council-flow-tool-note">
              当前没有证据核查环节，本轮不会执行工具或搜索；需要查证时，可将一个中间环节改为“证据核查”。
            </p>
          )}
          {error && (
            <p className="council-alert" role="alert">
              {error}
            </p>
          )}
        </>
      )}
      <div className="council-flow-total">
        <strong>{calls} 次模型调用</strong>
        <span>按实际环节和参与者计算，不因自定义自动增加权限。</span>
      </div>
    </fieldset>
  );
}
