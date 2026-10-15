"use client";
import { useEffect, useRef, useState } from "react";
import {
  instrumentKey,
  pulseWidgetUrl,
  type MarketInstrument,
} from "@/lib/market";
import { instrumentFallback } from "@/lib/market-state";
export default function MarketQuoteTile({
  row,
  ready,
  onSelect,
}: {
  row: MarketInstrument;
  ready: boolean;
  onSelect: (row: MarketInstrument) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState("waiting");
  const src = pulseWidgetUrl(row);
  useEffect(() => {
    setStatus("waiting");
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== "https://www.tradingview-widget.com" ||
        event.source !== frame.current?.contentWindow
      )
        return;
      if (event.data?.name === "tv-widget-ready")
        setStatus((current) => (current === "unavailable" ? current : "ready"));
      if (event.data?.name === "tv-widget-no-data") setStatus("unavailable");
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [src, attempt]);
  const missing = row.exchange === "TSX" && row.ticker === "ZGIN";
  return (
    <article
      className="market-quote-tile"
      aria-label={`${instrumentKey(row)}涨跌`}
      data-state={missing ? "unavailable" : status}
    >
      <button
        className="market-quote-heading"
        disabled={!ready}
        onClick={() => onSelect(row)}
        aria-label={`速览打开${instrumentKey(row)}图表`}
      >
        <b>{row.ticker}</b>
        <small>
          {row.exchange} · {row.exchange === "TSX" ? "CAD" : "USD"} ↗
        </small>
      </button>
      {missing ? (
        <div className="market-quote-missing">
          <b>—</b>
          <span>当前源暂无覆盖，不表示零涨跌。</span>
        </div>
      ) : (
        <iframe
          key={attempt}
          ref={frame}
          src={src}
          title={`当前涨跌${instrumentKey(row)}`}
          height={90}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      )}
      {!missing && (
        <small className="market-quote-status" role="status">
          {status === "ready"
            ? "组件已就绪 · 报价以卡片内为准"
            : status === "unavailable"
              ? "暂无报价，请核对来源"
              : "等待报价组件，空白时可重试"}
        </small>
      )}
      <div className="market-quote-footer">
        <a
          href={instrumentFallback(row)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {missing ? "查看官方价格与净值 ↗" : "来源 / 核对 ↗"}
        </a>
        {!missing && (
          <button
            className="text-button"
            onClick={() => setAttempt((value) => value + 1)}
            aria-label={`重试涨跌${instrumentKey(row)}`}
          >
            空白？重试
          </button>
        )}
      </div>
    </article>
  );
}
