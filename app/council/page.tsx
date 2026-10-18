"use client";
import { useEffect, useRef, useState } from "react";
import {
  MessagesSquare,
  Play,
  Pause,
  Plus,
  Download,
  RefreshCw,
  ShieldCheck,
  Check,
  ChevronRight,
  LoaderCircle,
} from "lucide-react";
import MarketNavigator from "@/app/components/MarketNavigator";
import AdvisorMarkdown from "@/app/components/AdvisorMarkdown";
import {
  COUNCIL_MODELS,
  CATALOG_DATE,
  PROVIDER_NAMES,
  STAGES,
  councilExport,
  councilConnectionNote,
  councilSpeaker,
  COUNCIL_STALE_MS,
  type CouncilAvailability,
  type CouncilRun,
  type CouncilStage,
  type CouncilProvider,
} from "@/lib/council";
import "./council.css";
import Attachments, { AttachmentList } from "./Attachments";
import Followup from "./Followup";
import Results from "./Results";
import { councilRound } from "@/lib/council-results";
import { readCouncilResponse } from "@/lib/council-client";
import type { CouncilProgress } from "@/lib/council-stream";
import {
  councilCanSeeImages,
  type CouncilAttachment,
} from "@/lib/council-attachments";
type HistoryItem = Pick<
  CouncilRun,
  "id" | "question" | "status" | "created_at"
>;
const STATUS = {
  active: "待继续",
  paused: "已暂停",
  complete: "已结束",
  cancelled: "已停止",
};
async function api(
  body?: unknown,
  id?: string,
  progress?: (p: CouncilProgress) => void,
) {
  const r = await fetch(
    "/api/council" + (id ? `?id=${encodeURIComponent(id)}` : ""),
    {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : {},
      ...(body
        ? {
            body: JSON.stringify({
              ...(body as Record<string, unknown>),
              ...(progress ? { stream: true } : {}),
            }),
          }
        : {}),
    },
  );
  return readCouncilResponse(r, progress);
}
export default function CouncilPage() {
  const [showAllProviders, setShowAllProviders] = useState(false);
  const [checking, setChecking] = useState(false);
  const [attachments, setAttachments] = useState<CouncilAttachment[]>([]);
  const [processingFiles, setProcessingFiles] = useState(false);
  const [round, setRound] = useState(0),
    [transcript, setTranscript] = useState(true),
    [progress, setProgress] = useState<CouncilProgress | null>(null),
    [requestAt, setRequestAt] = useState(0);
  const [availability, setAvailability] = useState<CouncilAvailability[]>([]),
    [storageReady, setStorageReady] = useState(false),
    [loading, setLoading] = useState(true),
    [history, setHistory] = useState<HistoryItem[]>([]),
    [run, setRun] = useState<CouncilRun | null>(null),
    [compose, setCompose] = useState(true),
    [question, setQuestion] = useState(""),
    [participants, setParticipants] = useState<string[]>([]),
    [judge, setJudge] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [stage, setStage] = useState<CouncilStage>("opening"),
    [auto, setAuto] = useState(false),
    [now, setNow] = useState(Date.now());
  const current = useRef<CouncilRun | null>(null),
    flight = useRef(false),
    enabled = useRef(false),
    mounted = useRef(true),
    draft = useRef<{ signature: string; id: string } | null>(null);
  const accept = (r: CouncilRun) => {
    current.current = r;
    setRun(r);
    setHistory((items) =>
      [
        {
          id: r.id,
          question: r.question,
          status: r.status,
          created_at: r.created_at,
        },
        ...items.filter((i) => i.id !== r.id),
      ].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    );
  };
  const stopAuto = () => {
    enabled.current = false;
    setAuto(false);
  };
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api();
      if (!mounted.current) return;
      setAvailability(d.availability);
      setHistory(d.runs);
      setStorageReady(d.storageReady);
      if (d.storageError) setError(d.storageError);
      return d;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load().then(async (d) => {
      if (!d || !mounted.current) return;
      const defaults = [
        "deepseek-light",
        "openai-light",
        "anthropic-light",
        "gemini-light",
        "qwen-light",
        "moonshot-alternative",
      ].filter((k) =>
        d.availability.some((a: CouncilAvailability) => a.key === k && a.ready),
      );
      const fallback = COUNCIL_MODELS.filter((m) =>
        d.availability.some(
          (a: CouncilAvailability) => a.key === m.key && a.ready,
        ),
      ).map((m) => m.key);
      setParticipants([...new Set([...defaults, ...fallback])].slice(0, 2));
      const id = new URL(location.href).searchParams.get("run");
      if (id) {
        try {
          const x = await api(undefined, id);
          if (mounted.current) {
            accept(x.run);
            setRound(x.run.turns?.length || 0);
            setTranscript(x.run.status !== "complete");
            setCompose(false);
            setStage(
              x.run.status === "complete"
                ? councilRound(x.run, x.run.turns?.length || 0).judge
                  ? "judge"
                  : x.run.turns?.length
                    ? "followup"
                    : "revision"
                : "opening",
            );
          }
        } catch (e) {
          setError((e as Error).message);
        }
      }
    });
    const clock = setInterval(() => setNow(Date.now()), 3000);
    return () => {
      mounted.current = false;
      enabled.current = false;
      clearInterval(clock);
    };
    // Initial load only. Do not automatically start paid work on refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!auto || !run || compose) return;
    const tick = setTimeout(async () => {
      const latest = current.current;
      if (
        !enabled.current ||
        flight.current ||
        !latest ||
        document.visibilityState !== "visible"
      )
        return;
      if (latest.status !== "active") {
        stopAuto();
        return;
      }
      if (latest.steps.some((s) => s.status === "running")) {
        stopAuto();
        setNotice("有请求已提交；请重新读取结果，不会自动重复调用。");
        return;
      }
      flight.current = true;
      setBusy(true);
      setRequestAt(Date.now());
      setProgress({ phase: "waiting" });
      try {
        const d = await api(
          { action: "advance", id: latest.id },
          undefined,
          (p) => {
            if (mounted.current && current.current?.id === latest.id)
              setProgress(p);
          },
        );
        if (mounted.current) {
          accept(d.run);
          if (d.run.status === "complete") {
            stopAuto();
            const lastRound = d.run.turns?.length || 0;
            setRound(lastRound);
            setTranscript(false);
            setStage(
              councilRound(d.run, lastRound).judge
                ? "judge"
                : lastRound
                  ? "followup"
                  : "revision",
            );
          }
        }
      } catch (e) {
        if (mounted.current) {
          stopAuto();
          setError((e as Error).message);
        }
      } finally {
        flight.current = false;
        if (mounted.current) setBusy(false);
        if (mounted.current) setProgress(null);
      }
    }, 500);
    return () => clearTimeout(tick);
  }, [auto, run, compose, now]);
  const openRun = async (id: string) => {
    if (flight.current) return;
    stopAuto();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const d = await api(undefined, id);
      accept(d.run);
      const lastRound = d.run.turns?.length || 0;
      setRound(lastRound);
      setTranscript(d.run.status !== "complete");
      setCompose(false);
      setStage(
        d.run.status === "complete"
          ? councilRound(d.run, lastRound).judge
            ? "judge"
            : lastRound
              ? "followup"
              : "revision"
          : "opening",
      );
      window.history.replaceState(null, "", `/council?run=${id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const start = async () => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const expectedConnections = Object.fromEntries(
      [...participants, ...(judge ? [judge] : [])].flatMap((key) => {
        const c = availability.find((a) => a.key === key)?.connection;
        return c ? [[key, c]] : [];
      }),
    );
    const signature = JSON.stringify({
      question,
      participants,
      judge,
      attachments,
      expectedConnections,
    });
    if (draft.current?.signature !== signature)
      draft.current = { signature, id: crypto.randomUUID() };
    try {
      const d = await api({
        action: "create",
        id: draft.current.id,
        question,
        participants,
        judge: judge || null,
        consent,
        attachments,
        expectedConnections,
      });
      accept(d.run);
      setRound(0);
      setTranscript(true);
      setCompose(false);
      setStage("opening");
      enabled.current = true;
      setAuto(true);
      window.history.replaceState(null, "", `/council?run=${d.run.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  };
  const command = async (action: string, seq?: number) => {
    if (!run) return;
    if (action === "pause") stopAuto();
    setError("");
    try {
      const d = await api({
        action,
        id: run.id,
        ...(seq === undefined ? {} : { seq }),
      });
      accept(d.run);
      if (action === "resume") {
        enabled.current = true;
        setAuto(true);
      }
      if (action === "cancel") stopAuto();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    if (
      !run ||
      !window.confirm(
        "删除本人的这场研讨、全部追问、附件及发言？此操作不能撤销，建议先导出。",
      )
    )
      return;
    setBusy(true);
    try {
      await api({ action: "delete", id: run.id });
      setHistory((h) => h.filter((x) => x.id !== run.id));
      current.current = null;
      setRun(null);
      setCompose(true);
      window.history.replaceState(null, "", "/council");
      setNotice("研讨已删除，无法恢复；每日调用限额不重置。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const available = (key: string) =>
    availability.find((a) => a.key === key)?.ready ?? false;
  const completed =
    run?.steps.filter((s) => s.status === "succeeded" || s.status === "failed")
      .length ?? 0;
  const running = run?.steps.find((s) => s.status === "running");
  const currentRound = run ? councilRound(run, round) : null;
  const finals =
    currentRound?.steps.filter(
      (s) =>
        s.stage === (round ? "followup" : "revision") &&
        s.status === "succeeded" &&
        !s.usage?.interrupted,
    ) ?? [];
  const failed = run?.steps.filter((s) => s.status === "failed").length ?? 0;
  const newQuestion = () => {
    stopAuto();
    setCompose(true);
    setQuestion("");
    setAttachments([]);
    draft.current = null;
    setConsent(false);
    setError("");
    window.history.replaceState(null, "", "/council");
  };
  const incompatibleImages =
    attachments.some((a) => a.kind === "image") &&
    [...participants, ...(judge ? [judge] : [])].some(
      (key) => !councilCanSeeImages(COUNCIL_MODELS.find((m) => m.key === key)!),
    );
  return (
    <main className="market-shell council-shell">
      <MarketNavigator active="council" />
      <div className="markets-page council-page">
        <header className="markets-header">
          <div>
            <p className="eyebrow">TOGETHER · THINK TOGETHER</p>
            <h1>
              <MessagesSquare size={30} /> 多模型研讨
            </h1>
            <p>把难题放到圆桌上。独立判断，认真质疑，保留不同意见。</p>
          </div>
          <button
            className="primary-button"
            disabled={busy || auto || processingFiles}
            onClick={newQuestion}
          >
            <Plus size={17} /> 新问题
          </button>
        </header>
        <div className="council-privacy">
          <ShieldCheck size={18} />
          <span>
            个人私密历史 ·
            仅发送本页问题及研讨发言，不读取家庭账本。服务商按各自条款处理；不自动执行资产操作。
          </span>
        </div>
        {error && (
          <div className="council-alert" role="alert">
            {error}
            <button onClick={() => void load()} disabled={busy}>
              重新连接
            </button>
          </div>
        )}
        {notice && (
          <p role="status" className="council-notice">
            {notice}
          </p>
        )}
        <div className="council-layout">
          <aside className="council-history" aria-label="我的研讨历史">
            <div className="council-section-label">
              <h2>我的研讨</h2>
              <span>{history.length}/100</span>
            </div>
            <p>本账号可回看、导出和继续。</p>
            {loading ? (
              <p role="status">正在读取…</p>
            ) : history.length === 0 ? (
              <div className="council-history-empty">
                从一个值得认真思考的问题开始。
              </div>
            ) : (
              history.map((h) => (
                <button
                  className={run?.id === h.id && !compose ? "selected" : ""}
                  disabled={busy || auto || processingFiles}
                  key={h.id}
                  onClick={() => void openRun(h.id)}
                >
                  <strong>{h.question}</strong>
                  <small>
                    {new Date(h.created_at).toLocaleDateString("zh-CN")} ·{" "}
                    {STATUS[h.status]}
                  </small>
                </button>
              ))
            )}
          </aside>
          <div className="council-workspace">
            {compose ? (
              <section
                className="council-card council-composer"
                aria-labelledby="compose-title"
              >
                <p className="eyebrow">01 / A QUESTION WORTH EXPLORING</p>
                <h2 id="compose-title">你想把什么想清楚？</h2>
                <label className="council-question">
                  问题与已知条件
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    maxLength={6000}
                    rows={5}
                    placeholder="例如：未来三年，我该继续深耕现有职业，还是尝试创业？请比较机会成本、风险与可验证的第一步。"
                  />
                </label>
                <div className="council-question-meta">
                  <span>补充目标、约束和反例，比简单问“哪个好”更有帮助。</span>
                  <span>{question.length}/6,000</span>
                </div>
                <Attachments
                  items={attachments}
                  onChange={(items) => {
                    setAttachments(items);
                    setConsent(false);
                  }}
                  onBusy={setProcessingFiles}
                  disabled={busy}
                />
                {incompatibleImages && (
                  <p role="alert" className="council-alert">
                    图片需要所有参与者及裁判均支持看图。请选择
                    OpenAI、Claude、Gemini 或 Qwen
                    型号，或移除图片；不会把图片偷偷转交其他服务识别。
                  </p>
                )}
                <div className="council-section-label">
                  <h3>谁来参与？</h3>
                  <span>{participants.length}/6 · 至少 2 个</span>
                </div>
                <p className="council-muted">
                  轻量组合适合先探索；旗舰适合关键取舍。选同一服务的两个型号也可以。
                </p>
                <button
                  className="council-provider-toggle"
                  onClick={() => setShowAllProviders((v) => !v)}
                >
                  {showAllProviders
                    ? "只看已配置服务"
                    : "查看全部 8 家服务与待配置型号"}
                </button>
                <div className="council-model-grid">
                  {(Object.keys(PROVIDER_NAMES) as CouncilProvider[]).map(
                    (p) =>
                      showAllProviders ||
                      !availability.some((a) => a.ready) ||
                      COUNCIL_MODELS.some(
                        (m) => m.provider === p && available(m.key),
                      ) ? (
                        <fieldset key={p}>
                          <legend>{PROVIDER_NAMES[p]}</legend>
                          {COUNCIL_MODELS.filter((m) => m.provider === p).map(
                            (m) => (
                              <label
                                key={m.key}
                                className={
                                  !available(m.key)
                                    ? "unavailable"
                                    : participants.includes(m.key)
                                      ? "checked"
                                      : ""
                                }
                              >
                                <input
                                  type="checkbox"
                                  checked={participants.includes(m.key)}
                                  disabled={
                                    loading ||
                                    !available(m.key) ||
                                    (!participants.includes(m.key) &&
                                      participants.length >= 6)
                                  }
                                  onChange={() =>
                                    setParticipants((list) =>
                                      list.includes(m.key)
                                        ? list.filter((k) => k !== m.key)
                                        : [...list, m.key],
                                    )
                                  }
                                />
                                <span>
                                  <strong>{m.name}</strong>
                                  <small>
                                    {councilCanSeeImages(m)
                                      ? "文字 + 看图"
                                      : "本页仅文字材料"}
                                    {m.model === "claude-fable-5-1"
                                      ? " · 深度推理，仍为现役"
                                      : ""}
                                  </small>
                                  <small>
                                    {m.tier === "light"
                                      ? "轻量"
                                      : m.tier === "flagship"
                                        ? "旗舰"
                                        : "在售备选，非轻量版"}{" "}
                                    ·{" "}
                                    {available(m.key)
                                      ? "凭证已配置"
                                      : "尚未配置"}
                                  </small>
                                  {available(m.key) &&
                                    availability.find((a) => a.key === m.key)
                                      ?.connection && (
                                      <small>
                                        {councilConnectionNote({
                                          ...m,
                                          connection: availability.find(
                                            (a) => a.key === m.key,
                                          )?.connection,
                                        })}
                                      </small>
                                    )}
                                </span>
                              </label>
                            ),
                          )}
                        </fieldset>
                      ) : null,
                  )}
                </div>
                <div className="council-judge">
                  <div>
                    <h3>可选：让一个模型做裁判</h3>
                    <p>
                      可以不参与前面辩论，也可以选择参与者。裁判汇总不等于事实核查。
                    </p>
                  </div>
                  <label>
                    <span className="sr-only">裁判模型</span>
                    <select
                      value={judge}
                      onChange={(e) => setJudge(e.target.value)}
                    >
                      <option value="">不设裁判 · 并列看最终结论</option>
                      {COUNCIL_MODELS.map((m) => (
                        <option
                          key={m.key}
                          value={m.key}
                          disabled={!available(m.key)}
                        >
                          {m.name}
                          {availability.find((a) => a.key === m.key)?.connection
                            ?.channel === "alibaba"
                            ? " · 百炼"
                            : ""}
                          {!available(m.key) ? "（未配置）" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="council-plan">
                  <span>1 独立观点</span>
                  <ChevronRight size={15} />
                  <span>2 交叉质询</span>
                  <ChevronRight size={15} />
                  <span>3 修订结论</span>
                  {judge && (
                    <>
                      <ChevronRight size={15} />
                      <span>4 裁判汇总</span>
                    </>
                  )}
                </div>
                <p className="council-muted">
                  本场最多 {participants.length * 3 + (judge ? 1 : 0)}{" "}
                  次付费调用；每次输出上限 4,096
                  tokens（可能含推理），价格和权限由各服务商决定。每天最多 3
                  场，失败不自动重试。页面关闭后不启动后续调用；已提交请求可能继续计费。
                </p>
                <label className="council-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span>
                    我同意把问题、附件内容及发言发送给所选服务商，并了解 API
                    用量可能收费。请勿填写账号密码或第三方隐私。
                  </span>
                </label>
                <button
                  className="primary-button council-start"
                  disabled={
                    !storageReady ||
                    loading ||
                    busy ||
                    processingFiles ||
                    incompatibleImages ||
                    participants.length < 2 ||
                    question.trim().length < 5 ||
                    !consent
                  }
                  onClick={() => void start()}
                >
                  {busy ? (
                    <LoaderCircle className="council-spin" size={18} />
                  ) : (
                    <Play size={18} />
                  )}
                  开始研讨
                </button>
                <details className="council-config">
                  <summary>模型来源与连接设置 · 核对于 {CATALOG_DATE}</summary>
                  <p>
                    “凭证已配置”不代表模型已测试或有余额。新配置需重新部署。Qwen
                    的凭证与业务空间地址必须属于同一地域。Kimi / GLM 可复用百炼
                    key，卡片显示实际渠道；未核实的百炼型号不会启用。通过百炼时由阿里云处理输入及计费，不会失败后自动切到原厂。Moonshot
                    未核实独立最新轻量型号，K2.6 仅作在售备选；Muse Spark
                    仅列已核实的正式型号。目录不是自动每日更新。
                  </p>
                  <button
                    disabled={checking}
                    onClick={async () => {
                      setChecking(true);
                      setError("");
                      try {
                        const d = await api({ action: "check-alibaba" });
                        setNotice(
                          d.check.message +
                            (d.check.ok
                              ? ` 本页目录覆盖 ${d.check.modelKeys.length} 个映射型号。`
                              : ""),
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setChecking(false);
                      }
                    }}
                  >
                    {checking
                      ? "正在检查百炼连接…"
                      : "检查百炼连接（不生成回答）"}
                  </button>
                  <p>
                    实际生成自检：仅发送固定公开问题，不读取你的研讨或财富数据，会有少量
                    API 用量，不自动重试。
                  </p>
                  <div className="council-actions">
                    {["qwen-light", "qwen-flagship", "glm-flagship"]
                      .filter(available)
                      .map((key) => (
                        <button
                          key={key}
                          disabled={checking}
                          onClick={async () => {
                            if (
                              !window.confirm(
                                "发送一次固定公开问题测试该模型？会产生少量 API 用量，不使用私人数据，也不会自动重试。",
                              )
                            )
                              return;
                            setChecking(true);
                            setError("");
                            setNotice("正在执行固定问题自检，最长 4 分钟…");
                            try {
                              const d = await api({
                                action: "check-model",
                                modelKey: key,
                                consent: true,
                              });
                              setNotice(d.check.message);
                            } catch (e) {
                              setError((e as Error).message);
                              setNotice("");
                            } finally {
                              setChecking(false);
                            }
                          }}
                        >
                          自检 {COUNCIL_MODELS.find((m) => m.key === key)?.name}
                        </button>
                      ))}
                  </div>
                  {(Object.keys(PROVIDER_NAMES) as CouncilProvider[]).map(
                    (p) => (
                      <div key={p}>
                        <a
                          href={
                            COUNCIL_MODELS.find((m) => m.provider === p)!.source
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {PROVIDER_NAMES[p]} 官方型号 ↗
                        </a>
                        <small>
                          {COUNCIL_MODELS.filter((m) => m.provider === p)
                            .map(
                              (m) =>
                                `${m.name}：${availability.find((a) => a.key === m.key)?.detail || "正在读取配置…"}`,
                            )
                            .join("；")}
                        </small>
                      </div>
                    ),
                  )}
                  <p>
                    本页首版不联网检索；各模型可能共享偏差、编造引用，重要决策应核验原始来源。
                  </p>
                </details>
              </section>
            ) : (
              run && (
                <>
                  <section className="council-card council-session">
                    <div className="council-section-label">
                      <span className="eyebrow">THE ROUNDTABLE</span>
                      <span className="council-status">
                        {auto ? "研讨进行中" : STATUS[run.status]}
                      </span>
                    </div>
                    <h2>{run.question}</h2>
                    {!!run.turns?.length && (
                      <nav className="council-round-nav" aria-label="讨论轮次">
                        {[0, ...run.turns.map((_, i) => i + 1)].map((value) => (
                          <button
                            key={value}
                            aria-current={round === value ? "page" : undefined}
                            onClick={() => {
                              setRound(value);
                              const target = councilRound(run, value);
                              setStage(
                                target.judge
                                  ? "judge"
                                  : value
                                    ? "followup"
                                    : "revision",
                              );
                            }}
                          >
                            {value ? `追问 ${value}` : "原始研讨"}
                          </button>
                        ))}
                      </nav>
                    )}
                    {round > 0 && (
                      <div className="council-current-question">
                        <small>本轮追问</small>
                        <p>{currentRound?.question}</p>
                      </div>
                    )}
                    <p className="council-muted">
                      {new Date(
                        round
                          ? run.turns?.[round - 1]?.created_at || run.created_at
                          : run.created_at,
                      ).toLocaleString("zh-CN")}{" "}
                      · {currentRound?.participants.length} 个参与模型 ·{" "}
                      {currentRound?.judge
                        ? `裁判 ${run.models.find((m) => m.key === currentRound.judge)?.name}`
                        : "无裁判，保留并列结论"}
                    </p>
                    {!!run.attachments?.length && (
                      <div className="council-materials">
                        <h3>本场材料 · 已随历史私密保存</h3>
                        <AttachmentList items={run.attachments} />
                      </div>
                    )}
                    <progress
                      value={completed}
                      max={run.steps.length}
                      aria-label="研讨进度"
                    />
                    <div className="council-progress">
                      <span>
                        {completed}/{run.steps.length} 步已归档
                        {failed > 0 ? ` · ${failed} 步未成功` : ""}
                      </span>
                      <span>逐步云端保存</span>
                    </div>
                    <div className="council-actions">
                      {["active", "paused"].includes(run.status) && (
                        <>
                          {auto ? (
                            <button onClick={() => void command("pause")}>
                              <Pause size={16} /> 暂停后续步骤
                            </button>
                          ) : (
                            <button
                              className="primary-button"
                              disabled={busy || !!running}
                              onClick={() => void command("resume")}
                            >
                              <Play size={16} /> 继续研讨
                            </button>
                          )}
                          <button
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "停止这场研讨？已产生的发言会保留，不再启动新请求。",
                                )
                              )
                                void command("cancel");
                            }}
                          >
                            结束本场
                          </button>
                        </>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => void openRun(run.id)}
                      >
                        <RefreshCw size={16} /> 重新读取
                      </button>
                      <button
                        onClick={() => {
                          const url = URL.createObjectURL(
                            new Blob([councilExport(run)], {
                              type: "text/markdown;charset=utf-8",
                            }),
                          );
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `Together-研讨-${run.id.slice(0, 8)}.md`;
                          a.click();
                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                        }}
                      >
                        <Download size={16} /> 导出
                      </button>
                      {!running && run.status !== "active" && (
                        <button disabled={busy} onClick={() => void remove()}>
                          删除历史
                        </button>
                      )}
                    </div>
                    {busy && auto && (
                      <p role="status" className="council-live">
                        <LoaderCircle size={16} className="council-spin" />{" "}
                        {progress?.seq !== undefined
                          ? `${run.models.find((m) => m.key === run.steps.find((s) => s.seq === progress.seq)?.model_key)?.name || "模型"} · `
                          : ""}
                        {progress?.phase === "thinking"
                          ? "模型正在推理"
                          : progress?.phase === "answering"
                            ? "正在接收正文"
                            : "请求已提交，正在等待服务商"}{" "}
                        · 已等待{" "}
                        {Math.max(0, Math.floor((now - requestAt) / 1000))}{" "}
                        秒；最多 4 分钟，不自动重发。
                      </p>
                    )}
                    {busy && progress?.preview && (
                      <div className="council-stream-preview">
                        <small>临时正文 · 完成归档后才算保存</small>
                        <AdvisorMarkdown text={progress.preview} />
                      </div>
                    )}
                    {running && !busy && (
                      <div className="council-alert">
                        <span>
                          “
                          {
                            run.models.find((m) => m.key === running.model_key)
                              ?.name
                          }
                          ”已提交，结果尚待确认。请先重新读取，不会自动重发。
                        </span>
                        {now - Date.parse(running.started_at || "") >=
                          COUNCIL_STALE_MS && (
                          <button
                            onClick={() => {
                              if (
                                window.confirm(
                                  "该请求可能已计费。跳过将保留不确定状态并允许继续，绝不自动重发。",
                                )
                              )
                                void command("abandon", running.seq);
                            }}
                          >
                            标记中断并跳过
                          </button>
                        )}
                      </div>
                    )}
                    {run.status === "complete" && (
                      <p className="council-notice">
                        {finals.length < (round ? 1 : 2)
                          ? "有效的最终观点不足两份，本场不是完整研讨。请查看失败步骤。"
                          : failed
                            ? "研讨已结束，但有缺席或失败步骤；结论仅基于成功返回的内容。"
                            : "各方结论已归档，可随时回看。意见一致不代表事实已被验证。"}
                      </p>
                    )}
                  </section>
                  <Results
                    run={run}
                    round={round}
                    activeSeq={busy ? progress?.seq : undefined}
                    inspect={(target, seq) => {
                      setTranscript(true);
                      setStage(target);
                      if (seq !== undefined)
                        setTimeout(
                          () =>
                            document
                              .getElementById(`council-step-${seq}`)
                              ?.scrollIntoView({ block: "center" }),
                          50,
                        );
                    }}
                  />
                  <button
                    className="council-transcript-toggle"
                    aria-expanded={transcript}
                    onClick={() => setTranscript((v) => !v)}
                  >
                    {transcript ? "收起完整发言" : "展开完整发言"}
                  </button>
                  <div hidden={!transcript}>
                    <nav className="council-stage-nav" aria-label="研讨阶段">
                      {(Object.keys(STAGES) as CouncilStage[])
                        .filter((s) =>
                          currentRound?.steps.some((x) => x.stage === s),
                        )
                        .map((s) => (
                          <button
                            key={s}
                            aria-current={stage === s ? "step" : undefined}
                            onClick={() => setStage(s)}
                          >
                            <span>{STAGES[s]}</span>
                            <small>
                              {
                                currentRound!.steps.filter(
                                  (x) =>
                                    x.stage === s && x.status === "succeeded",
                                ).length
                              }
                              /
                              {
                                currentRound!.steps.filter((x) => x.stage === s)
                                  .length
                              }
                            </small>
                          </button>
                        ))}
                    </nav>
                    {stage === "revision" && !currentRound?.judge && (
                      <div className="council-no-judge">
                        未设置裁判：以下并列展示各模型最终结论，不生成虚假的“统一答案”。
                      </div>
                    )}
                    <div className="council-responses">
                      {currentRound!.steps
                        .filter((s) => s.stage === stage)
                        .map((s) => (
                          <article
                            className="council-card council-answer"
                            key={s.seq}
                            id={`council-step-${s.seq}`}
                          >
                            <header>
                              <div>
                                <small>
                                  {s.stage === "judge"
                                    ? "独立裁判"
                                    : councilSpeaker(run, s.model_key)}{" "}
                                  · {STAGES[s.stage]}
                                </small>
                                <h3>
                                  {
                                    run.models.find(
                                      (m) => m.key === s.model_key,
                                    )?.name
                                  }
                                </h3>
                                <small>
                                  {councilConnectionNote(
                                    run.models.find(
                                      (m) => m.key === s.model_key,
                                    ),
                                  )}
                                </small>
                              </div>
                              <span
                                className={`council-step-status ${s.status}`}
                              >
                                {s.status === "succeeded" ? (
                                  <>
                                    <Check size={14} /> 已保存
                                  </>
                                ) : s.status === "failed" ? (
                                  "未成功"
                                ) : s.status === "running" ? (
                                  "已提交"
                                ) : (
                                  "等待中"
                                )}
                              </span>
                            </header>
                            {s.answer ? (
                              <>
                                <AdvisorMarkdown text={s.answer} />
                                {(s.usage?.truncated ||
                                  s.usage?.interrupted) && (
                                  <p className="council-alert">
                                    {s.usage.interrupted
                                      ? "连接中断，已保留收到的部分正文；请勿作为完整结论，补问会产生新调用。"
                                      : "回答达到输出上限，可能不完整。"}
                                  </p>
                                )}
                                <footer>
                                  {s.usage?.input == null
                                    ? "输入用量未返回"
                                    : `${s.usage.input.toLocaleString()} 输入 tokens`}{" "}
                                  ·{" "}
                                  {s.usage?.output == null
                                    ? "输出用量未返回"
                                    : `${s.usage.output.toLocaleString()} 输出 tokens（可能含推理）`}
                                </footer>
                              </>
                            ) : (
                              <p
                                className={
                                  s.error ? "council-alert" : "council-pending"
                                }
                              >
                                {s.error ||
                                  (run.status === "cancelled"
                                    ? "本场已停止，此步骤不再执行。"
                                    : s.status === "running"
                                      ? "请求已提交，结果归档后可在这里查看。"
                                      : "轮到这一步时，会使用前面阶段的同一份观点快照。")}
                              </p>
                            )}
                          </article>
                        ))}
                    </div>
                  </div>
                  <Followup
                    run={run}
                    disabled={busy || auto}
                    send={async (spec) => {
                      if (flight.current)
                        throw Error("已有请求进行中，请稍后继续。");
                      flight.current = true;
                      setBusy(true);
                      stopAuto();
                      setError("");
                      try {
                        const d = await api(spec);
                        accept(d.run);
                        const lastRound = d.run.turns?.length || 0;
                        setRound(lastRound);
                        setStage("followup");
                        setTranscript(true);
                        enabled.current = true;
                        setAuto(true);
                      } finally {
                        flight.current = false;
                        setBusy(false);
                      }
                    }}
                  />
                </>
              )
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
