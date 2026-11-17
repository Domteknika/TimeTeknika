import { LiveDuration } from "@/components/live-duration";
import { roleLabel, canViewTeam } from "@/lib/roles";
import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  Clock3,
  Inbox,
  ListTodo,
  FolderOpen,
  UsersRound,
  ChartNoAxesCombined,
  Settings2,
  LogOut,
  Menu,
  X,
  ArrowUpRight,
  Square,
  Loader2,
  WifiOff,
  FileDown,
} from "lucide-react";
import { toast } from "sonner";
import { useApp, useWorkspace, useNow } from "@/lib/app-context";
import { duration, elapsed, dayKey, clockTime } from "@/lib/time";
import { LoginPage } from "@/pages/login-page";
import { TimePage } from "@/pages/time-page";
import { CatalogPage } from "@/pages/catalog-page";
import { SettingsPage } from "@/pages/settings-page";
import { EntryEditor } from "@/components/editors";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Entry } from "@/lib/types";
const loadReports = () => import("@/pages/reports-page").then(m => ({ default: m.ReportsPage }));
const loadExports = () => import("@/pages/exports-page").then(m => ({ default: m.ExportsPage }));
const ReportsPage = lazy(loadReports);
const ExportsPage = lazy(loadExports);
function preloadPage(page: string) {
  if (page === "reports") void loadReports().catch(() => {});
  if (page === "exports") void loadExports().catch(() => {});
}
const navigation = [
  ["timer", "Mon temps", Clock3],
  ["unclassified", "À classer", Inbox],
  ["tasks", "Tâches", ListTodo],
  ["projects", "Projets", FolderOpen],
  ["clients", "Clients", UsersRound],
  ["reports", "Rapports", ChartNoAxesCombined],
  ["exports", "Exports", FileDown],
  ["settings", "Mon profil", Settings2],
] as const;
type Page = (typeof navigation)[number][0];
const isPage = (p: string): p is Page => navigation.some((n) => n[0] === p);
export default function App() {
  const { state, loading, error } = useApp();
  if (loading)
    return (
      <div className="loading-screen">
        <Loader2 className="animate-spin" />
        Ouverture de votre espace…
      </div>
    );
  if (!state) return <LoginPage />;
  return (
    <AppBoundary>
      <Workspace key={state.me.id} />
      {error && <p role="alert">{error}</p>}
    </AppBoundary>
  );
}
function Workspace() {
  const { state, connected, logout, mutate, preference } = useWorkspace();
  const now = useNow();
  const initial =
    location.hash.slice(1) || state.me.preferences.page || "timer";
  const [page, setPage] = useState<Page>(isPage(initial) ? initial : "timer"),
    [menu, setMenu] = useState(false),
    [edit, setEdit] = useState<Entry | null>(null);
  const running = state.entries.find(
      (e) => e.user_id === state.me.id && e.end === null,
    ),
    unclassified = state.entries.filter(
      (e) => e.user_id === state.me.id && !e.task_id,
    ).length;
  const [timerBusy, setTimerBusy] = useState(false);
  useEffect(() => {
    const hash = () => {
      const p = location.hash.slice(1);
      if (isPage(p)) setPage(p);
    };
    window.addEventListener("hashchange", hash);
    return () => window.removeEventListener("hashchange", hash);
  }, []);
  useEffect(() => {
    document.title =
      (navigation.find((n) => n[0] === page)?.[1] ?? "TimeTeknika") +
      " · TimeTeknika";
  }, [page]);
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');

    if (!link) return;
    link.href = running ? "/favicon-active.svg" : "/favicon.svg";
    return () => {
      link.href = "/favicon.svg";
    };
  }, [!!running]);
  const go = (p: Page) => {
    setPage(p);
    setMenu(false);
    location.hash = p;
    if (p !== "exports")
      void preference({ page: p }).catch((e) => toast.error(e.message));
  };
  const stop = async () => {
    if (!running || timerBusy) return;
    setTimerBusy(true);
    try {
      await mutate(
        "/api/timer/stop",
        "POST",
        { id: running.id, version: running.version },
        "Chrono arrêté.",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTimerBusy(false);
    }
  };
  const long = running && now - running.start > 6 * 3600000;
  const reminder =
    Number(clockTime(now).split(":")[0]) >=
      (state.me.preferences.reminderHour ?? 16) && unclassified > 0;
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Aller au contenu
      </a>
      {menu && (
        <button
          className="sidebar-backdrop"
          aria-label="Fermer le menu"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={"app-sidebar " + (menu ? "open" : "")}>
        <div className="brand">
          <span className="brand-symbol">t.</span>
          <span>
            TimeTeknika<span className="brand-caption">LE TEMPS EN ÉQUIPE</span>
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto lg:hidden"
            aria-label="Fermer le menu"
            onClick={() => setMenu(false)}
          >
            <X />
          </Button>
        </div>
        <div className="workspace-card">
          <span className="workspace-icon">T</span>
          <div>
            <b>Espace Teknika</b>
            <small>Votre équipe, réunie.</small>
          </div>
          <span className="workspace-dot" />
        </div>
        <div className="nav-caption">AU QUOTIDIEN</div>
        <nav aria-label="Navigation principale" className="app-nav">
          {navigation
            .filter((n) => n[0] !== "settings")
            .map(([id, label, Icon]) => (
              <button
                key={id}
                aria-current={page === id ? "page" : undefined}
                onPointerEnter={() => preloadPage(id)}
                onFocus={() => preloadPage(id)}
                onClick={() => go(id)}
              >
                <Icon size={18} />
                <span>{label}</span>
                {id === "unclassified" && unclassified > 0 && (
                  <span className="nav-count">{unclassified}</span>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <ArrowUpRight size={22} />
            <b>
              Chaque minute.
              <br />
              Un projet commun.
            </b>
            <p>
              Une vision claire du travail
              <br />
              que vous faites ensemble.
            </p>
          </div>
          <div
            className={"connection-status " + (connected ? "connected" : "")}
          >
            <i />
            {connected ? "Synchronisé en direct" : "Reconnexion…"}
          </div>
          <nav className="app-nav">
            <button
              aria-current={page === "settings" ? "page" : undefined}
              onClick={() => go("settings")}
            >
              <Settings2 size={18} />
              <span>Mon profil</span>
            </button>
          </nav>
          <div className="profile-row">
            <span
              className="mini-avatar"
              style={{ background: state.me.color }}
            >
              {state.me.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </span>
            <div>
              <b>{state.me.name}</b>
              <small>
                {roleLabel(state.me.role)}
              </small>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Se déconnecter"
              onClick={() => void logout().catch((e) => toast.error(e.message))}
            >
              <LogOut size={16} />
            </Button>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Ouvrir le menu"
              onClick={() => setMenu(true)}
            >
              <Menu />
            </Button>
            <span className="hidden text-muted-foreground sm:inline">
              Espace de travail
            </span>
            <span className="hidden text-border sm:inline">/</span>
            <b>{navigation.find((n) => n[0] === page)?.[1]}</b>
          </div>
          <div className="flex items-center gap-3">
            {running && page !== "timer" && page !== "unclassified" && (
              <div className="running-top">
                <button
                  onClick={() => go("timer")}
                  className="flex items-center gap-2"
                >
                  <Clock3 size={14} />
                  <LiveDuration entry={running} />
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Arrêter le chrono"
                  disabled={timerBusy}
                  onClick={() => void stop()}
                >
                  <Square className="size-3 fill-current" />
                </Button>
              </div>
            )}
            {state.demo && <Badge variant="secondary">DÉMONSTRATION</Badge>}
            <span className="hidden text-xs text-muted-foreground md:inline">
              {new Intl.DateTimeFormat("fr-CH", {
                timeZone: "Europe/Zurich",
                day: "numeric",
                month: "long",
                year: "numeric",
              }).format(now)}
            </span>
          </div>
        </header>
        {!connected && (
          <div className="connection-banner">
            <WifiOff size={16} />
            Connexion interrompue. Le chrono continue ; les modifications
            nécessitent une connexion.
          </div>
        )}
        <main className="page-content" id="main-content" tabIndex={-1}>
          {long && (
            <div className="timer-warning">
              <div>
                <b>Votre chrono dépasse 6 heures.</b>
                <p>
                  {running.description || "Activité en cours"} ·{" "}
                  <LiveDuration entry={running} />
                </p>
              </div>
              <Button variant="outline" onClick={() => setEdit(running)}>
                Corriger l’heure de fin
              </Button>
              <Button disabled={timerBusy} onClick={() => void stop()}>
                Arrêter le chrono
              </Button>
            </div>
          )}
          {reminder && page !== "unclassified" && (
            <button
              className="classification-reminder"
              onClick={() => go("unclassified")}
            >
              <Inbox size={15} />
              {unclassified} temps à classer. Prenez un instant pour les ranger.
              <ArrowUpRight size={14} />
            </button>
          )}
          <Suspense
            fallback={
              <div className="loading-screen">
                <Loader2 className="animate-spin" />
                Chargement…
              </div>
            }
          >
            {page === "timer" || page === "unclassified" ? (
              <TimePage key={page} unclassified={page === "unclassified"} />
            ) : page === "tasks" ||
              page === "projects" ||
              page === "clients" ? (
              <CatalogPage key={page} kind={page} />
            ) : page === "reports" ? (
              <ReportsPage onExport={() => go("exports")} />
            ) : page === "exports" ? (
              <ExportsPage />
            ) : (
              <SettingsPage />
            )}
          </Suspense>
        </main>
      </div>
      {edit && <EntryEditor entry={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
class AppBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="loading-screen">
        <h1>L’interface a rencontré une erreur.</h1>
        <p>Vos temps restent enregistrés sur le serveur.</p>
        <Button onClick={() => location.reload()}>Recharger la page</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
