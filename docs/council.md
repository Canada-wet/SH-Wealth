# 多模型研讨 · v0.6.1

入口 `/council`。两位白名单成员均可用，但问题及历史按本人账号隔离，不自动共享给伴侣，不自动附带家庭资产、兴趣资料或既有聊天。页面明确同意后，所选服务商接收问题以及后续阶段需要的发言；他们的存储和处理取决于各自条款。

## 运行与费用边界

选择 2–6 个型号；固定独立观点、交叉质询、修订结论三个阶段，可选一个裁判。共 `3 × 参与数 + 是否裁判` 次调用（最多 19 次）；每次最多 4,096 输出 tokens，可能包含推理。每人每个多伦多自然日最多新建三场，同时最多一场未结束；最多保存 100 场。输入上下文随阶段增长，未提供未经核实的美元报价。

同一阶段的模型看到同一份前阶段快照，不偷看同阶段先发言者。跨模型材料用观点编号匿名化，但发言本身仍可能透露模型身份。只保存可见答案和服务商返回的用量，不索要或持久化隐藏推理。发言向后续模型最多提供前 4,000 字，并标注摘录。成功开场不足两份时跳过后续付费步骤；失败与缺席不当作共识。

客户端一次请求仅推进一步。服务端数据库先原子认领，再调用模型，最后保存；多个标签不会认领同一步。不自动重试、不偷偷换模型、不依赖内存队列或后台 cron。隐藏/关闭页面不启动后续调用，已提交请求可能继续。恢复页面需明确点击继续；若提交后进程中断，等待两分钟可明确跳过，不重新扣款请求。暂停和停止不声称能撤回服务商已接受的请求。删除无法撤销，且不清除限额记录。

## 配置

先在同一 Supabase 项目运行 `supabase/council.sql`，再部署。新增的是个人研究表与配额表，不涉及财富文档及已有业务表。RLS 只允许本人读取；直接客户端写入及执行认领函数均禁止。服务器在白名单认证后通过服务端密钥执行固定命令，并强制本人用户 ID。

服务端变量：

| 服务 | 变量 | 核对型号 |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | GPT-6 Luna / GPT-6 Astra |
| Anthropic | `ANTHROPIC_API_KEY` | Claude Haiku 5.5 / Fable 5.1 |
| DeepSeek | `DEEPSEEK_API_KEY` | DeepSeek V4.1 Flash / V4 Pro |
| Qwen | `QWEN_API_KEY`, `QWEN_BASE_URL` | Qwen 3.8 Flash / Max |
| GLM | 百炼共用 `QWEN_API_KEY` + `QWEN_BASE_URL`，或原厂 `ZAI_API_KEY` | 百炼旗舰 `ZHIPU/GLM-5.3`；Flash 暂仅原厂 |
| Moonshot | 百炼共用 `QWEN_API_KEY` + `QWEN_BASE_URL`，或原厂 `MOONSHOT_API_KEY` | 百炼 `kimi-k3` / `kimi-k2.6`；K2.6 不是最新轻量型号 |
| Gemini | `GEMINI_API_KEY` | Gemini 3.5 Flash-Lite / Gemini 4 Argon |
| Meta | `MODEL_API_KEY` | Muse Spark 1.3；未核实独立 Lite 型号 |

不要使用 `NEXT_PUBLIC_` 前缀保存服务商密钥，不在浏览器存储密钥。百炼地址使用该 API key 同地域的官方业务空间地址，例如 `https://WORKSPACE.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`；只接受固定官方域名格式，拒绝任意代理地址。仅有这两个变量时，启用 Qwen 两种、Kimi 两种和 GLM 旗舰共五种已核实映射；不等于账号对这五种均已开通权限或免费额度。

`COUNCIL_GLM_CHANNEL` / `COUNCIL_MOONSHOT_CHANNEL` 支持 `auto`（默认）、`alibaba`、`direct`。auto 在已有原厂 key 时保持原厂，否则使用已配置的百炼；强制渠道无效时明确禁用，不静默回退。GLM 原厂使用按量付费 Model API，不自动使用 Coding Plan；Meta 不是 WhatsApp Graph 凭证。网页订阅不等于 API 余额。配置变化后需重新部署。

每个新研讨保存 `connection.channel`、精确 API 型号与百炼地址的 SHA-256 指纹（非密钥），用于发言和导出标注。运行中保持原渠道，业务空间变化则在下一步发出请求前阻止，不将旧请求转到新空间。旧版缺少快照的 Kimi / GLM 仍按原厂直连处理，不能自动借用百炼 key。旧版 Qwen 本来就通过百炼调用。

“检查百炼连接”仅请求同业务空间 `/models`，返回本页固定映射的覆盖情况，不返回密钥、完整目录或上游错误原文；不调用生成接口，也不因目录 404 自动改成付费测试。沿用现有顾问请求频率限制，操作前需白名单登录和同源 JSON 请求。

## 型号依据（核对日期 2026-10-18）

- [OpenAI 模型目录](https://developers.openai.com/api/docs/models)
- [Anthropic 模型目录](https://platform.claude.com/docs/en/models/overview)
- [DeepSeek 模型与价格](https://api-docs.deepseek.com/quick_start/pricing/)
- [Qwen 推荐型号](https://www.alibabacloud.com/help/en/model-studio/models)、[兼容接口与地域](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope)
- [GLM 型号](https://docs.z.ai/guides/overview/overview)、[Model API](https://docs.z.ai/api-reference/llm/chat-completion)
- [Kimi 在售与退役型号](https://platform.kimi.ai/docs/models)、[K3 接口](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart)
- [Gemini 型号](https://ai.google.dev/gemini-api/docs/models)、[Argon 接口](https://ai.google.dev/gemini-api/docs/generate-content/latest-model)
- [Meta Model API](https://dev.meta.ai/docs/quickstart)

目录非动态更新：不能把供应商滚动别名等同固定版本、把凭证存在等同模型已实测。当前不调用搜索工具，也不自动执行任何真实财务操作；财务、法律、医疗和时效性信息需独立核验。

## 验证

核心、八种协议的模拟响应、认证/输入边界、防重复认领和失败恢复见 `tests/council*.test.ts`。`tests/council.sql` 使用合成研讨记录并整体回滚，检查 RLS、客户端写入拒绝、幂等创建、并发认领、暂停保存、停止和限额。浏览器交互测试使用隔离模拟，不发送真实问题至付费模型；不能据此声称八家服务均已激活。
