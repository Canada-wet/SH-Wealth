# 多模型研讨 · v0.12.0

## 私人研讨库与决策复核（v0.12.0）

增量脚本 `supabase/council-library.sql` 建立独立个人整理表，不重写既有研讨文档、步骤、配额或财富账本。置顶与页面导航的置顶是两件事；归档可恢复，只整理已结束/停止的研讨，不替用户停止执行，也不释放原100场容量。删除原研讨时对应整理记录由外键级联删除，仍沿用原来的删除确认和运行中保护。

搜索由认证用户RPC在数据库内检查本人至多100场的原问题、追问、保存的发言、标题、标签和私人笔记；支持最多120字/8个空格分隔词的全部匹配，中英文均按不区分大小写的字面子串，不展开SQL通配符或正则。不搜索原附件/图片，不把全量正文或base64发到历史列表。返回有界最新完整结论摘要与命中摘录/轮次/步骤；未完成或截断裁判不冒充完整结论。无搜索时不聚合全文。搜索词通过同源POST传递，不放进URL、导航记录、用户偏好或模型请求。

历史默认按最近实际讨论活动排序（含新追问时间），置顶优先；可组合状态/模型筛选与已归档/待复核分类。手机历史默认折叠，需要时展开，不让长列表挡住研讨台。读取失败仍保留旧问题入口并标明降级，不假装全文检索或本机持久化成功。刷新/窗口重新聚焦读云端，不是跨设备实时订阅。

自定义标题、至多6个标签、2,400字私人笔记和复核日期显式保存；独立版本CAS，未知结果不自动重发，旧草稿拒绝覆盖。笔记用于记录用户自己的判断和实际反馈，不是AI结论，也不自动进入模型上下文。到期只显示待复核标记，不自动推送/生成。账号变化清空私密状态并拦截迟到请求；个人整理不因共同家庭权限而对伴侣可见。

三个深挖入口只准备追问草稿，替换已有未发送草稿需确认，再次费用授权后才发送；不自动提升深度、工具权限或改变参与者。新旧轮次对照只是原文摘录，不推断意见改变或伪造共识。单场Markdown导出附本人已保存整理；跨模块包新增 `councilLibrary`，仍有条数/字节限制，不是全数据库备份。

权限与协议单测见 `tests/council-library*.test.*`；隔离数据库事务为 `tests/council-library.sql`，不得在生产运行该合成夹具。未安装新SQL时显示明确降级，不影响原研讨继续/导出流程。

## 深入研讨与受控工具（v0.9.0）

新界面默认深入五阶段：独立建模 → 交叉质询 → 证据核查 → 逐项答辩 → 修订结论，再可选裁判。主张用 C1/C2/C3 编号，区分事实、假设、推断和价值判断；轮流采用因果 / 基准率、反例 / 敏感性、执行 / 机会成本视角，不强迫模型持相反立场。质询须具体引用对方主张，答辩读取本轮真实工具回执，最后列出解决 / 未解决争点、改变结论的阈值与验证行动。不是用更长文本或更多一致意见代替证据。

深入模式为 `5N + judge` 次模型调用，上限 8,192 总输出 tokens（含推理），建议可见正文 800–1600 字但非硬性凑字。标准模式保持 `3N + judge` / 4,096；直接回应仍为 `N + judge`，不带工具设置。旧请求没有 research 字段时保持旧预算；新请求将深度、工具与公开检索授权按轮冻结，幂等重试不能换设置。最多 279 个计划步骤，4 MB 容量与预留空间可能先于轮次限额用尽。

原生推理控制按当前已核实协议适配：OpenAI Responses high；Qwen 开启思考并设 4,096 思考预算；GLM high 且保持思考启用；Claude adaptive + high（不使用已不适配的固定 budget_tokens）；Gemini high；原厂 Kimi K3 high / K2.6 enabled；Meta 沿用原 high。百炼 Kimi K2.6 开启思考、预算 4,096；K3 保持平台的必需思考模式，不猜测未核实的努力参数。百炼 Qwen / Kimi 深入模式使用 `max_completion_tokens=8192`，而非只限制回答的旧 `max_tokens`；平台文档说明实际长度可能有最多 10 tokens 误差，输入和搜索另计，不承诺金额硬上限。旧标准请求保留原参数。无论供应商返回多少隐藏推理，只保存可见正文与用量。依据：[OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning)、[Claude thinking](https://platform.claude.com/docs/en/build-with-claude/thinking)、[百炼深思](https://help.aliyun.com/en/model-studio/deep-thinking)、[百炼兼容接口与输出预算](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions/)、[百炼 GLM](https://www.alibabacloud.com/help/en/model-studio/glm-zhipu)、[DeepSeek thinking](https://api-docs.deepseek.com/guides/thinking_mode/)、[Gemini thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking)、[Kimi model selection](https://www.kimi.ai/help/kimi-api/api-model-selection)。配置和模拟通过不代表每个账号的真实模型权限、额度或生成质量已复测。

工具采用应用层受控 JSON 请求协议，不是所有服务商原生 function_call 的无限循环。在唯一的证据核查阶段，模型先输出有限计划，服务器整份校验后才执行最多两项；下一答辩阶段读取结果。没有强迫工具调用；空计划可合法说明不需要工具或缺少授权。截断 / 坏格式 / 未授权计划不执行，不自动付费修复计划。

- `calculate`：最多 300 字、120 个 token 的纯数字运算语法，有限嵌套与数值范围；不使用 eval、shell、变量、模块或代码。只验证给定算式，不证明输入假设成立。
- `search_documents`：只匹配本场已上传的文字材料，至多三段有文件名的摘录；不读电脑文件、不连账本、无 OCR，不把未命中当作证据不存在。
- `search_public`：只接受用户已确认的公开检索词编号，不能由模型自造查询或 URL。用户最多填两条公共主题，单独确认 OpenAI 搜索的处理与费用；只发送这些原样词，不发送问题、历史、附件或财富数据。检索服务必须返回已完成 web_search_call 和 HTTPS 真实引用，否则记为失败。应用不自行抓取引用 URL，来源仍可能不可靠或有延迟。

联网先通过内部 `tool-start` 持久化意图，再发出请求；同一轮同一查询即使失败或状态未知也不自动重试。原子 claim 防并发，暂停 / 停止后不新发联网请求。其他模型可复用已归档结果，未知结果只能继承未知状态；新追问需新的明确费用确认。工具请求、返回、时间、来源、失败 / 未知 / 复用状态按个人研讨保存，可回看和导出。工具结果最多 24 KB / 步，付费前预留存储；非服务角色不能调用内部命令。无浏览器操作、任意代码、数据库查询、账户操作、发信或财富写入权限。

入口 `/council`。两位白名单成员均可用，但问题及历史按本人账号隔离，不自动共享给伴侣，不自动附带家庭资产、兴趣资料或既有聊天。页面明确同意后，所选服务商接收问题以及后续阶段需要的发言；他们的存储和处理取决于各自条款。

## 运行与费用边界

选择 2–6 个型号。标准模式为独立观点、交叉质询、修订结论三个阶段，可选一个裁判，共 `3 × 参与数 + 是否裁判` 次调用（最多 19 次），每次最多 4,096 输出 tokens；深入模式为上述五阶段（最多 31 次），每次最多 8,192 总输出 tokens，可能包含推理。每人每个多伦多自然日最多新建三场，同时最多一场未结束；最多保存 100 场。输入上下文随阶段增长，未提供未经核实的美元报价。

同一阶段的模型看到同一份前阶段快照，不偷看同阶段先发言者。跨模型材料用观点编号匿名化，但发言本身仍可能透露模型身份。只保存可见答案和服务商返回的用量，不索要或持久化隐藏推理。发言向后续模型最多提供前 4,000 字，并标注摘录。成功开场不足两份时跳过后续付费步骤；失败与缺席不当作共识。

客户端一次请求仅推进一步。服务端数据库先原子认领，再调用模型，最后保存；多个标签不会认领同一步。不自动重试、不偷偷换模型、不依赖内存队列或后台 cron。隐藏/关闭页面不启动后续调用，已提交请求可能继续。恢复页面需明确点击继续；若提交后进程中断，从提交时刻起等待六分钟可明确跳过，不重新扣款请求。暂停和停止不声称能撤回服务商已接受的请求。删除无法撤销，且不清除限额记录。

## 配置

先在同一 Supabase 项目运行 `supabase/council.sql`，再部署。新增的是个人研究表与配额表，不涉及财富文档及已有业务表。RLS 只允许本人读取；直接客户端写入及执行认领函数均禁止。服务器在白名单认证后通过服务端密钥执行固定命令，并强制本人用户 ID。

服务端变量：

| 服务      | 变量                                                                 | 核对型号                                                              |
| --------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| OpenAI    | `OPENAI_API_KEY`                                                     | GPT-6 Luna / GPT-6 Astra                                              |
| Anthropic | `ANTHROPIC_API_KEY`                                                  | Claude Haiku 5.5 / Opus 5.5（日常旗舰） / Fable 5.1（深度推理，现役） |
| DeepSeek  | `DEEPSEEK_API_KEY`                                                   | DeepSeek V4.1 Flash / V4 Pro                                          |
| Qwen      | `QWEN_API_KEY`, `QWEN_BASE_URL`                                      | Qwen 3.8 Flash / Max                                                  |
| GLM       | 百炼共用 `QWEN_API_KEY` + `QWEN_BASE_URL`，或原厂 `ZAI_API_KEY`      | 百炼旗舰 `ZHIPU/GLM-5.3`；Flash 暂仅原厂                              |
| Moonshot  | 百炼共用 `QWEN_API_KEY` + `QWEN_BASE_URL`，或原厂 `MOONSHOT_API_KEY` | 百炼 `kimi-k3` / `kimi-k2.6`；K2.6 不是最新轻量型号                   |
| Gemini    | `GEMINI_API_KEY`                                                     | Gemini 3.5 Flash-Lite / Gemini 4 Argon                                |
| Meta      | `MODEL_API_KEY`                                                      | Muse Spark 1.3；未核实独立 Lite 型号                                  |

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

目录非动态更新：不能把供应商滚动别名等同固定版本、把凭证存在等同模型已实测。公开搜索仅在深入模式且用户单独确认检索词后开放；不自动执行任何真实财务操作。财务、法律、医疗和时效性信息需独立核验。

## 验证

核心、八种协议的模拟响应、认证/输入边界、防重复认领和失败恢复见 `tests/council*.test.ts`。`tests/council.sql` 使用合成研讨记录并整体回滚，检查 RLS、客户端写入拒绝、幂等创建、并发认领、暂停保存、停止和限额。浏览器交互测试使用隔离模拟，不发送真实问题至付费模型；不能据此声称八家服务均已激活。

## 图片与附件

- 浏览器本机处理；未开始的材料只在当前页面内存中，刷新会丢失。开始时才经认证接口保存到该用户的私密 `wealth_council_runs.document.attachments`。不创建公开对象、不发给额外 OCR 服务、不写家庭账本，也不自动读取任何本地文件。
- 每场最多 5 份材料、2 张图片；原文件各不超过 10 MB。JPEG / PNG / WebP 重编码成去元数据的 JPEG，最长边起始 1800 像素，每张不超过 150 KB；用户必须预览小字可读性。JSON 序列化附件最多 600 KB，API 请求整体最多 700 KB（流式有界读取）；为容纳追问，数据库单场上限扩至 4 MB，追问前预留所有新回答的最大空间，不足则在付费前拒绝。
- TXT / MD / CSV / TSV / JSON 要求 UTF-8；DOCX 仅解压大小不超过 2 MB 的 `word/document.xml`，不执行宏/链接；PDF.js 在本机 worker 中读取最多 30 页的文字和页码。所有文档合计最多 30,000 字，超长拒绝而非静默截断。扫描 PDF 无 OCR，文档图像、批注、复杂表格和排版不保证保留；改用清晰截图。原始 PDF / DOCX 不保存，不能将本功能当原件备份。
- PDF.js 的中文等 CMap 与标准字体在 `predev` / `prebuild` 从已安装依赖复制到版本化的自有静态目录；没有第三方 CDN，不向外部字体服务发送文件信息。生成目录被 Git 忽略，部署时自动生成。
- 每步的提示附带完整文字材料（非此前发言 4,000 字摘录限制）；图片以真实多模态内容块随每一步发送。当前仅开放已核实的 OpenAI Responses、Anthropic Messages、Gemini GenerateContent 和百炼 Qwen 路径；其他型号本页只接收文字材料。图片场景中任何参会者或裁判不兼容均在付费前拒绝，无隐藏 OCR 或跨服务替换。
- 文件名、文字与图片中的内容视为不可信证据，不服从其改变角色、泄露系统或调用工具的指令。提示要求引用文件名 / 页码，图像模糊时标注不确定。材料反复发送会增加输入用量，用户授权文案明确包含附件。
- 附件随个人研讨完整删除，不留孤立对象；导出 Markdown 包含文字及图片说明，不嵌入 base64，图片回到私密历史查看。历史摘要列表不返回附件内容。幂等创建同时核对附件与型号快照，同一编号不同材料返回冲突。

协议依据：[OpenAI 图像输入](https://developers.openai.com/api/docs/guides/images-vision)、[Claude Vision](https://platform.claude.com/docs/en/build-with-claude/vision)、[Gemini GenerateContent 图像](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding)、[Qwen 视觉理解](https://www.alibabacloud.com/help/en/model-studio/vision)。

## 持续追问与可靠性（v0.7.0）

轮次完成或明确结束后，可对同场已授权快照型号追问，另选裁判。v0.8.1 新追问默认 `mode=debate`：2–6 个模型各执行独立回应 → 交叉质询 → 修订结论，随后可选裁判；费用上界为 `3N + judge` 次。可显式选择 `mode=direct`，1–6 个模型各直接回应一次，费用上界为 `N + judge`。设置变化撤销旧费用确认；旧记录缺少 mode 或旧客户端未发送 mode 均按 direct，不能静默扩大费用同意。数据库原子构建对应阶段计划，不接收客户端自定义步骤。

`turnId` 与 `baseRound` 同时做幂等 / 乐观并发控制；相同编号但不同问题、型号、裁判、模式或研究设置拒绝，不同标签基于过期轮次也拒绝。每场最多 8 次、每人每个多伦多自然日最多 10 次；独立 `followups` 计数删除不重置，原每日 3 场限制不变。v0.8.1 标准模式全程最多 171 个计划步骤；v0.9.0 为深入模式扩至 279，并在付费前按本轮所有回答及工具回执预留存储空间；4 MB 容量可能先于轮次上限耗尽。原未提交步骤在结束后另开追问时标为未执行，不会误跑旧问题。原附件与渠道不重新选择、不自动新增供应商。先更新 `supabase/council.sql` 再部署新客户端。

追问读取原问题、此前用户补充、原轮修订 / 裁判与之前追问最终回应；旧轮没有最终结果时，退回该轮成功开场，保留来源阶段与缺失记录。研讨开场不偷看同轮先发言，交叉质询读取本轮全部成功开场，修订读取本轮开场与质询，裁判读取本轮各阶段；不泄漏后续问题或同阶段先发答案。每份发言最多 4,000 字，所有发言合计最多 48,000 字，优先最近结果，并标注摘录、省略和不完整，不伪装成完整历史；原附件仍提供。本轮不足两份完整开场，不调用后续交锋；没有完整最终回应时不再付费让裁判猜测。仅可回看和导出已保存内容，不修改旧轮次或真实账本。

Qwen 和百炼 GLM 使用 SSE，解析跨 chunk UTF-8、CRLF、多行事件、空 choices 用量尾帧与 `[DONE]`；仅存可见正文，不保存或显示隐藏推理。Qwen 旗舰开启思考并以 `thinking_budget=1024` 控制长度，轻量关闭；百炼 GLM 5.3 始终思考，显式 `enable_thinking=true`、`reasoning_effort=low`，不使用不适配该渠道的原厂关闭参数。接收总预算 240 秒，接口 `maxDuration=300`；已只读核对该 Vercel 项目启用了 Fluid compute。50 秒旧保护曾导致 Qwen 记录在约 50.4 秒被截断；GLM 历史为 HTTP 400，不把两者归为同一种网络故障。

页面用有界 NDJSON 读取等待 / 推理 / 正文状态和临时正文；10 秒心跳不触发额外模型调用。临时正文不算云端已保存，只有最后归档确认算完成。服务端途中断流若已有正文则保存 `usage.interrupted=true`，UI 标注不完整；空正文、超时、参数拒绝与解析错误分开显示。若保存失败或进程被终止，claim 保留，不自动重发；六分钟后才能明确跳过，长于模型超时和保存余量。

`check-model` 是独立的白名单、同源、限频操作，仅允许 Qwen 两档与 GLM 旗舰，必须明确费用同意；只发送固定公开合成问题，不传用户问题 / 附件 / 财富，不写研讨和配额。成功表示本次确实返回正文，不代表未来不会限流或断线。用于本轮有界真实验证，以及用户连接自检；不能把原只读目录检查偷偷升级成付费测试。

若某型号在同一轮已经收到明确的模型权限拒绝，后续该型号步骤跳过且不再次调用，其他模型继续。不会将临时超时误判成永久权限拒绝；修正权限后可通过新的明确追问重新选择该型号，原失败记录保留。控制台开通不等于当前生产 key 已获调用权限，需要核对新加坡地域、业务空间和 API key 的模型访问范围；若更换了 Vercel 凭证，还需重新部署使其生效。

结果速览与观点对照只展示已归档原文和执行状态；共识 / 分歧栏目来自裁判本人，不由字符串投票生成。未设裁判时保留并列结论，不提供伪造的共识百分比。模型可见 Markdown 在原有安全渲染器中显示，不执行 HTML、远程图片或操作指令。

依据：[百炼深度思考](https://www.alibabacloud.com/help/zh/model-studio/deep-thinking)、[百炼 GLM-ZHIPU](https://www.alibabacloud.com/help/en/model-studio/glm-zhipu)、[OpenAI 对话状态](https://developers.openai.com/api/docs/guides/conversation-state)、[Vercel 执行时限](https://vercel.com/docs/functions/configuring-functions/duration)。
