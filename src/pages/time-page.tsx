import { LiveDuration } from "@/components/live-duration";
import { useState, useEffect, useRef, useMemo, useSyncExternalStore } from "react";
import {
  Plus,
  Play,
  Square,
  List,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Pencil,
  History,
  Trash2,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspace, useNow } from "@/lib/app-context";
import type { Entry } from "@/lib/types";
import { emptyWorkTime, workMinutesLabel } from "@/lib/work-time";
import { weekday, workCalendar, type Leave } from "../../public/work-schedule.js";
import { LeaveEditor, WorkDayMarks } from "@/components/work-time";
import {
  dayKey,
  prettyDay,
  weekDays,
  shiftDay,
  midnight,
  clockTime,
  duration,
  elapsed,
} from "@/lib/time";
import {
  weeklyProgress,
  cumulativeProgress,
  layoutCalendarEntries,
  calendarSelection,
  calendarWallTime,
  isoWeek,
} from "../../public/calendar-utils.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Classification } from "@/components/classification";
import {
  PageHeading,
  Empty,
  Modal,
  ErrorMessage,
  NativeSelect,
} from "@/components/shared";
import { CatalogEditor, EntryEditor, EntryHistory, deleteEntry } from "@/components/editors";

const mobileViewport = window.matchMedia(
  "(max-width: 767px), (max-height: 767px) and (pointer: coarse)",
);
function subscribeToMobileViewport(onChange: () => void) {
  mobileViewport.addEventListener("change", onChange);
  return () => mobileViewport.removeEventListener("change", onChange);
}
const isMobileViewport = () => mobileViewport.matches;

export function EntryList({
  entries,
  onEdit,
  onHistory,
  onContinue,
}: {
  entries: Entry[];
  onEdit: (entry: Entry) => void;
  onHistory: (entry: Entry) => void;
  onContinue?: (entry: Entry) => void;
}) {
  const { state, mutate } = useWorkspace();
  if (!entries.length)
    return (
      <Empty
        title="Aucun temps pour le moment"
        description="Démarrez votre chrono ou ajoutez un temps manuellement."
      />
    );
  return (
    <div className="divide-y">
      {entries.map((e) => {
        const p = state.projects.find((p) => p.id === e.project_id),
          t = state.tasks.find((t) => t.id === e.task_id),
          own = e.user_id === state.me.id;
        return (
          <div key={e.id} className="entry-row">
            <i
              className="entry-color"
              style={{ background: p?.color ?? "#ccc" }}
            />
            <div className="min-w-0 flex-1">
              <button
                className="block max-w-full truncate text-left text-sm font-medium hover:text-primary"
                onClick={() => (own ? onEdit(e) : onHistory(e))}
              >
                {e.description || "Sans description"}
              </button>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {!own && (
                  <span>
                    {state.users.find((u) => u.id === e.user_id)?.name} ·{" "}
                  </span>
                )}
                {t ? (
                  <span>{t.name}</span>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">
                    À classer
                  </Badge>
                )}
                {p && (
                  <>
                    <span>·</span>
                    <span>{p.name}</span>
                  </>
                )}
              </div>
            </div>
            <span className="hidden text-xs text-muted-foreground sm:block">
              {clockTime(e.start)} —{" "}
              {e.end === null ? "en cours" : clockTime(e.end)}
            </span>
            <strong
              className={
                "font-mono text-sm tabular-nums " +
                (e.end === null ? "text-primary" : "")
              }
            >
              <LiveDuration entry={e} />
            </strong>
            <div className="flex gap-0.5">
              {own && onContinue && e.end !== null && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Continuer cette activité"
                  onClick={() => onContinue(e)}
                >
                  <Play size={15} />
                </Button>
              )}
              {own && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Modifier ce temps"
                  onClick={() => onEdit(e)}
                >
                  <Pencil size={15} />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                aria-label="Historique de ce temps"
                onClick={() => onHistory(e)}
              >
                <History size={15} />
              </Button>
              {own && e.end !== null && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Supprimer ce temps"
                  onClick={() =>
                    void deleteEntry(e, mutate).catch((err) =>
                      toast.error(err.message),
                    )
                  }
                >
                  <Trash2 size={15} />
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
export function TimePage({ unclassified = false }: { unclassified?: boolean }) {
  const { state, mutate, preference } = useWorkspace();
  const now = useNow();
  const mobile = useSyncExternalStore(subscribeToMobileViewport, isMobileViewport);
  const [view, setView] = useState(state.me.preferences.timerView ?? "list"),
    [offset, setOffset] = useState(0);
  const [calendarDay, setCalendarDay] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [selection, setSelection] = useState({ task: "", project: "", runningId: "" });
  const [createTask, setCreateTask] = useState(false);
  const [leaveEdit, setLeaveEdit] = useState<{ date: string; entry?: Leave } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [edit, setEdit] = useState<{
      entry?: Entry;
      initialStart?: string;
      initialEnd?: string;
    } | null>(null),
    [history, setHistory] = useState<Entry | null>(null),
    [balanceInfo, setBalanceInfo] = useState(false);
  const own = useMemo(() => state.entries.filter((e) => e.user_id === state.me.id), [state.entries, state.me.id]),
    running = own.find((e) => e.end === null);
  const runningTaskId = running?.task_id ?? "";
  const runningProjectId = running?.project_id ?? "";
  const { task, project } = running && selection.runningId !== running.id
    ? { task: runningTaskId, project: runningProjectId }
    : selection;
  const selectClassification = (task: string, project: string) =>
    setSelection({ task, project, runningId: running?.id ?? "" });
  const runningClassification = [
    runningTaskId && state.tasks.find((item) => item.id === runningTaskId)?.name,
    runningProjectId && state.projects.find((item) => item.id === runningProjectId)?.name,
  ].filter(Boolean).join(" · ");
  const showCalendar = !unclassified && view === "calendar";
  const dailyCalendar = showCalendar && mobile;
  const today = dayKey(now);
  const viewedDay = calendarDay ?? today;
  const days = dailyCalendar ? [viewedDay] : weekDays(offset, now);
  const current = weekDays(0, now);
  const prefs = state.me.preferences;
  const workTime = state.workTime ?? emptyWorkTime;
  const calendar = useMemo(() => workCalendar(workTime.schedules, workTime.leaves, workTime.holidays, prefs.weeklyTargetMinutes),
    [workTime, prefs.weeklyTargetMinutes]);
  const weekStart = current[0];
  const weekEnd = shiftDay(weekStart, 7);
  const viewedWeekStart = shiftDay(days[0], -weekday(days[0]));
  const balanceStart = prefs.balanceStartDate ?? weekStart;
  const targets = useMemo(() => ({
    week: calendar.total(weekStart, weekEnd),
    balance: calendar.total(balanceStart, weekEnd),
    previous: calendar.total(balanceStart, weekStart),
  }), [calendar, balanceStart, weekStart, weekEnd]);
  const viewedTarget = useMemo(() => calendar.total(viewedWeekStart, shiftDay(viewedWeekStart, 7)), [calendar, viewedWeekStart]);
  const totalToday = useMemo(() => weeklyProgress(
    own,
    midnight(today),
    midnight(shiftDay(today, 1)),
    null,
    now,
  ), [own, today, now]);
  const week = useMemo(() => weeklyProgress(
    own,
    midnight(weekStart),
    midnight(weekEnd),
    targets.week.adjusted,
    now,
  ), [own, weekStart, weekEnd, targets.week.adjusted, now]);
  const balance = useMemo(() => cumulativeProgress(
    own,
    midnight(balanceStart),
    midnight(weekEnd),
    prefs.weeklyTargetMinutes,
    now,
    targets.balance.adjusted,
  ), [own, balanceStart, weekEnd, prefs.weeklyTargetMinutes, targets.balance.adjusted, now]);
  const previous = useMemo(() => cumulativeProgress(
    own,
    midnight(balanceStart),
    midnight(weekStart),
    prefs.weeklyTargetMinutes,
    now,
    targets.previous.adjusted,
  ), [own, balanceStart, weekStart, prefs.weeklyTargetMinutes, targets.previous.adjusted, now]);
  const rangeStart = midnight(days[0]);
  const rangeEnd = midnight(shiftDay(days[days.length - 1], 1));
  const visible = useMemo(() => own.filter((e) =>
    unclassified
      ? !e.task_id
      : e.start < rangeEnd && (e.end ?? now) >= rangeStart,
  ), [own, unclassified, rangeStart, rangeEnd, now]);
  const groups = (() => {
    const byDay = new Map<string, Entry[]>();
    for (const entry of visible) {
      const day = dayKey(entry.start);
      const items = byDay.get(day) ?? [];
      items.push(entry); byDay.set(day, items);
    }
    if (!unclassified && !showCalendar) {
      for (const day of days) {
        const { holiday, absences } = calendar.details(day);
        if ((holiday || absences.length) && !byDay.has(day)) byDay.set(day, []);
      }
    }
    return [...byDay].sort(([a], [b]) => b.localeCompare(a));
  })();
  const editLeave = (entry: Leave) => setLeaveEdit({ date: entry.start_date, entry });
  async function start(from?: Entry) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await mutate(
        "/api/timer/start",
        "POST",
        {
          task_id: from ? from.task_id : task || null,
          project_id: from ? from.project_id : project || null,
          description: from?.description ?? description,
          expectedRunningId: running?.id ?? null,
          expectedVersion: running?.version,
        },
        "Chrono démarré.",
      );
      if (!from) setDescription("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    if (!running || busy) return;
    setBusy(true);
    setError("");
    try {
      await mutate(
        "/api/timer/stop",
        "POST",
        { id: running.id, version: running.version },
        "Chrono arrêté.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const balanceLabel = (v: typeof balance) =>
    v.target === null
      ? "Objectif à définir"
      : v.weeks === 0
        ? "Pas encore de semaine terminée"
        : v.balance! < 0
          ? "À rattraper"
          : v.balance! > 0
            ? "À récupérer"
            : "À l’équilibre";
  const balanceClass = (v: typeof balance) =>
    v.target === null || v.weeks === 0 || !v.balance
      ? ""
      : v.balance < 0 ? "balance-negative" : "balance-positive";
  const changeView = (v: "list" | "calendar") => {
    if (v !== view && v === "calendar") setCalendarDay(null);
    setView(v);
    void preference({ timerView: v }).catch((e) => toast.error(e.message));
  };
  const movePeriod = (direction: number) => {
    if (dailyCalendar) {
      setCalendarDay((day) => {
        const nextDay = shiftDay(day ?? today, direction);
        return nextDay === today ? null : nextDay;
      });
    } else {
      setOffset((week) => week + direction);
    }
  };
  const resetPeriod = () => {
    if (dailyCalendar) setCalendarDay(null);
    else setOffset(0);
  };
  return (
    <>
      <PageHeading
        title={
          unclassified
            ? "Un peu d’ordre dans vos temps."
            : "Votre temps, en perspective."
        }
        description={
          unclassified
            ? "Retrouvez vos activités sans tâche et donnez-leur un projet."
            : "Gardez le fil de votre journée. Chaque minute compte."
        }
      >
        <Button variant="outline" onClick={() => setEdit({})}>
          <Plus />
          Ajouter du temps
        </Button>
      </PageHeading>
      <section className="summary-grid" aria-label="Résumé de mon temps">
        <div>
          <span>Aujourd’hui</span>
          <strong>{duration(totalToday.seconds)}</strong>
          <small>{prettyDay(today, true)}</small>
        </div>
        <div>
          <span>Cette semaine</span>
          <strong>
            {duration(week.seconds)}{" "}
            <em>{week.target === null ? "" : "/ " + duration(week.target)}</em>
          </strong>
          <Progress value={week.percent} className="mt-2 h-1.5" />
          <small>
            {week.target === null
              ? "Définissez votre objectif dans Mon profil"
              : targets.week.holiday + targets.week.leave > 0
                ? "Objectif ajusté · −" + workMinutesLabel(targets.week.holiday + targets.week.leave)
                : "Objectif hebdomadaire"}
          </small>
        </div>
        <div>
          <button
            className="flex items-center gap-2 text-xs text-muted-foreground"
            onClick={() => setBalanceInfo(true)}
          >
            Solde global
            <ArrowUpRight size={13} />
          </button>
          <strong className={balanceClass(balance)}>
            {balance.target === null
              ? "—"
              : duration(Math.abs(balance.balance ?? 0))}
          </strong>
          <small className={balanceClass(balance)}>{balanceLabel(balance)}</small>
        </div>
        <div>
          <span>Semaines précédentes</span>
          <strong className={balanceClass(previous)}>
            {previous.target === null
              ? "—"
              : duration(Math.abs(previous.balance ?? 0))}
          </strong>
          <small className={balanceClass(previous)}>{balanceLabel(previous)}</small>
        </div>
      </section>
      <Card className={"timer-card " + (running ? "is-running" : "")}>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Input
            aria-label="Description du chrono"
            placeholder="Sur quoi travaillez-vous ?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            className="border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0"
          />
          <Classification
            taskId={task}
            projectId={project}
            onCreateTask={() => setCreateTask(true)}
            onChange={selectClassification}
          />
        </div>
        <div className="timer-actions">
          <div>
            <span className="eyebrow">
              {running ? "CHRONO EN COURS" : "PRÊT À COMMENCER"}
            </span>
            <strong className="timer-digits">
              {running ? <LiveDuration entry={running} /> : "00:00:00"}
            </strong>
            {running && (
              <div className="max-w-52 text-muted-foreground">
                {running.description && (
                  <small className="block truncate" title={running.description}>{running.description}</small>
                )}
                <small className="block break-words" aria-live="polite">
                  {runningClassification || "À classer"}
                </small>
              </div>
            )}
          </div>
          {running ? (
            <Button
              size="lg"
              disabled={busy}
              onClick={() => void stop()}
              aria-label="Arrêter le chrono"
            >
              <Square className="fill-current" />
              Arrêter
            </Button>
          ) : (
            <Button size="lg" disabled={busy} onClick={() => void start()}>
              <Play className="fill-current" />
              Démarrer
            </Button>
          )}
          {running && (description || task !== runningTaskId || project !== runningProjectId) && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void start()}
            >
              Basculer sur cette activité
            </Button>
          )}
        </div>
      </Card>
      <ErrorMessage message={error} />
      <div className="section-toolbar">
        <div className="flex flex-wrap items-center gap-2">
          {unclassified ? (
            <h2>{visible.length} temps à classer</h2>
          ) : (
            <>
              <Button
                variant="outline"
                size="icon"
                className={dailyCalendar ? "size-11" : undefined}
                aria-label={dailyCalendar ? "Jour précédent" : "Semaine précédente"}
                onClick={() => movePeriod(-1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className={dailyCalendar ? "size-11" : undefined}
                aria-label={dailyCalendar ? "Jour suivant" : "Semaine suivante"}
                onClick={() => movePeriod(1)}
              >
                <ChevronRight />
              </Button>
              <span className="text-sm font-medium" aria-live="polite">
                {dailyCalendar
                  ? prettyDay(viewedDay)
                  : `${prettyDay(days[0], true)} — ${prettyDay(days[6], true)}`}
              </span>
              {!dailyCalendar && (
                <Badge variant="secondary" className="hidden sm:inline-flex">
                  S{isoWeek(days[0]).number}
                </Badge>
              )}
              {viewedWeekStart !== weekStart && viewedTarget.adjusted !== null && (
                <span className="text-xs text-muted-foreground">
                  Objectif · {workMinutesLabel(viewedTarget.adjusted)}
                </span>
              )}
              {(dailyCalendar ? viewedDay !== today : offset !== 0) && (
                <Button variant="ghost" size="sm" onClick={resetPeriod}>
                  Aujourd’hui
                </Button>
              )}
            </>
          )}
        </div>
        {!unclassified && (
          <div className="segmented">
            <Button
              variant={view === "list" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => changeView("list")}
            >
              <List />
              Liste
            </Button>
            <Button
              variant={view === "calendar" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => changeView("calendar")}
            >
              <CalendarDays />
              Calendrier
            </Button>
          </div>
        )}
      </div>
      {showCalendar ? (
        <TimeCalendar
          entries={visible}
          days={days}
          daily={dailyCalendar}
          calendar={calendar}
          onEditLeave={editLeave}
          onEdit={(entry) => setEdit({ entry })}
          onCreate={(initialStart, initialEnd) =>
            setEdit({ initialStart, initialEnd })
          }
        />
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          {!groups.length ? (
            <Empty
              title={
                unclassified
                  ? "Tous vos temps sont classés"
                  : "Une semaine à écrire"
              }
              description={
                unclassified
                  ? "Vos activités sont rattachées à leurs tâches."
                  : "Vos temps apparaîtront ici au fil de votre travail."
              }
            />
          ) : (
            groups.map(([d, entries]) => (
                <section key={d}>
                  <div className="day-title">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3>{d === today ? "Aujourd’hui" : prettyDay(d)}</h3>
                      {!unclassified && <WorkDayMarks info={calendar.details(d)} onEdit={editLeave} />}
                    </div>
                    <span>
                      {duration(
                        entries.reduce((n, e) => n + elapsed(e, now), 0),
                      )}
                    </span>
                  </div>
                  {entries.length > 0 && <EntryList
                    entries={entries}
                    onEdit={(entry) => setEdit({ entry })}
                    onHistory={setHistory}
                    onContinue={(entry) => void start(entry)}
                  />}
                </section>
              ))
          )}
        </Card>
      )}
      {createTask && (
        <CatalogEditor
          kind="tasks"
          initialProject={project}
          onClose={() => setCreateTask(false)}
          onCreated={(created) => {
            if (!created.assignees.includes(state.me.id)) return;
            selectClassification(created.id, created.project_id);
          }}
        />
      )}
      {edit && <EntryEditor {...edit} onClose={() => setEdit(null)} />}{" "}
      {leaveEdit && <LeaveEditor {...leaveEdit} calendar={calendar} ownEntries={own} now={now} onClose={() => setLeaveEdit(null)} />}
      {history && (
        <EntryHistory entry={history} onClose={() => setHistory(null)} />
      )}
      {balanceInfo && (
        <Modal
          title="Comprendre votre solde"
          onClose={() => setBalanceInfo(false)}
          description="Les calculs utilisent le fuseau Europe/Zurich."
        >
          <p className="text-sm leading-7">
            Depuis le {prettyDay(balanceStart)}, vos temps sont comparés à
            l’objectif de chaque semaine. L’horaire en vigueur à chaque date
            détermine les heures déduites pour les congés et les jours fériés.
            Les semaines antérieures au premier horaire utilisent l’objectif
            hebdomadaire d’origine. La semaine en cours compte dès le lundi et le
            report des semaines précédentes s’arrête au dimanche passé.
          </p>
          {targets.week.base !== null && <p className="text-sm leading-7">
            Cette semaine · {workMinutesLabel(targets.week.base)} prévues ·
            Congés −{workMinutesLabel(targets.week.leave)} ·
            Jours chômés −{workMinutesLabel(targets.week.holiday)} ·
            Objectif {workMinutesLabel(targets.week.adjusted ?? 0)}
          </p>}
        </Modal>
      )}
    </>
  );
}
function TimeCalendar({
  entries,
  days,
  daily,
  calendar,
  onEditLeave,
  onEdit,
  onCreate,
}: {
  entries: Entry[];
  days: string[];
  daily: boolean;
  calendar: ReturnType<typeof workCalendar>;
  onEditLeave: (leave: Leave) => void;
  onEdit: (entry: Entry) => void;
  onCreate: (start: string, end: string) => void;
}) {
  const { state, preference } = useWorkspace(),
    prefs = state.me.preferences;
  const now = useNow();
  const container = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(620);
  const [headerHeight, setHeaderHeight] = useState(62);
  const [drag, setDrag] = useState<{
    day: string;
    anchor: number;
    cursor: number;
  } | null>(null);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const header = el.querySelector(".calendar-corner");
    const observer = new ResizeObserver(() => {
      setHeight(el.clientHeight);
      if (header) setHeaderHeight(header.getBoundingClientRect().height);
    });
    observer.observe(el);
    if (header) observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const min = prefs.calendarRange === "full" ? 0 : prefs.calendarRange === "extended" ? 8 : 7,
    max = prefs.calendarRange === "full" ? 24 : prefs.calendarRange === "extended" ? 20 : 18;
  const scale =
    prefs.calendarFit !== false
      ? Math.max(20, (height - headerHeight - 8) / (max - min))
      : (prefs.calendarZoom ?? 75);
  const shown = days.slice(0, prefs.calendarDays === 7 ? 7 : 5),
    today = dayKey(now);
  const save = (data: Parameters<typeof preference>[0]) =>
    void preference(data).catch((e) => toast.error(e.message));
  const hour = (ms: number) => {
    const [h, m] = clockTime(ms).split(":").map(Number);
    return h + m / 60;
  };
  const minute = (event: React.PointerEvent<HTMLElement>) =>
    min * 60 +
    ((event.clientY - event.currentTarget.getBoundingClientRect().top) /
      scale) *
      60;
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <p className="text-xs text-muted-foreground">
          {daily
            ? "Touchez un créneau pour ajouter un temps."
            : "Glissez sur une journée pour ajouter un temps."}
        </p>
        <div className="flex flex-wrap gap-2">
          {!daily && (
            <NativeSelect
              label="Jours affichés"
              value={String(prefs.calendarDays ?? 5)}
              onChange={(v) => save({ calendarDays: Number(v) })}
              options={[
                ["5", "5 jours"],
                ["7", "7 jours"],
              ]}
            />
          )}
          <NativeSelect
            label="Plage horaire"
            value={prefs.calendarRange ?? "workday"}
            onChange={(v) => save({ calendarRange: v as "full" | "workday" | "extended" })}
            options={[
              ["workday", "7 h – 18 h"],
              ["extended", "8 h – 20 h"],
              ["full", "24 heures"],
            ]}
          />
          <NativeSelect
            label="Zoom du calendrier"
            value={
              prefs.calendarFit !== false
                ? "fit"
                : String(prefs.calendarZoom ?? 75)
            }
            onChange={(v) =>
              save(
                v === "fit"
                  ? { calendarFit: true }
                  : { calendarFit: false, calendarZoom: Number(v) },
              )
            }
            options={[
              ["fit", "Ajuster"],
              ...([50, 75, 100, 125, 150, 200].map((v) => [
                String(v),
                v + " %",
              ]) as [string, string][]),
            ]}
          />
        </div>
      </div>
      <div ref={container} className="calendar-scroll">
        <div
          className={"calendar-grid" + (daily ? " daily" : "")}
          style={{
            gridTemplateColumns:
              "50px repeat(" + shown.length + ", minmax(115px, 1fr))",
          }}
        >
          <div className="calendar-corner" />
          {shown.map((day) => {
            const from = midnight(day),
              to = midnight(shiftDay(day, 1)),
              total = weeklyProgress(entries, from, to, null, now).seconds;
            return (
              <div
                key={day}
                className={
                  "calendar-day-head " + (day === today ? "today" : "")
                }
              >
                <b>{daily ? "Temps saisi" : prettyDay(day, true)}</b>
                <span>{duration(total)}</span>
                <WorkDayMarks info={calendar.details(day)} onEdit={onEditLeave} />
              </div>
            );
          })}
          <div
            className="calendar-hours"
            style={{ height: (max - min) * scale }}
          >
            {Array.from({ length: max - min }, (_, i) => (
              <span key={i} style={{ top: i * scale }}>
                {min + i}:00
              </span>
            ))}
          </div>
          {shown.map((day) => {
            const from = midnight(day),
              to = midnight(shiftDay(day, 1));
            const segments = layoutCalendarEntries(
              entries
                .filter((e) => e.start < to && (e.end ?? now) >= from)
                .map((e) => ({
                  ...e,
                  key: e.id + ":" + day,
                  topHour: e.start <= from ? 0 : hour(e.start),
                  endHour: (e.end ?? now) >= to ? 24 : hour(e.end ?? now),
                })),
              scale,
              min,
              max,
            ) as (Entry & {
              key: string;
              top: number;
              height: number;
              column: number;
              columns: number;
              span: number;
            })[];
            const selected =
              drag?.day === day
                ? calendarSelection(
                    drag.anchor,
                    drag.cursor,
                    min * 60,
                    max * 60,
                  )
                : null;
            return (
              <div
                key={day}
                className={"calendar-day " + (day === today ? "today" : "")}
                style={{
                  height: (max - min) * scale,
                  backgroundSize: "100% " + scale + "px",
                }}
                onPointerDown={(e) => {
                  if (
                    e.button !== 0 ||
                    (e.target as HTMLElement).closest("button")
                  )
                    return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const m = minute(e);
                  setDrag({ day, anchor: m, cursor: m });
                }}
                onPointerMove={(e) => {
                  if (drag?.day === day)
                    setDrag({ ...drag, cursor: minute(e) });
                }}
                onPointerCancel={() => setDrag(null)}
                onPointerUp={() => {
                  if (drag?.day !== day) return;
                  const range = calendarSelection(
                    drag.anchor,
                    drag.cursor,
                    min * 60,
                    max * 60,
                  );
                  setDrag(null);
                  onCreate(
                    calendarWallTime(day, range.start),
                    calendarWallTime(day, range.end),
                  );
                }}
              >
                {segments.map((e) => {
                  const project = state.projects.find(
                    (p) => p.id === e.project_id,
                  );
                  return (
                    <button
                      key={e.key}
                      className={
                        "calendar-entry " + (e.end === null ? "active" : "")
                      }
                      style={{
                        top: e.top,
                        height: e.height,
                        left:
                          "calc(" + (e.column * 100) / e.columns + "% + 3px)",
                        width:
                          "calc(" + (e.span * 100) / e.columns + "% - 6px)",
                        background: `color-mix(in srgb, ${project?.color ?? "#aaa"} 16%, white)`,
                        borderColor: project?.color ?? "#aaa",
                      }}
                      title={e.description + " · " + duration(elapsed(e, now))}
                      onClick={() => onEdit(e)}
                    >
                      <b>
                        {e.description ||
                          state.tasks.find((t) => t.id === e.task_id)?.name ||
                          "Sans description"}
                      </b>
                      <span>
                        {clockTime(e.start)} · {duration(elapsed(e, now))}
                      </span>
                    </button>
                  );
                })}
                {selected && (
                  <div
                    className="calendar-selection"
                    style={{
                      top: (selected.start / 60 - min) * scale,
                      height: ((selected.end - selected.start) / 60) * scale,
                    }}
                  />
                )}
                {day === today && hour(now) >= min && hour(now) <= max && (
                  <div
                    className="now-line"
                    style={{ top: (hour(now) - min) * scale }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
