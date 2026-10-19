"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyState,
  finishChange,
  validateState,
  type WealthState,
} from "./wealth";
import {
  readState,
  writeState,
  STATE_KEY,
  BACKUP_KEY,
  MIGRATION_KEY,
} from "./storage";
import {
  cloudClient,
  cloudRead,
  cloudWrite,
  sharedHousehold,
  type CloudConflictError,
} from "./cloud";
import { connectionPlan, hasSavedData, sameData } from "./cloud-plan";
import { mergeChatHistory } from "./conversations";
import { AGGREGATE_LABELS, mergeHouseholdAggregates } from "./aggregate-merge";
export type CloudChoice = {
  householdId: string;
  remoteRevision: number;
  assets: number;
  debts: number;
  history: number;
  messages: number;
};
type CloudLink = {
  householdId: string;
  remoteRevision: number;
  localRevision: number;
  userId: string;
};
type AcknowledgedBaseline = {
  householdId: string;
  userId: string;
  remoteRevision: number;
  document: WealthState;
};
function revisionConflict(reason: unknown): reason is CloudConflictError {
  return (
    reason instanceof Error &&
    reason.name === "CloudConflictError" &&
    "code" in reason &&
    reason.code === "HOUSEHOLD_REVISION_CONFLICT"
  );
}
const CLOUD_KEY = "together-cloud-link";
export default function useWealth() {
  const [state, setState] = useState<WealthState>(emptyState);
  const current = useRef(state);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [cloudStatus, setCloudStatus] = useState("仅保存于本机");
  const [cloudHousehold, setCloudHousehold] = useState("");
  const [cloudLoading, setCloudLoading] = useState(true);
  const [cloudChoice, setCloudChoice] = useState<CloudChoice | null>(null);
  const choice = useRef<CloudChoice | null>(null);
  const booting = useRef(false);
  const localReadable = useRef(true);
  const remote = useRef<CloudLink | null>(null);
  // Never restore this from localStorage. A persisted revision is not proof of
  // a common content baseline after refresh, account changes or an unknown ACK.
  const baseline = useRef<AcknowledgedBaseline | null>(null);
  const connection = useRef(0);
  const syncing = useRef(false);
  const syncCloud = useCallback(async function sync(): Promise<void> {
    if (!remote.current || syncing.current) return;
    syncing.current = true;
    let attemptedMerge = false;
    let attemptedLink: CloudLink | null = null;
    const unchangedLocal = (expected: WealthState) => {
      const stored = readState(localStorage);
      return (
        current.current === expected &&
        stored.revision === expected.revision &&
        sameData(stored, expected)
      );
    };
    try {
      while (
        remote.current &&
        remote.current.localRevision !== current.current.revision
      ) {
        const link: CloudLink = remote.current;
        attemptedLink = link;
        let document = current.current;
        setCloudStatus("正在同步云端…");
        let revision: number;
        try {
          revision = await cloudWrite(
            link.householdId,
            link.remoteRevision,
            document,
          );
        } catch (reason) {
          if (remote.current !== link) return;
          const common = baseline.current;
          if (
            !revisionConflict(reason) ||
            attemptedMerge ||
            !common ||
            common.householdId !== link.householdId ||
            common.userId !== link.userId ||
            common.remoteRevision !== link.remoteRevision
          )
            throw reason;
          attemptedMerge = true;
          setCloudStatus("检测到并发修改 · 正在核对模块…");
          const row = await cloudRead(link.householdId);
          if (remote.current !== link) return;
          if (!unchangedLocal(document))
            throw new Error(
              "核对云端期间本机又有新修改，已全部保留；请重新连接确认版本。",
            );
          if (
            row.household_id !== link.householdId ||
            !row.document ||
            !Number.isSafeInteger(row.revision) ||
            row.revision <= link.remoteRevision
          )
            throw new Error(
              "云端版本无法确认，未自动合并；请重新连接确认版本。",
            );
          const merged = mergeHouseholdAggregates(
            common.document,
            document,
            row.document,
          );
          if (merged.status === "conflict") {
            const modules = merged.domains
              .map((key) => AGGREGATE_LABELS[key])
              .join("、");
            throw new Error(
              modules
                ? `${modules}在两边都有修改，未自动合并；本机已保留，请选择家庭版本。`
                : "数据含未知或无效字段，未自动合并；本机已保留，请选择家庭版本。",
            );
          }
          const client = cloudClient();
          const user = client ? (await client.auth.getUser()).data.user : null;
          if (remote.current !== link) return;
          if (!user || user.id !== link.userId)
            throw new Error("登录账号已变化，未自动合并；本机数据已保留。");
          if (!unchangedLocal(document))
            throw new Error(
              "核对云端期间本机又有新修改，已全部保留；请重新连接确认版本。",
            );
          // One CAS retry only, with whole financial history kept from its owner.
          // A non-financial merge must never append a financial snapshot.
          const previousRevision = Math.max(
            document.revision,
            row.document.revision,
          );
          if (!Number.isSafeInteger(previousRevision + 1))
            throw new Error(
              "本机文档版本超出安全范围，未自动合并；请保留备份后检查版本。",
            );
          const combined = finishChange(
            {
              ...document,
              revision: previousRevision,
            },
            merged.document,
            "合并不同模块的并发修改",
          );
          setCloudStatus("不同模块修改可兼容 · 正在合并同步…");
          revision = await cloudWrite(link.householdId, row.revision, combined);
          if (remote.current !== link) return;
          if (!unchangedLocal(document))
            throw new Error(
              "模块合并已保存云端，但期间本机又有新修改；新修改已保留，请重新连接确认版本。",
            );
          writeState(localStorage, combined, document.revision);
          current.current = combined;
          setState(combined);
          document = combined;
        }
        if (remote.current !== link) break;
        baseline.current = {
          householdId: link.householdId,
          userId: link.userId,
          remoteRevision: revision,
          document: structuredClone(document),
        };
        remote.current = {
          ...link,
          remoteRevision: revision,
          localRevision: document.revision,
        };
        attemptedLink = remote.current;
        localStorage.setItem(CLOUD_KEY, JSON.stringify(remote.current));
      }
      if (remote.current) setCloudStatus("已同步 Supabase");
    } catch (reason) {
      if (remote.current !== attemptedLink) return;
      const message = reason instanceof Error ? reason.message : "云端同步失败";
      setCloudStatus("云端同步失败 · 本机已保存");
      setError(message);
      // Pause retries on a conflict; local saves remain available.
      remote.current = null;
      baseline.current = null;
    } finally {
      syncing.current = false;
      if (
        remote.current &&
        remote.current.localRevision !== current.current.revision
      )
        void sync();
    }
  }, []);
  const replaceFromCloud = useCallback((document: WealthState) => {
    validateState(document);
    if (hasSavedData(current.current) && !localStorage.getItem(MIGRATION_KEY))
      localStorage.setItem(MIGRATION_KEY, JSON.stringify(current.current));
    writeState(localStorage, document);
    current.current = document;
    setState(document);
  }, []);
  const connectCloud = useCallback(
    async (
      householdId: string,
      mode: "load" | "upload" | "resume" | "auto" = "load",
    ) => {
      const request = ++connection.current;
      remote.current = null;
      baseline.current = null;
      const client = cloudClient();
      if (!client) throw new Error("尚未配置 Supabase URL 与公开密钥。");
      const {
        data: { user },
      } = await client.auth.getUser();
      if (connection.current !== request)
        throw new Error("家庭连接已变化，请使用当前家庭版本。");
      if (!user) throw new Error("请先登录。");
      const observedRevision = current.current.revision;
      const row = await cloudRead(householdId);
      if (connection.current !== request)
        throw new Error("家庭连接已变化，请使用当前家庭版本。");
      let operation = mode;
      let merged = false;
      if (mode === "auto") {
        const decision = connectionPlan(current.current, row.document);
        if (decision === "choice") {
          remote.current = null;
          const pending = {
            householdId,
            remoteRevision: row.revision,
            assets: row.document!.assets.length,
            debts: row.document!.debts.length,
            history: row.document!.history.length,
            messages:
              row.document!.messages.length +
              (row.document!.chatArchives ?? []).reduce(
                (sum, chat) => sum + chat.messages.length,
                0,
              ),
          };
          choice.current = pending;
          setCloudChoice(pending);
          setCloudHousehold(householdId);
          setCloudStatus("本机与云端均有数据 · 待选择版本");
          return;
        }
        if (decision === "merge-chat") {
          replaceFromCloud(
            finishChange(
              row.document!,
              mergeChatHistory(row.document!, current.current),
              "保留本机聊天历史",
            ),
          );
          operation = "upload";
          merged = true;
        } else operation = decision;
      }
      if (
        operation === "load" &&
        current.current.revision !== observedRevision &&
        !(row.document && sameData(row.document, current.current)) &&
        !merged
      )
        throw new Error("加载期间本机有新修改，未覆盖你的数据，请重新连接。");
      if (
        operation === "upload" &&
        choice.current?.householdId === householdId &&
        choice.current.remoteRevision !== row.revision
      ) {
        choice.current = {
          ...choice.current,
          remoteRevision: row.revision,
          assets: row.document?.assets.length ?? 0,
          debts: row.document?.debts.length ?? 0,
          history: row.document?.history.length ?? 0,
          messages: row.document?.messages.length ?? 0,
        };
        setCloudChoice(choice.current);
        throw new Error("云端又有新修改，请确认最新版本信息后再选择。");
      }
      let resumeNeedsUpload = false;
      if (operation === "resume") {
        const raw = localStorage.getItem(CLOUD_KEY);
        const saved: CloudLink | null = raw ? JSON.parse(raw) : null;
        if (
          !saved ||
          saved.userId !== user.id ||
          saved.householdId !== householdId
        )
          throw new Error("请重新选择家庭空间。");
        if (
          row.revision !== saved.remoteRevision &&
          current.current.revision !== saved.localRevision &&
          !(row.document && sameData(row.document, current.current))
        )
          throw new Error(
            "本机与云端都有新修改，请在数据设置选择要加载的版本。",
          );
        if (
          row.revision !== saved.remoteRevision &&
          row.document &&
          !sameData(row.document, current.current)
        )
          replaceFromCloud(row.document);
        resumeNeedsUpload =
          row.revision === saved.remoteRevision &&
          current.current.revision !== saved.localRevision;
      } else if (
        operation === "load" &&
        row.document &&
        !sameData(row.document, current.current)
      )
        replaceFromCloud(row.document);
      const shouldUpload =
        operation === "upload" || !row.document || resumeNeedsUpload;
      remote.current = {
        householdId,
        remoteRevision: row.revision,
        localRevision: shouldUpload ? -1 : current.current.revision,
        userId: user.id,
      };
      if (!shouldUpload && row.document)
        baseline.current = {
          householdId,
          userId: user.id,
          remoteRevision: row.revision,
          document: structuredClone(row.document),
        };
      localStorage.setItem(CLOUD_KEY, JSON.stringify(remote.current));
      setCloudHousehold(householdId);
      choice.current = null;
      setCloudChoice(null);
      setError("");
      await syncCloud();
      if (!remote.current)
        throw new Error(
          "云端同步未完成，本机数据已保留，请重新连接后处理版本冲突。",
        );
    },
    [replaceFromCloud, syncCloud],
  );
  useEffect(() => {
    try {
      const loaded = readState(localStorage);
      // A normal refresh must not replace the previous-change recovery copy.
      if (localStorage.getItem(STATE_KEY) === null)
        writeState(localStorage, loaded);
      current.current = loaded;
      setState(loaded);
    } catch (reason) {
      localReadable.current = false;
      setError(
        `保存数据无法读取：${reason instanceof Error ? reason.message : "格式错误"}。原始数据已保留，请使用备份恢复。`,
      );
    } finally {
      setReady(true);
    }
    const syncTab = (event: StorageEvent) => {
      if (event.key !== STATE_KEY || !event.newValue) return;
      try {
        const next: unknown = JSON.parse(event.newValue);
        validateState(next);
        current.current = next;
        setState(next);
      } catch {
        setError("另一个页面写入了无效数据，请检查备份。");
      }
    };
    window.addEventListener("storage", syncTab);
    return () => window.removeEventListener("storage", syncTab);
  }, []);
  useEffect(() => {
    if (!ready) return;
    if (!cloudClient()) {
      setCloudLoading(false);
      return;
    }
    let active = true;
    const resume = async () => {
      try {
        const {
          data: { session },
        } = await cloudClient()!.auth.getSession();
        if (!active || !session || booting.current || !localReadable.current)
          return;
        booting.current = true;
        setCloudStatus("正在连接家庭云端数据…");
        const raw = localStorage.getItem(CLOUD_KEY);
        const saved: CloudLink | null = raw ? JSON.parse(raw) : null;
        if (saved?.userId === session.user.id) {
          try {
            await connectCloud(saved.householdId, "resume");
          } catch (reason) {
            if (
              reason instanceof Error &&
              /JSON object|0 rows|not found/i.test(reason.message)
            ) {
              localStorage.removeItem(CLOUD_KEY);
              await connectCloud(await sharedHousehold(), "auto");
            } else throw reason;
          }
        } else await connectCloud(await sharedHousehold(), "auto");
      } catch (reason) {
        if (active) {
          setCloudStatus("云端待连接 · 本机已保存");
          setError(reason instanceof Error ? reason.message : "云端连接失败");
        }
      } finally {
        booting.current = false;
        if (active) setCloudLoading(false);
      }
    };
    void resume();
    return () => {
      active = false;
    };
  }, [ready, connectCloud]);
  const commit = useCallback(
    (
      update: (state: WealthState) => WealthState,
      reason: string,
      financial = false,
    ) => {
      if (!ready) throw new Error("数据仍在载入，请稍后重试。");
      const previous = current.current;
      const updated = update(previous);
      if (updated === previous) return previous;
      const next = finishChange(previous, updated, reason, financial);
      writeState(localStorage, next, previous.revision);
      current.current = next;
      setState(next);
      setError("");
      void syncCloud();
      return next;
    },
    [ready, syncCloud],
  );
  const restore = useCallback(
    (document: WealthState) => {
      const next = finishChange(current.current, document, "恢复备份", true);
      writeState(localStorage, next);
      current.current = next;
      setState(next);
      setError("");
      localReadable.current = true;
      void syncCloud();
    },
    [syncCloud],
  );
  const recoverPrevious = () => {
    const saved = localStorage.getItem(BACKUP_KEY);
    if (!saved) throw new Error("尚无上一份本机备份。");
    const document: unknown = JSON.parse(saved);
    validateState(document);
    restore(document);
  };
  useEffect(() => {
    if (!cloudHousehold) return;
    let active = true;
    const refresh = async () => {
      const link = remote.current;
      if (
        !link ||
        syncing.current ||
        link.localRevision !== current.current.revision ||
        document.hidden
      )
        return;
      try {
        const row = await cloudRead(link.householdId);
        if (!active || remote.current !== link || syncing.current) return;
        if (row.revision !== link.remoteRevision && row.document) {
          if (current.current.revision !== link.localRevision)
            throw new Error("云端与本机都有修改，请重新加载家庭版本。");
          replaceFromCloud(row.document);
          remote.current = {
            ...link,
            remoteRevision: row.revision,
            localRevision: row.document.revision,
          };
          baseline.current = {
            householdId: link.householdId,
            userId: link.userId,
            remoteRevision: row.revision,
            document: structuredClone(row.document),
          };
          localStorage.setItem(CLOUD_KEY, JSON.stringify(remote.current));
          setCloudStatus("已同步 Supabase");
        }
      } catch (reason) {
        if (active) {
          setCloudStatus("云端读取失败 · 本机已保存");
          setError(reason instanceof Error ? reason.message : "云端读取失败");
        }
      }
    };
    const timer = setInterval(() => void refresh(), 5000);
    const focused = () => void refresh();
    window.addEventListener("focus", focused);
    document.addEventListener("visibilitychange", focused);
    const client = cloudClient();
    const channel =
      client && typeof client.channel === "function"
        ? client
            .channel(`wealth-${cloudHousehold}`)
            .on(
              "postgres_changes",
              {
                event: "UPDATE",
                schema: "public",
                table: "household_documents",
                filter: `household_id=eq.${cloudHousehold}`,
              },
              () => void refresh(),
            )
            .subscribe()
        : null;
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", focused);
      document.removeEventListener("visibilitychange", focused);
      if (channel && client) void client.removeChannel(channel);
    };
  }, [cloudHousehold, replaceFromCloud]);
  const disconnectCloud = () => {
    connection.current += 1;
    remote.current = null;
    baseline.current = null;
    localStorage.removeItem(CLOUD_KEY);
    setCloudHousehold("");
    setCloudStatus("仅保存于本机");
  };
  return {
    state,
    ready,
    error,
    setError,
    commit,
    restore,
    recoverPrevious,
    cloudStatus,
    cloudHousehold,
    cloudLoading,
    cloudChoice,
    connectCloud,
    disconnectCloud,
  };
}
