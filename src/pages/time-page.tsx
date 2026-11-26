import { SaveStatus, useEntrySaves } from "@/components/entry-autosave";
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
import type { Entry, Snapshot } from "@/lib/types";
import { layoutCalendarDay } from "@/lib/calendar-layout";
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
} from "@/lib/time";
import {
  weeklyProgress,
  cumulativeProgress,
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
  day,
}: {
  entries: Entry[];
  day?: string;
  onEdit: (entry: Entry) => void;
  onHistory: (entry: Entry) => void;
  onContinue?: (entry: Entry) => void;
}) {
  const { state, mutate } = useWorkspace();
  const from = day ? midnight(day) : -Infinity, to = day ? midnight(shiftDay(day, 1)) : Infinity;
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
              {clockTime(Math.max(from, e.start))} —{" "}
              {e.end === null && Date.now() < to ? "en cours" : clockTime(Math.min(e.end ?? Date.now(), to))}
            </span>
            <strong
              className={
                "font-mono text-sm tabular-nums " +
                (e.end === null ? "text-primary" : "")
              }
            >
              <LiveDuration entry={{ ...e, start: Math.max(e.start, from), end: (e.end ?? Date.now()) >= to ? to : e.end }} />
            </strong>
            <div className="flex gap-0.5">
              {own && onContinue && resumable(e, state) && (
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
  const { state, mutate, preference, requestWeek } = useWorkspace();
  const now = useNow();
  const mobile = useSyncExternalStore(subscribeToMobileViewport, isMobileViewport);
  const [view, setView] = useState(state.me.preferences.timerView ?? "list"),
    [offset, setOffset] = useState(0);
  const [calendarDay, setCalendarDay] = useState<string | null>(null);
  const [idle, setIdle] = useState({ description: "", task: "", project: "" });
  const saves = useEntrySaves();
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
  const draftKey = running ? saves.keyFor(running) : "";
  const values = running ? saves.values(draftKey, running) : undefined;
  const description = values?.description ?? idle.description;
  const task = values ? values.task_id ?? "" : idle.task;
  const project = values ? values.project_id ?? "" : idle.project;
  const selectClassification = (task: string, project: string) => {
    if (running) saves.edit(draftKey, running, { task_id: task || null, project_id: project || null });
    else setIdle(previous => ({ ...previous, task, project }));
  };
  const previousTimer = useRef(running?.id);
  useEffect(() => {
    if (previousTimer.current !== running?.id) setIdle({ description: "", task: "", project: "" });
    previousTimer.current = running?.id;
  }, [running?.id]);
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
  useEffect(() => { requestWeek(viewedWeekStart); }, [viewedWeekStart, requestWeek]);
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
  const partialBalance = useMemo(() => cumulativeProgress(
    own,
    midnight(balanceStart),
    midnight(weekEnd),
    prefs.weeklyTargetMinutes,
    now,
    targets.balance.adjusted,
  ), [own, balanceStart, weekEnd, prefs.weeklyTargetMinutes, targets.balance.adjusted, now]);
  const partialPrevious = useMemo(() => cumulativeProgress(
    own,
    midnight(balanceStart),
    midnight(weekStart),
    prefs.weeklyTargetMinutes,
    now,
    targets.previous.adjusted,
  ), [own, balanceStart, weekStart, prefs.weeklyTargetMinutes, targets.previous.adjusted, now]);
  const includeHistory = (summary: typeof partialBalance) => {
    const seconds = summary.seconds + (state.entryWindow?.omittedSeconds ?? 0);
    const target = summary.target;
    const balance = target === null ? null : seconds - target;
    return { ...summary, seconds, balance };
  };
  const balance = includeHistory(partialBalance), previous = includeHistory(partialPrevious);
  const rangeStart = midnight(days[0]);
  const rangeEnd = midnight(shiftDay(days[days.length - 1], 1));
  const visible = useMemo(() => own.filter((e) =>
    unclassified
      ? !e.task_id
      : e.start < rangeEnd && (e.end ?? now) >= rangeStart,
  ), [own, unclassified, rangeStart, rangeEnd, now]);
  const groups = (() => {
    const byDay = new Map<string, Entry[]>();
    if (unclassified) {
      for (const entry of visible) {
        const lastDay = dayKey(Math.max(entry.start, (entry.end ?? now) - 1));
        for (let day = dayKey(entry.start); day <= lastDay; day = shiftDay(day, 1)) {
          const items = byDay.get(day) ?? [];
          items.push(entry); byDay.set(day, items);
        }
      }
    } else if (!showCalendar) {
      for (const day of days) {
        const from = midnight(day), to = midnight(shiftDay(day, 1));
        const items = visible.filter(e => inPeriod(e, from, to, now));
        if (items.length) byDay.set(day, items);
      }
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
    if (from && running && (from.task_id ? from.task_id === running.task_id :
      !running.task_id && from.project_id === running.project_id && from.description === running.description)) {
      toast.info("Le chrono de cette tâche est déjà en cours.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = running ? await saves.flush(draftKey) : undefined;
      await mutate(
        "/api/timer/start",
        "POST",
        {
          task_id: from ? from.task_id : task || null,
          project_id: from ? from.project_id : project || null,
          description: from?.description ?? description,
          expectedRunningId: running?.id ?? null,
          expectedVersion: running ? Math.max(saved?.version ?? 0, running.version) : undefined,
        },
        "Chrono démarré.",
      );
      setIdle({ description: "", task: "", project: "" });
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
      const saved = await saves.flush(draftKey);
      await mutate(
        "/api/timer/stop",
        "POST",
        { id: running.id, version: Math.max(saved?.version ?? 0, running.version) },
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
            disabled={busy}
            onChange={(e) => running ? saves.edit(draftKey, running, { description: e.target.value }, 500)
              : setIdle({ ...idle, description: e.target.value })}
            maxLength={2000}
            className="border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0"
          />
          <Classification
            disabled={busy}
            taskId={task}
            projectId={project}
            onCreateTask={() => setCreateTask(true)}
            onChange={selectClassification}
          />
          {running && <SaveStatus draftKey={draftKey} entry={running} />}
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
          onContinue={(entry) => void start(entry)}
          timerBusy={busy}
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
                        weeklyProgress(entries, midnight(d), midnight(shiftDay(d, 1)), null, now).seconds,
                      )}
                    </span>
                  </div>
                  {entries.length > 0 && <EntryList
                    entries={entries}
                    day={d}
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
  onContinue,
  timerBusy,
  onCreate,
}: {
  entries: Entry[];
  days: string[];
  daily: boolean;
  calendar: ReturnType<typeof workCalendar>;
  onEditLeave: (leave: Leave) => void;
  onEdit: (entry: Entry) => void;
  onContinue: (entry: Entry) => void;
  timerBusy: boolean;
  onCreate: (start: string, end: string) => void;
}) {
  const { state, preference } = useWorkspace(),
    prefs = state.me.preferences;
  const now = useNow(entries.some(e => e.end === null) ? 1000 : 60000);
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
    const [h, m, s] = clockTime(ms, true).split(":").map(Number);
    return h + m / 60 + s / 3600;
  };
  const columns = shown.map((day) => {
    const from = midnight(day);
    const to = midnight(shiftDay(day, 1));
    const segments = entries.filter((entry) => inPeriod(entry, from, to, now))
      .map((entry) => ({
        ...entry,
        key: `${entry.id}:${day}`,
        topHour: entry.start <= from ? 0 : hour(entry.start),
        endHour: (entry.end ?? now) >= to ? 24 : hour(entry.end ?? now),
      }));
    return {
      day,
      total: weeklyProgress(entries, from, to, null, now).seconds,
      ...layoutCalendarDay(segments, scale, min, max, daily ? 18 : 14),
    };
  });
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
            ? "Touchez un bloc pour le modifier, ▶ pour relancer, ou une zone libre pour ajouter du temps."
            : "Cliquez sur un bloc pour le modifier, sur ▶ pour relancer. Glissez sur une zone libre pour ajouter du temps."}
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
          {columns.map(({ day, total }) => (
            <div key={day} className={"calendar-day-head" + (day === today ? " today" : "")}>
              <b>{daily ? "Temps saisi" : prettyDay(day, true)}</b>
              <span className="calendar-day-total">{duration(total)}</span>
              <WorkDayMarks info={calendar.details(day)} onEdit={onEditLeave} />
            </div>
          ))}
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
          {columns.map(({ day, blocks, markers }) => {
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
                    (e.target as Element).closest("button")
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
                {markers.map((entry) => {
                  const { color, editLabel } = calendarActivity(entry, state, now, day, true);
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      className="calendar-short-mark"
                      style={{
                        top: entry.top,
                        height: entry.height,
                        left: `calc(${(entry.column * 100) / entry.columns}% + 1px)`,
                        width: `max(1px, ${(entry.span * 100) / entry.columns}% - 2px)`,
                        backgroundColor: color,
                      }}
                      title={editLabel}
                      aria-label={editLabel}
                      onClick={() => onEdit(entry)}
                    />
                  );
                })}
                {blocks.map((entry) => {
                  const { color, label, timing, resumeLabel, editLabel } = calendarActivity(entry, state, now, day);
                  return (
                    <div
                      key={entry.key}
                      className={"calendar-block" + (entry.end === null ? " active" : "")}
                      style={{
                        top: entry.top,
                        height: entry.height,
                        left: `calc(${(entry.column * 100) / entry.columns}% + 3px)`,
                        width: `calc(${(entry.span * 100) / entry.columns}% - 6px)`,
                        background: `color-mix(in srgb, ${color} 16%, white)`,
                        borderColor: color,
                      }}
                    >
                      <button
                        type="button"
                        className={"calendar-entry" + (resumeLabel ? " can-resume" : "")}
                        title={editLabel}
                        aria-label={editLabel}
                        onClick={() => onEdit(entry)}
                      >
                        <b>{label}</b>
                        {entry.description && <small className="block truncate">{entry.description}</small>}
                        <span className="calendar-entry-time">{timing}</span>
                      </button>
                      {resumeLabel && (
                        <button
                          type="button"
                          className="calendar-entry-resume"
                          title="Relancer le chrono"
                          aria-label={resumeLabel}
                          disabled={timerBusy}
                          onClick={() => onContinue(entry)}
                        >
                          <span className="calendar-entry-resume-icon">
                            <Play aria-hidden="true" size={11} />
                          </span>
                        </button>
                      )}
                    </div>
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

function shortDuration(seconds: number) {
  const total = Math.floor(seconds);
  if (total >= 3600) return duration(total, true);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  if (!minutes) return `${remainder} s`;
  return `${minutes} min${remainder ? ` ${remainder} s` : ""}`;
}

function inPeriod(entry: Entry, from: number, to: number, now: number) {
  return entry.start < to && ((entry.end ?? now) > from || entry.start === from);
}
function resumable(entry: Entry, state: Snapshot) {
  if (entry.end === null || entry.user_id !== state.me.id) return false;
  const project = state.projects.find(p => p.id === entry.project_id);
  const task = state.tasks.find(t => t.id === entry.task_id);
  return (!entry.project_id || (project && !project.archived)) &&
    (!entry.task_id || (task && !task.archived && task.assignees.includes(state.me.id) && task.project_id === entry.project_id));
}
function calendarActivity(entry: Entry, state: Snapshot, now: number, day: string, showSeconds = false) {
  const task = state.tasks.find((item) => item.id === entry.task_id);
  const project = state.projects.find((item) => item.id === (entry.project_id ?? task?.project_id));
  const canContinue = resumable(entry, state);
  const classification = [task?.name || "À classer", project?.name].filter(Boolean).join(" · ");
  const label = entry.description ? entry.description + " · " + classification : classification;
  const start = Math.max(entry.start, midnight(day));
  const end = Math.min(entry.end ?? now, midnight(shiftDay(day, 1)));
  const seconds = Math.max(0, (end - start) / 1000);
  const startTime = clockTime(start, showSeconds);
  const elapsedTime = showSeconds ? shortDuration(seconds) : duration(seconds);
  const timing = `${startTime} · ${elapsedTime}`;
  return {
    color: project?.color ?? "#aaa", label: classification, timing,
    resumeLabel: canContinue ? `Relancer le chrono · ${label} · ${timing}` : undefined,
    editLabel: `${entry.end === null ? "Modifier le chrono en cours" : "Modifier ce temps"} · ${label} · ${timing}`,
  };
}
