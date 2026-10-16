"use client";
import { useEffect, useRef, useState } from "react";
import { Archive, RefreshCw } from "lucide-react";
import AdvisorMarkdown from "./AdvisorMarkdown";
import {
  researchDisplayText,
  validResearchArchive,
  type ResearchArchive,
} from "@/lib/research-archive";
export default function MarketResearchArchive({
  household,
}: {
  household: string;
}) {
  const [reports, setReports] = useState<ResearchArchive[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const loadedHousehold = useRef("");
  useEffect(() => {
    loadedHousehold.current = "";
    setReports([]);
    setSelected("");
    setError("");
    if (!household) {
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let active = true;
    setBusy(true);
    void (async () => {
      try {
        const r = await fetch(
          `/api/market/research-archive?household=${encodeURIComponent(household)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!r.ok)
          throw Error(
            r.status === 401
              ? "请重新登录后读取研究归档。"
              : "研究归档读取失败，请重试。",
          );
        const body = await r.json();
        if (
          !Array.isArray(body.reports) ||
          !body.reports.every(validResearchArchive)
        )
          throw Error("研究归档格式异常。");
        if (active) {
          loadedHousehold.current = household;
          setReports(body.reports);
        }
      } catch (e) {
        if (active)
          setError(
            controller.signal.aborted
              ? "研究归档读取超时，请重试。"
              : e instanceof Error
                ? e.message
                : "读取失败。",
          );
      } finally {
        clearTimeout(timer);
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [household, refresh]);
  const rows = loadedHousehold.current === household ? reports : [];
  const report = rows.find((r) => r.id === selected) ?? rows[0];
  const time = (at: string) =>
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: "America/Toronto",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(at));
  return (
    <section
      className="card market-section research-archive"
      id="research-archive"
      aria-label="外部研究归档"
    >
      <div className="card-head">
        <div>
          <p className="eyebrow">PRIVATE RESEARCH · SOURCE PRESERVED</p>
          <h2>
            <Archive size={18} aria-hidden="true" /> 外部研究归档
          </h2>
          <p>保留原文、来源和采集时间，供两位家庭成员回看。</p>
        </div>
        <button
          className="secondary"
          disabled={busy || !household}
          onClick={() => setRefresh((n) => n + 1)}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {busy ? "读取归档中…" : "刷新研究归档"}
        </button>
      </div>
      <p className="market-notice">
        Funda 单次交互测试 · 未启用每日自动采集。AI
        研究未经独立核验，不写入官方行情曲线，也不修改家庭资产。
      </p>
      {!household && <p>连接共同家庭后可查看私密研究归档。</p>}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {household && !busy && !error && !report && (
        <p>尚无已保存的外部研究；不会以示例数据填充。</p>
      )}
      {report && (
        <>
          <label className="research-archive-select">
            历史记录（最近 90 则）
            <select
              aria-label="选择外部研究归档"
              value={report.id}
              onChange={(e) => setSelected(e.target.value)}
            >
              {rows.map((r) => (
                <option key={r.id} value={r.id}>
                  {time(r.captured_at)} · Funda ·{" "}
                  {r.status === "partial" ? "部分完成" : "回答完成"}
                </option>
              ))}
            </select>
          </label>
          <p>
            采集时间 {time(report.captured_at)}
            （多伦多）；不等于行情观察时间，具体日期以原文为准。
          </p>
          <details>
            <summary>查看研究原文与来源</summary>
            <a
              href={report.source_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              在 Funda 查看本次独立对话 ↗
            </a>
            <details>
              <summary>查看提问</summary>
              <p>{report.prompt}</p>
            </details>
            <AdvisorMarkdown text={researchDisplayText(report.response)} />
            <h3>回答中引用的链接（未逐条核验）</h3>
            {report.citations.length ? (
              <ul>
                {report.citations.map((c, i) => (
                  <li key={`${c.url}-${i}`}>
                    <a href={c.url} target="_blank" rel="noopener noreferrer">
                      {c.title || c.url} ↗
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p>本次未取得可保存的引用链接。</p>
            )}
          </details>
        </>
      )}
    </section>
  );
}
