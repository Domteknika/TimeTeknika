import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { createApplication } from '../server/index.mjs';
import { migrateDatabase } from '../server/db/postgres.mjs';
import { openPostgresStore } from '../server/async-store.mjs';
import { splitWorkDay, workCalendar } from '../public/work-schedule.js';

const start_date = '2026-12-21';
const endOfWeek = '2026-12-28';
const friday = '2026-12-25';
const thursday = '2026-12-24';
const fourDays = [492, 492, 492, 492, 0, 0, 0].map(splitWorkDay);
const fiveDays = [394, 394, 394, 393, 393, 0, 0].map(splitWorkDay);
const sixHours = [360, 360, 360, 360, 360, 0, 0].map(splitWorkDay);
const holiday = { id: 'noel', date: friday, name: 'Noël', kind: 'holiday', version: 1 };
const period = (start_date, start_part, end_date = start_date, end_part = 'full') => ({ start_date, end_date, start_part, end_part });

test('Horaire : les deux répartitions à 80 % et une journée de 6 h déduisent les minutes prévues', () => {
  const four = workCalendar([{ start_date, days: fourDays, version: 1 }], [], [holiday], null);
  const five = workCalendar([{ start_date, days: fiveDays, version: 1 }], [], [holiday], null);
  assert.deepEqual(four.total(start_date, endOfWeek), { base: 1968, holiday: 0, leave: 0, adjusted: 1968 });
  assert.deepEqual(five.total(start_date, endOfWeek), { base: 1968, holiday: 393, leave: 0, adjusted: 1575 });
  assert.equal(four.preview(period(thursday, 'pm')).minutes, 246);
  assert.equal(five.preview(period(thursday, 'pm')).minutes, 196);
  assert.ok(five.preview(period(friday, 'full')).error);
  assert.deepEqual(five.preview(period(thursday, 'pm', endOfWeek, 'am')).excluded_dates, [friday, '2026-12-26', '2026-12-27']);
  const changed = workCalendar([{ start_date, days: fiveDays, version: 1 },
    { start_date: endOfWeek, days: [[240, 120], ...sixHours.slice(1)], version: 1 }], [], [holiday], 2460);
  assert.equal(changed.preview(period(endOfWeek, 'full')).minutes, 360);
  assert.equal(changed.preview(period(endOfWeek, 'am')).minutes, 240);
  assert.equal(changed.preview(period(endOfWeek, 'pm')).minutes, 120);
  assert.equal(changed.total('2026-12-14', '2027-01-04').adjusted, 2460 + 1575 + 1800);
  assert.equal(workCalendar([], [], [holiday], 2460).total(start_date, endOfWeek).adjusted, 2460);
  const overlapping = { ...period(friday, 'full'), id: 'leave', excluded_dates: [], version: 1 };
  assert.equal(workCalendar([{ start_date, days: fiveDays, version: 1 }], [overlapping], [holiday], null)
    .total(start_date, endOfWeek).adjusted, 1575);
});

test('Solde annuel : demi-journées, fermetures, fériés, repos et passage d’année', () => {
  const schedules = [{ start_date, days: fourDays, version: 1 },
    { start_date: '2027-01-01', days: [[360, 0], ...sixHours.slice(1)], version: 1 }];
  const leave = (id, dates) => ({ ...dates, id, excluded_dates: [], version: 1 });
  const closure = (date) => ({ ...holiday, date, id: date, kind: 'closure' });
  const leaves = [
    leave('half', period('2026-12-22', 'pm')),
    leave('overlap', period(thursday, 'full')),
    leave('holiday-leave', period(friday, 'full')),
    leave('across-years', period('2026-12-31', 'pm', '2027-01-04', 'am')),
  ];
  const calendar = workCalendar(schedules, leaves, [closure(thursday), closure('2026-12-26'), holiday,
    { ...holiday, date: '2027-01-01', id: 'new-year' }], null);
  // La période de fin d’année couvre un jeudi après-midi et le lundi suivant.
  assert.deepEqual(calendar.annual('2026'), { leave: 1, closures: 1 });
  assert.deepEqual(calendar.annual('2027'), { leave: 1, closures: 0 });
  assert.equal(calendar.preview(period('2027-01-11', 'am')).days, 1);
});

for (const backend of ['SQLite', 'PostgreSQL']) {
  test(backend + ' HTTP : horaires personnels, congés versionnés et fériés partagés', async (t) => {
    let app;
    const pg = backend === 'PostgreSQL' ? new PGlite() : null;
    t.after(async () => { try { await app?.close(); } finally { await pg?.close(); } });
    let store;
    if (pg) {
      const orm = drizzle(pg);
      await migrateDatabase({ drizzle: orm });
      store = await openPostgresStore({ drizzle: orm });
    }
    app = await createApplication({ store, demo: true, dbPath: ':memory:' });
    await new Promise((resolve, reject) => app.server.listen(0, '127.0.0.1', resolve).once('error', reject));
    const origin = 'http://127.0.0.1:' + app.server.address().port;
    function client() {
      let cookie = '', csrf = '';
      return async (path, { method = 'GET', body, status = 200, key = crypto.randomUUID() } = {}) => {
        const response = await fetch(origin + path, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json',
          'X-CSRF-Token': csrf, 'Idempotency-Key': key }, body: body === undefined ? undefined : JSON.stringify(body) });
        cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
        const data = await response.json();
        csrf = data.csrf ?? csrf;
        assert.equal(response.status, status, JSON.stringify(data));
        return data;
      };
    }
    const admin = client(), emma = client(), lucas = client();
    await client()('/api/team-leaves?month=2026-12', { status: 401 });
    for (const [call, user_id] of [[admin, 'demo-alex'], [emma, 'demo-emma'], [lucas, 'demo-lucas']]) {
      await call('/api/demo-login', { method: 'POST', body: { user_id } });
    }
    const seeded = await emma('/api/state');
    await emma('/api/leaves', { method: 'POST', body: period(thursday, 'full'), status: 400 });
    const schedule = { start_date, days: fourDays, version: null };
    await emma('/api/work-schedule', { method: 'POST', body: schedule });
    await emma('/api/work-schedule', { method: 'POST', body: schedule, status: 409 });
    await lucas('/api/work-schedule', { method: 'POST', body: { ...schedule, days: fiveDays } });
    const date = { date: friday, name: 'Noël', kind: 'holiday' };
    await emma('/api/holidays', { method: 'POST', body: date, status: 403 });
    const savedHoliday = (await admin('/api/holidays', { method: 'POST', body: date })).holiday;
    await admin('/api/holidays', { method: 'POST', body: date, status: 409 });
    const payload = period(thursday, 'pm');
    const key = crypto.randomUUID();
    const post = { method: 'POST', body: payload, key };
    const saved = await emma('/api/leaves', post);
    assert.deepEqual(await emma('/api/leaves', post), saved);
    await emma('/api/leaves', { method: 'POST', body: payload, status: 400 });
    const path = '/api/leaves/' + saved.leave.id;
    await lucas(path, { method: 'DELETE', body: { version: 1 }, status: 404 });
    await emma(path, { method: 'PATCH', body: { ...payload, start_part: 'am', version: 0 }, status: 409 });
    const own = await emma('/api/state'), other = await lucas('/api/state');
    assert.deepEqual(own.workTime.leaves, [saved.leave]);
    assert.deepEqual(other.workTime.leaves, []);
    assert.deepEqual(own.entries, seeded.entries);
    assert.deepEqual(other.workTime.holidays, [savedHoliday]);
    const team = await lucas('/api/team-leaves?month=2026-12');
    assert.deepEqual(team.map(({ date, name, part }) => ({ date, name, part })), [{ date: thursday, name: 'Emma Laurent', part: 'pm' }]);
    assert.deepEqual(Object.keys(team[0]).sort(), ['color', 'date', 'name', 'part', 'user_id']);
    const calendar = await lucas('/api/team-leaves?month=2026-12&includeRest=1');
    const plannedRest = calendar.filter(row => row.kind === 'rest');
    assert.deepEqual(plannedRest.map(({ date, name }) => [date, name]), [[friday, 'Emma Laurent']]);
    assert.deepEqual(Object.keys(plannedRest[0]).sort(), ['color', 'date', 'kind', 'name', 'user_id']);
    await emma('/api/team-leaves?month=2026-13', { status: 400 });
    assert.deepEqual(await emma('/api/team-leaves?month=2027-01'), []);
    for (const [snapshot, adjusted] of [[own, 1722], [other, 1575]]) {
      const { schedules, leaves, holidays } = snapshot.workTime;
      assert.equal(workCalendar(schedules, leaves, holidays, null).total(start_date, endOfWeek).adjusted, adjusted);
    }
    await emma(path, { method: 'DELETE', body: { version: 1 } });
    assert.deepEqual((await emma('/api/state')).workTime.leaves, []);
    await admin('/api/holidays', { method: 'POST', body: { date: '2027-01-01', name: 'Nouvel An', kind: 'holiday' } });
    await lucas('/api/leaves', { method: 'POST', body: period('2026-12-31', 'pm', '2027-01-04', 'am') });
    assert.deepEqual((await emma('/api/team-leaves?month=2026-12')).map(({ date, part }) => [date, part]), [['2026-12-31', 'pm']]);
    assert.deepEqual((await emma('/api/team-leaves?month=2027-01')).map(({ date, part }) => [date, part]), [['2027-01-04', 'am']]);
    await emma('/api/work-schedule', { method: 'POST', body: { start_date: '2026-12-28', days: fiveDays, version: null } });
    assert.deepEqual((await lucas('/api/team-leaves?month=2026-12&includeRest=1')).filter(row => row.kind === 'rest').map(row => row.date), [friday]);
    assert.deepEqual((await lucas('/api/team-leaves?month=2027-01&includeRest=1')).filter(row => row.kind === 'rest'), []);
    const saveBudget = (year, days, status = 200) => emma('/api/preferences', { method: 'PATCH', body: { leaveEntitlement: { year, days } }, status });
    await saveBudget('2026', 20.5);
    await saveBudget('2027', 21);
    await saveBudget('2026', 20.1, 400);
    const range = { date: thursday, end_date: friday, kind: 'closure', name: 'Fermeture de fin d’année' };
    await lucas('/api/holidays', { method: 'POST', body: range, status: 403 });
    const result = await admin('/api/holidays', { method: 'POST', body: range });
    assert.equal(result.added, 1);
    assert.equal(result.skipped, 1);
    const updated = await emma('/api/state');
    assert.deepEqual(updated.me.preferences.leaveEntitlements, { 2026: 20.5, 2027: 21 });
    assert.equal((await lucas('/api/state')).me.preferences.leaveEntitlements, undefined);
    assert.ok(updated.workTime.holidays.some(item => item.date === friday && item.kind === 'holiday'));
    assert.deepEqual(workCalendar(updated.workTime.schedules, [], updated.workTime.holidays, null).annual('2026'), { leave: 0, closures: 1 });
  });
}
