# Together Wealth

伴侣共同维护的家庭财富工作台：资产与负债、成员贡献、每月现金流、目标与规划、完整历史，以及可修改数据的浮动财富顾问。

## 运行与验证

```bash
npm install
npm run dev
npm test
npm run build
```

浏览器交互测试使用独立的生产构建，不会污染开发缓存：

```bash
npx playwright install chromium
NEXT_DIST_DIR=.next-test npm run build
npm run test:e2e
```

开发缓存在 `.next-dev`，生产缓存在 `.next`，测试缓存在 `.next-test`。修改环境变量或 `next.config.ts` 后需要重启开发服务。

## 数据保存与共享

数据统一保存在 `together-wealth-v3`，包含数值资产、可空本年回报、负债、贡献、现金流、成员、目标、规划、每次财务变动的完整快照、对话和模型偏好。写入成功后界面才显示已保存；浏览器容量不足或数据损坏会明确报错。上一版本保存为恢复备份，支持完整 JSON 导入导出。旧版本的存储自动迁移，删空的账户不会重新生成示例数据。旧版缺少准确日期的历史仍可查看与导出，不生成虚构时间戳。

本机保存只能保证同一浏览器内刷新与重开后的恢复。夫妻跨设备共享需要在“数据与同步”登录并连接同一个 Supabase 家庭空间。

Supabase 配置：

1. 将 `.env.example` 的配置放入 `.env.local` 或 `.env`。这些文件已加入 Git 忽略规则。
2. 在 SQL Editor 执行 `supabase/persistence.sql`，以及 `supabase/push.sql`。已有旧表可直接执行新增脚本；新项目还需先运行 `supabase/schema.sql`。
3. 页面内注册或登录，创建家庭并上传本机数据；分享邀请代码给伴侣，伴侣加入后加载云端数据。启用邮件确认的项目需要先确认注册邮件。
4. 后续保存自动同步；重新打开恢复已登录的家庭连接。实时事件、窗口恢复可见和轮询一起同步伴侣的更新。

云端写入通过带版本校验的 RPC 执行。两个设备同时修改时会拒绝旧版本覆盖，而不是静默丢失数据。RLS 限制家庭数据读取；邀请代码只向家庭创建者展示。云端保留完整文档修改历史。

## 统一的计算规则

- 净资产 = 总资产 − 总负债；主目标进度使用净资产。
- 类别与成员持有占比都按实际账户金额 / 总资产计算；自定义类别会单独显示。
- 贡献按真实投入与取出记录。关联账户的投入增加估值，取出减少估值；编辑只应用差额，删除撤回对应变动。独立历史出资不改变已录入估值，避免重复计入。
- 贡献占比使用累计投入金额；净贡献另外显示，和资产持有归属分开。
- 现金流使用每月税后收入与开支；必要开支自动用于应急金目标。现金资产同步到规划的当前应急金参考值。
- 本年回报为用户记录的百分比，可以是负数、零或留空，不自动推算回报，也不改变账户估值。

## 财富顾问

支持 OpenAI 快速 / 均衡 / 深度、Anthropic 快速 / 深度、DeepSeek 快速 / 深度。自动路由按问题复杂度和已配置的 provider 选择；模型 ID 可通过环境变量替换。模型和路由原因显示在回复中。

顾问读取当前资产、负债、贡献、现金流、成员、目标、规划及近期对话；明确的数据修改请求通过校验后一次性保存。支持资产回报、负债、贡献、现金流、目标与规划修改；项目重名、数据过期或无效金额会拒绝执行。假设题与分析问题不执行数据变更。

没有配置外部模型时使用明确标注的本地数据助手，可查询数据及执行基础账户修改。外部模型失败不会显示伪造的成功；聊天内容和模型偏好会保存。

当前模型配置参考：[OpenAI](https://developers.openai.com/api/docs/guides/latest-model)、[Anthropic](https://platform.claude.com/docs/en/models/overview)、[DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/)。

## 主动提醒与 Web Push

站内提醒从真实数据生成：待录入资产、估值过期、应急金差额、负债复盘和目标完成。每周 Vercel Cron 从同一份云端家庭文档生成财富回顾并保存为站内提醒。

页面关闭后的浏览器推送需要 HTTPS、用户主动启用通知，以及 `NEXT_PUBLIC_VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT` 和 `CRON_SECRET`。在通知中心启用，登录并连接家庭后订阅；可随时关闭。发送成功的订阅按周去重，临时失败可重试，过期订阅会清理。本机配置不能自动同步到 Vercel，部署时须将这些环境变量填写到对应项目。

`/api/advisor/digest` 只接受 `Authorization: Bearer <CRON_SECRET>`；未配置密钥时拒绝执行。服务端密钥和 VAPID 私钥不进入浏览器。

## 真实外部集成测试

默认 `npm test` 不调用付费模型或外部数据库。显式运行：

```bash
npm run test:cloud
npm run test:ai
npm run test:e2e:cloud
```

`test:cloud` 与 `test:e2e:cloud` 创建临时测试账号和家庭，验证共享、持久化、RLS 隔离、版本冲突以及浏览器间同步，结束后清理测试数据，不发送注册邮件。`test:ai` 使用已配置的 OpenAI key 发起一次合成数据的模型请求，会产生少量 API 费用。Anthropic / DeepSeek 的适配器通过 mock 测试；真实调用还需要对应 key。

## GitHub 与 Vercel

将仓库导入 Vercel，Framework 选择 Next.js，添加 `.env.example` 所需变量。首次部署完成后使用两个账户验证共享并各自启用浏览器通知。`vercel.json` 定义每周一 13:00 UTC 的财富回顾。

`.env*`、开发与测试缓存、测试截图和浏览器报告不会进入 Git。请勿将服务端密钥填入 `NEXT_PUBLIC_*` 变量。
