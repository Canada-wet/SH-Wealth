# 多模型研讨 · v0.6.2

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
| Anthropic | `ANTHROPIC_API_KEY` | Claude Haiku 5.5 / Opus 5.5（日常旗舰） / Fable 5.1（深度推理，现役） |
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

Anthropic 官方当前仍列 Fable 5.1；5.1 与 Haiku / Opus 的 5.5 属于不同产品线，不能按数字判断过时。官方建议大多数工作先用 Opus 5.5，高要求推理再用 Fable。新增 `anthropic-opus`，保留 `anthropic-flagship` 的 Fable 映射与所有旧快照，不自动改变已有研讨的数据接收方。

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

## 图片与附件

- 浏览器本机处理；未开始的材料只在当前页面内存中，刷新会丢失。开始时才经认证接口保存到该用户的私密 `wealth_council_runs.document.attachments`。不创建公开对象、不发给额外 OCR 服务、不写家庭账本，也不自动读取任何本地文件。
- 每场最多 5 份材料、2 张图片；原文件各不超过 10 MB。JPEG / PNG / WebP 重编码成去元数据的 JPEG，最长边起始 1800 像素，每张不超过 150 KB；用户必须预览小字可读性。JSON 序列化附件最多 600 KB，API 整体最多 700 KB（流式有界读取）；原有数据库单场 2 MB 上限保留。
- TXT / MD / CSV / TSV / JSON 要求 UTF-8；DOCX 仅解压大小不超过 2 MB 的 `word/document.xml`，不执行宏/链接；PDF.js 在本机 worker 中读取最多 30 页的文字和页码。所有文档合计最多 30,000 字，超长拒绝而非静默截断。扫描 PDF 无 OCR，文档图像、批注、复杂表格和排版不保证保留；改用清晰截图。原始 PDF / DOCX 不保存，不能将本功能当原件备份。
- PDF.js 的中文等 CMap 与标准字体在 `predev` / `prebuild` 从已安装依赖复制到版本化的自有静态目录；没有第三方 CDN，不向外部字体服务发送文件信息。生成目录被 Git 忽略，部署时自动生成。
- 每步的提示附带完整文字材料（非此前发言 4,000 字摘录限制）；图片以真实多模态内容块随每一步发送。当前仅开放已核实的 OpenAI Responses、Anthropic Messages、Gemini GenerateContent 和百炼 Qwen 路径；其他型号本页只接收文字材料。图片场景中任何参会者或裁判不兼容均在付费前拒绝，无隐藏 OCR 或跨服务替换。
- 文件名、文字与图片中的内容视为不可信证据，不服从其改变角色、泄露系统或调用工具的指令。提示要求引用文件名 / 页码，图像模糊时标注不确定。材料反复发送会增加输入用量，用户授权文案明确包含附件。
- 附件随个人研讨完整删除，不留孤立对象；导出 Markdown 包含文字及图片说明，不嵌入 base64，图片回到私密历史查看。历史摘要列表不返回附件内容。幂等创建同时核对附件与型号快照，同一编号不同材料返回冲突。

协议依据：[OpenAI 图像输入](https://developers.openai.com/api/docs/guides/images-vision)、[Claude Vision](https://platform.claude.com/docs/en/build-with-claude/vision)、[Gemini GenerateContent 图像](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding)、[Qwen 视觉理解](https://www.alibabacloud.com/help/en/model-studio/vision)。
