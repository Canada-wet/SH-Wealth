"use client";
import type { CouncilResearch } from "@/lib/council-research";
export default function ResearchSettings({
  value,
  change,
  disabled = false,
}: {
  value: CouncilResearch;
  change: (r: CouncilResearch) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="council-research-settings" disabled={disabled}>
      <legend>思考与证据</legend>
      <label>
        研讨深度
        <select
          aria-label="研讨深度"
          value={value.depth}
          onChange={(e) =>
            change(
              e.target.value === "deep"
                ? {
                    depth: "deep",
                    tools: true,
                    publicQueries: [],
                    webConsent: false,
                  }
                : {
                    depth: "standard",
                    tools: false,
                    publicQueries: [],
                    webConsent: false,
                  },
            )
          }
        >
          <option value="deep">深入研讨 · 五阶段，追证与答辩</option>
          <option value="standard">标准研讨 · 三阶段，较省用量</option>
        </select>
      </label>
      <p>
        深入模式：独立建模 → 交叉质询 → 证据核查 → 逐项答辩 →
        修订结论。提高已适配型号的推理预算，输出可审阅依据，不展示私有思维链。不是“越长越正确”。
      </p>
      {value.depth === "deep" && (
        <>
          <label className="council-research-toggle">
            <input
              type="checkbox"
              checked={value.tools}
              onChange={(e) =>
                change({
                  ...value,
                  tools: e.target.checked,
                  publicQueries: [],
                  webConsent: false,
                })
              }
            />
            <span>
              允许只读工具：数字计算、本场文字附件检索
              <small>
                每个模型核查阶段最多请求 2
                项；不运行代码、读电脑文件、改账本或发送消息。
              </small>
            </span>
          </label>
          {value.tools && (
            <details
              className="council-web-settings"
              open={value.publicQueries.length > 0 || undefined}
            >
              <summary>可选：允许查证公开资料</summary>
              <label>
                公开检索词（最多两行）
                <textarea
                  aria-label="公开检索词"
                  rows={2}
                  maxLength={401}
                  value={value.publicQueries.join("\n")}
                  onChange={(e) =>
                    change({
                      ...value,
                      publicQueries: e.target.value
                        ? e.target.value.split("\n")
                        : [],
                      webConsent: false,
                    })
                  }
                  placeholder="例如：Bank of Canada latest policy rate decision"
                />
              </label>
              <p>
                模型只能选用这些原样检索词，不会把讨论、历史或附件自动转成搜索。请只填公共主题，不含个人资料、金额细节、邮箱或密钥。空白表示不联网。
              </p>
              {value.publicQueries.length > 0 && (
                <label className="council-research-toggle">
                  <input
                    type="checkbox"
                    checked={value.webConsent}
                    onChange={(e) =>
                      change({ ...value, webConsent: e.target.checked })
                    }
                  />
                  <span>
                    我确认上述检索词可发送至 OpenAI
                    联网搜索，并接受额外搜索费用。每轮每条词最多尝试一次，失败或状态不明不自动重发。
                  </span>
                </label>
              )}
            </details>
          )}
        </>
      )}
    </fieldset>
  );
}
