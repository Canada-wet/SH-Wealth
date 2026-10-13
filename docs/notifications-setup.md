# 通知与平台内顾问接入

核对日期：2026-10-13。当前 App 仅允许两位已验证成员；每位成员分别绑定自己的渠道。

## 最快启用：Telegram + Gmail SMTP

在 Vercel 的 SH-Wealth 项目中添加 Production 环境变量，保存后重新部署。凭证不要发到聊天、GitHub 或截图中。

### Telegram

1. 在 Telegram 的官方 `@BotFather` 创建一个**专用新 Bot**，记下 token 与 Bot 用户名。
2. 设置 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_BOT_USERNAME`（不带 `@`）。`TELEGRAM_WEBHOOK_SECRET` 和 `NOTIFICATION_ENCRYPTION_KEY` 由管理员生成，须保持稳定并私密备份。
3. 部署后登录 App → 通知 → 消息渠道 → 同意接收 Telegram 通知；如需要平台内对话，另外勾选只读顾问的外部处理与家庭共享同意。
4. 点击“连接 Telegram”：服务器检查 Bot 身份并自动注册带 secret-token 的回调。如果 Bot 已被其他网站使用，会拒绝覆盖，请改用专用 Bot。
5. 打开一次性链接，按 Telegram 的 Start 按钮；链接 15 分钟有效，不要转发。返回 App 检查“已绑定”，再发送测试。

只接受私人聊天，不把群组绑定为家庭空间。`/stop` 会取消该账号的通知与顾问授权。普通提问使用最新家庭快照，聊天同步到 App 历史，伴侣可回看；不会执行资产或收支变更。平台消息先持久化再后台处理，重复 webhook 不重复调用模型。模型失败会如实回复服务不可用。外部回复基于提问时的快照，不是银行实时行情。

官方参考：[Bot 深链](https://core.telegram.org/bots/features#deep-linking)、[Webhook secret-token](https://core.telegram.org/bots/api#setwebhook)。

### Email / Gmail SMTP

通知只发送至当前账号已验证的登录邮箱，不要求读取收件箱，也不允许用户填入第三方收件人。

无自有域名时，可用支持应用专用密码的 Gmail 账号作为发件人：

| 环境变量 | 配置 |
| --- | --- |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | 作为发件人的 Gmail 地址 |
| `SMTP_PASSWORD` | Google 应用专用密码，不是普通登录密码 |
| `EMAIL_FROM` | 可选；不填则使用 SMTP_USER |

Google 账号需具备应用密码资格，通常要求两步验证；某些组织、增强保护或其他安全设置可能不提供此选项，需按账号界面核实。不要用 App 登录密码当 SMTP 密码。代码强制 TLS（465 直连或 587 STARTTLS），不关闭证书校验，也不记录 SMTP 协议或凭证。

如果已有发信域名，也可以配置 `RESEND_API_KEY` + `EMAIL_FROM`；Resend 优先于 SMTP。发信身份、域名验证和服务配额由发信平台控制。

登录 → 通知 → 消息渠道 → 同意 Email 通知 → 启用 → 发送测试。“平台已接受”不等于收件箱已收到，还需自行核对垃圾邮件与发送记录。

官方参考：[Google 应用密码](https://support.google.com/accounts/answer/185833)、[Nodemailer SMTP/TLS](https://nodemailer.com/smtp)、[Resend 邮件 API](https://resend.com/docs/api-reference/emails/send-email)。

App 周报发信与 Supabase Authentication 的密码重置邮件是**独立配置**；这里不会修改现有登录或密码恢复设置。

## WhatsApp：通知与 AI 对话分开配置

不是扫描个人 WhatsApp 登录二维码。使用专用 WhatsApp Business Cloud API 号码，配置 `WHATSAPP_ACCESS_TOKEN`、`WHATSAPP_PHONE_NUMBER_ID`、`WHATSAPP_BUSINESS_NUMBER`（纯数字含国家码）、`WHATSAPP_APP_SECRET`、`WHATSAPP_WEBHOOK_VERIFY_TOKEN` 和当前账号支持的 `WHATSAPP_GRAPH_VERSION`。

Meta 回调地址为 `https://sh-wealth.vercel.app/api/notifications/whatsapp`，订阅消息事件。GET 验证 verify-token；POST 校验原始请求体的 SHA-256 HMAC。只接受已配置 phone-number-id 的文本消息，不处理其他号码的事件。

周报使用一个审核通过的**静态、零变量**通知模板，正文只说明“复盘已准备好，请登录私密 App 查看”，附固定 App 链接。配置 `WHATSAPP_TEMPLATE_NAME` 和 `WHATSAPP_TEMPLATE_LANGUAGE`；不要使用测试 hello_world 模板来冒充真实周报。不使用任意自由文本主动发送每周提醒。

App 生成 15 分钟一次性 `CONNECT` 链接；用户从自己的 WhatsApp 向 Business 号码发送连接码，服务器据此验证收件人。`STOP` 可取消连接。

`WHATSAPP_ALLOW_ADVISOR=0` 默认关闭平台内 AI 对话。Meta 的 AI 使用条款、适用地区与账号资格可能变化，管理员必须先核实当前政策，确认这一家庭财务应用的用途被允许，再设置为 `1`。即使启用，也只在用户发起的消息窗口内回复，保持只读；不要把这个开关当成 Meta 审批证明。

官方参考：[Meta 的模板消息 API](https://www.postman.com/meta/whatsapp-business-platform/request/o65u5m5/send-message-template-text)、[Meta webhook 签名校验](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/)、[现行 Business Solution 条款](https://www.whatsapp.com/legal/business-solution-terms)。

## 微信可行性评估

| 路线 | 本项目判断 | 前置条件 / 限制 |
| --- | --- | --- |
| 个人微信扫码托管、非官方机器人 | 不纳入私密财务 App | 本轮未确认可直接替代 Telegram Bot 的个人号官方接入方案；不托管个人登录态或读取聊天历史 |
| 微信公众号 | 有条件可行，尚未开发 | 公众号主体与接口权限、用户授权/关注、可用类目与模板、服务端凭证和 IP 白名单需核对 |
| 企业微信应用或官方智能机器人 | 可进一步评估，尚未开发 | 需适用组织、应用授权、可见成员或会话；不是自动连接个人微信的保证 |
| 微信小程序订阅通知 | 独立产品路线，本轮未实现 | 需小程序、用户订阅授权与对应类目/模板；不能当成任意定时推送 |

腾讯官方列出了公众号订阅通知、模板及客服消息 API，并要求事先接入公众平台、配置 IP 白名单。Vercel 部署需要另核对实际出网与白名单要求，可能需要固定出口或网关，不能仅填 AppSecret 就声称已接通。企业微信的应用消息路径与个人微信不同，是否能通过微信插件到达个人微信仍需按实际账号核实。

对于仅两位成员的应用，Telegram 和 Email 的接入更轻量；这是基于当前前置条件的工程判断，不是断言其他路线不可能。

官方参考：[腾讯公众号接口](https://cloud.tencent.cn/document/product/1301/100187)、[腾讯 CloudBase 企业微信消息示例](https://docs.cloudbase.net/en/workflow/tutorial/wecom/section-2)、[WeCom 官方 CLI 能力说明](https://github.com/WecomTeam/wecom-unified/blob/main/skills/wecom-unified/references/wecomcli-message.md)。部分微信原始开发文档本次无法直接抓取；具体主体资格、审核结果和额度仍需在账号后台验证。

## 数据与安全边界

执行 `supabase/channels.sql`。渠道配置在 Supabase 按家庭 + 用户保存，不混入财富 JSON 备份。接收地址 AES-256-GCM 加密，浏览器只得到遮蔽标签。不要随意更换加密 key，否则旧地址无法读取与匹配。

通知只含中性提示及需要登录的 App 链接，不含金额、附件或完整 AI 周报。平台内顾问必须另行明确同意，回复可能包含用户主动询问的财务信息；该平台将处理这些消息。退出 App 不会自动取消已绑定渠道，丢失平台账号时应在 App 断开。

按渠道 + 周报记录原子认领发送任务；平台明确拒绝可有限重试，发送结果不明确不自动重复。Email/Telegram/WhatsApp 的“已接受”状态不是实际用户阅读或设备投递证明。所有外部渠道共享 App 的顾问调用限流。
