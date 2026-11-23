import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { useWorkspace } from "@/lib/app-context";
import { dayKey, duration, midnight, prettyDay, shiftDay, zoneInstant } from "@/lib/time";
import { emptyWorkTime, readWorkMinutes, workDaysLabel, workMinutesLabel } from "@/lib/work-time";
import type { Entry } from "@/lib/types";
import {
  distributeWeeklyTarget, partLabels, scheduleOn, splitWorkDay, weekdayNames, workCalendar,
  type DayPart, type Holiday, type Leave, type WorkDay, type WorkSchedule,
} from "../../public/work-schedule.js";
import { AsyncForm, ErrorMessage, Field, Modal, NativeSelect } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Calendar = ReturnType<typeof workCalendar>;
type DayDetails = ReturnType<Calendar["details"]>;

export function WorkDayMarks({ info, onEdit }: { info: DayDetails; onEdit: (leave: Leave) => void }) {
  if (!info.holiday && !info.absences.length) return null;
  return (
    <div className="work-day-marks">
      {info.holiday && (
        <span
          className="work-day-mark is-holiday"
          title={info.planned === null ? "Horaire de référence à configurer" : info.planned === 0 ? "Jour habituellement non travaillé" : "Réduction de l’objectif"}
        >
          {info.holiday.name}{info.planned !== null && " · " + (info.holidayMinutes ? "−" : "") + workMinutesLabel(info.holidayMinutes)}
        </span>
      )}
      {info.absences.map(({ leave, part }) => (
        <button key={leave.id} type="button" className="work-day-mark is-leave" onClick={() => onEdit(leave)}
          title={info.holiday ? "Déjà couvert par le jour chômé" : "Modifier le congé"}>
          Congé · {part === "full" ? "journée" : partLabels[part].toLocaleLowerCase("fr")}
        </button>
      ))}
    </div>
  );
}

const partOptions = Object.entries(partLabels);
const dateProps = { min: "2000-01-01", max: "2099-12-31", required: true } as const;

export function LeaveEditor({ date, entry, calendar, ownEntries, now, onClose }: {
  date: string; entry?: Leave; calendar: Calendar; ownEntries: Entry[]; now: number; onClose: () => void;
}) {
  const { mutate } = useWorkspace();
  const [start, setStart] = useState(entry?.start_date ?? date);
  const [end, setEnd] = useState(entry?.end_date ?? date);
  const [first, setFirst] = useState<DayPart>(entry?.start_part ?? "full");
  const [last, setLast] = useState<DayPart>(entry?.end_part ?? "full");
  const [deleting, setDeleting] = useState(false);
  const single = start === end;
  const startPart = !single && first === "am" ? "full" : first;
  const period = { start_date: start, end_date: end, start_part: startPart, end_part: single ? "full" as const : last };
  const result = calendar.preview(period, entry?.id);
  const overlap = result.covered?.some(({ date, part }) => {
    const noon = part === "full" ? null : zoneInstant(date + "T12:00");
    const from = part === "pm" ? noon! : midnight(date);
    const to = part === "am" ? noon! : midnight(shiftDay(date, 1));
    return ownEntries.some(item => item.start < to && (item.end ?? now) > from);
  });
  const path = entry ? "/api/leaves/" + entry.id : "/api/leaves";
  return (
    <Modal title={entry ? "Modifier le congé" : "Ajouter un congé"}
      description="Enregistrez un congé déjà validé. Le décompte suit votre répartition hebdomadaire." onClose={onClose}>
      {deleting && entry ? (
        <AsyncForm destructive submitLabel="Supprimer le congé" onCancel={() => setDeleting(false)}
          onSubmit={async () => {
            await mutate(path, "DELETE", { version: entry.version }, "Congé supprimé.");
            onClose();
          }}>
          <p className="text-sm">Les heures prévues seront réintégrées à l’objectif des jours concernés.</p>
        </AsyncForm>
      ) : (
        <AsyncForm submitLabel={overlap ? "Enregistrer quand même" : "Enregistrer le congé"} onCancel={onClose}
          onSubmit={async () => {
            if (result.error) throw Error(result.error);
            await mutate(path, entry ? "PATCH" : "POST", { ...period, version: entry?.version }, "Congé enregistré.");
            onClose();
          }}
          actions={entry && <Button variant="ghost" type="button" className="text-destructive" onClick={() => setDeleting(true)}>Supprimer</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Du"><Input type="date" {...dateProps} value={start} onChange={(e) => {
              const next = e.target.value;
              if (end === start || end < next) setEnd(next);
              setStart(next);
            }} /></Field>
            <Field label="Au"><Input type="date" {...dateProps} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <NativeSelect label={single ? "Durée" : "Premier jour"} value={startPart} onChange={(v) => setFirst(v as DayPart)}
              options={single ? partOptions : partOptions.filter(([value]) => value !== "am")} />
            {!single && <NativeSelect label="Dernier jour" value={last} onChange={(v) => setLast(v as DayPart)}
              options={partOptions.filter(([value]) => value !== "pm")} />}
          </div>
          <p className="text-sm" aria-live="polite">
            {result.error ?? (workMinutesLabel(result.minutes ?? 0) + " déduites de l’objectif" +
              " · " + workDaysLabel(result.days ?? 0) + " de congé" +
              (result.excluded_dates?.length ? " · Jours non travaillés ignorés : " + result.excluded_dates.length : ""))}
          </p>
          {overlap && <p className="text-sm text-muted-foreground">Du temps est déjà saisi sur cette période. Il sera conservé.</p>}
        </AsyncForm>
      )}
    </Modal>
  );
}

type DayDraft = { full: string; am: string; pm: string; rest: boolean };
type DurationField = Exclude<keyof DayDraft, "rest">;
const durationField = (minutes: number) => duration(minutes * 60);
const dayDraft = ([am, pm]: WorkDay): DayDraft => ({
  full: durationField(am + pm), am: durationField(am), pm: durationField(pm), rest: am + pm === 0,
});

function ScheduleEditor({ baseline, initialDate, versions, onClose }: {
  baseline: WorkDay[]; initialDate: string; versions: WorkSchedule[]; onClose: () => void;
}) {
  const { mutate, state } = useWorkspace();
  const [date, setDate] = useState(initialDate);
  const [days, setDays] = useState(() => baseline.map((day, index) =>
    versions.length === 0 && state.me.preferences.weeklyTargetMinutes == null && index < 5
      ? { full: "", am: "", pm: "", rest: false }
      : dayDraft(day)));
  const [halves, setHalves] = useState(false);
  const [repeat, setRepeat] = useState("");
  const [quickError, setQuickError] = useState("");
  const parsed = days.map(({ am, pm, rest }) => rest ? [0, 0] as const : [readWorkMinutes(am), readWorkMinutes(pm)] as const);
  const valid = parsed.every(([am, pm]) => am !== null && pm !== null && am + pm <= 1440);
  const minutes = parsed.reduce((total, [am, pm]) => total + (am ?? 0) + (pm ?? 0), 0);
  const effectiveVersion = versions.find((item) => item.start_date === date)?.version ?? null;
  function edit(index: number, part: DurationField, value: string) {
    const next = { ...days[index], [part]: value };
    if (part === "full") {
      const n = readWorkMinutes(value);
      const [am, pm] = n === null ? ["", ""] : splitWorkDay(n).map(durationField);
      Object.assign(next, { am, pm });
    } else {
      const am = readWorkMinutes(next.am), pm = readWorkMinutes(next.pm);
      next.full = am !== null && pm !== null ? durationField(am + pm) : "";
    }
    setDays((previous) => previous.map((day, i) => i === index ? next : day));
  }
  return (
    <Modal title="Répartition hebdomadaire" description="Cochez Repos pour les jours non travaillés. Pour les autres jours, indiquez la durée prévue en heures et minutes." onClose={onClose} wide>
      <AsyncForm submitLabel="Enregistrer l’horaire" onCancel={onClose} onSubmit={async () => {
        if (!valid) throw Error("Vérifiez les durées. Exemple : 6:30.");
        await mutate("/api/work-schedule", "POST", { start_date: date, days: parsed, version: effectiveVersion }, "Horaire enregistré.");
        onClose();
      }}>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Même durée sur les jours travaillés">
            <Input inputMode="text" placeholder="6:00" maxLength={5} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </Field>
          <Button type="button" variant="outline" onClick={() => {
            const n = readWorkMinutes(repeat);
            if (n === null || n === 0) { setQuickError("Saisissez une durée de travail, par exemple 6:00."); return; }
            setQuickError("");
            setDays((previous) => previous.map((day) => day.rest ? day : dayDraft(splitWorkDay(n))));
          }}>Appliquer</Button>
        </div>
        <ErrorMessage message={quickError} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={halves} onChange={(e) => setHalves(e.target.checked)} />
          Détailler le matin et l’après-midi
        </label>
        <div className={"work-schedule-grid" + (halves ? " show-halves" : "")}>
          <span>Jour</span><span>Durée prévue</span>{halves && <><span>Matin</span><span>Après-midi</span></>}
          {days.map((value, i) => (
            <div key={weekdayNames[i]} className="contents">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{weekdayNames[i]}</span>
                <label className="inline-flex items-center gap-1 text-muted-foreground">
                  <input type="checkbox" checked={value.rest} aria-label={"Repos le " + weekdayNames[i].toLowerCase()}
                    onChange={(event) => {
                      const rest = event.target.checked;
                      setDays((previous) => previous.map((day, index) => index === i ? { ...day, rest } : day));
                    }} />
                  Repos
                </label>
              </div>
              {(["full", ...(halves ? ["am", "pm"] : [])] as DurationField[]).map((part) => (
                <Input key={part} aria-label={(part === "full" ? "Durée" : partLabels[part]) + " du " + weekdayNames[i].toLowerCase()}
                  maxLength={5} disabled={value.rest} value={value.rest ? "00:00" : value[part]} onChange={(e) => edit(i, part, e.target.value)} />
              ))}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Field label="À partir du"><Input {...dateProps} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <strong aria-live="polite">Total hebdomadaire · {valid ? workMinutesLabel(minutes) : "—"}</strong>
        </div>
      </AsyncForm>
    </Modal>
  );
}

export function WorkScheduleSettings() {
  const { state } = useWorkspace();
  const { schedules } = state.workTime ?? emptyWorkTime;
  const today = dayKey(state.serverNow);
  const current = scheduleOn(schedules, today);
  const [editor, setEditor] = useState<{ days: WorkDay[]; from: string; versions: WorkSchedule[] } | null>(null);
  function open(schedule?: WorkSchedule) {
    setEditor({ days: schedule?.days ?? current?.days ?? distributeWeeklyTarget(state.me.preferences.weeklyTargetMinutes),
      from: schedule?.start_date ?? today, versions: schedules });
  }
  return (
    <section className="grid gap-3 border-t pt-4" aria-labelledby="work-schedule-label">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="work-schedule-label" className="text-sm font-semibold">Répartition hebdomadaire</h3>
          <p className="text-xs text-muted-foreground">
            {current ? workMinutesLabel(current.days.reduce((total, [am, pm]) => total + am + pm, 0)) +
              " par semaine depuis le " + prettyDay(current.start_date) : "Définissez vos jours travaillés pour calculer vos congés et jours fériés."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => open()}>{schedules.length ? "Nouvel horaire" : "Configurer"}</Button>
      </div>
      {current && <div className="flex flex-wrap gap-2 text-xs">
        {current.days.map(([am, pm], i) => (
          <span key={weekdayNames[i]} className="rounded-md bg-muted px-2 py-1">
            {weekdayNames[i].slice(0, 3)}. {am + pm ? workMinutesLabel(am + pm) : "repos"}
          </span>
        ))}
      </div>}
      {schedules.length > 0 && <details className="text-xs">
        <summary className="text-muted-foreground">Voir les horaires et leurs dates d’effet</summary>
        <ul className="mt-2 space-y-1">
          {[...schedules].reverse().map((item) => <li key={item.start_date} className="flex items-center justify-between gap-2">
            <span>{prettyDay(item.start_date)} {item.start_date.slice(0, 4)} · {workMinutesLabel(item.days.reduce((sum, [am, pm]) => sum + am + pm, 0))}</span>
            <Button variant="ghost" size="sm" onClick={() => open(item)}>Modifier</Button>
          </li>)}
        </ul>
      </details>}
      {editor && <ScheduleEditor baseline={editor.days} initialDate={editor.from} versions={editor.versions} onClose={() => setEditor(null)} />}
    </section>
  );
}

export function AnnualLeaveBalance({ year }: { year: string }) {
  const { state } = useWorkspace();
  const workTime = state.workTime ?? emptyWorkTime;
  const { leave, closures } = useMemo(() => workCalendar(workTime.schedules, workTime.leaves, workTime.holidays, null).annual(year),
    [workTime, year]);
  const entitlement = state.me.preferences.leaveEntitlements?.[year];
  return (
    <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-2 text-sm" aria-label={"Mon solde de congés " + year}>
      <div><dt className="text-xs text-muted-foreground">Droit annuel</dt><dd>{entitlement === undefined ? "À renseigner" : workDaysLabel(entitlement)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Congés posés</dt><dd>{workDaysLabel(leave)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Fermetures déduites</dt><dd>{workDaysLabel(closures)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Solde {year}</dt><dd className="font-semibold">{entitlement === undefined ? "—" : workDaysLabel(entitlement - leave - closures)}</dd></div>
    </dl>
  );
}

export function AnnualLeaveSettings() {
  const { state, mutate } = useWorkspace();
  const current = Number(dayKey(state.serverNow).slice(0, 4));
  const [year, setYear] = useState(String(current));
  const [editing, setEditing] = useState(false);
  const entitlements = state.me.preferences.leaveEntitlements ?? {};
  const years = [...new Set([String(current - 1), String(current), String(current + 1), ...Object.keys(entitlements)])].sort();
  return (
    <Card className="gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold">Mes congés annuels</h2>
          <p className="text-xs text-muted-foreground">Le décompte suit votre horaire de référence.</p></div>
        <NativeSelect label="Année du droit aux congés" value={year} onChange={(next) => { setEditing(false); setYear(next); }}
          options={years.map((value) => [value, value])} />
      </div>
      <AnnualLeaveBalance year={year} />
      {editing ? (
        <AsyncForm key={year} submitLabel="Enregistrer le droit annuel" onCancel={() => setEditing(false)} onSubmit={async (data) => {
          const value = data.get("days");
          if (value === null || value === "") throw Error("Indiquez le nombre de jours de congé.");
          await mutate("/api/preferences", "PATCH", { leaveEntitlement: { year, days: Number(value) } }, "Droit annuel enregistré.");
          setEditing(false);
        }}>
          <Field label="Nombre de jours de congé">
            <Input name="days" type="number" inputMode="decimal" min={0} max={366} step={0.5}
              defaultValue={entitlements[year]} required />
          </Field>
        </AsyncForm>
      ) : <Button variant="outline" className="self-start" onClick={() => setEditing(true)}>
        {entitlements[year] === undefined ? "Renseigner le droit annuel" : "Modifier le droit annuel"}
      </Button>}
    </Card>
  );
}

const holidayOptions: [string, string][] = [["holiday", "Jour férié"], ["closure", "Fermeture d’entreprise"]];
const holidayLabel = (kind: Holiday["kind"]) => kind === "holiday" ? "Jour férié" : "Fermeture d’entreprise";

export function HolidayEditor({ holiday, initialKind = "holiday", date, onClose, onSaved }: {
  holiday?: Holiday; initialKind?: Holiday["kind"]; date: string; onClose: () => void; onSaved: (date: string) => void;
}) {
  const { mutate } = useWorkspace();
  const [kind, setKind] = useState(holiday?.kind ?? initialKind);
  const [deleting, setDeleting] = useState(false);
  const path = holiday ? "/api/holidays/" + holiday.id : "/api/holidays";
  const closureRange = !holiday && kind === "closure";
  return (
    <Modal title={holiday ? "Modifier la date chômée" : closureRange ? "Ajouter une fermeture" : "Ajouter un jour férié"}
      description={kind === "closure"
        ? "La fermeture s’applique à toute l’équipe et déduit un jour de congé pour chaque jour normalement travaillé."
        : "Le jour férié s’applique à toute l’équipe et préserve le solde de congés."} onClose={onClose}>
      {deleting && holiday ? (
        <AsyncForm destructive submitLabel="Retirer la date" onCancel={() => setDeleting(false)} onSubmit={async () => {
          await mutate(path, "DELETE", { version: holiday.version }, "Date retirée.");
          onClose();
        }}>
          <p className="text-sm">Retirer {holiday.name} le {prettyDay(holiday.date)} du calendrier partagé ?</p>
        </AsyncForm>
      ) : (
        <AsyncForm submitLabel="Enregistrer la date" onCancel={onClose} actions={holiday &&
          <Button type="button" variant="ghost" className="text-destructive" onClick={() => setDeleting(true)}>Retirer</Button>}
          onSubmit={async (data) => {
            const next = String(data.get("date"));
            const end = closureRange ? data.get("end_date") : null;
            const result = await mutate<{ added?: number; skipped?: number }>(path, holiday ? "PATCH" : "POST", {
              date: next, end_date: end || undefined, name: data.get("name"), kind, version: holiday?.version,
            }, closureRange && end ? "" : "Date chômée enregistrée.");
            if (result.skipped !== undefined) {
              toast.success(result.added + " date(s) ajoutée(s)" +
                (result.skipped ? " · " + result.skipped + " date(s) déjà inscrite(s) conservée(s)" : ""));
            }
            onSaved(next);
          }}>
          <Field label={closureRange ? "Du" : "Date"}><Input name="date" type="date" defaultValue={holiday?.date ?? date} {...dateProps} /></Field>
          {closureRange && <Field label="Au (facultatif)" hint="Les dates déjà inscrites au calendrier sont conservées.">
            <Input name="end_date" type="date" min={dateProps.min} max={dateProps.max} />
          </Field>}
          <Field label="Nom"><Input name="name" defaultValue={holiday?.name} required maxLength={100} /></Field>
          {holiday && <NativeSelect label="Type" options={holidayOptions} value={kind} onChange={(value) => setKind(value as Holiday["kind"])} />}
        </AsyncForm>
      )}
    </Modal>
  );
}

export function HolidaySettings() {
  const { state } = useWorkspace();
  const { holidays } = state.workTime ?? emptyWorkTime;
  const today = dayKey(state.serverNow);
  const initialYear = today.slice(0, 4);
  const [year, setYear] = useState(initialYear);
  const [editor, setEditor] = useState<{ holiday?: Holiday; kind?: Holiday["kind"] } | null>(null);
  const canEdit = state.me.role === "admin";
  const years = useMemo(() => [...new Set([initialYear, String(Number(initialYear) + 1),
    year, ...holidays.map((holiday) => holiday.date.slice(0, 4))])].sort(), [initialYear, holidays, year]);
  const dates = holidays.filter((holiday) => holiday.date.startsWith(year));
  return (
    <Card className="gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold">Jours fériés et fermetures</h2><p className="text-xs text-muted-foreground">Calendrier partagé de l’équipe</p></div>
        {canEdit && <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditor({ kind: "holiday" })}><Plus /> Ajouter un jour férié</Button>
          <Button variant="outline" onClick={() => setEditor({ kind: "closure" })}><Plus /> Ajouter une fermeture</Button>
        </div>}
      </div>
      <NativeSelect label="Année des jours fériés" value={year} onChange={setYear} options={years.map((item) => [item, item])} />
      {dates.length === 0 ? <p className="text-sm text-muted-foreground">Aucune date chômée enregistrée pour cette année.</p> :
        <ul className="divide-y">
          {dates.map((item) => <li key={item.id} className="flex min-w-0 items-center justify-between gap-2 py-2">
            <div><strong className="text-sm">{item.name}</strong><p className="text-xs text-muted-foreground">{prettyDay(item.date)} · {holidayLabel(item.kind)}</p></div>
            {canEdit && <Button variant="ghost" size="icon" aria-label={"Modifier " + item.name} onClick={() => setEditor({ holiday: item })}><Pencil /></Button>}
          </li>)}
        </ul>}
      {editor && <HolidayEditor holiday={editor.holiday} initialKind={editor.kind} date={year === initialYear ? today : year + "-01-01"}
        onClose={() => setEditor(null)} onSaved={(date) => { setYear(date.slice(0, 4)); setEditor(null); }} />}
    </Card>
  );
}
