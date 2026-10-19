"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { cloudClient } from "./cloud";
import { allowedEmail } from "./access";
import {
  parseActionInput,
  parseActionPatch,
  sortActionItems,
  validActionId,
  validActionItem,
  validActionItems,
  type ActionItem,
  type ActionPatch,
  type CreateActionInput,
} from "./action-center";

export default function useActionCenter(householdId: string) {
  const [items, setItems] = useState<ActionItem[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const home = useRef(householdId),
    alive = useRef(false),
    sequence = useRef(0),
    busy = useRef(false),
    mutationSequence = useRef(0),
    sessionEpoch = useRef(0),
    sessionRequired = useRef(false),
    sessionReady = useRef(false),
    sessionKnown = useRef(false),
    owner = useRef<string | null>(null);
  const pendingCreate = useRef<{ signature: string; id: string } | null>(null);
  home.current = householdId;
  const refresh = useCallback(async () => {
    if (
      !validActionId(householdId) ||
      !alive.current ||
      (sessionRequired.current && (!sessionReady.current || !owner.current))
    )
      return;
    const token = ++sequence.current,
      epoch = sessionEpoch.current;
    if (alive.current) setLoading(true);
    try {
      const response = await fetch(
        `/api/actions?household=${encodeURIComponent(householdId)}`,
        {
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(12000),
        },
      );
      const data = await response.json();
      if (
        !response.ok &&
        [401, 403, 404].includes(response.status) &&
        alive.current &&
        sessionEpoch.current === epoch &&
        home.current === householdId &&
        token === sequence.current
      )
        setItems([]);
      if (!response.ok || !validActionItems(data.items))
        throw Error(data.error || "行动读取确认无效，请重新连接。");
      if (
        alive.current &&
        sessionEpoch.current === epoch &&
        home.current === householdId &&
        token === sequence.current
      ) {
        setItems(sortActionItems(data.items));
        setError("");
      }
    } catch (reason) {
      if (
        alive.current &&
        sessionEpoch.current === epoch &&
        home.current === householdId &&
        token === sequence.current
      )
        setError(
          reason instanceof Error ? reason.message : "行动读取失败，请重试。",
        );
    } finally {
      if (
        alive.current &&
        sessionEpoch.current === epoch &&
        home.current === householdId &&
        token === sequence.current
      )
        setLoading(false);
    }
  }, [householdId]);
  useEffect(() => {
    let active = true;
    alive.current = true;
    sequence.current++;
    setItems([]);
    setError("");
    setLoading(false);
    pendingCreate.current = null;
    let unsubscribe: (() => void) | undefined;
    try {
      const client = cloudClient();
      sessionRequired.current = !!client;
      sessionReady.current = !client;
      if (client) {
        let first = true;
        const { data } = client.auth.onAuthStateChange((_event, session) => {
          if (!active || !alive.current) return;
          const user = session?.user;
          const next =
            user?.id && allowedEmail(user.email) && user.email_confirmed_at
              ? user.id
              : null;
          const changed = sessionKnown.current && owner.current !== next;
          if (!sessionKnown.current || changed) {
            sessionEpoch.current++;
            sequence.current++;
            mutationSequence.current++;
            busy.current = false;
            pendingCreate.current = null;
            setItems([]);
            setError("");
            setLoading(false);
          }
          sessionKnown.current = true;
          sessionReady.current = true;
          owner.current = next;
          if (changed)
            window.dispatchEvent(new Event("together-action-session-changed"));
          // INITIAL_SESSION is supplied by the SDK: do not also call getSession
          // or query twice when INITIAL_SESSION/SIGNED_IN repeat the same owner.
          if ((first || changed) && next) void refresh();
          first = false;
        });
        unsubscribe = () => data.subscription.unsubscribe();
      } else void refresh();
    } catch {
      sessionRequired.current = true;
      sessionReady.current = false;
      setItems([]);
      setError("行动登录状态暂不可用，请重新连接。");
    }
    const changed = () => {
      if (!busy.current && !document.hidden) void refresh();
    };
    window.addEventListener("together-actions-changed", changed);
    window.addEventListener("focus", changed);
    return () => {
      active = false;
      alive.current = false;
      sequence.current++;
      unsubscribe?.();
      window.removeEventListener("together-actions-changed", changed);
      window.removeEventListener("focus", changed);
    };
  }, [refresh]);
  const mutate = async (
    operation: "create" | "update" | "delete",
    id: string,
    version: number | undefined,
    value: unknown,
  ) => {
    if (!validActionId(householdId)) throw Error("请先连接家庭空间。");
    if (sessionRequired.current && (!sessionReady.current || !owner.current))
      throw Error("登录身份尚未确认，请先重新登录。");
    if (busy.current) throw Error("上一项行动正在保存，请稍后再操作。");
    busy.current = true;
    sequence.current++;
    const target = householdId,
      epoch = sessionEpoch.current,
      mutation = ++mutationSequence.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/actions", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation,
          household: target,
          id,
          ...(version === undefined ? {} : { version }),
          ...(operation === "create"
            ? { input: value }
            : operation === "update"
              ? { patch: value }
              : {}),
        }),
      });
      const data = await response.json();
      if (!alive.current || sessionEpoch.current !== epoch)
        throw Error(
          "登录身份已变化，未确认原操作结果；请回到对应账号刷新核对。",
        );
      if (!response.ok)
        throw Error(data.error || "未能确认保存，请刷新后核对。");
      if (
        operation === "delete"
          ? data.deleted !== true || data.id !== id
          : !validActionItem(data.item) ||
            data.item.id !== id ||
            (operation === "update" && data.item.version !== version! + 1)
      )
        throw Error("保存确认无效，请刷新后核对；未自动重发。");
      if (
        alive.current &&
        home.current === target &&
        sessionEpoch.current === epoch
      ) {
        sequence.current++;
        setItems((previous) =>
          sortActionItems(
            operation === "delete"
              ? previous.filter((item) => item.id !== id)
              : [...previous.filter((item) => item.id !== id), data.item],
          ),
        );
        setError("");
      }
      window.dispatchEvent(new Event("together-actions-changed"));
      return data.item as ActionItem | undefined;
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "操作未确认，请刷新后核对。";
      if (
        alive.current &&
        home.current === target &&
        sessionEpoch.current === epoch
      )
        setError(message);
      throw Error(message);
    } finally {
      if (mutation === mutationSequence.current) {
        busy.current = false;
        if (
          alive.current &&
          home.current === target &&
          sessionEpoch.current === epoch
        )
          setLoading(false);
      }
    }
  };
  const create = async (input: CreateActionInput): Promise<ActionItem> => {
    const parsed = parseActionInput(input),
      signature = householdId + JSON.stringify(parsed);
    if (!validActionId(householdId)) throw Error("请先连接家庭空间。");
    if (sessionRequired.current && (!sessionReady.current || !owner.current))
      throw Error("登录身份尚未确认，请先重新登录。");
    if (busy.current) throw Error("上一项行动正在保存，请稍后再操作。");
    if (pendingCreate.current && pendingCreate.current.signature !== signature)
      throw Error(
        "上一项新建结果尚未确认，请先到行动中心刷新核对；未发起另一项新建请求。",
      );
    if (!pendingCreate.current)
      pendingCreate.current = { signature, id: crypto.randomUUID() };
    const intent = pendingCreate.current;
    const result = await mutate("create", intent.id, undefined, parsed);
    if (pendingCreate.current === intent) pendingCreate.current = null;
    return result!;
  };
  const update = async (
    item: ActionItem,
    patch: ActionPatch,
  ): Promise<ActionItem> =>
    (await mutate("update", item.id, item.version, parseActionPatch(patch)))!;
  const remove = async (item: ActionItem): Promise<void> => {
    await mutate("delete", item.id, item.version, {});
  };
  return { items, loading, error, refresh, create, update, remove };
}
