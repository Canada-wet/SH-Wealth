"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Bot,
  ChevronDown,
  Send,
  Sparkles,
  History,
  Plus,
  X,
} from "lucide-react";
import { id, totals, type WealthState } from "@/lib/wealth";
import type { AssistantAction } from "@/lib/advisor-actions";
import AdvisorMarkdown from "./AdvisorMarkdown";
import { proactiveInsights } from "@/lib/insights";
import { financialFingerprint, previewActions } from "@/lib/advisor-preview";
import useChatDraft from "@/lib/useChatDraft";
import VoiceControls from "./VoiceControls";
import SearchControls from "./SearchControls";
import {
  activeChat,
  allChats,
  appendChat,
  newChat,
  openChat,
} from "@/lib/conversations";
export default function FloatingAdvisor({
  state,
  onActions,
  onChange,
  saveStatus,
  loading = false,
}: {
  state: WealthState;
  onActions: (
    actions: AssistantAction[],
    expectedFinancial?: string,
  ) => WealthState;
  onChange: (update: (state: WealthState) => WealthState) => WealthState;
  saveStatus?: string;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [hiddenNudges, setHiddenNudges] = useState<string[]>([]);
  const [overviewPromptVisible, setOverviewPromptVisible] = useState(true);
  const [pending, setPending] = useState<{
    actions: AssistantAction[];
    rows: string[];
    fingerprint: string;
    chatId: string;
  } | null>(null);
  const insights =
    state.preferences.proactive === false
      ? []
      : proactiveInsights(state).filter(
          (row) => !state.readAlerts.includes(row.id),
        );
  const nudge = insights.find(
    (row) => row.priority === "attention" && !hiddenNudges.includes(row.id),
  );
  const currentChat =
    allChats(state).find((chat) => chat.id === selectedChatId) ??
    activeChat(state);
  const [input, setInput] = useChatDraft(currentChat.id);
  const chooseChat = (chatId: string) => {
    setSelectedChatId(chatId);
    try {
      localStorage.setItem("together-selected-chat", chatId);
    } catch {
      setError("阅读位置未能保存，聊天内容不受影响。");
    }
  };
  const latest = useRef(state);
  latest.current = state;
  const messagesRef = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    try {
      setSelectedChatId(localStorage.getItem("together-selected-chat"));
      const hidden: unknown = JSON.parse(
        sessionStorage.getItem("together-hidden-nudges") || "[]",
      );
      if (
        Array.isArray(hidden) &&
        hidden.every((row) => typeof row === "string")
      )
        setHiddenNudges(hidden);
    } catch {
      // A blocked local preference must not prevent cloud chat restoration.
    }
  }, []);
  useEffect(() => {
    const summary = document.querySelector(".pulse-next");
    if (!summary || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) =>
      setOverviewPromptVisible(entry.isIntersecting),
    );
    observer.observe(summary);
    return () => observer.disconnect();
  }, [insights[0]?.id]);
  useEffect(() => {
    const show = (event: Event) => {
      setOpen(true);
      const prompt = (event as CustomEvent<string>).detail;
      if (typeof prompt === "string") setInput(prompt);
      setHistoryOpen(false);
    };
    window.addEventListener("together-open-advisor", show);
    return () => {
      window.removeEventListener("together-open-advisor", show);
      controller.current?.abort();
    };
  }, [setInput]);
  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    const newest = container.lastElementChild as HTMLElement | null;
    if (!busy && currentChat.messages.at(-1)?.role === "assistant" && newest) {
      // Complete replies arrive at once: start at their conclusion, not their footer.
      container.scrollTop +=
        newest.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        16;
    } else container.scrollTop = container.scrollHeight;
  }, [currentChat.messages, busy, open, historyOpen]);
  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const question = input.trim();
    if (!question || busy || loading || pending || voiceListening) return;
    setError("");
    const snapshot = openChat(latest.current, currentChat.id);
    const chatId = activeChat(snapshot).id;
    const financial = financialFingerprint(snapshot);
    try {
      if (!(
        currentChat.messages.at(-1)?.role === "user" &&
        currentChat.messages.at(-1)?.text === question
      ))
        onChange((current) =>
          appendChat(
            current,
            { id: id(), role: "user", text: question },
            chatId,
          ),
        );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "消息无法保存");
      return;
    }
    setInput("");
    setBusy(true);
    controller.current = new AbortController();
    const timer = setTimeout(() => controller.current?.abort(), 75000);
    try {
      const response = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.current.signal,
        body: JSON.stringify({
          message: question,
          preference: snapshot.preferences.model,
          state: snapshot,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "顾问暂时不可用。");
      const actions = Array.isArray(result.actions)
        ? (result.actions as AssistantAction[])
        : [];
      if (actions.length) {
        if (financial !== financialFingerprint(latest.current))
          throw new Error(
            "对话期间家庭数据已有变化，请用最新数据重新发起修改。",
          );
        setPending({
          actions,
          rows: previewActions(latest.current, actions),
          fingerprint: financial,
          chatId,
        });
      }
      const text = `${result.answer || "已完成分析。"}${actions.length ? `\n\n待确认 ${actions.length} 项变更：请核对预览，确认后才会保存。刷新页面后需重新发起，未确认变更不会执行。` : ""}${result.route ? `\n\n${result.route.provider === "local" ? "本地助手" : `${result.route.provider} · ${result.route.model}`} · ${result.route.reason}` : ""}`;
      onChange((current) =>
        appendChat(current, { id: id(), role: "assistant", text }, chatId),
      );
    } catch (reason) {
      const message = controller.current?.signal.aborted
        ? "请求已停止或超时；问题已保留，可重试。停止不保证服务商取消计费。"
        : reason instanceof Error
          ? reason.message
          : "请求失败。";
      setError(message);
      setInput(question);
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  };
  const confirm = () => {
    if (!pending) return;
    try {
      if (pending.fingerprint !== financialFingerprint(latest.current))
        throw new Error(
          "家庭数据已有变化，此预览已过期。请取消并用最新数据重新提问。",
        );
      onActions(pending.actions, pending.fingerprint);
      const text = `✓ 已保存 ${pending.actions.length} 项变更，页面已同步。\n\n${pending.rows.map((row) => `- ${row}`).join("\n")}`;
      setPending(null);
      try {
        onChange((current) =>
          appendChat(
            current,
            { id: id(), role: "assistant", text },
            pending.chatId,
          ),
        );
        setError("");
      } catch {
        setError(
          "财务修改已保存，但确认消息未能保存。请查看财富历史，不要重复执行。",
        );
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "保存失败，未执行修改。",
      );
    }
  };
  const total = totals(state);
  const chats = allChats(state).filter((chat) =>
    `${chat.title}\n${chat.messages.map((row) => row.text).join("\n")}`
      .toLowerCase()
      .includes(historyQuery.toLowerCase()),
  );
  return (
    <div className="advisor-widget">
      {open && (
        <section className="advisor-window" aria-label="家庭财富顾问">
          <div className="advisor-window-head">
            <div className="advisor-avatar">
              <Bot size={20} />
            </div>
            <div>
              <b>家庭财富顾问</b>
              <small>
                {state.members.first} & {state.members.second} 的实时家庭数据
              </small>
            </div>
            <button
              aria-label="查看聊天历史"
              disabled={busy || Boolean(pending)}
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen(!historyOpen)}
            >
              <History size={17} />
            </button>
            <button
              aria-label="新建对话"
              disabled={busy || loading || Boolean(pending)}
              onClick={() => {
                try {
                  const next = onChange(newChat);
                  chooseChat(next.chatCurrent!.id);
                  setHistoryOpen(false);
                  setInput("");
                  setError("");
                } catch (reason) {
                  setError(
                    reason instanceof Error ? reason.message : "保存失败",
                  );
                }
              }}
            >
              <Plus size={17} />
            </button>
            <button aria-label="收起顾问" onClick={() => setOpen(false)}>
              <ChevronDown size={19} />
            </button>
          </div>
          <div className="advisor-controls">
            <span>模型策略</span>
            <select
              aria-label="顾问模型策略"
              value={state.preferences.model}
              onChange={(event) => {
                try {
                  onChange((current) => ({
                    ...current,
                    preferences: {
                      ...current.preferences,
                      model: event.target.value,
                    },
                  }));
                } catch (reason) {
                  setError(
                    reason instanceof Error ? reason.message : "保存失败",
                  );
                }
              }}
            >
              <option value="auto">自动路由 · DeepSeek 省钱优先</option>
              <option value="local">本地数据助手</option>
              <optgroup label="OpenAI">
                <option value="openai-fast">快速</option>
                <option value="openai-balanced">均衡</option>
                <option value="openai-reasoning">深度推理</option>
              </optgroup>
              <optgroup label="Anthropic">
                <option value="anthropic-fast">Claude 快速</option>
                <option value="anthropic-reasoning">Claude 深度</option>
              </optgroup>
              <optgroup label="DeepSeek">
                <option value="deepseek-chat">快速分析</option>
                <option value="deepseek-reasoner">深度推理</option>
              </optgroup>
            </select>
          </div>
          {state.preferences.model === "auto" && (
            <small className="route-hint">
              日常问答 / 记账用 DeepSeek；退休、税务与情景规划升级
              GPT‑6。未配置时按可用模型选择，不因余额位数升级。
            </small>
          )}
          <div className="advisor-context">
            <span>{state.assets.length} 项资产</span>
            <span>{state.debts.length} 项负债</span>
            <span>净资产 {total.netWorth.toLocaleString("en-CA")}</span>
          </div>
          <div className="advisor-conversation-meta">
            <span title={currentChat.title}>
              {historyOpen ? "历史会话" : currentChat.title}
            </span>
            <small>{saveStatus || "本机已保存"}</small>
          </div>
          {!historyOpen && insights.length > 0 && (
            <details className="advisor-suggestions">
              <summary>
                <Sparkles size={14} /> 主动发现 · {insights.length}{" "}
                个可讨论的事项 <ChevronDown size={14} />
              </summary>
              <div>
                {insights.slice(0, 4).map((row) => (
                  <button
                    type="button"
                    key={row.id}
                    disabled={busy || loading}
                    onClick={() =>
                      setInput(
                        `只做分析与讨论，不执行数据变更。\n${row.prompt}`,
                      )
                    }
                  >
                    <b>{row.title}</b>
                    <small>{row.body}</small>
                    <span>依据：{row.source} · 点击准备讨论</span>
                  </button>
                ))}
              </div>
            </details>
          )}
          {historyOpen && (
            <div className="advisor-history" aria-label="聊天历史">
              <label>
                搜索历史
                <input
                  type="search"
                  aria-label="搜索聊天历史"
                  placeholder="搜索问题或回复…"
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                />
              </label>
              <p>新建对话会保留旧记录；选择任意会话可回看并继续提问。</p>
              {chats.length ? (
                chats.map((chat) => (
                  <button
                    type="button"
                    className="advisor-history-item"
                    key={chat.id}
                    aria-label={`继续会话：${chat.title}`}
                    onClick={() => {
                      try {
                        chooseChat(chat.id);
                        setHistoryOpen(false);
                        setInput("");
                      } catch (reason) {
                        setError(
                          reason instanceof Error
                            ? reason.message
                            : "无法打开会话",
                        );
                      }
                    }}
                  >
                    <b>{chat.title}</b>
                    <small>
                      {chat.messages.length} 条消息 ·{" "}
                      {chat.updatedAt
                        ? new Date(chat.updatedAt).toLocaleString("zh-CN", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "导入的历史记录"}
                      {chat.id === currentChat.id ? " · 当前会话" : ""}
                    </small>
                    <span>
                      {chat.messages
                        .filter((row) => row.role === "assistant")
                        .at(-1)
                        ?.text.replace(/[*#]/g, "")
                        .slice(0, 70) || "点击继续对话"}
                    </span>
                  </button>
                ))
              ) : (
                <p>没有匹配的会话。</p>
              )}
            </div>
          )}
          <div
            className="advisor-messages"
            hidden={historyOpen}
            ref={messagesRef}
            aria-live="polite"
          >
            {!currentChat.messages.length && (
              <div className="chat-message assistant">
                {insights.length
                  ? `我从最新记录中发现 ${insights.length} 个值得讨论的事项。展开上方“主动发现”选择一个，或直接告诉我想了解什么。`
                  : "我们可以一起解读资产、核对收支或讨论目标。明确要求修改数据时，我也能协助更新。"}
              </div>
            )}
            {currentChat.messages.map((message) => (
              <div className={`chat-message ${message.role}`} key={message.id}>
                {message.role === "assistant" ? (
                  <AdvisorMarkdown text={message.text} />
                ) : (
                  message.text
                )}
              </div>
            ))}
            {busy && (
              <div className="chat-message assistant typing">
                正在查看家庭数据…
              </div>
            )}
          </div>
          {error && (
            <div className="advisor-error" role="alert">
              {error}
            </div>
          )}
          {pending && (
            <div
              className="advisor-preview"
              role="region"
              aria-label="数据修改预览"
            >
              <b>确认这 {pending.actions.length} 项修改？</b>
              <p>
                金额为
                CAD。所有变更一次性保存，并写入历史；未确认不会改变页面数据。
              </p>
              <ul>
                {pending.rows.map((row, index) => (
                  <li key={index}>{row}</li>
                ))}
              </ul>
              <div>
                <button
                  type="button"
                  className="primary"
                  disabled={loading || busy}
                  onClick={confirm}
                >
                  确认并保存修改
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const chatId = pending.chatId;
                    setPending(null);
                    try {
                      onChange((current) =>
                        appendChat(
                          current,
                          {
                            id: id(),
                            role: "assistant",
                            text: "已取消本次待确认修改；家庭数据未变。",
                          },
                          chatId,
                        ),
                      );
                    } catch {
                      setError("取消记录未保存，财务数据未修改。");
                    }
                  }}
                >
                  取消修改
                </button>
              </div>
            </div>
          )}
          <SearchControls
            state={state}
            input={input}
            disabled={busy || loading || Boolean(pending)}
            onChange={onChange}
            onError={setError}
          />
          <VoiceControls
            key={currentChat.id}
            input={input}
            onTranscript={setInput}
            onListeningChange={setVoiceListening}
            reply={
              currentChat.messages
                .filter((row) => row.role === "assistant")
                .at(-1)?.text || ""
            }
            disabled={busy || loading || historyOpen || Boolean(pending)}
            active={open}
          />
          <form className="advisor-compose" onSubmit={send}>
            <textarea
              aria-label="顾问消息"
              value={input}
              disabled={
                historyOpen ||
                loading ||
                busy ||
                Boolean(pending) ||
                voiceListening
              }
              maxLength={6000}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder="描述问题，或直接要求修改数据…"
              rows={2}
            />
            <button
              disabled={
                busy ||
                historyOpen ||
                loading ||
                Boolean(pending) ||
                voiceListening ||
                !input.trim()
              }
              aria-label="发送消息"
            >
              <Send size={17} />
            </button>
          </form>
          {busy && (
            <button
              type="button"
              className="advisor-stop"
              onClick={() => controller.current?.abort()}
            >
              停止本次回复
            </button>
          )}
          <small className="advisor-disclaimer">
            草稿仅保存在此设备；数据修改先预览确认。AI 分析供家庭讨论参考。
          </small>
        </section>
      )}
      {!open && !loading && !overviewPromptVisible && nudge && (
        <div className="advisor-nudge" role="status">
          <button
            className="nudge-close"
            aria-label="本次暂不显示主动提示"
            onClick={() => {
              const next = [...hiddenNudges, nudge.id];
              setHiddenNudges(next);
              try {
                sessionStorage.setItem(
                  "together-hidden-nudges",
                  JSON.stringify(next),
                );
              } catch {
                /* Session-only dismissal remains available. */
              }
            }}
          >
            <X size={14} />
          </button>
          <span>顾问发现一个需要核对的事项</span>
          <b>{nudge.title}</b>
          <button
            className="text-button"
            onClick={() => {
              setOpen(true);
              setHistoryOpen(false);
              setInput(`只做分析与讨论，不执行数据变更。\n${nudge.prompt}`);
            }}
          >
            展开讨论 ↗
          </button>
        </div>
      )}
      <button
        className="advisor-bubble"
        aria-label={open ? "收起财富顾问" : "打开财富顾问"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <X size={21} />
        ) : (
          <>
            <Bot size={21} />
            <span>问问顾问</span>
            {insights.length && !loading ? (
              <i className="advisor-unread">{insights.length}</i>
            ) : (
              <Sparkles size={13} />
            )}
          </>
        )}
      </button>
    </div>
  );
}
