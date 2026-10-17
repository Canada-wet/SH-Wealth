"use client";
import { useEffect, useRef, useState } from "react";
import { cloudClient } from "@/lib/cloud";
import {
  readXMLSource,
  sourceKey,
  sourceStorage,
  type XMLSource,
  type XMLPickerWindow,
} from "@/lib/rekordbox-source";

type Offer = (
  data: NonNullable<Awaited<ReturnType<typeof readXMLSource>>>,
  token: number,
  current: () => boolean,
) => Promise<boolean>;
export function useRekordboxSource(
  household: string | null,
  busy: boolean,
  offer: Offer,
) {
  const [supported, setSupported] = useState(false),
    [key, setKey] = useState(""),
    [source, setSource] = useState<XMLSource | null>(null),
    [status, setStatus] = useState(""),
    [working, setWorking] = useState(false);
  const refs = useRef({
    key: "",
    source: null as XMLSource | null,
    generation: 0,
    working: false,
    busy,
    offer,
    offeredHash: "",
  });
  refs.current.busy = busy;
  refs.current.offer = offer;
  useEffect(() => {
    setSupported(
      typeof (window as XMLPickerWindow).showOpenFilePicker === "function" &&
        !!window.indexedDB &&
        !!crypto.subtle,
    );
    const client = cloudClient();
    let active = true,
      sequence = 0;
    const reset = () => {
      refs.current.generation++;
      refs.current.key = "";
      refs.current.source = null;
      refs.current.offeredHash = "";
      refs.current.working = false;
      setWorking(false);
      setKey("");
      setSource(null);
      setStatus("");
    };
    const refresh = async () => {
      const n = ++sequence;
      reset();
      const generation = refs.current.generation;
      if (!client || !household) return;
      try {
        const { data, error } = await client.auth.getUser();
        if (
          !active ||
          n !== sequence ||
          refs.current.generation !== generation ||
          error ||
          !data.user
        )
          return;
        const id = sourceKey(data.user.id, household);
        refs.current.key = id;
        setKey(id);
        const saved = await sourceStorage(id, "get");
        if (!active || n !== sequence || refs.current.generation !== generation)
          return;
        if (
          saved?.handle?.kind === "file" &&
          typeof saved.handle.getFile === "function"
        ) {
          refs.current.source = saved;
          setSource(saved);
          setStatus(
            "已记住本机 XML；仅在此页面打开时检查，更新后仍需确认导入。",
          );
        }
      } catch {
        if (active && n === sequence)
          setStatus("浏览器无法恢复文件记忆，仍可选择或拖入 XML。");
      }
    };
    void refresh();
    const subscription = client?.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        sequence++;
        reset();
      } else if (event === "SIGNED_IN" || event === "USER_UPDATED")
        window.setTimeout(() => {
          if (active) void refresh();
        }, 0);
    });
    return () => {
      active = false;
      sequence++;
      refs.current.generation++;
      refs.current.key = "";
      refs.current.source = null;
      subscription?.data.subscription.unsubscribe();
    };
  }, [household]);
  const check = async (interactive = false, fresh?: XMLSource) => {
    const r = refs.current,
      s = fresh ?? r.source;
    if (
      !s ||
      !r.key ||
      r.working ||
      (!interactive && (r.busy || !s.autoCheck || document.hidden))
    )
      return;
    const generation = r.generation,
      id = r.key;
    const current = () =>
      refs.current.generation === generation && refs.current.key === id;
    r.working = true;
    setWorking(true);
    try {
      const data = await readXMLSource(s.handle, interactive);
      if (!current()) return;
      if (!data) {
        setStatus(
          "需重新授权读取；点击“检查 XML 更新”。不会在后台弹出权限请求。",
        );
        return;
      }
      if (
        !interactive &&
        (data.hash === s.lastImportedHash || data.hash === r.offeredHash)
      )
        return;
      if (!interactive && r.busy) return;
      if (await r.offer(data, generation, current)) {
        if (!current()) return;
        r.offeredHash = data.hash;
        setStatus("XML 已读取并生成预览；尚未修改曲库，请核对后确认。");
      }
    } catch (error) {
      if (current())
        setStatus(
          error instanceof Error
            ? error.message
            : "XML 无法访问，请重新选择文件。",
        );
    } finally {
      if (current()) {
        r.working = false;
        setWorking(false);
      }
    }
  };
  const checkRef = useRef(check);
  checkRef.current = check;
  useEffect(() => {
    if (!source || !key) return;
    const run = () => void checkRef.current(false);
    run();
    const timer = window.setInterval(run, 60000);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", run);
    };
  }, [source, key]);
  const connect = async () => {
    const picker = (window as XMLPickerWindow).showOpenFilePicker;
    const id = refs.current.key;
    if (!picker || !id) return;
    const generation = ++refs.current.generation;
    try {
      // Must be invoked immediately by the button's user gesture, before any await.
      const [handle] = await picker.call(window, {
        multiple: false,
        excludeAcceptAllOption: true,
        types: [
          {
            description: "rekordbox XML",
            accept: { "application/xml": [".xml"] },
          },
        ],
      });
      if (
        !handle ||
        refs.current.key !== id ||
        refs.current.generation !== generation
      )
        return;
      const next: XMLSource = { handle, lastImportedHash: "", autoCheck: true };
      try {
        await sourceStorage(id, "put", next);
      } catch {
        if (refs.current.key === id && refs.current.generation === generation) {
          await checkRef.current(true, next);
          if (refs.current.key === id && refs.current.generation === generation)
            setStatus(
              "本次按所选 XML 读取，但浏览器无法记住文件授权。若已出现预览可直接确认；以后请重新选择 XML。",
            );
        }
        return;
      }
      if (refs.current.key !== id || refs.current.generation !== generation)
        return;
      refs.current.source = next;
      refs.current.offeredHash = "";
      setSource(next);
      await checkRef.current(true, next);
    } catch (error) {
      if (
        refs.current.key === id &&
        refs.current.generation === generation &&
        !(error instanceof DOMException && error.name === "AbortError")
      )
        setStatus("无法记住文件，请使用“选择 XML”直接导入；未改变曲库。");
    }
  };
  const disconnect = async () => {
    const id = refs.current.key;
    refs.current.generation++;
    refs.current.source = null;
    refs.current.offeredHash = "";
    refs.current.working = true;
    setWorking(true);
    try {
      if (id) await sourceStorage(id, "delete");
      setStatus("已忘记本机 XML，已导入曲目保留；浏览器权限可在网站设置撤销。");
    } catch {
      setStatus(
        "本次已停止检查，但未能清除文件记忆；请在浏览器网站设置清除此站点的存储与文件权限。",
      );
    } finally {
      if (refs.current.key === id) {
        setSource(null);
        refs.current.working = false;
        setWorking(false);
      }
    }
  };
  const markImported = async (hash: string, token: number) => {
    const r = refs.current;
    if (!hash || token !== r.generation || !r.source || !r.key) return;
    const next = { ...r.source, lastImportedHash: hash };
    r.source = next;
    try {
      await sourceStorage(r.key, "put", next);
    } catch {
      if (token === r.generation)
        setStatus(
          "曲库已保存，但无法记住此文件版本，下次检查可能再次显示预览。",
        );
    }
  };
  return {
    supported,
    ready: !!key,
    source,
    status,
    working,
    connect,
    check: () => check(true),
    disconnect,
    markImported,
  };
}
