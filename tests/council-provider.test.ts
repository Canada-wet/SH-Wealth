import { it, expect, vi, afterEach } from "vitest";
import { COUNCIL_MODELS } from "../lib/council";
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
    expect(body.reasoning_effort).toBeUndefined();
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
