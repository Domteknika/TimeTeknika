import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
  type RefObject,
} from "react";
import { toast } from "sonner";
import { api, ApiError, setCsrf } from "./api";
import type { Snapshot, Info, Preferences } from "./types";
type Context = {
  state: Snapshot | null;
  info: Info | null;
  loading: boolean;
  error: string;
  connected: boolean;
  clockOffset: RefObject<number>;
  refresh: () => Promise<void>;
  login: (path: string, data: unknown) => Promise<void>;
  logout: () => Promise<void>;
  mutate: <T = Record<string, unknown>>(
    path: string,
    method: string,
    data: unknown,
    message?: string,
  ) => Promise<T>;
  preference: (
    data:
      | Partial<Preferences>
      | {
          taskProject: {
            projectId: string;
            pinned?: boolean;
            collapsed?: boolean;
          };
        },
  ) => Promise<void>;
};
const AppContext = createContext<Context | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Snapshot | null>(null),
    [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false);
  const offset = useRef(0),
    epoch = useRef(0);
  const refreshing = useRef<Promise<void> | null>(null),
    again = useRef(false);
  const clear = useCallback(() => {
    epoch.current++;
    setCsrf("");
    setState(null);
    setConnected(false);
  }, []);
  const refresh = useCallback(async () => {
    if (refreshing.current) {
      again.current = true;
      return refreshing.current;
    }
    refreshing.current = (async () => {
      do {
        again.current = false;
        const generation = epoch.current;
        const latest = await api<Snapshot>("/api/state");
        if (generation !== epoch.current) return;
        setCsrf(latest.csrf);
        offset.current = latest.serverNow - Date.now();
        setState((previous) =>
          !previous ||
          previous.me.id !== latest.me.id ||
          latest.revision >= previous.revision
            ? latest
            : previous,
        );
        setError("");
      } while (again.current);
    })().finally(() => {
      refreshing.current = null;
    });
    return refreshing.current;
  }, []);
  useEffect(() => {
    let alive = true;
    async function initialize() {
      try {
        const result = await api<Info>("/api/info");
        if (!alive) return;
        setInfo(result);
        try {
          await refresh();
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 401)) throw e;
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    void initialize();
    window.addEventListener("session-expired", clear);
    return () => {
      alive = false;
      window.removeEventListener("session-expired", clear);
    };
  }, [refresh, clear]);
  const userId = state?.me.id;
  useEffect(() => {
    if (!userId) return;
    const stream = new EventSource("/api/events");
    const sync = () => {
      void refresh().catch((e) => {
        if (e.status !== 401) setConnected(false);
      });
    };
    stream.addEventListener("connected", () => {
      setConnected(true);
      sync();
    });
    stream.addEventListener("change", sync);
    stream.addEventListener("auth", clear);
    stream.onerror = () => setConnected(false);
    const focus = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", focus);
    return () => {
      stream.close();
      document.removeEventListener("visibilitychange", focus);
    };
  }, [userId, refresh, clear]);
  async function login(path: string, data: unknown) {
    await api(path, "POST", data);
    await refresh();
    setInfo(await api<Info>("/api/info"));
  }
  async function logout() {
    await api("/api/logout", "POST", {});
    clear();
    setInfo(await api<Info>("/api/info"));
  }
  async function mutate<T = Record<string, unknown>>(
    path: string,
    method: string,
    data: unknown,
    message = "Modifications enregistrées.",
  ) {
    const key = crypto.randomUUID();
    let result: T;
    try {
      result = await api<T>(path, method, data, key);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        try {
          result = await api<T>(path, method, data, key);
        } catch (second) {
          throw second instanceof ApiError && second.status === 0
            ? new ApiError(
                "Confirmation non reçue. Attendez la reconnexion et vérifiez l’état enregistré avant de recommencer.",
              )
            : second;
        }
      } else {
        if (e instanceof ApiError && e.status === 409)
          await refresh().catch(() => {});
        throw e;
      }
    }
    await refresh().catch(() =>
      toast.warning("Enregistré. Actualisation en attente de la reconnexion."),
    );
    if (message) toast.success(message);
    return result;
  }
  async function preference(data: Parameters<Context["preference"]>[0]) {
    await mutate("/api/preferences", "PATCH", data, "");
  }
  return (
    <AppContext.Provider
      value={{
        state,
        info,
        loading,
        error,
        connected,
        clockOffset: offset,
        refresh,
        login,
        logout,
        mutate,
        preference,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw Error("AppProvider manquant");
  return context;
}
export function useWorkspace() {
  const context = useApp();
  if (!context.state) throw Error("Session requise");
  return { ...context, state: context.state };
}

/** Only consumers needing time tick; forms, tables and charts stay idle. */
export function useNow(period = 60000, enabled = true) {
  const { clockOffset } = useApp();
  const [tick, setTick] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    const update = () => {
      if (document.visibilityState === "visible") setTick(Date.now());
    };
    const timer = window.setInterval(update, period);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [period, enabled]);
  return tick + clockOffset.current;
}
