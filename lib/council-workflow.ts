import type { CouncilRun, CouncilStage, CouncilStep } from "./council";

export type WorkflowStageType = Exclude<CouncilStage, "judge" | "followup">;
export type WorkflowStage = {
  id: string;
  type: WorkflowStageType;
  title: string;
  instructions: string;
  participants: string[];
};
export type CouncilWorkflow = { version: 1; stages: WorkflowStage[] };
export const WORKFLOW_LABELS: Record<WorkflowStageType, string> = {
  opening: "独立观点",
  critique: "交叉质询",
  investigation: "证据核查",
  rebuttal: "逐项答辩",
  revision: "最终结论",
  custom: "专题分析",
};
export const WORKFLOW_MAX_STAGES = 8;
export const WORKFLOW_MAX_CALLS = 31;
const sameKeys = (a: string[], b: string[]) =>
  a.length === b.length && a.every((k) => b.includes(k));
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" &&
  v.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);

export function defaultCouncilWorkflow(
  participants: string[],
  depth: "standard" | "deep",
): CouncilWorkflow {
  const types: WorkflowStageType[] =
    depth === "deep"
      ? ["opening", "critique", "investigation", "rebuttal", "revision"]
      : ["opening", "critique", "revision"];
  return {
    version: 1,
    stages: types.map((type) => ({
      id: type,
      type,
      title: WORKFLOW_LABELS[type],
      instructions: "",
      participants: [...participants],
    })),
  };
}

/** Validate before persistence and again before any paid custom step. Never silently repair a plan. */
export function validateCouncilWorkflow(
  raw: unknown,
  participants: string[],
  judge: string | null,
): CouncilWorkflow | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("自定义流程格式无效。");
  const w = raw as CouncilWorkflow;
  if (
    Object.keys(w).sort().join() !== "stages,version" ||
    w.version !== 1 ||
    !Array.isArray(w.stages) ||
    w.stages.length < 2 ||
    w.stages.length > WORKFLOW_MAX_STAGES
  )
    throw Error("自定义流程需包含 2–8 个环节，首尾为独立观点和最终结论。");
  const stages = w.stages.map((s, i) => {
    if (
      !s ||
      typeof s !== "object" ||
      Array.isArray(s) ||
      Object.keys(s).sort().join() !==
        "id,instructions,participants,title,type" ||
      typeof s.id !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(s.id) ||
      ["judge", "followup"].includes(s.id) ||
      !Object.hasOwn(WORKFLOW_LABELS, s.type) ||
      !text(s.title, 60) ||
      /[\r\n\t]/.test(s.title) ||
      !s.title.trim() ||
      !text(s.instructions, 1200) ||
      !Array.isArray(s.participants) ||
      !s.participants.length ||
      s.participants.length > 6 ||
      new Set(s.participants).size !== s.participants.length ||
      s.participants.some(
        (k) => typeof k !== "string" || !participants.includes(k),
      )
    )
      throw Error(
        `请检查第 ${i + 1} 个环节：名称 1–60 字、任务最多 1,200 字，且至少选择一个本场参与模型。`,
      );
    if (s.type === "custom" && s.instructions.trim().length < 5)
      throw Error(`请为“${s.title.trim()}”填写至少 5 字的具体任务。`);
    if (
      i === 0
        ? s.type !== "opening" || !sameKeys(s.participants, participants)
        : i === w.stages.length - 1
          ? s.type !== "revision"
          : ["opening", "revision"].includes(s.type)
    )
      throw Error(
        "首环节须由全部参与模型独立开场；最终结论须在最后，二者不能在中间重复。",
      );
    return {
      id: s.id,
      type: s.type,
      title: s.title.trim(),
      instructions: s.instructions.trim(),
      participants: [...s.participants],
    };
  });
  if (new Set(stages.map((s) => s.id)).size !== stages.length)
    throw Error("环节编号重复，请重新添加该环节。");
  if (stages.filter((s) => s.type === "investigation").length > 1)
    throw Error(
      "每轮最多一个证据核查环节；其余环节可复用真实回执，避免重复搜索费用。",
    );
  if (
    stages.reduce((n, s) => n + s.participants.length, judge ? 1 : 0) >
    WORKFLOW_MAX_CALLS
  )
    throw Error("本轮最多 31 次模型调用，请减少环节或参与模型。");
  return { version: 1, stages };
}

/** UI-only reconciliation; empty specialist assignments remain visibly invalid, never replaced. */
export function syncCouncilWorkflow(
  workflow: CouncilWorkflow | undefined,
  previous: string[],
  next: string[],
) {
  return (
    workflow && {
      ...workflow,
      stages: workflow.stages.map((s) => ({
        ...s,
        participants:
          s.type === "opening" || sameKeys(s.participants, previous)
            ? [...next]
            : s.participants.filter((k) => next.includes(k)),
      })),
    }
  );
}
export function councilWorkflowFor(run: CouncilRun, round = 0) {
  return round ? run.turns?.[round - 1]?.workflow : run.workflow;
}
export function councilWorkflowStage(run: CouncilRun, step: CouncilStep) {
  return councilWorkflowFor(run, step.round ?? 0)?.stages.find(
    (s) => s.id === step.phase_id,
  );
}
export const councilPhaseKey = (step: CouncilStep) =>
  step.phase_id ?? step.stage;
export function councilWorkflowSearches(
  workflow: CouncilWorkflow | undefined,
  participants: string[],
  depth: "standard" | "deep",
  queries: number,
) {
  const slots = workflow
    ? workflow.stages
        .filter((s) => s.type === "investigation")
        .reduce((n, s) => n + s.participants.length, 0)
    : depth === "deep"
      ? participants.length
      : 0;
  return Math.min(slots, queries);
}
