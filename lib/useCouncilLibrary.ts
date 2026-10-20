"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { cloudClient } from "./cloud";
import { allowedEmail } from "./access";
import {
  councilSearch,
  parseCouncilMemo,
  validCouncilLibraryItems,
  type CouncilLibraryItem,
  type CouncilMemo,
} from "./council-library";
export default function useCouncilLibrary() {
  const [items, setItems] = useState<CouncilLibraryItem[]>([]),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(true),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [sessionKey, setSessionKey] = useState("pending"),
    [resolvedQuery, setResolvedQuery] = useState("");
  const alive = useRef(false),
    epoch = useRef(0),
    seq = useRef(0),
    owner = useRef<string | null>(null),
    authReady = useRef(false),
    required = useRef(false),
    queryRef = useRef(""),
    saving = useRef(false),
    request = useRef<AbortController | null>(null);
  queryRef.current = query;
  const refresh = useCallback(async () => {
    if (
      !alive.current ||
      !authReady.current ||
      (required.current && !owner.current)
    )
      return;
    let search: string;
    try {
      search = councilSearch(queryRef.current);
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const ticket = ++seq.current,
      identity = epoch.current;
    setLoading(true);
    try {
      const response = await fetch("/api/council/library", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15000),
        ]),
        body: JSON.stringify({ action: "search", query: search }),
      });
      const body = await response.json();
      if (
        !alive.current ||
        identity !== epoch.current ||
        ticket !== seq.current ||
        search !== queryRef.current.trim().replace(/\s+/g, " ")
      )
        return;
      if (!response.ok) throw Error(body.error || "研讨库读取失败。");
      if (
        typeof body.userId !== "string" ||
        (owner.current && body.userId !== owner.current) ||
        !validCouncilLibraryItems(body.items)
      )
        throw Error("研讨库读取确认无效，请重新连接。");
      owner.current = body.userId;
      setItems(body.items);
      setReady(true);
      setResolvedQuery(search);
      setError("");
    } catch (e) {
      if (
        alive.current &&
        identity === epoch.current &&
        ticket === seq.current &&
        !controller.signal.aborted
      ) {
        setError(e instanceof Error ? e.message : "研讨库暂不可用。");
        setReady(false);
      }
    } finally {
      if (alive.current && identity === epoch.current && ticket === seq.current)
        setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    let active = true;
    let unsubscribe: undefined | (() => void);
    const client = cloudClient();
    required.current = !!client;
    authReady.current = !client;
    if (client) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        if (!active) return;
        const user = session?.user,
          next =
            user?.id && allowedEmail(user.email) && user.email_confirmed_at
              ? user.id
              : null;
        if (!authReady.current || owner.current !== next) {
          epoch.current++;
          seq.current++;
          request.current?.abort();
          owner.current = next;
          authReady.current = true;
          saving.current = false;
          setItems([]);
          setReady(false);
          setError("");
          setQuery("");
          setResolvedQuery("");
          queryRef.current = "";
          setSessionKey(next || "signed-out");
          if (next) void refresh();
          else setLoading(false);
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } else {
      setSessionKey("unconfigured");
      void refresh();
    }
    const focus = () => {
      if (!document.hidden && !saving.current) void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      alive.current = false;
      epoch.current++;
      seq.current++;
      request.current?.abort();
      unsubscribe?.();
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 300);
    return () => clearTimeout(timer);
  }, [query, refresh]);
  const save = async (id: string, value: CouncilMemo) => {
    if (!ready || !owner.current || !authReady.current)
      throw Error("请先连接本人的研讨库。");
    if (saving.current) throw Error("上一项整理正在保存，请稍后再操作。");
    const memo = parseCouncilMemo(value),
      identity = epoch.current,
      expectedOwner = owner.current;
    saving.current = true;
    try {
      const response = await fetch("/api/council/library", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ action: "save", id, memo }),
      });
      const body = await response.json();
      if (!alive.current || identity !== epoch.current)
        throw Error("账号已变化，请回到原账号重新读取核对。");
      if (!response.ok)
        throw Error(body.error || "整理尚未确认保存，请重新读取后核对。");
      const saved = parseCouncilMemo(body.memo);
      if (
        body.userId !== expectedOwner ||
        body.id !== id ||
        saved.version !== memo.version + 1 ||
        JSON.stringify({ ...memo, version: saved.version }) !==
          JSON.stringify(saved)
      )
        throw Error("整理保存确认无效，请重新读取；未自动重发。");
      // Do not let an older read overwrite the acknowledged version.
      seq.current++;
      request.current?.abort();
      setLoading(false);
      setItems((previous) =>
        previous.map((x) => (x.id === id ? { ...x, memo: saved } : x)),
      );
      setError("");
      void refresh();
      return saved;
    } finally {
      if (identity === epoch.current) saving.current = false;
    }
  };
  return {
    items,
    query,
    setQuery,
    loading,
    searching: loading || query.trim().replace(/\s+/g, " ") !== resolvedQuery,
    ready,
    error,
    sessionKey,
    refresh,
    save,
  };
}
