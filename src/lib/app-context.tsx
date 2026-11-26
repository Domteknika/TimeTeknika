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
import { weekDays } from "./time";
import { api, ApiError, setCsrf } from "./api";
import type { Snapshot, Info, Preferences, Entry } from "./types";
type Context = {
  state: Snapshot | null;
  info: Info | null;
  loading: boolean;
  error: string;
  connected: boolean;
  clockOffset: RefObject<number>;
  refresh: () => Promise<void>;
  requestWeek: (monday: string | null) => void;
  login: (path: string, data: unknown) => Promise<void>;
  logout: () => Promise<void>;
  mutate: <T = Record<string, unknown>>(
    path: string,
    method: string,
    data: unknown,
    message?: string,
    key?: string,
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
function visibleInSnapshot(entry: Entry, snapshot: Snapshot) {
  const window = snapshot.entryWindow;
  if (!window) return entry.user_id === snapshot.me.id || snapshot.me.role !== "member";
  return entry.user_id === snapshot.me.id && (entry.end === null || !entry.task_id ||
    (entry.start < window.to && entry.end >= window.from) || (entry.start < window.next && entry.end >= window.current));
}
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
  const requestedWeek = useRef<string | null>(weekDays()[0]);
  const currentState = useRef(state);
  currentState.current = state;
  const reloadWindow = useRef<() => void>(() => {});
  const fullRevision = useRef(-1);
  const changes = useRef(new Map<string, { entry: Entry; revision: number }>());
  const applyEntry = useCallback((update: { entry: Entry; revision: number }) => {
    const old = changes.current.get(update.entry.id);
    if (update.revision <= fullRevision.current || (old && old.revision >= update.revision)) return;
    const snapshot = currentState.current;
    if (!snapshot) return;
    const window = snapshot.entryWindow;
    changes.current.set(update.entry.id, update);
    if (window && update.entry.user_id !== snapshot.me.id) {
      setState(previous => previous && { ...previous, reportRevision: Math.max(previous.reportRevision ?? 0, update.revision), revision: Math.max(previous.revision, update.revision) });
      return;
    }
    // Moves into/out of archived weeks can change the balance outside our window.
    if (window && (!visibleInSnapshot(update.entry, snapshot) || (update.entry.version > 1 &&
      !snapshot.entries.some(e => e.id === update.entry.id)))) reloadWindow.current();
    setState(previous => {
      if (!previous) return previous;
      const entries = previous.entries.filter(e => e.id !== update.entry.id);
      if (!update.entry.deleted && visibleInSnapshot(update.entry, previous)) entries.push(update.entry);
      entries.sort((a,b) => b.start - a.start);
      return { ...previous, entries, reportRevision: Math.max(previous.reportRevision ?? 0, update.revision), revision: Math.max(previous.revision, update.revision) };
    });
  }, []);
  const clear = useCallback(() => {
    requestedWeek.current = weekDays()[0];
    epoch.current++;
    fullRevision.current = -1;
    changes.current.clear();
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
        const week = requestedWeek.current;
        const latest = await api<Snapshot>("/api/state" + (week ? "?week=" + encodeURIComponent(week) : ""));
        if (week !== requestedWeek.current) { again.current = true; continue; }
        if (generation !== epoch.current) return;
        if (currentState.current && latest.me.id !== currentState.current.me.id) {
          epoch.current++;
          fullRevision.current = -1;
          changes.current.clear();
        }
        setCsrf(latest.csrf);
        offset.current = latest.serverNow - Date.now();
        if (latest.revision >= fullRevision.current) {
          fullRevision.current = latest.revision;
          const entries = new Map(latest.entries.map(e => [e.id, e]));
          for (const [id, update] of changes.current) {
            if (update.revision <= latest.revision) changes.current.delete(id);
            else if (update.entry.deleted) entries.delete(id);
            else if (visibleInSnapshot(update.entry, latest)) entries.set(id, update.entry);
            else entries.delete(id);
          }
          const deltas = Array.from(changes.current.values(), change => change.revision);
          setState({ ...latest, revision: Math.max(latest.revision, ...deltas),
            reportRevision: Math.max(latest.reportRevision ?? latest.revision, ...deltas),
            entries: [...entries.values()].sort((a,b) => b.start - a.start) });
        }
        setError("");
      } while (again.current);
    })().finally(() => {
      refreshing.current = null;
    });
    return refreshing.current;
  }, []);
  reloadWindow.current = () => { void refresh().catch(() => {}); };
  const requestWeek = useCallback((week: string | null) => {
    if (week === requestedWeek.current) return;
    requestedWeek.current = week;
    void refresh().catch(e => setError((e as Error).message));
  }, [refresh]);
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
    const stream = new EventSource("/api/events?delta=1");
    const sync = () => {
      void refresh().catch((e) => {
        if (e.status !== 401) setConnected(false);
      });
    };
    stream.addEventListener("connected", () => {
      setConnected(true);
      sync();
    });
    let active = true;
    stream.addEventListener("entry", async (event: MessageEvent<string>) => {
      try {
        const { id, revision } = JSON.parse(event.data);
        if (revision <= fullRevision.current || revision <= (changes.current.get(id)?.revision ?? -1)) return;
        const update = await api<{ entry: Entry; revision: number }>("/api/entries/" + encodeURIComponent(id));
        if (active) applyEntry(update);
      } catch { if (active) sync(); }
    });
    stream.addEventListener("change", sync);
    stream.addEventListener("auth", clear);
    stream.onerror = () => setConnected(false);
    const focus = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", focus);
    return () => {
      active = false;
      stream.close();
      document.removeEventListener("visibilitychange", focus);
    };
  }, [userId, refresh, clear, applyEntry]);
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
    key: string = crypto.randomUUID(),
  ) {
    const generation = epoch.current;
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
    if (generation !== epoch.current) return result;
    const update = result as { entry?: Entry; revision?: number };
    if (update.entry && update.revision !== undefined && !(path === "/api/timer/start" && (data as { expectedRunningId?: string }).expectedRunningId)) {
      applyEntry({ entry: update.entry, revision: update.revision });
    } else await refresh().catch(() =>
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
        requestWeek,
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
