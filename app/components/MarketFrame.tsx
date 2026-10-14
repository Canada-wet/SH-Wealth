"use client";
import { useEffect, useState } from "react";
export default function MarketFrame({
  title,
  src,
  height,
  fallback,
}: {
  title: string;
  src: string;
  height: number;
  fallback: string;
}) {
  const [attempt, setAttempt] = useState(0),
    [status, setStatus] = useState<"loading" | "loaded" | "slow">("loading");
  useEffect(() => {
    setStatus("loading");
    const timer = setTimeout(
      () => setStatus((value) => (value === "loading" ? "slow" : value)),
      12000,
    );
    return () => clearTimeout(timer);
  }, [src, attempt]);
  return (
    <div className="market-frame">
      <div className="market-frame-tools">
        <span role="status">
          {status === "loading"
            ? "正在载入行情窗口…"
            : status === "slow"
              ? "窗口未能及时载入，可重试或在提供商页面查看。"
              : "窗口文档已载入，报价是否可用以窗口内状态为准。"}
        </span>
        <button
          className="text-button"
          onClick={() => {
            setStatus("loading");
            setAttempt((value) => value + 1);
          }}
          aria-label={`重试${title}`}
        >
          重新载入
        </button>
        <a href={fallback} target="_blank" rel="noopener noreferrer">
          在提供商查看 ↗
        </a>
      </div>
      <iframe
        key={`${src}-${attempt}`}
        title={title}
        src={src}
        height={height}
        loading="eager"
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("slow")}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
      <small>
        行情由{" "}
        <a
          href="https://www.tradingview.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          TradingView
        </a>{" "}
        提供。跨域安全限制不允许本站读取窗口内的报价或错误；出现空白、权限提示或代码不支持时，请使用上方替代入口。
      </small>
    </div>
  );
}
