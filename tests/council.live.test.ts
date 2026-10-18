import { it, expect } from "vitest";
import { loadEnvConfig } from "@next/env";
import { COUNCIL_MODELS } from "../lib/council";
import { callCouncilModel } from "../lib/council-provider";
it.skipIf(process.env.RUN_COUNCIL_INTEGRATION !== "1")(
  "真实 OpenAI + DeepSeek：各一次公开合成问题，无家庭数据",
  async () => {
    loadEnvConfig(process.cwd());
    for (const key of ["openai-light", "deepseek-light"]) {
      const model = COUNCIL_MODELS.find((m) => m.key === key)!;
      const result = await callCouncilModel(
        model,
        "请用两句中文简洁回答，不展示私有推理，不调用工具。",
        "什么是机会成本？请给一个不涉及任何个人资料的通用例子。",
      );
      expect(result.answer.trim().length).toBeGreaterThan(5);
      expect(result.usage.truncated).toBe(false);
      expect(result.usage.output).toBeGreaterThan(0);
    }
  },
  120000,
);
