import { fail, id, nextDate, text } from './domain.mjs';
import { leaveDays, scheduleOn, validWorkDate, weekday, workCalendar } from '../public/work-schedule.js';

const toSchedule = ({ start_date, schedule, version }) => ({ start_date, ...JSON.parse(schedule), version });
const toLeave = ({ id, start_date, end_date, start_part, end_part, exclusions, version }) =>
  ({ id, start_date, end_date, start_part, end_part, excluded_dates: JSON.parse(exclusions).dates, version });

export async function workTimeSnapshot(store, userId) {
  const [schedules, leaves, holidays] = await Promise.all([
    store.all('SELECT start_date,schedule,version FROM work_schedules WHERE user_id=? ORDER BY start_date', userId),
    store.all('SELECT id,start_date,end_date,start_part,end_part,exclusions,version FROM leaves WHERE user_id=? ORDER BY start_date,id', userId),
    store.all('SELECT id,date,name,kind,version FROM holidays ORDER BY date'),
  ]);
  return { schedules: schedules.map(toSchedule), leaves: leaves.map(toLeave), holidays };
}

export async function teamLeaveMonth(store, month, includeRest = false) {
  const from = month + '-01';
  if (!validWorkDate(from)) fail(400, 'Choisissez un mois au format AAAA-MM.');
  const [year, index] = month.split('-').map(Number);
  const to = new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10);
  const [rows, schedules] = await Promise.all([store.all(`
    SELECT l.id,l.user_id,l.start_date,l.end_date,l.start_part,l.end_part,l.exclusions,l.version,u.name,u.color
    FROM leaves l JOIN users u ON u.id=l.user_id
    WHERE l.start_date<=? AND l.end_date>=? AND u.active=true
    ORDER BY u.name,u.id,l.start_date,l.id`, to, from),
    includeRest ? store.all(`
      SELECT s.user_id,s.start_date,s.schedule,s.version,u.name,u.color
      FROM work_schedules s JOIN users u ON u.id=s.user_id
      WHERE u.active=true AND s.start_date<=?
      AND NOT EXISTS (
        SELECT 1 FROM work_schedules newer WHERE newer.user_id=s.user_id
        AND newer.start_date>s.start_date AND newer.start_date<=?
      )
      ORDER BY s.user_id,s.start_date`, to, from) : [],
  ]);
  const leave = rows.flatMap(row => Array.from(leaveDays(toLeave(row), from, to), ({ date, part }) => ({
    date, part, user_id: row.user_id, name: row.name, color: row.color,
  })));
  const booked = new Set(leave.map(row => JSON.stringify([row.user_id, row.date])));
  const people = new Map();
  for (const row of schedules) {
    if (!people.has(row.user_id)) people.set(row.user_id, { name: row.name, color: row.color, schedules: [] });
    people.get(row.user_id).schedules.push(toSchedule(row));
  }
  const rest = [];
  for (const [user_id, person] of people) {
    for (let date = from; date <= to; date = nextDate(date)) {
      const day = weekday(date);
      if (day >= 5 || booked.has(JSON.stringify([user_id, date]))) continue;
      const hours = scheduleOn(person.schedules, date)?.days[day];
      if (hours?.[0] === 0 && hours[1] === 0) {
        rest.push({ date, kind: 'rest', user_id, name: person.name, color: person.color });
      }
    }
  }
  return [...leave, ...rest];
}

function checkVersion(current, expected) {
  if ((current?.version ?? null) !== expected) {
    fail(409, 'Cet élément a changé. Rouvrez l’édition avec les dernières valeurs.', 'version_conflict');
  }
}

export async function saveWorkSchedule(store, user, data) {
  const { start_date, days } = data;
  if (!validWorkDate(start_date)) fail(400, 'Date d’effet invalide.');
  if (!Array.isArray(days) || days.length !== 7 || days.some(day => !Array.isArray(day) || day.length !== 2 ||
    day.some(minutes => !Number.isInteger(minutes) || minutes < 0) || day[0] + day[1] > 1440)) {
    fail(400, 'Indiquez les durées du matin et de l’après-midi pour les sept jours, au maximum 24 heures par jour.');
  }
  const row = await store.one('SELECT start_date,schedule,version FROM work_schedules WHERE user_id=? AND start_date=?', user.id, start_date);
  checkVersion(row, data.version);
  const schedule = { start_date, days, version: (row?.version ?? 0) + 1 };
  const json = JSON.stringify({ days });
  if (row) await store.run('UPDATE work_schedules SET schedule=?,version=? WHERE user_id=? AND start_date=?', json, schedule.version, user.id, start_date);
  else await store.run('INSERT INTO work_schedules(user_id,start_date,schedule) VALUES (?,?,?)', user.id, start_date, json);
  await store.audit(user, 'work-schedule', start_date, row ? 'update' : 'create', row ? toSchedule(row) : null, schedule, user.id);
  return { schedule };
}

export async function changeLeave(store, user, method, leaveId, data) {
  const row = leaveId && await store.one('SELECT * FROM leaves WHERE id=? AND user_id=?', leaveId, user.id);
  if (leaveId && !row) fail(404, 'Congé introuvable.');
  const before = row ? toLeave(row) : null;
  if (row) checkVersion(row, data.version);
  if (method === 'DELETE') {
    await store.run('DELETE FROM leaves WHERE id=? AND user_id=?', leaveId, user.id);
    await store.audit(user, 'leave', leaveId, 'delete', before, null, user.id);
    return { ok: true };
  }
  const { start_date, end_date, start_part, end_part } = data;
  const period = { start_date, end_date, start_part, end_part };
  const { schedules, leaves, holidays } = await workTimeSnapshot(store, user.id);
  const preview = workCalendar(schedules, leaves, holidays, null).preview(period, leaveId);
  if (preview.error) fail(400, preview.error);
  const leave = { ...period, id: leaveId || id(), excluded_dates: preview.excluded_dates, version: (row?.version ?? 0) + 1 };
  const values = [start_date, end_date, start_part, end_part, JSON.stringify({ dates: preview.excluded_dates })];
  if (row) await store.run('UPDATE leaves SET start_date=?,end_date=?,start_part=?,end_part=?,exclusions=?,version=? WHERE id=? AND user_id=?',
    ...values, leave.version, leave.id, user.id);
  else await store.run('INSERT INTO leaves(id,user_id,start_date,end_date,start_part,end_part,exclusions) VALUES (?,?,?,?,?,?,?)',
    leave.id, user.id, ...values);
  await store.audit(user, 'leave', leave.id, row ? 'update' : 'create', before, leave, user.id);
  return { leave };
}

export async function changeHoliday(store, user, method, holidayId, data) {
  if (user.role !== 'admin') fail(403, 'Seul un administrateur peut modifier le calendrier des jours fériés.');
  const before = holidayId && await store.one('SELECT * FROM holidays WHERE id=?', holidayId);
  if (holidayId && !before) fail(404, 'Date chômée introuvable.');
  if (before) checkVersion(before, data.version);
  if (method === 'DELETE') {
    await store.run('DELETE FROM holidays WHERE id=?', holidayId);
    await store.audit(user, 'holiday', holidayId, 'delete', before, null);
    return { ok: true };
  }
  const { date, kind } = data;
  if (!validWorkDate(date)) fail(400, 'Date chômée invalide.');
  if (!['holiday', 'closure'].includes(kind)) fail(400, 'Type de date chômée invalide.');
  const name = text(data.name, 'Nom', 100);
  if (data.end_date !== undefined) {
    const end = data.end_date;
    if (method !== 'POST' || kind !== 'closure' || !validWorkDate(end) || end < date ||
      Date.parse(end) - Date.parse(date) > 365 * 86400000) {
      fail(400, 'Choisissez une période de fermeture de 1 à 366 jours.');
    }
    const existing = new Set((await store.all('SELECT date FROM holidays WHERE date>=? AND date<=?', date, end)).map(row => row.date));
    let added = 0;
    for (let day = date; day <= end; day = nextDate(day)) {
      if (existing.has(day)) continue;
      const holiday = { id: id(), date: day, name, kind, version: 1 };
      await store.run('INSERT INTO holidays(id,date,name,kind) VALUES (?,?,?,?)', holiday.id, day, name, kind);
      await store.audit(user, 'holiday', holiday.id, 'create', null, holiday);
      added++;
    }
    return { added, skipped: existing.size };
  }
  if (await store.one('SELECT id FROM holidays WHERE date=? AND id!=?', date, holidayId || '')) {
    fail(409, 'Une date chômée existe déjà ce jour-là.', 'duplicate');
  }
  const holiday = { id: holidayId || id(), date, kind, name, version: (before?.version ?? 0) + 1 };
  if (before) await store.run('UPDATE holidays SET date=?,name=?,kind=?,version=? WHERE id=?', date, name, kind, holiday.version, holiday.id);
  else await store.run('INSERT INTO holidays(id,date,name,kind) VALUES (?,?,?,?)', holiday.id, date, name, kind);
  await store.audit(user, 'holiday', holiday.id, before ? 'update' : 'create', before || null, holiday);
  return { holiday };
}
