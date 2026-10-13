"use client";
import { useCallback, useEffect, useState } from "react";
import { Mail, MessageCircle, Send, ExternalLink } from "lucide-react";
type Channel = "email" | "telegram" | "whatsapp";
type Connection = {
  id: string;
  channel: Channel;
  destination_label: string;
  enabled: boolean;
  advisor_enabled: boolean;
  last_status: "accepted" | "failed" | "uncertain" | null;
};
type Payload = {
  channels: Connection[];
  configuration: Record<Channel, { ready: boolean; reason: string }>;
  whatsappAdvisor: boolean;
};
const items = [
  {
    key: "email" as const,
    title: "Email",
    icon: Mail,
    intro: "发到当前账号已验证的登录邮箱，不读取收件箱。",
  },
  {
    key: "telegram" as const,
    title: "Telegram",
    icon: Send,
    intro: "打开 Bot 并发送一次性连接码；支持私聊内的只读顾问。",
  },
  {
    key: "whatsapp" as const,
    title: "WhatsApp",
    icon: MessageCircle,
    intro: "连接 Business 号码；周报使用平台审核通过的模板。",
  },
];
export default function ChannelSettings({
  householdId,
  proactive,
}: {
  householdId: string;
  proactive: boolean;
}) {
  const [data, setData] = useState<Payload | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<Channel | null>(null),
    [loading, setLoading] = useState(true);
  const [consent, setConsent] = useState<Partial<Record<Channel, boolean>>>({}),
    [advisor, setAdvisor] = useState<Partial<Record<Channel, boolean>>>({});
  const [pending, setPending] = useState<{
    channel: Channel;
    url: string;
    expiresAt: string;
  } | null>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!householdId) {
        setLoading(false);
        return;
      }
      try {
        const response = await fetch(
          `/api/notifications/channels?householdId=${encodeURIComponent(householdId)}`,
          { signal, cache: "no-store" },
        );
        const next = await response.json();
        if (!response.ok) throw new Error(next.error || "渠道状态无法读取。");
        setData(next);
        setError("");
      } catch (reason) {
        if (!(reason instanceof Error && reason.name === "AbortError"))
          setError(
            reason instanceof Error ? reason.message : "渠道状态无法读取。",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [householdId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    if (!pending) return;
    if (
      data?.channels.some(
        (row) => row.channel === pending.channel && row.enabled,
      )
    ) {
      setPending(null);
      setNotice("平台验证已完成。连接状态已保存，可发送测试确认收信。");
      return;
    }
    const timer = setInterval(() => {
      if (Date.now() > Date.parse(pending.expiresAt)) {
        setPending(null);
        setNotice("连接链接已过期，请重新生成。");
      } else if (!document.hidden) void load();
    }, 4000);
    return () => clearInterval(timer);
  }, [pending, data, load]);
  const run = async (
    channel: Channel,
    action: "connect" | "disconnect" | "test",
  ) => {
    setBusy(channel);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/notifications/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          householdId,
          channel,
          action,
          consent: consent[channel] === true,
          advisor: action === "connect" && advisor[channel] === true,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "操作未完成。");
      setNotice(result.message);
      if (result.url)
        setPending({ channel, url: result.url, expiresAt: result.expiresAt });
      else {
        if (pending?.channel === channel) setPending(null);
        await load();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败。");
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="channel-settings" aria-label="消息渠道连接">
      <div className="channel-heading">
        <div>
          <h3>连接你的消息渠道</h3>
          <p>
            每位成员分别绑定自己的账号。通知不包含财务金额；仅主动开启对话后，顾问回复才会进入外部平台。
          </p>
        </div>
      </div>
      {!householdId && (
        <p className="form-help">请等待家庭空间连接完成后再绑定。</p>
      )}
      {!proactive && (
        <p className="channel-note">
          家庭主动复盘当前已关闭。绑定会保留，但不会发送周报；已授权的手动顾问对话仍可使用。
        </p>
      )}
      {loading && <p>正在读取渠道状态…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="channel-note" role="status">
          {notice}
        </p>
      )}
      {items.map(({ key, title, icon: Icon, intro }) => {
        const row = data?.channels.find((entry) => entry.channel === key),
          config = data?.configuration[key];
        const available =
          key === "telegram" || (key === "whatsapp" && data?.whatsappAdvisor);
        return (
          <article className="channel-card" key={key}>
            <div className="channel-card-head">
              <Icon size={19} />
              <b>{title}</b>
              <span className={row?.enabled ? "connected" : ""}>
                {row?.enabled ? "已绑定" : config?.ready ? "未连接" : "待配置"}
              </span>
            </div>
            <p>{intro}</p>
            {!config?.ready && (
              <details className="channel-setup">
                <summary>管理员接入步骤</summary>
                {key === "telegram" ? (
                  <p>
                    在官方 @BotFather 创建专用 Bot；在 Vercel 设置
                    TELEGRAM_BOT_TOKEN 和 TELEGRAM_BOT_USERNAME（不带
                    @），重新部署后即可绑定。App
                    会自动检查和注册回调，不覆盖其他网站的 Bot。
                  </p>
                ) : key === "email" ? (
                  <p>
                    可配置 Gmail
                    SMTP：SMTP_HOST=smtp.gmail.com、SMTP_PORT=465、SMTP_USER=发件邮箱、SMTP_PASSWORD=Google
                    应用专用密码；或使用 RESEND_API_KEY 和已验证
                    EMAIL_FROM。不要使用普通登录密码。仅管理员配置发信服务，成员各自启用登录邮箱的收信订阅。
                  </p>
                ) : (
                  <p>
                    需要 WhatsApp Business
                    号码、服务凭证、签名回调和审核模板。AI 对话还需核实当前 Meta
                    政策，不能用个人号二维码代替。
                  </p>
                )}
                <a
                  href="https://vercel.com/henrywhy233-8756s-projects/sh-wealth/settings/environment-variables"
                  target="_blank"
                  rel="noreferrer"
                >
                  在 Vercel 安全配置服务凭证 ↗
                </a>
              </details>
            )}
            {row?.enabled ? (
              <>
                <p className="channel-recipient">
                  {row.destination_label} ·{" "}
                  {row.advisor_enabled ? "通知＋只读顾问" : "仅通知"}
                </p>
                {!config?.ready && (
                  <small>绑定保留，但发送服务暂停：{config?.reason}</small>
                )}
                {row.last_status && (
                  <small>
                    {row.last_status === "accepted"
                      ? "最近发送：平台已接受，收信请在对应平台确认。"
                      : row.last_status === "uncertain"
                        ? "最近发送：结果无法确认，请勿立即重复发送。"
                        : "最近发送失败，请检查服务配置。"}
                  </small>
                )}
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy !== null || !config?.ready}
                    onClick={() => void run(key, "test")}
                  >
                    测试{title}通知
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy !== null}
                    onClick={() => void run(key, "disconnect")}
                  >
                    断开{title}
                  </button>
                </div>
              </>
            ) : (
              <>
                {!config?.ready && (
                  <small>
                    {config?.reason || "请先由管理员完成服务配置。"}
                  </small>
                )}
                <label className="channel-consent">
                  <input
                    type="checkbox"
                    disabled={!config?.ready || busy !== null}
                    checked={consent[key] === true}
                    onChange={(event) =>
                      setConsent({ ...consent, [key]: event.target.checked })
                    }
                  />
                  <span>同意接收{title}通知，可随时取消。</span>
                </label>
                {available && (
                  <label className="channel-consent">
                    <input
                      type="checkbox"
                      disabled={!config?.ready || busy !== null}
                      checked={advisor[key] === true}
                      onChange={(event) =>
                        setAdvisor({ ...advisor, [key]: event.target.checked })
                      }
                    />
                    <span>
                      另开启平台内只读顾问。理解提问与财务解读会由该平台处理，聊天同步回家庭
                      App，伴侣可回看。
                    </span>
                  </label>
                )}
                {key === "whatsapp" && !data?.whatsappAdvisor && (
                  <small>
                    平台内 AI 对话尚未启用：管理员需先核实 Meta 政策和账号资格。
                  </small>
                )}
                <button
                  type="button"
                  className="secondary"
                  disabled={busy !== null || !config?.ready || !consent[key]}
                  onClick={() => void run(key, "connect")}
                >
                  {key === "email" ? "启用Email通知" : `连接${title}`}
                </button>
              </>
            )}
            {pending?.channel === key && (
              <div className="channel-link">
                <a
                  href={pending.url}
                  target="_blank"
                  rel="noreferrer"
                  className="primary"
                >
                  打开{title}完成验证 <ExternalLink size={13} />
                </a>
                <small>
                  15 分钟内有效，请勿分享链接。返回此页面自动检查绑定状态。
                </small>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void load()}
                >
                  检查连接状态
                </button>
              </div>
            )}
          </article>
        );
      })}
      <details className="wechat-feasibility">
        <summary>微信可行性 · 尚未接入</summary>
        <p>
          个人微信不是 Telegram Bot
          的直接替代：目前不提供非官方扫码登录或常驻个人号机器人。可进一步评估企业微信应用
          /
          官方智能机器人，或公众号的订阅通知、客服消息；需核对主体资格、用户授权、类目权限及服务器网络
          / IP 要求。
        </p>
        <p>
          对于仅两位成员使用的 App，先用 Telegram / Email
          更轻量。微信接入需要先确定你们是否有可用的企业微信或公众号账号，当前不会显示为“已连接”。
        </p>
        <a
          href="https://cloud.tencent.cn/document/product/1301/100187"
          target="_blank"
          rel="noreferrer"
        >
          腾讯官方公众号接口说明 ↗
        </a>
        <a
          href="https://docs.cloudbase.net/en/workflow/tutorial/wecom/section-2"
          target="_blank"
          rel="noreferrer"
        >
          企业微信应用消息说明 ↗
        </a>
      </details>
    </section>
  );
}
