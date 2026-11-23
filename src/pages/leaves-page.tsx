import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useNow, useWorkspace } from "@/lib/app-context";
import { dayKey, prettyDay, shiftDay } from "@/lib/time";
import { emptyWorkTime } from "@/lib/work-time";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ErrorMessage, Modal, NativeSelect, PageHeading } from "@/components/shared";
import { AnnualLeaveBalance, HolidayEditor, LeaveEditor } from "@/components/work-time";
import { partLabels, weekday, weekdayNames, workCalendar, type DayPart, type Holiday, type Leave } from "../../public/work-schedule.js";

type TeamAbsence = {
  date: string;
  user_id: string;
  name: string;
  color: string;
} & ({ kind?: undefined; part: DayPart } | { kind: "rest" });

const monthFormat = new Intl.DateTimeFormat("fr-CH", { month: "long", year: "numeric", timeZone: "UTC" });
const shortPart: Record<DayPart, string> = { full: "", am: "Matin", pm: "Après-midi" };
const maxVisible = 3;
const partOrder: Record<DayPart, number> = { full: 0, am: 1, pm: 2 };
const absenceOrder = (row: TeamAbsence) => row.kind === "rest" ? 3 : partOrder[row.part];
const absenceLabel = (row: TeamAbsence) => row.kind === "rest" ? "Repos hebdomadaire" : partLabels[row.part];
function moveMonth(month: string, direction: number) {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index - 1 + direction, 1)).toISOString().slice(0, 7);
}

export function LeavesPage() {
  const { state } = useWorkspace();
  const now = useNow();
  const today = dayKey(now);
  const todayMonth = today.slice(0, 7);
  const [month, setMonth] = useState(todayMonth);
  const [person, setPerson] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ date: string; entry?: Leave } | null>(null);
  const [dateEditor, setDateEditor] = useState<{ kind: Holiday["kind"]; item?: Holiday } | null>(null);
  const [loaded, setLoaded] = useState<{ month: string; rows: TeamAbsence[] } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const request = new AbortController();
    void api<TeamAbsence[]>("/api/team-leaves?includeRest=1&month=" + month, "GET", undefined, undefined, request.signal)
      .then((rows) => {
        if (request.signal.aborted) return;
        setLoaded({ month, rows });
        setError("");
      })
      .catch((failure: Error) => {
        if (!request.signal.aborted) setError(failure.message);
      });
    return () => request.abort();
  }, [month, retry, state.revision]);

  const workTime = state.workTime ?? emptyWorkTime;
  const calendar = useMemo(() => workCalendar(workTime.schedules, workTime.leaves, workTime.holidays, state.me.preferences.weeklyTargetMinutes),
    [workTime, state.me.preferences.weeklyTargetMinutes]);
  const ownEntries = useMemo(() => state.entries.filter((entry) => entry.user_id === state.me.id),
    [state.entries, state.me.id]);
  const filter = state.users.some((item) => item.id === person && item.active) ? person : "";
  const rowsByDay = useMemo(() => {
    const result = new Map<string, TeamAbsence[]>();
    if (loaded?.month !== month) return result;
    for (const row of loaded.rows) {
      if (filter && row.user_id !== filter) continue;
      const day = result.get(row.date) ?? [];
      day.push(row);
      result.set(row.date, day);
    }
    for (const rows of result.values()) rows.sort((a, b) =>
      Number(a.kind === "rest") - Number(b.kind === "rest") ||
      a.name.localeCompare(b.name, "fr-CH") || absenceOrder(a) - absenceOrder(b));
    return result;
  }, [loaded, month, filter]);
  const holidays = useMemo(() => new Map(workTime.holidays.map((item) => [item.date, item])), [workTime.holidays]);

  const first = month + "-01";
  const next = moveMonth(month, 1) + "-01";
  const start = shiftDay(first, -weekday(first));
  const end = shiftDay(next, (7 - weekday(next)) % 7);
  const weeks: string[][] = [];
  for (let date = start; date < end; date = shiftDay(date, 7)) {
    weeks.push(weekdayNames.map((_, i) => shiftDay(date, i)));
  }
  const monthLabel = monthFormat.format(new Date(first + "T12:00:00Z"));
  const selectedRows = selected ? rowsByDay.get(selected) ?? [] : [];
  const selectedHoliday = selected ? holidays.get(selected) : undefined;
  const selectedInfo = selected ? calendar.details(selected) : null;
  const admin = state.me.role === "admin";
  const changeMonth = (value: string) => {
    setError("");
    setMonth(value);
  };

  return (
    <>
      <PageHeading title="Congés" description="Les congés, repos hebdomadaires et jours chômés de l’équipe.">
        {admin && <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline">Dates de l’équipe <ChevronDown /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuItem onSelect={() => setDateEditor({ kind: "holiday" })}>Ajouter un jour férié</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDateEditor({ kind: "closure" })}>Ajouter une fermeture</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>}
        <Button variant="outline" onClick={() => setEditor({ date: month === todayMonth ? today : first })}>
          <Plus /> Ajouter un congé
        </Button>
      </PageHeading>
      <Card className="px-4 py-3"><AnnualLeaveBalance year={month.slice(0, 4)} /></Card>
      <Card className="team-leaves gap-0 overflow-hidden py-0">
        <div className="team-leaves-toolbar">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="icon" variant="outline" aria-label="Mois précédent" disabled={month <= "2000-01"}
              onClick={() => changeMonth(moveMonth(month, -1))}><ChevronLeft /></Button>
            <Button size="icon" variant="outline" aria-label="Mois suivant" disabled={month >= "2099-12"}
              onClick={() => changeMonth(moveMonth(month, 1))}><ChevronRight /></Button>
            <h2 className="ml-1 font-semibold capitalize" aria-live="polite">{monthLabel}</h2>
            {month !== todayMonth && <Button variant="ghost" size="sm" onClick={() => changeMonth(todayMonth)}>Mois en cours</Button>}
          </div>
          <NativeSelect label="Filtrer par personne" value={filter} onChange={setPerson}
            options={[["", "Toute l’équipe"], ...state.users.filter((item) => item.active).map((item): [string, string] =>
              [item.id, item.id === state.me.id ? item.name + " (moi)" : item.name])]} />
        </div>
        <div className="team-leaves-legend">
          <span><i className="team-leaves-symbol" aria-hidden="true" /> Congé</span>
          <span><i className="team-leaves-symbol is-rest" aria-hidden="true" /> Repos hebdomadaire</span>
          <span><i className="team-leaves-symbol is-closure" aria-hidden="true" /> Fermeture</span>
          <span><i className="team-leaves-holiday-dot" aria-hidden="true" /> Jour férié</span>
        </div>
        {error && (
          <div className="grid gap-2 px-4 pb-3">
            <ErrorMessage message={error} />
            <Button variant="outline" size="sm" className="justify-self-start" onClick={() => { setError(""); setRetry((n) => n + 1); }}>Réessayer</Button>
          </div>
        )}
        <table className="team-leaves-table" aria-label={"Congés de l’équipe en " + monthLabel} aria-busy={!error && loaded?.month !== month}>
          <thead><tr>{weekdayNames.map((name) => <th key={name} scope="col" aria-label={name}>{name.slice(0, 3)}.</th>)}</tr></thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]}>
                {week.map((date, i) => {
                  const inMonth = date >= first && date < next;
                  const rows = rowsByDay.get(date) ?? [];
                  const holiday = holidays.get(date);
                  const count = rows.length;
                  const dateNumber = Number(date.slice(-2));
                  return (
                    <td key={date} className={i >= 5 ? "is-weekend" : undefined}>
                      {inMonth ? (
                        <button type="button" className="team-leaves-day" onClick={() => setSelected(date)}
                          aria-current={date === today ? "date" : undefined}
                          aria-label={prettyDay(date) + (holiday ? " · " + holiday.name : "") +
                            (count ? " · " + count + (count === 1 ? " indisponibilité" : " indisponibilités") : "")}>
                          <span className="team-leaves-date">{dateNumber}</span>
                          {holiday && <span className="team-leaves-holiday" title={holiday.name + (holiday.kind === "closure" ? " · Fermeture" : " · Jour férié")}>
                            <span className={"team-leaves-holiday-dot" + (holiday.kind === "closure" ? " is-closure" : "")} aria-hidden="true" /><span className="team-leaves-holiday-name">{holiday.name}</span>
                          </span>}
                          {rows.slice(0, maxVisible).map((row) => (
                            <span className="team-leaves-person" key={row.user_id + absenceOrder(row)} data-part={row.kind === "rest" ? "rest" : row.part}
                              title={row.name + " · " + absenceLabel(row)}>
                              <i className={row.kind === "rest" ? "is-rest" : undefined}
                                style={row.kind === "rest" ? { borderColor: row.color } : { backgroundColor: row.color }} aria-hidden="true" />
                              <span className="team-leaves-person-name">{row.name}</span>
                              {row.kind === "rest" ? <small>Repos</small> : shortPart[row.part] && <small>{shortPart[row.part]}</small>}
                            </span>
                          ))}
                          {count > maxVisible && <span className="team-leaves-more">+{count - maxVisible}</span>}
                        </button>
                      ) : <span className="team-leaves-outside" aria-hidden="true">{dateNumber}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="team-leaves-status" role="status">
          {loaded?.month !== month ? error ? "" : "Chargement du calendrier…" : !rowsByDay.size ? "Aucune absence ni repos pour ce mois." : ""}
        </p>
      </Card>
      {selected && (
        <Modal title={prettyDay(selected)} description="Congés et repos hebdomadaires pour cette date." onClose={() => setSelected(null)}>
          {selectedHoliday && <div className="flex items-center justify-between gap-2 rounded-md bg-muted p-3 text-sm">
            <div><strong>{selectedHoliday.name}</strong><p className="text-xs text-muted-foreground">{selectedHoliday.kind === "closure" ? "Fermeture d’entreprise" : "Jour férié"}</p></div>
            {admin && <Button variant="ghost" size="icon" aria-label="Modifier cette date" onClick={() => {
              setDateEditor({ kind: selectedHoliday.kind, item: selectedHoliday }); setSelected(null);
            }}><Pencil /></Button>}
          </div>}
          {selectedRows.length === 0 && <p className="text-sm text-muted-foreground">Aucune absence ni repos pour cette date.</p>}
          <ul className="divide-y">
            {selectedRows.map((row) => {
              const own = row.kind !== "rest" && row.user_id === state.me.id &&
                selectedInfo?.absences.find(({ part }) => part === row.part)?.leave;
              return (
                <li key={row.user_id + absenceOrder(row)} className="flex min-w-0 items-center gap-2 py-2">
                  <i className={"team-leaves-symbol" + (row.kind === "rest" ? " is-rest" : "")}
                    style={row.kind === "rest" ? { borderColor: row.color } : { backgroundColor: row.color }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 text-sm">{row.name}</span>
                  <span className="text-xs text-muted-foreground">{absenceLabel(row)}</span>
                  {own && <Button variant="ghost" size="icon" aria-label={"Modifier mon congé · " + absenceLabel(row)} onClick={() => {
                    setEditor({ date: selected, entry: own }); setSelected(null);
                  }}><Pencil /></Button>}
                </li>
              );
            })}
          </ul>
          {!selectedHoliday && selectedInfo?.planned !== 0 && <Button variant="outline" className="justify-self-end" onClick={() => {
            setEditor({ date: selected }); setSelected(null);
          }}><Plus /> Ajouter mon congé</Button>}
        </Modal>
      )}
      {editor && <LeaveEditor {...editor} calendar={calendar} ownEntries={ownEntries} now={now} onClose={() => setEditor(null)} />}
      {dateEditor && <HolidayEditor holiday={dateEditor.item} initialKind={dateEditor.kind} date={month === todayMonth ? today : first}
        onClose={() => setDateEditor(null)} onSaved={(date) => { changeMonth(date.slice(0, 7)); setDateEditor(null); }} />}
    </>
  );
}
