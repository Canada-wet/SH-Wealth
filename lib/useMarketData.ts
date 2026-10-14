"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MARKET_CACHE_KEY,
  validMarketData,
  mergeMarketData,
} from "./market-state";
import type { MarketData } from "./market";
export default function useMarketData() {
  const [data, setData] = useState<MarketData | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [cached, setCached] = useState(false),
    [needsLogin, setNeedsLogin] = useState(false);
  const current = useRef<AbortController | null>(null);
  const latest = useRef<MarketData | null>(null);
  const refresh = useCallback(async () => {
    if (current.current && !current.current.signal.aborted) return;
    const controller = new AbortController();
    current.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 25000);
    setBusy(true);
    setError("");
    setNeedsLogin(false);
    try {
      const response = await fetch("/api/market", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        if (current.current === controller) {
          setNeedsLogin(true);
          throw new Error("登录已失效或没有访问权限，请重新登录后重试。");
        }
        return;
      }
      if (!response.ok)
        throw new Error("官方数据暂时无法读取，请重试；已有快照不会被清空。");
      const result: unknown = await response.json();
      if (!validMarketData(result))
        throw new Error("数据格式不完整，请稍后重试。");
      if (current.current !== controller || controller.signal.aborted) return;
      const next = mergeMarketData(latest.current, result);
      latest.current = next;
      setData(next);
      setCached(false);
      try {
        localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify(next));
      } catch {}
    } catch (reason) {
      if (
        current.current === controller &&
        (timedOut || !controller.signal.aborted)
      )
        setError(
          timedOut
            ? "读取超时，请检查网络后重试。"
            : reason instanceof Error
              ? reason.message
              : "读取失败，请重试。",
        );
    } finally {
      clearTimeout(timer);
      if (current.current === controller) {
        current.current = null;
        setBusy(false);
      }
    }
  }, []);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(MARKET_CACHE_KEY);
      if (raw) {
        const saved: unknown = JSON.parse(raw);
        if (validMarketData(saved)) {
          setData(saved);
          latest.current = saved;
          setCached(true);
        }
      }
    } catch {}
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 300000);
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      current.current?.abort();
      current.current = null;
    };
  }, [refresh]);
  return { data, busy, error, cached, needsLogin, refresh };
}
