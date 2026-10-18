import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { CouncilProgress } from "./council-stream";
import {
  COUNCIL_MODELS,
  CATALOG_DATE,
  councilPlan,
  councilPrompt,
  type CouncilRun,
  type CouncilModel,
} from "./council";
import {
  callCouncilModel,
  CouncilProviderError,
  councilAvailability,
  councilModelSnapshot,
} from "./council-provider";
import {
  validateCouncilAttachments,
  councilCanSeeImages,
  type CouncilAttachment,
} from "./council-attachments";
export class CouncilError extends Error {
  constructor(
    message: string,
    readonly status = 503,
  ) {
    super(message);
  }
}
function councilAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new CouncilError("研讨数据库尚未配置。请设置服务端 Supabase 凭证。");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function councilCommand(
  action: string,
  user: string,
  id: string,
  payload: unknown = {},
) {
  const { data, error } = await councilAdmin().rpc("wealth_council_command", {
    action,
    target_user: user,
    run_id: id,
    payload,
  });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("council_invalid"))
      throw new CouncilError(
        "追问格式无效，参与者和裁判必须来自本场已授权的型号。",
        400,
      );
    if (
      message.includes("council_not_found") ||
      message.includes("council_forbidden")
    )
      throw new CouncilError("研讨不存在或没有访问权限。", 404);
    if (message.includes("council_quota"))
      throw new CouncilError(
        "已达到每日 3 场研讨的上限（多伦多日期），避免意外支出。",
        429,
      );
    if (message.includes("council_followup_limit"))
      throw new CouncilError(
        "每场最多 8 次追问，每人每天最多 10 次；请保留结果，明天继续或新建研讨。",
        429,
      );
    if (message.includes("council_followup_state"))
      throw new CouncilError(
        "请等待本轮结束或明确结束本轮后再追问；至少保留一份成功观点。",
        409,
      );
    if (message.includes("council_document_full"))
      throw new CouncilError(
        "本场历史接近容量上限，请导出后新建研讨；未调用模型。",
        409,
      );
    if (message.includes("council_active"))
      throw new CouncilError("请先继续或结束已有研讨，再开始新问题。", 409);
    if (message.includes("council_capacity"))
      throw new CouncilError(
        "已保存 100 场研讨，请先导出并删除不再需要的历史。",
        409,
      );
    if (
      message.includes("council_running") ||
      message.includes("council_conflict")
    )
      throw new CouncilError(
        "存在进行中的请求或版本冲突；请先重新读取。不确定请求开始 6 分钟后才允许明确跳过。",
        409,
      );
    throw new CouncilError(
      "研讨存储暂不可用。请确认已安装 supabase/council.sql，再重试；未自动重发模型请求。",
    );
  }
  return data as CouncilRun;
}
export async function createCouncil(
  user: string,
  spec: {
    id: string;
    question: string;
    participants: string[];
    judge: string | null;
    attachments?: CouncilAttachment[];
    expectedConnections?: Record<
      string,
      NonNullable<CouncilModel["connection"]>
    >;
  },
) {
  const keys = [...spec.participants, ...(spec.judge ? [spec.judge] : [])];
  if (keys.some((k) => !councilAvailability().find((a) => a.key === k)?.ready))
    throw new CouncilError("选中的服务尚未配置完整；请选择可用模型。", 400);
  const models = COUNCIL_MODELS.filter((m) => keys.includes(m.key)).map(
    councilModelSnapshot,
  );
  const attachments = validateCouncilAttachments(spec.attachments);
  if (
    attachments.some((a) => a.kind === "image") &&
    models.some((m) => !councilCanSeeImages(m))
  )
    throw new CouncilError("图片研讨需要所有参与者和裁判均支持看图。", 400);
  for (const m of models) {
    const expected = spec.expectedConnections?.[m.key],
      actual = m.connection!;
    if (
      (spec.expectedConnections ||
        (actual.channel === "alibaba" && m.provider !== "qwen")) &&
      (!expected ||
        expected.channel !== actual.channel ||
        expected.model !== actual.model ||
        expected.endpointHash !== actual.endpointHash)
    )
      throw new CouncilError(
        "模型渠道或型号配置已变化，请重新连接并核对实际渠道后再开始。尚未调用模型。",
        409,
      );
  }
  const { expectedConnections: _expected, ...specification } = spec;
  return councilCommand("create", user, spec.id, {
    ...specification,
    catalogDate: CATALOG_DATE,
    models,
    steps: councilPlan(spec.participants, spec.judge).map((s) => ({
      ...s,
      status: "pending",
      answer: "",
      error: "",
      usage: { input: null, output: null },
      started_at: null,
      finished_at: null,
    })),
  });
}
export async function advanceCouncil(
  user: string,
  id: string,
  onProgress?: (p: CouncilProgress) => void,
) {
  const claim = randomUUID();
  const run = await councilCommand("claim", user, id, { claim });
  const step = run.steps.find(
    (s) => (s as typeof s & { claim?: string }).claim === claim,
  );
  if (!step) return run; // Another tab owns the call; never duplicate it.
  onProgress?.({ phase: "waiting", seq: step.seq });
  let answer = "",
    error = "",
    errorKind: "access" | undefined,
    usage: {
      input: number | null;
      output: number | null;
      truncated?: boolean;
      interrupted?: boolean;
    } = { input: null, output: null };
  const openings = run.steps.filter(
    (s) =>
      !s.round &&
      s.stage === "opening" &&
      s.status === "succeeded" &&
      !s.usage?.interrupted,
  );
  const model = run.models.find((m) => m.key === step.model_key);
  try {
    if (!model) throw new CouncilProviderError("模型快照缺失，未发起调用。");
    if (
      run.steps.some(
        (s) =>
          s.seq < step.seq &&
          s.model_key === step.model_key &&
          (s.round ?? 0) === (step.round ?? 0) &&
          s.error_kind === "access",
      )
    )
      throw new CouncilProviderError(
        "此型号本轮已被服务商拒绝访问，后续步骤已跳过，未再次调用。请修正模型权限后明确补问。",
        "access",
      );
    if (!step.round && step.stage !== "opening" && openings.length < 2)
      throw new CouncilProviderError(
        "成功的独立观点不足两份，无法进行有效交叉研讨；此步骤未调用模型。",
      );
    if (
      step.round &&
      step.stage === "judge" &&
      !run.steps.some(
        (s) =>
          s.round === step.round &&
          s.stage === "followup" &&
          s.status === "succeeded",
      )
    )
      throw new CouncilProviderError("本轮没有成功回应，裁判步骤未调用模型。");
    const prompt = councilPrompt(run, step),
      result = await callCouncilModel(
        model,
        prompt.system,
        prompt.input,
        validateCouncilAttachments(run.attachments).filter(
          (a) => a.kind === "image",
        ),
        (p) => onProgress?.({ ...p, seq: step.seq }),
      );
    answer = result.answer;
    usage = result.usage;
  } catch (e) {
    errorKind = e instanceof CouncilProviderError ? e.kind : undefined;
    error =
      e instanceof CouncilProviderError
        ? e.message
        : "模型执行异常；没有自动重试，其他结果仍保留。";
  }
  // If this write fails, the claim stays running. Only explicit skip can unlock it.
  return councilCommand("finish", user, id, {
    seq: step.seq,
    claim,
    answer,
    error,
    error_kind: errorKind ?? null,
    usage,
  });
}
export function publicCouncil(run: CouncilRun): CouncilRun {
  return {
    ...run,
    steps: run.steps.map((s) => {
      const clean = { ...s } as typeof s & { claim?: string };
      delete clean.claim;
      return clean;
    }),
  };
}
