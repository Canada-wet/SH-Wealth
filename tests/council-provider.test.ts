import { it, expect, vi, afterEach } from "vitest";
import { COUNCIL_MODELS } from "../lib/council";
import type { CouncilAttachment } from "../lib/council-attachments";
import {
  callCouncilModel,
  councilAvailability,
  councilModelSnapshot,
  checkAlibabaConnection,
} from "../lib/council-provider";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const keys = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "QWEN_API_KEY",
  "ZAI_API_KEY",
  "MOONSHOT_API_KEY",
  "GEMINI_API_KEY",
  "MODEL_API_KEY",
];
const enable = () => {
  vi.stubEnv("COUNCIL_GLM_CHANNEL", "auto");
  vi.stubEnv("COUNCIL_MOONSHOT_CHANNEL", "auto");
  keys.forEach((k) => vi.stubEnv(k, "private-test-secret"));
  vi.stubEnv(
    "QWEN_BASE_URL",
    "https://test-workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
  );
};
const onlyAlibaba = () => {
  enable();
  keys.filter((k) => k !== "QWEN_API_KEY").forEach((k) => vi.stubEnv(k, ""));
};
it.each([
  "openai-light",
  "anthropic-light",
  "qwen-light",
  "glm-flagship",
  "deepseek-light",
  "gemini-flagship",
  "moonshot-flagship",
  "moonshot-alternative",
])(
  "%s 深入模式使用真实推理参数和8192总输出预算，不返回隐藏思考",
  async (key) => {
    enable();
    const m = COUNCIL_MODELS.find((m) => m.key === key)!;
    const fetcher = vi.fn(async (_url: unknown, options: RequestInit) => {
      const b = JSON.parse(String(options.body));
      expect(
        b.max_tokens ??
          b.max_output_tokens ??
          b.generationConfig.maxOutputTokens,
      ).toBe(8192);
      if (m.provider === "openai") expect(b.reasoning.effort).toBe("high");
      if (m.provider === "anthropic") {
        expect(b.thinking.type).toBe("adaptive");
        expect(b.output_config.effort).toBe("high");
        expect(b.thinking).not.toHaveProperty("budget_tokens");
      }
      if (m.provider === "qwen") {
        expect(b.enable_thinking).toBe(true);
        expect(b.thinking_budget).toBe(4096);
      }
      if (m.provider === "glm" || m.provider === "deepseek")
        expect(b.reasoning_effort).toBe("high");
      if (m.provider === "gemini")
        expect(b.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
      if (m.key === "moonshot-flagship")
        expect(b.reasoning_effort).toBe("high");
      if (m.key === "moonshot-alternative")
        expect(b.thinking.type).toBe("enabled");
      return Response.json({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "visible" }],
          },
        ],
        content: [
          { type: "thinking", thinking: "HIDDEN" },
          { type: "text", text: "visible" },
        ],
        candidates: [
          {
            content: {
              parts: [{ thought: true, text: "HIDDEN" }, { text: "visible" }],
            },
          },
        ],
        choices: [
          { message: { content: "visible", reasoning_content: "HIDDEN" } },
        ],
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await callCouncilModel(
      m,
      "system",
      "synthetic",
      [],
      undefined,
      "deep",
    );
    expect(result.answer).toBe("visible");
    expect(JSON.stringify(result)).not.toContain("HIDDEN");
  },
);
it.each([
  "openai-light",
  "anthropic-light",
  "anthropic-opus",
  "gemini-light",
  "qwen-light",
])("%s 真实多模态请求结构，不把图片仅作为文字提及", async (key) => {
  enable();
  const image: CouncilAttachment = {
    id: "00000000-0000-4000-8000-000000000004",
    name: "chart.png",
    kind: "image",
    mime: "image/png",
    note: "Synthetic pixel",
    content:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jAusAAAAASUVORK5CYII=",
  };
  const m = COUNCIL_MODELS.find((v) => v.key === key)!;
  const fetcher = vi.fn(async (_url: unknown, options: RequestInit) => {
    const b = JSON.parse(String(options.body));
    if (m.provider === "openai")
      expect(b.input[0].content[0]).toMatchObject({
        type: "input_image",
        image_url: image.content,
      });
    if (m.provider === "anthropic")
      expect(b.messages[0].content[0]).toMatchObject({
        type: "image",
        source: { type: "base64", media_type: image.mime },
      });
    if (m.provider === "gemini")
      expect(b.contents[0].parts[0].inlineData).toEqual({
        mimeType: image.mime,
        data: image.content.split(",")[1],
      });
    if (m.provider === "qwen")
      expect(b.messages[1].content[0]).toMatchObject({
        type: "image_url",
        image_url: { url: image.content },
      });
    return Response.json({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "visible" }],
        },
      ],
      content: [{ type: "text", text: "visible" }],
      candidates: [{ content: { parts: [{ text: "visible" }] } }],
      choices: [{ message: { content: "visible" } }],
    });
  });
  vi.stubGlobal("fetch", fetcher);
  expect((await callCouncilModel(m, "s", "question", [image])).answer).toBe(
    "visible",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(
    callCouncilModel(
      COUNCIL_MODELS.find((v) => v.key === "deepseek-light")!,
      "s",
      "q",
      [image],
    ),
  ).rejects.toThrow("未调用模型");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("一把百炼key启用核实的五个型号；GLM Flash不自动替换", () => {
  onlyAlibaba();
  expect(
    councilAvailability()
      .filter((a) => a.ready)
      .map((a) => a.key),
  ).toEqual([
    "qwen-light",
    "qwen-flagship",
    "glm-flagship",
    "moonshot-alternative",
    "moonshot-flagship",
  ]);
  const glm = councilAvailability().find((a) => a.key === "glm-flagship")!;
  expect(glm.connection).toMatchObject({
    channel: "alibaba",
    model: "ZHIPU/GLM-5.3",
  });
  expect(
    councilAvailability().find((a) => a.key === "glm-light")?.detail,
  ).toContain("尚无已核实");
  expect(JSON.stringify(councilAvailability())).not.toContain("test-workspace");
});
it.each([
  ["moonshot-flagship", "kimi-k3"],
  ["moonshot-alternative", "kimi-k2.6"],
  ["glm-flagship", "ZHIPU/GLM-5.3"],
])("%s 通过百炼地址和同一key发送正确别名，不混入原厂参数", async (k, id) => {
  onlyAlibaba();
  const m = councilModelSnapshot(COUNCIL_MODELS.find((m) => m.key === k)!);
  const fetcher = vi.fn(async (url: unknown, options: RequestInit) => {
    expect(String(url)).toBe(
      "https://test-workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
    expect((options.headers as Record<string, string>).Authorization).toBe(
      "Bearer private-test-secret",
    );
    const body = JSON.parse(String(options.body));
    expect(body.model).toBe(id);
    expect(body.thinking).toBeUndefined();
    if (k === "glm-flagship") {
      expect(body.reasoning_effort).toBe("low");
      expect(body.enable_thinking).toBe(true);
      expect(body.stream).toBe(true);
      expect(body.stream_options.include_usage).toBe(true);
    } else expect(body.reasoning_effort).toBeUndefined();
    return Response.json({
      choices: [{ message: { content: "百炼合成回答" } }],
    });
  });
  vi.stubGlobal("fetch", fetcher);
  expect((await callCouncilModel(m, "system", "public question")).answer).toBe(
    "百炼合成回答",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("渠道偏好不静默降级，快照冻结渠道与业务空间，旧版直连不迁移", async () => {
  onlyAlibaba();
  const glm = COUNCIL_MODELS.find((m) => m.key === "glm-flagship")!,
    snapshot = councilModelSnapshot(glm);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  // Historical no-snapshot GLM remains direct and cannot borrow Alibaba credentials.
  await expect(callCouncilModel(glm, "s", "q")).rejects.toThrow("未发起调用");
  vi.stubEnv(
    "QWEN_BASE_URL",
    "https://other.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
  );
  await expect(callCouncilModel(snapshot, "s", "q")).rejects.toThrow(
    "业务空间地址已变化",
  );
  expect(fetcher).not.toHaveBeenCalled();
  enable();
  expect(councilModelSnapshot(glm).connection?.channel).toBe("direct");
  vi.stubEnv("COUNCIL_GLM_CHANNEL", "alibaba");
  expect(councilModelSnapshot(glm).connection?.channel).toBe("alibaba");
  expect(councilAvailability().find((a) => a.key === "glm-light")?.ready).toBe(
    false,
  );
  vi.stubEnv("COUNCIL_GLM_CHANNEL", "invalid");
  expect(
    councilAvailability().find((a) => a.key === "glm-flagship")?.ready,
  ).toBe(false);
  vi.stubEnv("COUNCIL_GLM_CHANNEL", "direct");
  vi.stubEnv("ZAI_API_KEY", "");
  expect(
    councilAvailability().find((a) => a.key === "glm-flagship")?.ready,
  ).toBe(false);
});
it("百炼失败不转发至原厂，不重新调用或输出密钥", async () => {
  enable();
  vi.stubEnv("COUNCIL_GLM_CHANNEL", "alibaba");
  const m = councilModelSnapshot(
    COUNCIL_MODELS.find((m) => m.key === "glm-flagship")!,
  );
  const fetcher = vi.fn(
    async () => new Response("private-test-secret", { status: 401 }),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(callCouncilModel(m, "s", "q")).rejects.toThrow(
    "凭证、地域或模型访问权限",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("连接检查只读取目录，过滤非研讨型号；不发起付费生成", async () => {
  onlyAlibaba();
  const fetcher = vi.fn(async (url: unknown, options: RequestInit) => {
    expect(String(url)).toMatch(/\/models$/);
    expect(options.method).toBeUndefined();
    expect(options.body).toBeUndefined();
    return Response.json({
      data: [
        { id: "kimi-k3" },
        { id: "ZHIPU/GLM-5.3" },
        { id: "unrelated-private-model" },
      ],
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await checkAlibabaConnection();
  expect(result.ok).toBe(true);
  expect(result.modelKeys).toEqual(["moonshot-flagship", "glm-flagship"]);
  expect(JSON.stringify(result)).not.toContain("unrelated-private-model");
  fetcher.mockImplementationOnce(
    async () => new Response("secret", { status: 404 }),
  );
  expect((await checkAlibabaConnection()).ok).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("只返回配置状态不返回密钥，Qwen 拒绝任意域名与错误地域地址", () => {
  keys.forEach((k) => vi.stubEnv(k, ""));
  expect(councilAvailability().every((x) => !x.ready)).toBe(true);
  enable();
  expect(councilAvailability().every((x) => x.ready)).toBe(true);
  expect(JSON.stringify(councilAvailability())).not.toContain(
    "private-test-secret",
  );
  for (const value of [
    "https://evil.test/v1",
    "https://test.us-east-1.maas.aliyuncs.com.evil.test/compatible-mode/v1",
    "http://test.us-east-1.maas.aliyuncs.com/compatible-mode/v1",
    "https://user:pass@test.us-east-1.maas.aliyuncs.com/compatible-mode/v1",
  ]) {
    vi.stubEnv("QWEN_BASE_URL", value);
    expect(
      councilAvailability().find((x) => x.key === "qwen-light")?.ready,
    ).toBe(false);
  }
});
it.each(COUNCIL_MODELS.map((m) => [m.key, m] as const))(
  "%s: 使用对应协议，提取可见文字和用量，不持久化私有推理",
  async (_key, m) => {
    enable();
    const fetcher = vi.fn(async (_url: unknown, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      expect(body.model ?? String(_url)).toContain(
        m.provider === "gemini" ? "gemini" : m.model,
      );
      if (m.key === "moonshot-flagship")
        expect(body.reasoning_effort).toBe("low");
      if (m.key === "moonshot-alternative")
        expect(body.thinking.type).toBe("disabled");
      expect(body.tools).toBeUndefined();
      expect(options.redirect).toBe("error");
      if (m.provider === "glm") {
        expect(String(_url)).toBe(
          "https://api.z.ai/api/paas/v4/chat/completions",
        );
        expect(body.thinking).toEqual({ type: "enabled" });
      }
      if (m.provider === "gemini")
        expect(body.generationConfig.maxOutputTokens).toBe(4096);
      if (m.provider === "anthropic")
        expect((options.headers as Record<string, string>)["x-api-key"]).toBe(
          "private-test-secret",
        );
      const data = ["openai", "meta"].includes(m.provider)
        ? {
            output: [
              { type: "reasoning", summary: [{ text: "PRIVATE" }] },
              {
                type: "message",
                content: [{ type: "output_text", text: "visible" }],
              },
            ],
            usage: { input_tokens: 12, output_tokens: 34 },
          }
        : m.provider === "anthropic"
          ? {
              content: [
                { type: "thinking", thinking: "PRIVATE" },
                { type: "text", text: "visible" },
              ],
              usage: { input_tokens: 12, output_tokens: 34 },
            }
          : m.provider === "gemini"
            ? {
                candidates: [
                  {
                    content: {
                      parts: [
                        { thought: true, text: "PRIVATE" },
                        { text: "visible" },
                      ],
                    },
                  },
                ],
                usageMetadata: { promptTokenCount: 12, totalTokenCount: 46 },
              }
            : {
                choices: [
                  {
                    message: {
                      content: "visible",
                      reasoning_content: "PRIVATE",
                    },
                    finish_reason: "stop",
                  },
                ],
                usage: { prompt_tokens: 12, completion_tokens: 34 },
              };
      return Response.json(data);
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await callCouncilModel(m, "system", "question");
    expect(result).toEqual({
      answer: "visible",
      usage: { input: 12, output: 34, truncated: false },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it("未配置不调用；429、超时和坏响应不自动重试或泄露服务商内容", async () => {
  const m = COUNCIL_MODELS[0];
  vi.stubEnv("OPENAI_API_KEY", "");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(callCouncilModel(m, "s", "q")).rejects.toThrow("尚未配置");
  expect(fetcher).not.toHaveBeenCalled();
  enable();
  fetcher.mockResolvedValueOnce(
    new Response("private-test-secret", { status: 429 }),
  );
  await expect(callCouncilModel(m, "s", "q")).rejects.toThrow("限流");
  fetcher.mockRejectedValueOnce(Error("private-test-secret"));
  await expect(callCouncilModel(m, "s", "q")).rejects.toThrow("未自动重发");
  fetcher.mockResolvedValueOnce(Response.json({ output: [] }));
  await expect(callCouncilModel(m, "s", "q")).rejects.toThrow("未收到可展示");
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("达到输出预算或展示长度时标注截断，用量未知不伪造为零", async () => {
  enable();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        status: "incomplete",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "x".repeat(17000) }],
          },
        ],
      }),
    ),
  );
  const result = await callCouncilModel(COUNCIL_MODELS[0], "s", "q");
  expect(result.answer.length).toBe(16000);
  expect(result.usage).toEqual({ input: null, output: null, truncated: true });
});
it("Qwen 旗舰通过 SSE 接收，限制思考长度且保留部分正文，隐藏推理不进入结果", async () => {
  onlyAlibaba();
  const fetcher = vi.fn(async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    expect(body.enable_thinking).toBe(true);
    expect(body.thinking_budget).toBe(1024);
    expect(body.stream).toBe(true);
    expect(body.reasoning_effort).toBeUndefined();
    return new Response(
      'data: {"choices":[{"delta":{"reasoning_content":"PRIVATE"}}]}\n\ndata: {"choices":[{"delta":{"content":"部分结论"}}]}\n\n',
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await callCouncilModel(
    councilModelSnapshot(
      COUNCIL_MODELS.find((m) => m.key === "qwen-flagship")!,
    ),
    "system",
    "public question",
  );
  expect(result.answer).toBe("部分结论");
  expect(result.usage.interrupted).toBe(true);
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("超时、坏 JSON 与参数错误分开提示，不回显上游私密内容", async () => {
  enable();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockRejectedValueOnce(
    new DOMException("private detail", "TimeoutError"),
  );
  await expect(callCouncilModel(COUNCIL_MODELS[0], "s", "q")).rejects.toThrow(
    "4 分钟",
  );
  fetcher.mockResolvedValueOnce(new Response("invalid JSON"));
  await expect(callCouncilModel(COUNCIL_MODELS[0], "s", "q")).rejects.toThrow(
    "无法解析",
  );
  fetcher.mockResolvedValueOnce(
    Response.json(
      { error: { message: "max_tokens invalid: PRIVATE_SECRET" } },
      { status: 400 },
    ),
  );
  let message = "";
  try {
    await callCouncilModel(COUNCIL_MODELS[0], "s", "q");
  } catch (e) {
    message = (e as Error).message;
  }
  expect(message).toContain("涉及 max_tokens");
  expect(message).not.toContain("PRIVATE_SECRET");
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("包含特殊字符的回复仍为数据库留足附件空间，不保存 NUL 或半个代理对", async () => {
  enable();
  const fetcher = vi.fn(async () =>
    Response.json({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "\u0001".repeat(16000) }],
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const result = await callCouncilModel(COUNCIL_MODELS[0], "s", "q");
  expect(Buffer.byteLength(JSON.stringify(result.answer))).toBeLessThanOrEqual(
    60000,
  );
  expect(result.usage.truncated).toBe(true);
  fetcher.mockResolvedValueOnce(
    Response.json({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "x".repeat(15999) + "😀\0" }],
        },
      ],
    }),
  );
  const unicode = await callCouncilModel(COUNCIL_MODELS[0], "s", "q");
  expect(unicode.answer.isWellFormed()).toBe(true);
  expect(unicode.answer).not.toContain("\0");
});
