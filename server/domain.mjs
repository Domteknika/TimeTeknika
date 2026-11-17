export class AppError extends Error {
  constructor(status, message, code = 'invalid_request', details) {
    super(message); Object.assign(this, { status, code, details });
  }
}
export const fail = (status, message, code, details) => { throw new AppError(status, message, code, details); };
export const id = () => crypto.randomUUID();
export function text(value, label, max = 200, required = true) {
  if (typeof value !== 'string') fail(400, `${label} invalide.`);
  const result = value.trim();
  if ((required && !result) || result.length > max) fail(400, `${label} : entre ${required ? 1 : 0} et ${max} caractères.`);
  return result;
}
export function instant(value, label = 'Date') {
  if (typeof value !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(value)) fail(400, `${label} doit préciser son fuseau horaire.`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms < Date.UTC(2000, 0, 1) || ms > Date.UTC(2100, 0, 1)) fail(400, `${label} invalide.`);
  return Math.floor(ms / 1000) * 1000;
}
export function seconds(entry, now = Date.now(), from = -Infinity, to = Infinity) {
  return Math.max(0, Math.floor((Math.min(entry.end ?? now, to) - Math.max(entry.start, from)) / 1000));
}
export function dateInZone(ms, zone = 'Europe/Zurich') {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms).map(p => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function midnight(date, zone = 'Europe/Zurich') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, 'Période invalide.');
  const guess = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(guess) || new Date(guess).toISOString().slice(0, 10) !== date) fail(400, 'Date inexistante.');
  let value = guess;
  for (let n = 0; n < 4; n++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(value).map(p => [p.type, p.value]));
    const displayed = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const delta = guess - displayed;
    value += delta;
    if (!delta) return value;
  }
  fail(400, 'Limite de journée invalide.');
}
export function nextDate(date) { return new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10); }
export function report(entries, filters, lookups, now = Date.now()) {
  const { clients, projects, tasks, users } = lookups;
  const from = midnight(filters.from), to = midnight(nextDate(filters.to));
  if (to <= from || to - from > 370 * 86400000) fail(400, 'Choisissez une période comprise entre 1 et 370 jours.');
  const byId = list => new Map(list.map(item => [item.id, item]));
  const c = byId(clients), p = byId(projects), t = byId(tasks), u = byId(users);
  const rows = entries.filter(e => !e.deleted).map(e => {
    const project = p.get(e.project_id), task = t.get(e.task_id), client = c.get(project?.client_id);
    return { ...e, project: project?.name ?? 'Sans projet', task: task?.name ?? 'À classer', client: client?.name ?? 'Sans client', client_id: client?.id ?? null, person: u.get(e.user_id)?.name ?? 'Ancien membre', seconds: seconds(e, now, from, to) };
  }).filter(e => (e.seconds > 0 || e.start >= from && e.start < to && (e.end === e.start || e.end === null)) && (!filters.person || e.user_id === filters.person) && (!filters.client || e.client_id === filters.client) && (!filters.project || e.project_id === filters.project) && (!filters.task || e.task_id === filters.task) && (!filters.unclassified || !e.task_id) && (!filters.search || e.description.toLocaleLowerCase('fr').includes(filters.search.toLocaleLowerCase('fr'))));
  const groups = new Map();
  const primary = ['project', 'task', 'client', 'person'].includes(filters.group) ? filters.group : 'project';
  for (const row of rows) {
    const keyId = primary === 'person' ? row.user_id : row[`${primary}_id`];
    const key = `${keyId ?? 'none'}:${row.user_id}`;
    if (!groups.has(key)) groups.set(key, { key, label: row[primary], person: row.person, user_id: row.user_id, seconds: 0, completed: 0, running: 0, count: 0 });
    const group = groups.get(key);
    group.seconds += row.seconds; group.count++;
    group[row.end === null ? 'running' : 'completed'] += row.seconds;
  }
  const days = [];
  for (let day = filters.from; day <= filters.to; day = nextDate(day)) {
    const dayFrom = midnight(day), dayTo = midnight(nextDate(day));
    days.push({ date: day, seconds: rows.reduce((sum, e) => sum + seconds(e, now, dayFrom, dayTo), 0) });
  }
  return { rows: rows.sort((a, b) => b.start - a.start), groups: [...groups.values()].sort((a, b) => b.seconds - a.seconds), days, total: rows.reduce((s, e) => s + e.seconds, 0), completed: rows.filter(e => e.end !== null).reduce((s, e) => s + e.seconds, 0), running: rows.filter(e => e.end === null).reduce((s, e) => s + e.seconds, 0), unclassified: rows.filter(e => !e.task_id).reduce((s, e) => s + e.seconds, 0), timezone: 'Europe/Zurich', asOf: now };
}
