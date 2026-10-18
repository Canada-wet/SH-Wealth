"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import {
  featureForLocation,
  validNavEntries,
  type NavAction,
  type NavEntry,
} from "@/lib/navigation";
type NavigationState = {
  entries: NavEntry[];
  ready: boolean;
  busy: boolean;
  error: string;
  current: string;
  pin: (id: string, pinned: boolean) => Promise<void>;
  refresh: () => void;
};
const Context = createContext<NavigationState>({
  entries: [],
  ready: false,
  busy: false,
  error: "",
  current: "overview",
  pin: async () => {},
  refresh: () => {},
});
export const useNavigation = () => useContext(Context);
export default function NavigationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [entries, setEntries] = useState<NavEntry[]>([]),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [current, setCurrent] = useState("overview");
  const owner = useRef(""),
    alive = useRef(false),
    loaded = useRef(false),
    writing = useRef(false),
    pending = useRef<string[]>([]),
    latest = useRef(0),
    request = useRef<AbortController | null>(null);
  const privatePage = pathname !== "/login" && !pathname?.startsWith("/auth/");
  const consume = async (response: Response) => {
    const body = await response.json();
    if (
      !response.ok ||
      typeof body.userId !== "string" ||
      !validNavEntries(body.entries)
    )
      throw Error(body.error || "导航保存确认无效，请重新读取。");
    if (owner.current && owner.current !== body.userId) {
      owner.current = "";
      loaded.current = false;
      pending.current = [];
      if (alive.current) {
        setEntries([]);
        setReady(false);
      }
      throw Error("登录账号已变化，请刷新页面。");
    }
    owner.current = body.userId;
    return body.entries as NavEntry[];
  };
  const update = async (featureId: string, action: NavAction) => {
    const response = await fetch("/api/navigation", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      keepalive: true,
      signal: AbortSignal.timeout(12000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featureId, action }),
    });
    return consume(response);
  };
  const flush = async () => {
    if (!loaded.current || writing.current || !alive.current) return;
    writing.current = true;
    latest.current++;
    setBusy(true);
    try {
      while (pending.current.length && alive.current) {
        const id = pending.current[0];
        const next = await update(id, "visit");
        pending.current.shift();
        if (alive.current) {
          setEntries(next);
          setError("");
        }
      }
    } catch {
      if (alive.current)
        setError("最近使用尚未同步，页面仍可打开；可重新连接。");
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const visit = () => {
    const feature = featureForLocation(location.pathname, location.hash);
    if (!feature) return;
    setCurrent(feature.id);
    if (pending.current.at(-1) !== feature.id) pending.current.push(feature.id);
    void flush();
  };
  const refresh = async () => {
    if (!alive.current || writing.current) return;
    const version = ++latest.current;
    request.current?.abort();
    request.current = new AbortController();
    const controller = request.current,
      timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch("/api/navigation", {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await consume(response);
      if (!alive.current || version !== latest.current) return;
      setEntries(data);
      loaded.current = true;
      setReady(true);
      setError("");
      void flush();
    } catch {
      if (alive.current && version === latest.current)
        setError("个人导航暂未连接云端；搜索和页面入口仍可使用。");
    } finally {
      clearTimeout(timer);
    }
  };
  useEffect(() => {
    if (!privatePage) {
      owner.current = "";
      loaded.current = false;
      pending.current = [];
      setEntries([]);
      setReady(false);
      return;
    }
    alive.current = true;
    void refresh();
    const focus = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      alive.current = false;
      request.current?.abort();
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [privatePage]);
  useEffect(() => {
    if (!privatePage) return;
    visit();
    window.addEventListener("hashchange", visit);
    window.addEventListener("popstate", visit);
    return () => {
      window.removeEventListener("hashchange", visit);
      window.removeEventListener("popstate", visit);
    };
  }, [pathname, privatePage]);
  const pin = async (featureId: string, pinned: boolean) => {
    if (!loaded.current || writing.current) return;
    writing.current = true;
    latest.current++;
    setBusy(true);
    setError("");
    try {
      const next = await update(featureId, pinned ? "pin" : "unpin");
      if (alive.current) setEntries(next);
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "置顶尚未保存，请重试。");
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
      void flush();
    }
  };
  return (
    <Context.Provider
      value={{
        entries,
        ready,
        busy,
        error,
        current,
        pin,
        refresh: () => void refresh(),
      }}
    >
      {children}
    </Context.Provider>
  );
}
