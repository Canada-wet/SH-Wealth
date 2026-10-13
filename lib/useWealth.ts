"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyState,
  finishChange,
  validateState,
  type WealthState,
} from "./wealth";
import { readState, writeState, STATE_KEY, BACKUP_KEY } from "./storage";
import { cloudClient, cloudRead, cloudWrite } from "./cloud";
type CloudLink = {
  householdId: string;
  remoteRevision: number;
  localRevision: number;
  userId: string;
};
const CLOUD_KEY = "together-cloud-link";
export default function useWealth() {
  const [state, setState] = useState<WealthState>(emptyState);
  const current = useRef(state);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [cloudStatus, setCloudStatus] = useState("仅保存于本机");
  const [cloudHousehold, setCloudHousehold] = useState("");
  const remote = useRef<CloudLink | null>(null);
  const syncing = useRef(false);
  const syncCloud = useCallback(async function sync(): Promise<void> {
    if (!remote.current || syncing.current) return;
    syncing.current = true;
    try {
      while (
        remote.current &&
        remote.current.localRevision !== current.current.revision
      ) {
        const link: CloudLink = remote.current;
        const document = current.current;
        setCloudStatus("正在同步云端…");
        const revision = await cloudWrite(
          link.householdId,
          link.remoteRevision,
          document,
        );
        if (remote.current !== link) break;
        remote.current = {
          ...link,
          remoteRevision: revision,
          localRevision: document.revision,
        };
        localStorage.setItem(CLOUD_KEY, JSON.stringify(remote.current));
      }
      if (remote.current) setCloudStatus("已同步 Supabase");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "云端同步失败";
      setCloudStatus("云端同步失败 · 本机已保存");
      setError(message);
      // Pause retries on a conflict; local saves remain available.
      remote.current = null;
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
    writeState(localStorage, document);
    current.current = document;
    setState(document);
  }, []);
  const connectCloud = useCallback(
    async (
      householdId: string,
      mode: "load" | "upload" | "resume" = "load",
    ) => {
      const client = cloudClient();
      if (!client) throw new Error("尚未配置 Supabase URL 与公开密钥。");
      const {
        data: { user },
      } = await client.auth.getUser();
      if (!user) throw new Error("请先登录。");
      const row = await cloudRead(householdId);
      let resumeNeedsUpload = false;
      if (mode === "resume") {
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
          current.current.revision !== saved.localRevision
        )
          throw new Error(
            "本机与云端都有新修改，请在数据设置选择要加载的版本。",
          );
        if (row.revision !== saved.remoteRevision && row.document)
          replaceFromCloud(row.document);
        resumeNeedsUpload =
          row.revision === saved.remoteRevision &&
          current.current.revision !== saved.localRevision;
      } else if (mode === "load" && row.document)
        replaceFromCloud(row.document);
      const shouldUpload =
        mode === "upload" || !row.document || resumeNeedsUpload;
      remote.current = {
        householdId,
        remoteRevision: row.revision,
        localRevision: shouldUpload ? -1 : current.current.revision,
        userId: user.id,
      };
      localStorage.setItem(CLOUD_KEY, JSON.stringify(remote.current));
      setCloudHousehold(householdId);
      setError("");
      await syncCloud();
    },
    [replaceFromCloud, syncCloud],
  );
  useEffect(() => {
    try {
      const loaded = readState(localStorage);
      writeState(localStorage, loaded);
      current.current = loaded;
      setState(loaded);
    } catch (reason) {
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
    if (!ready || !cloudClient()) return;
    let active = true;
    const resume = async () => {
      try {
        const raw = localStorage.getItem(CLOUD_KEY);
        if (!raw) return;
        const saved: CloudLink = JSON.parse(raw);
        const {
          data: { session },
        } = await cloudClient()!.auth.getSession();
        if (active && session?.user.id === saved.userId)
          await connectCloud(saved.householdId, "resume");
      } catch (reason) {
        if (active) {
          setCloudStatus("云端待连接 · 本机已保存");
          setError(reason instanceof Error ? reason.message : "云端连接失败");
        }
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
      const next = finishChange(previous, update(previous), reason, financial);
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
    remote.current = null;
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
    connectCloud,
    disconnectCloud,
  };
}
