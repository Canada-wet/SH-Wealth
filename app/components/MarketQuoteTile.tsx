"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  instrumentKey,
  pulseWidgetUrl,
  type MarketInstrument,
} from "@/lib/market";
import { instrumentFallback } from "@/lib/market-state";
import { RefreshCw, ExternalLink } from "lucide-react";
export default function MarketQuoteTile({
  row,
  ready,
  onSelect,
  enabled = true,
}: {
  row: MarketInstrument;
  ready: boolean;
  onSelect: (row: MarketInstrument) => void;
  enabled?: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const tile = useRef<HTMLElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [near, setNear] = useState(false);
  const [height, setHeight] = useState(90);
  const [status, setStatus] = useState<
    "waiting" | "ready" | "unavailable" | "slow"
  >("waiting");
  const src = pulseWidgetUrl(row);
  const missing = row.exchange === "TSX" && row.ticker === "ZGIN";
  useLayoutEffect(() => {
    if (!enabled) {
      setNear(false);
      return;
    }
    if (missing) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) setNear(entry.isIntersecting);
      },
      { rootMargin: "160px 0px" },
    );
    if (tile.current) observer.observe(tile.current);
    return () => observer.disconnect();
  }, [src, missing, enabled]);
  // A cached frame may signal readiness before deferred effects run.
  useLayoutEffect(() => {
    setStatus("waiting");
    if (!near || missing || !enabled) return;
    const timer = setTimeout(
      () => setStatus((current) => (current === "waiting" ? "slow" : current)),
      15000,
    );
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== "https://www.tradingview-widget.com" ||
        event.source !== frame.current?.contentWindow
      )
        return;
      if (event.data?.name === "tv-widget-ready")
        setStatus((current) => (current === "unavailable" ? current : "ready"));
      if (event.data?.name === "tv-widget-no-data") setStatus("unavailable");
      const nextHeight = event.data?.data?.height;
      if (
        event.data?.name === "tv-widget-resize-iframe" &&
        typeof nextHeight === "number" &&
        Number.isFinite(nextHeight) &&
        nextHeight >= 60 &&
        nextHeight <= 180
      )
        setHeight(Math.ceil(nextHeight));
    };
    window.addEventListener("message", receive);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
    };
  }, [src, attempt, near, missing, enabled]);
  useEffect(() => {
    if (!near || missing || !enabled) return;
    let scheduled = 0;
    const reconnect = () => {
      cancelAnimationFrame(scheduled);
      scheduled = requestAnimationFrame(() => setAttempt((value) => value + 1));
    };
    const foreground = () => {
      if (!document.hidden) reconnect();
    };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) reconnect();
    };
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("pageshow", restored);
    window.addEventListener("online", reconnect);
    return () => {
      cancelAnimationFrame(scheduled);
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("pageshow", restored);
      window.removeEventListener("online", reconnect);
    };
  }, [near, missing, enabled]);
  return (
    <article
      ref={tile}
      className="market-quote-tile"
      aria-label={`${instrumentKey(row)}涨跌`}
      data-state={
        !enabled
          ? "paused"
          : missing
            ? "unavailable"
            : near
              ? status
              : "deferred"
      }
    >
      <button
        className="market-quote-heading"
        disabled={!ready}
        onClick={() => onSelect(row)}
        aria-label={`速览打开${instrumentKey(row)}图表`}
      >
        <b>{row.ticker}</b>
        <small>
          {row.exchange} · {row.exchange === "TSX" ? "CAD" : "USD"} ↓
        </small>
      </button>
      {!enabled ? (
        <div className="market-quote-missing">
          <b>—</b>
          <span>当前设备未开启行情，请点击上方开启按钮。</span>
        </div>
      ) : missing ? (
        <div className="market-quote-missing">
          <b>—</b>
          <span>当前源暂无覆盖，不表示零涨跌。</span>
        </div>
      ) : (
        <iframe
          key={attempt}
          ref={frame}
          src={near ? src : undefined}
          data-src={src}
          title={`当前涨跌${instrumentKey(row)}`}
          height={height}
          loading="eager"
          onError={() => setStatus("slow")}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      )}
      {enabled && !missing && status !== "ready" && (
        <small
          className="market-quote-status"
          role={
            status === "unavailable" || status === "slow" ? "status" : undefined
          }
        >
          {!near
            ? "进入可视区域后连接行情"
            : status === "unavailable"
              ? "暂无报价，请核对来源"
              : status === "slow"
                ? "连接超时或被浏览器拦截，请重试或打开来源。"
                : "正在连接行情…"}
        </small>
      )}
      <div className="market-quote-footer">
        <a
          href={instrumentFallback(row)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={
            missing
              ? "查看官方价格与净值 ↗"
              : `核对${instrumentKey(row)}行情来源`
          }
        >
          <ExternalLink size={12} aria-hidden="true" />
          {missing ? "官方价格与净值" : "来源 · 空白时直接查看"}
        </a>
        {enabled && !missing && (
          <button
            className="text-button"
            onClick={() => {
              setNear(true);
              setHeight(90);
              setAttempt((value) => value + 1);
            }}
            aria-label={`重试涨跌${instrumentKey(row)}`}
          >
            <RefreshCw size={12} aria-hidden="true" />
            重新连接
          </button>
        )}
      </div>
    </article>
  );
}
