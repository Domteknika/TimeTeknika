/** @typedef {[number, number]} WorkDay Matin et après-midi, en minutes. */
/** @typedef {'full' | 'am' | 'pm'} DayPart */
/** @typedef {{start_date: string, days: WorkDay[], version: number}} WorkSchedule */
/** @typedef {{start_date: string, end_date: string, start_part: DayPart, end_part: DayPart}} LeavePeriod */
/** @typedef {LeavePeriod & {id: string, excluded_dates: string[], version: number}} Leave */
/** @typedef {{id: string, date: string, name: string, kind: 'holiday' | 'closure', version: number}} Holiday */

export const weekdayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
export const partLabels = { full: 'Journée entière', am: 'Matin', pm: 'Après-midi' };
const DAY = 86_400_000;
const dayValue = day => Date.parse(day + 'T00:00:00Z');
const dateKey = ms => new Date(ms).toISOString().slice(0, 10);
export const weekday = day => (new Date(dayValue(day)).getUTCDay() + 6) % 7;
export const validWorkDate = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
  day >= '2000-01-01' && day < '2100-01-01' && Number.isFinite(dayValue(day)) && dateKey(dayValue(day)) === day;

/** @returns {WorkDay} */
export const splitWorkDay = minutes => [Math.ceil(minutes / 2), Math.floor(minutes / 2)];

/** @returns {WorkDay[]} */
export function distributeWeeklyTarget(minutes) {
  if (minutes == null) return weekdayNames.map(() => [0, 0]);
  const count = minutes > 5 * 1440 ? 7 : 5;
  const daily = Math.floor(minutes / count);
  return weekdayNames.map((_, index) => splitWorkDay(index < count ? daily + Number(index < minutes % count) : 0));
}

/** @param {WorkSchedule[]} schedules */
export function scheduleOn(schedules, date) {
  for (let index = schedules.length - 1; index >= 0; index--) {
    if (schedules[index].start_date <= date) return schedules[index];
  }
  return undefined;
}

/** @param {WorkDay} day @param {DayPart} part */
const minutesFor = (day, part) => part === 'am' ? day[0] : part === 'pm' ? day[1] : day[0] + day[1];

/** @param {LeavePeriod} period @returns {DayPart} */
function partOn(period, day) {
  if (day === period.start_date) return period.start_part;
  if (day === period.end_date) return period.end_part;
  return 'full';
}

function* datesBetween(from, to) {
  const end = dayValue(to);
  for (let at = dayValue(from); at <= end; at += DAY) yield dateKey(at);
}

/**
 * @param {WorkSchedule[]} schedules Triés par date d’effet.
 * @param {Leave[]} leaves
 * @param {Holiday[]} holidays
 * @param {number | null | undefined} legacyTarget
 */
export function workCalendar(schedules, leaves, holidays, legacyTarget) {
  const holidaysByDay = new Map(holidays.map(holiday => [holiday.date, holiday]));
  /** @type {Map<string, { leave: Leave, part: DayPart }[]>} */
  const leavesByDay = new Map();
  for (const leave of leaves) {
    const excluded = new Set(leave.excluded_dates);
    for (const date of datesBetween(leave.start_date, leave.end_date)) {
      if (excluded.has(date)) continue;
      if (!leavesByDay.has(date)) leavesByDay.set(date, []);
      leavesByDay.get(date).push({ leave, part: partOn(leave, date) });
    }
  }
  const legacyDays = distributeWeeklyTarget(legacyTarget);
  const emptyDay = splitWorkDay(0);
  const details = date => {
    const schedule = scheduleOn(schedules, date);
    const index = weekday(date);
    const parts = schedule?.days[index] ?? emptyDay;
    const planned = schedule ? minutesFor(parts, 'full') : null;
    const holiday = holidaysByDay.get(date);
    const absences = leavesByDay.get(date) ?? [];
    const morning = absences.some(({ part }) => part !== 'pm');
    const afternoon = absences.some(({ part }) => part !== 'am');
    return {
      holiday, planned, parts, absences,
      base: planned ?? (legacyTarget == null ? null : minutesFor(legacyDays[index], 'full')),
      holidayMinutes: holiday ? planned ?? 0 : 0,
      leaveMinutes: holiday ? 0 : (morning ? parts[0] : 0) + (afternoon ? parts[1] : 0),
    };
  };

  /** @param {LeavePeriod} period */
  function preview(period, excludingId = '') {
    const { start_date, end_date, start_part, end_part } = period;
    if (!validWorkDate(start_date) || !validWorkDate(end_date) || end_date < start_date ||
      dayValue(end_date) - dayValue(start_date) > 365 * DAY) {
      return { error: 'Choisissez une période de 1 à 366 jours.' };
    }
    const single = start_date === end_date;
    if (!Object.hasOwn(partLabels, start_part) || !['full', 'am'].includes(end_part) ||
      (single ? end_part !== 'full' : start_part === 'am')) {
      return { error: 'Choisissez des demi-journées compatibles avec la période.' };
    }
    const excluded_dates = [];
    const covered = [];
    let minutes = 0;
    let missingSchedule = false;
    for (const date of datesBetween(start_date, end_date)) {
      const info = details(date);
      const part = partOn(period, date);
      const amount = minutesFor(info.parts, part);
      if (info.holiday || !amount) {
        if (!info.holiday && info.planned === null) missingSchedule = true;
        excluded_dates.push(date);
        continue;
      }
      if (info.absences.some(existing => existing.leave.id !== excludingId &&
        (part === 'full' || existing.part === 'full' || existing.part === part))) {
        return { error: 'Un congé couvre déjà tout ou partie du ' + date + '.' };
      }
      minutes += amount;
      covered.push({ date, part });
    }
    if (missingSchedule) return { error: 'Configurez votre répartition hebdomadaire dans Mon profil à partir de cette période.' };
    if (!minutes) return { error: single && holidaysByDay.has(start_date)
      ? 'Cette date est déjà fériée ou chômée.'
      : 'Aucune heure de travail n’est prévue sur le créneau choisi.' };
    return { minutes, excluded_dates, covered };
  }

  // Les bornes du solde sont des lundis en Europe/Zurich. Avant le premier
  // horaire, la répartition de l’ancienne cible n’ajuste aucun jour férié.
  function total(from, to) {
    let base = from >= to && (legacyTarget != null || scheduleOn(schedules, to)) ? 0 : null;
    let holiday = 0;
    let leave = 0;
    if (from < to) {
      for (const date of datesBetween(from, dateKey(dayValue(to) - DAY))) {
        const info = details(date);
        if (info.base !== null) base = (base ?? 0) + info.base;
        holiday += info.holidayMinutes;
        leave += info.leaveMinutes;
      }
    }
    return { base, holiday, leave, adjusted: base === null ? null : base - holiday - leave };
  }

  return { details, preview, total };
}
