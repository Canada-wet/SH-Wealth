"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, X } from "lucide-react";
import {
  securityQuery,
  validateSecuritySearch,
  type Security,
} from "@/lib/security-search";
import { symbolIdentity } from "@/lib/backtest-schema";

export default function SecurityPicker({
  value,
  label,
  excluded,
  disabled,
  onSelect,
}: {
  value: string;
  label: string;
  excluded: string[];
  disabled?: boolean;
  onSelect: (security: Security) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(value),
    [options, setOptions] = useState<Security[]>([]),
    [active, setActive] = useState(-1),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [cancelNotice, setCancelNotice] = useState(""),
    [selected, setSelected] = useState<Security | null>(null),
    [revision, setRevision] = useState(0);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null),
    root = useRef<HTMLDivElement>(null),
    popup = useRef<HTMLDivElement>(null),
    sequence = useRef(0),
    composing = useRef(false),
    suppressFocus = useRef(false),
    pointerInside = useRef(false);
  const id = useId(),
    listId = `${id}-list`,
    statusId = `${id}-status`;
  const used = (s: Security) =>
    excluded.some((x) => symbolIdentity(x) === symbolIdentity(s.symbol));
  const close = () => {
    if (
      open &&
      query.trim() &&
      query.trim().toUpperCase() !== value.toUpperCase()
    )
      setCancelNotice(
        `未选择${query.trim().slice(0, 48)}，当前仍保留 ${value}。`,
      );
    sequence.current++;
    setOpen(false);
    setQuery(value);
  };
  const choose = (s: Security) => {
    if (disabled || used(s) || !options.includes(s)) return;
    sequence.current++;
    setSelected(s);
    setCancelNotice("");
    setOpen(false);
    setQuery(s.symbol);
    onSelect(s);
  };
  useEffect(() => {
    setQuery(value);
    setSelected((s) =>
      s && symbolIdentity(s.symbol) === symbolIdentity(value) ? s : null,
    );
  }, [value]);
  useEffect(() => {
    if (disabled) close();
  }, [disabled]);
  useEffect(() => {
    if (!open || disabled) return;
    const place = () => {
      if (!input.current) return;
      const r = input.current.getBoundingClientRect(),
        viewport = window.visualViewport,
        left = viewport?.offsetLeft ?? 0,
        top = viewport?.offsetTop ?? 0,
        viewWidth = viewport?.width ?? window.innerWidth,
        viewHeight = viewport?.height ?? window.innerHeight,
        width = Math.min(Math.max(350, r.width), viewWidth - 24),
        below = top + viewHeight - r.bottom - 12,
        above = r.top - top - 12;
      const height = Math.min(370, Math.max(below, above));
      setPosition({
        left: Math.max(
          left + 12,
          Math.min(r.left, left + viewWidth - width - 12),
        ),
        top:
          below >= 200 || below >= above
            ? r.bottom + 5
            : Math.max(top + 12, r.top - height - 5),
        width,
        maxHeight: Math.max(120, height),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    const outside = (e: PointerEvent) => {
      if (
        !root.current?.contains(e.target as Node) &&
        !popup.current?.contains(e.target as Node)
      ) {
        pointerInside.current = false;
        close();
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open, disabled, value]);
  useEffect(() => {
    const n = ++sequence.current;
    setOptions([]);
    setActive(-1);
    setError("");
    setLoading(false);
    if (!open || disabled || !query.trim()) return;
    let term: string;
    try {
      term = securityQuery(query);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(async () => {
      timeout = setTimeout(() => controller.abort(), 22000);
      try {
        const r = await fetch(
          `/api/backtest/securities?q=${encodeURIComponent(term)}`,
          { signal: controller.signal },
        );
        const body = await r.json().catch(() => null);
        if (!r.ok)
          throw Error(
            typeof body?.error === "string"
              ? body.error.slice(0, 300)
              : "证券搜索暂不可用，原持仓未改变。",
          );
        validateSecuritySearch(body, term);
        if (n === sequence.current) {
          setOptions(body.options);
          const exact = body.options
            .map((s, i) => ({ s, i }))
            .filter(
              ({ s }) =>
                !used(s) &&
                (s.symbol === term.toUpperCase() ||
                  s.symbol.slice(0, -3) === term.toUpperCase()),
            );
          setActive(exact.length === 1 ? exact[0].i : -1);
        }
      } catch (e) {
        if (n === sequence.current)
          setError(
            controller.signal.aborted
              ? "搜索超时，未自动重试；原持仓未改变。"
              : (e as Error).message,
          );
      } finally {
        if (timeout) clearTimeout(timeout);
        if (n === sequence.current) setLoading(false);
      }
    }, 550);
    return () => {
      sequence.current++;
      clearTimeout(timer);
      if (timeout) clearTimeout(timeout);
      controller.abort();
    };
  }, [open, query, revision, disabled]);
  useEffect(() => {
    if (active >= 0)
      document
        .getElementById(`${listId}-${active}`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [active, listId]);
  const move = (direction: number) => {
    const enabled = options
      .map((s, i) => (!used(s) ? i : -1))
      .filter((i) => i >= 0);
    if (!enabled.length) return;
    const index = enabled.indexOf(active),
      next =
        index < 0
          ? direction > 0
            ? 0
            : enabled.length - 1
          : (index + direction + enabled.length) % enabled.length;
    setActive(enabled[next]);
  };
  return (
    <div
      className="bt-security-picker"
      ref={root}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (
          !pointerInside.current &&
          !root.current?.contains(next) &&
          !popup.current?.contains(next)
        )
          close();
      }}
    >
      <div className="bt-security-input">
        <input
          ref={input}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={open && !disabled}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={
            open && active >= 0 ? `${listId}-${active}` : undefined
          }
          aria-describedby={open ? statusId : undefined}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          maxLength={48}
          value={open ? query : value}
          placeholder="搜索代码或名称"
          onFocus={(e) => {
            if (suppressFocus.current) {
              suppressFocus.current = false;
              return;
            }
            setQuery(value.startsWith("DEMO") ? "" : value);
            setOpen(true);
            e.currentTarget.select();
          }}
          onClick={() => {
            if (!open) {
              setQuery(value.startsWith("DEMO") ? "" : value);
              setOpen(true);
            }
          }}
          onChange={(e) => {
            setCancelNotice("");
            sequence.current++;
            setOptions([]);
            setActive(-1);
            setQuery(e.target.value);
            setOpen(true);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(e) => {
            if (composing.current || e.nativeEvent.isComposing) return;
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              move(e.key === "ArrowDown" ? 1 : -1);
            }
            if (e.key === "Enter" && open) {
              e.preventDefault();
              if (active >= 0 && options[active]) choose(options[active]);
              else if (error) setRevision((n) => n + 1);
            }
          }}
        />
        <ChevronDown size={13} aria-hidden="true" />
      </div>
      {selected && selected.symbol === value && (
        <small className="bt-security-caption">
          {selected.name} · {selected.currency}
        </small>
      )}
      {!open && cancelNotice && (
        <small role="status" className="bt-security-caption">
          {cancelNotice}
        </small>
      )}
      {open &&
        !disabled &&
        position &&
        createPortal(
          <div
            ref={popup}
            className="bt-security-popover"
            style={position}
            onPointerDown={() => {
              pointerInside.current = true;
            }}
            onPointerUp={() => {
              setTimeout(() => {
                pointerInside.current = false;
              }, 0);
            }}
            onPointerCancel={() => {
              pointerInside.current = false;
            }}
          >
            <header>
              <span>
                <Search size={14} />
                选择股票／ETF
              </span>
              <button
                type="button"
                aria-label="关闭证券选择"
                onClick={() => {
                  close();
                  if (document.activeElement !== input.current) {
                    suppressFocus.current = true;
                    input.current?.focus();
                  }
                }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <X size={16} />
              </button>
            </header>
            <p className="bt-security-hint">
              美股与TSX · 搜索不更改组合，选中后才替换
            </p>
            <div id={statusId} role="status" className="bt-security-status">
              {loading
                ? "正在搜索并核对证券身份…"
                : error ||
                  (!query.trim()
                    ? "输入股票代码或公司名称，例如 NVDA、Microsoft、ZSP。"
                    : options.length
                      ? `已核对 ${options.length} 项，按↑↓及回车选择。`
                      : "没有通过核对的股票／ETF。请核对代码或更换名称；不支持其他交易所、指数、期货或私人证券。")}
            </div>
            {error && (
              <button
                type="button"
                className="bt-security-retry"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setRevision((n) => n + 1)}
              >
                重新搜索
              </button>
            )}
            <div
              id={listId}
              role="listbox"
              aria-label={`${label}候选证券`}
              className="bt-security-options"
            >
              {options.map((s, i) => (
                <button
                  key={s.symbol}
                  id={`${listId}-${i}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={active === i}
                  aria-disabled={used(s)}
                  disabled={used(s)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(s)}
                >
                  <span>
                    <strong>{s.symbol}</strong>
                    <em>
                      {s.kind === "ETF" ? "ETF" : "股票"} · {s.exchange} ·{" "}
                      {s.currency}
                    </em>
                  </span>
                  <span className="bt-security-name">{s.name}</span>
                  <small>
                    {used(s) ? "已在组合中" : "已在线核对"}
                    {s.verifiedBy === "tiingo" ? " · Tiingo" : ""} ·{" "}
                    {new Date(s.verifiedAt).toLocaleDateString()}
                  </small>
                </button>
              ))}
            </div>
            <footer>
              Yahoo公开资料／已配置Tiingo的常见美股ETF精确匹配 ·
              结果可能缓存，历史仍需另行获取。
            </footer>
          </div>,
          document.body,
        )}
    </div>
  );
}
