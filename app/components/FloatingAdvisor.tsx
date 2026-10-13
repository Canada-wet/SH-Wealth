"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bot, ChevronDown, Send, Sparkles, Trash2, X } from "lucide-react";
import { id, totals, type WealthState } from "@/lib/wealth";
import type { AssistantAction } from "@/lib/advisor-actions";
export default function FloatingAdvisor({
  state,
  onActions,
  onChange,
}: {
  state: WealthState;
  onActions: (actions: AssistantAction[]) => WealthState;
  onChange: (update: (state: WealthState) => WealthState) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(state);
  latest.current = state;
  const messagesRef = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const show = (event: Event) => {
      setOpen(true);
      const prompt = (event as CustomEvent<string>).detail;
      if (typeof prompt === "string") setInput(prompt);
    };
    window.addEventListener("together-open-advisor", show);
    return () => {
      window.removeEventListener("together-open-advisor", show);
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (messagesRef.current)
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [state.messages, busy, open]);
  const fingerprint = (current: WealthState) =>
    JSON.stringify({
      assets: current.assets,
      debts: current.debts,
      budget: current.budget,
      goal: current.goal,
      plan: current.plan,
      contributions: current.contributions,
      members: current.members,
    });
  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const question = input.trim();
    if (!question || busy) return;
    setError("");
    const snapshot = latest.current;
    const financial = fingerprint(snapshot);
    try {
      onChange((current) => ({
        ...current,
        messages: [
          ...current.messages,
          { id: id(), role: "user", text: question },
        ],
      }));
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
      let applied = false;
      if (actions.length) {
        if (financial !== fingerprint(latest.current))
          throw new Error(
            "对话期间家庭数据已有变化，请用最新数据重新发起修改。",
          );
        onActions(actions);
        applied = true;
      }
      const text = `${result.answer || "已完成分析。"}${applied ? `\n\n✓ 已保存 ${actions.length} 项变更，页面已同步。` : ""}${result.route ? `\n\n${result.route.provider === "local" ? "本地助手" : `${result.route.provider} · ${result.route.model}`} · ${result.route.reason}` : ""}`;
      onChange((current) => ({
        ...current,
        messages: [...current.messages, { id: id(), role: "assistant", text }],
      }));
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.name === "AbortError"
            ? "请求超时，请重试。"
            : reason.message
          : "请求失败。";
      setError(message);
      setInput(question);
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  };
  const total = totals(state);
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
              aria-label="清空聊天记录"
              disabled={busy}
              onClick={() => {
                if (window.confirm("清空当前聊天记录？"))
                  try {
                    onChange((current) => ({ ...current, messages: [] }));
                  } catch (reason) {
                    setError(
                      reason instanceof Error ? reason.message : "保存失败",
                    );
                  }
              }}
            >
              <Trash2 size={15} />
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
              <option value="auto">自动路由</option>
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
          <div className="advisor-context">
            <span>{state.assets.length} 项资产</span>
            <span>{state.debts.length} 项负债</span>
            <span>净资产 {total.netWorth.toLocaleString("en-CA")}</span>
          </div>
          <div
            className="advisor-messages"
            ref={messagesRef}
            aria-live="polite"
          >
            {!state.messages.length && (
              <div className="chat-message assistant">
                我可以解读你们的资产、负债与贡献，也可以根据明确要求更新数据。试试「把某个账户本年回报改为
                -2.5%」。
              </div>
            )}
            {state.messages.map((message) => (
              <div className={`chat-message ${message.role}`} key={message.id}>
                {message.text}
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
          <form className="advisor-compose" onSubmit={send}>
            <textarea
              aria-label="顾问消息"
              value={input}
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
            <button disabled={busy || !input.trim()} aria-label="发送消息">
              <Send size={17} />
            </button>
          </form>
          <small className="advisor-disclaimer">
            明确提出的数据修改会自动保存；AI 分析供家庭规划参考。
          </small>
        </section>
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
            <Sparkles size={13} />
          </>
        )}
      </button>
    </div>
  );
}
