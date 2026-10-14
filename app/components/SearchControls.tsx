"use client";
import { Globe } from "lucide-react";
import {
  SEARCH_TOPICS,
  searchPlan,
  type SearchMode,
  type SearchTopic,
} from "@/lib/search-policy";
import type { WealthState } from "@/lib/wealth";
export default function SearchControls({
  state,
  input,
  disabled,
  onChange,
  onError,
}: {
  state: WealthState;
  input: string;
  disabled: boolean;
  onChange: (update: (state: WealthState) => WealthState) => WealthState;
  onError: (error: string) => void;
}) {
  const mode = state.preferences.webSearch ?? "auto";
  const selected = state.preferences.searchTopic ?? "auto";
  const plan = searchPlan(input, mode, selected);
  const local = state.preferences.model === "local";
  const update = (preferences: Partial<WealthState["preferences"]>) => {
    try {
      onChange((current) => ({
        ...current,
        preferences: { ...current.preferences, ...preferences },
      }));
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "联网偏好未能保存。");
    }
  };
  return (
    <details className="search-controls">
      <summary>
        <Globe size={14} /> 联网搜索{" "}
        <span>
          {local
            ? "本地模式不联网"
            : mode === "off"
              ? "已关闭"
              : mode === "on"
                ? "按公开主题查证"
                : "需要最新信息时查证"}
        </span>
      </summary>
      <div className="search-toolbar">
        <label>
          搜索策略
          <select
            aria-label="联网搜索策略"
            disabled={disabled || local}
            value={mode}
            onChange={(event) =>
              update({ webSearch: event.target.value as SearchMode })
            }
          >
            <option value="auto">自动判断</option>
            <option value="on">开启 · 查证公开主题</option>
            <option value="off">关闭</option>
          </select>
        </label>
        {mode === "on" && (
          <label>
            公开查询主题
            <select
              aria-label="公开搜索主题"
              disabled={disabled || local}
              value={selected}
              onChange={(event) =>
                update({
                  searchTopic: event.target.value as SearchTopic | "auto",
                })
              }
            >
              <option value="auto">从问题识别主题</option>
              {Object.entries(SEARCH_TOPICS).map(([key, topic]) => (
                <option key={key} value={key}>
                  {topic.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p>
        仅查询政府、央行和银行官网；不会发送原始问题、资产金额、账户明细或聊天记录。联网结果只供分析，不执行账本修改。每次最多一次搜索工具调用，会产生额外
        API 费用。
      </p>
      {input.trim() && !local && mode !== "off" && plan.needed && (
        <p className="search-query" role="status">
          {plan.topic
            ? `公开查询：${SEARCH_TOPICS[plan.topic].label}（${plan.query}）`
            : "尚未识别公开金融主题，请开启后选择主题。"}
        </p>
      )}
      {local && <p>本地模式不调用外部模型或搜索服务。</p>}
    </details>
  );
}
