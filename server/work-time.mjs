import { fail, id, text } from './domain.mjs';
import { validWorkDate, workCalendar } from '../public/work-schedule.js';

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
  if (await store.one('SELECT id FROM holidays WHERE date=? AND id!=?', date, holidayId || '')) {
    fail(409, 'Une date chômée existe déjà ce jour-là.', 'duplicate');
  }
  const holiday = { id: holidayId || id(), date, kind, name, version: (before?.version ?? 0) + 1 };
  if (before) await store.run('UPDATE holidays SET date=?,name=?,kind=?,version=? WHERE id=?', date, name, kind, holiday.version, holiday.id);
  else await store.run('INSERT INTO holidays(id,date,name,kind) VALUES (?,?,?,?)', holiday.id, date, name, kind);
  await store.audit(user, 'holiday', holiday.id, before ? 'update' : 'create', before || null, holiday);
  return { holiday };
}
