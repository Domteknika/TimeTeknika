import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrateDatabase } from '../server/db/postgres.mjs';
import { openPostgresStore } from '../server/async-store.mjs';
import { createApplication } from '../server/index.mjs';
import { requestContext } from '../server/journal.mjs';
import { defaultExportConfig } from '../public/export-config.js';

const manual = extra => ({ description: 'Étude PostgreSQL', task_id: null, project_id: null,
  start: '2026-02-10T08:00:00Z', end: '2026-02-10T09:00:00Z', ...extra });
const expect = (response, status = 200) => {
  assert.equal(response.status, status, JSON.stringify(response.data));
  return response.data;
};

async function fixture(t, demo = true) {
  const pg = new PGlite(), orm = drizzle(pg);
  let app, disposed = 0;
  t.after(async () => { try { await app?.close(); } finally { await pg.close(); } });
  assert.equal((await migrateDatabase({ drizzle: orm })).applied, 3);
  const store = await openPostgresStore({ drizzle: orm, close: async () => { disposed++; } });
  app = await createApplication({ store, demo });
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  function client() {
    let cookie = '', csrf = '';
    return {
      get cookie() { return cookie; },
      async request(path, method = 'GET', data, { key = crypto.randomUUID(), headers = {} } = {}) {
        const response = await fetch(base + path, { method, signal: AbortSignal.timeout(15_000),
          headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': key, ...headers },
          body: method === 'GET' ? undefined : JSON.stringify(data ?? {}) });
        if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        const parsed = response.headers.get('content-type')?.includes('application/json')
          ? await response.json() : Buffer.from(await response.arrayBuffer());
        if (parsed.csrf) csrf = parsed.csrf;
        return { status: response.status, data: parsed, headers: response.headers };
      },
    };
  }
  return { app, pg, orm, base, client, get disposed() { return disposed; } };
}

// Actual PostgreSQL SQL + full HTTP application. PGlite has a single connection;
// parallel HTTP calls here do not replace a native pg pool concurrency test.
test('PostgreSQL HTTP : stockage asynchrone, droits, catalogue, temps et journal', async t => {
  const env = await fixture(t), { app, pg, base, client } = env;
  const admin = client(), member = client(), other = client(), anonymous = client();
  let customer, project, task, entry;

  await t.test('démarrage, sessions, types API et isolation des temps', async () => {
    assert.equal(expect(await anonymous.request('/health')).status, 'ok');
    const info = expect(await anonymous.request('/api/info'));
    assert.equal(info.setup, false); assert.equal(info.demoUsers.length, 3);
    expect(await anonymous.request('/api/state'), 401);
    for (const [session, uid] of [[admin, 'demo-alex'], [member, 'demo-emma'], [other, 'demo-lucas']])
      expect(await session.request('/api/demo-login', 'POST', { user_id: uid }));
    const mine = expect(await member.request('/api/state')), team = expect(await admin.request('/api/state'));
    assert.equal(mine.me.active, 1); assert.equal(mine.me.role, 'member');
    assert.equal(typeof mine.me.preferences, 'object'); assert.equal(typeof mine.revision, 'number');
    assert.ok(mine.entries.every(row => row.user_id === 'demo-emma' && typeof row.start === 'number' && row.deleted === 0));
    assert.ok(team.entries.some(row => row.user_id !== 'demo-alex')); assert.equal(team.me.role, 'admin');
    expect(await member.request('/api/journal'), 403);
    expect(await member.request('/api/preferences', 'PATCH', { reminderHour: 15 }, { headers: { 'X-CSRF-Token': 'invalid' } }), 403);
  });

  await t.test('vue hebdomadaire privée et modification partielle du chrono', async () => {
    const scoped = expect(await admin.request('/api/state?week=2025-12-29'));
    assert.ok(scoped.entryWindow && Number.isFinite(scoped.entryWindow.omittedSeconds));
    assert.ok(scoped.entries.every(row => row.user_id === scoped.me.id));
    expect(await admin.request('/api/preferences','PATCH',{reportChart:'bars'}));
    assert.equal(expect(await admin.request('/api/state')).reportRevision,scoped.reportRevision);
    const running = expect(await member.request('/api/timer/start','POST',{expectedRunningId:null})).entry;
    const classified = expect(await member.request('/api/entries/'+running.id,'PATCH',
      {version:running.version, task_id:'task-plans'})).entry;
    assert.deepEqual([classified.start,classified.end,classified.project_id], [running.start,null,'project-cedres']);
    const moved = expect(await member.request('/api/entries/'+running.id,'PATCH',
      {version:classified.version, project_id:'project-atelier'})).entry;
    assert.equal(moved.task_id,null);
    expect(await other.request('/api/entries/'+moved.id),404);
    assert.equal(expect(await member.request('/api/timer/status')).active,true);
    expect(await member.request('/api/timer/stop','POST',{id:moved.id,version:moved.version}));
    expect(await member.request('/api/entries/'+moved.id,'DELETE',{version:moved.version+1}));
  });
  await t.test('le cumul historique reste identique en changeant de semaine ou de classement', async () => {
    const previous = expect(await member.request('/api/state')).me.preferences.balanceStartDate;
    expect(await member.request('/api/preferences','PATCH',{balanceStartDate:'2000-01-03'}));
    const week = '/api/state?week=2000-01-03';
    const before = expect(await member.request(week)).entryWindow.omittedSeconds;
    const historic = expect(await member.request('/api/entries','POST', manual({
      task_id:'task-plans', project_id:'project-cedres', start:'2000-02-02T07:00:02Z', end:'2000-02-02T07:40:04Z'
    }))).entry;
    const hidden = expect(await member.request(week));
    assert.ok(!hidden.entries.some(e => e.id === historic.id));
    assert.equal(hidden.entryWindow.omittedSeconds - before, 2402);
    const visible = expect(await member.request('/api/state?week=2000-01-31'));
    assert.ok(visible.entries.some(e => e.id === historic.id));
    assert.equal(visible.entryWindow.omittedSeconds, before);
    const unclassified = expect(await member.request('/api/entries/'+historic.id,'PATCH',{version:historic.version,task_id:null})).entry;
    const after = expect(await member.request(week));
    assert.ok(after.entries.some(e => e.id === historic.id));
    assert.equal(after.entryWindow.omittedSeconds, before);
    expect(await member.request('/api/entries/'+historic.id,'DELETE',{version:unclassified.version}));
    expect(await member.request('/api/preferences','PATCH',{balanceStartDate:previous}));
  });
  await t.test('catalogue partagé, unicité, affectations et booléens d’archivage', async () => {
    customer = expect(await member.request('/api/clients', 'POST', { name: 'Client PostgreSQL' })).client;
    expect(await member.request('/api/clients', 'POST', { name: 'client postgresql' }), 409);
    project = expect(await member.request('/api/projects', 'POST', { name: 'Projet PostgreSQL', client_id: customer.id })).project;
    task = expect(await member.request('/api/tasks', 'POST', { name: 'Tâche PostgreSQL', project_id: project.id, assignees: ['demo-emma', 'demo-lucas'] })).task;
    task = expect(await member.request(`/api/tasks/${task.id}`, 'PATCH', { version: task.version, status: 'doing', archived: true })).task;
    assert.equal(task.archived, 1); assert.deepEqual(task.assignees.sort(), ['demo-emma', 'demo-lucas']);
    task = expect(await member.request(`/api/tasks/${task.id}`, 'PATCH', { version: task.version, archived: false })).task;
    assert.equal(task.archived, 0);
    project = expect(await member.request(`/api/projects/${project.id}`, 'PATCH', { version: project.version, name: 'Projet renommé', archived: true })).project;
    assert.equal(project.archived, 1);
    project = expect(await member.request(`/api/projects/${project.id}`, 'PATCH', { version: project.version, archived: false })).project;
    assert.equal(project.archived, 0);
  });

  await t.test('saisie, conflit de version, droits, suppression, restauration et historique', async () => {
    const payload = manual({ task_id: task.id, project_id: project.id });
    entry = expect(await member.request('/api/entries', 'POST', payload)).entry;
    expect(await other.request(`/api/entries/${entry.id}`, 'PATCH', { ...payload, version: entry.version }), 403);
    const versions = await Promise.all(['Correction A', 'Correction B'].map(description =>
      member.request(`/api/entries/${entry.id}`, 'PATCH', { ...payload, version: entry.version, description })));
    assert.deepEqual(versions.map(result => result.status).sort(), [200, 409]);
    entry = versions.find(result => result.status === 200).data.entry;
    assert.equal(entry.version, 2);
    expect(await member.request(`/api/entries/${entry.id}`, 'DELETE', { version: entry.version }));
    assert.equal((await app.store.one('SELECT deleted FROM entries WHERE id=?', entry.id)).deleted, 1);
    assert.ok(!expect(await member.request('/api/state')).entries.some(row => row.id === entry.id));
    entry = expect(await member.request(`/api/entries/${entry.id}/restore`, 'POST', {})).entry;
    assert.equal(entry.deleted, 0); assert.equal(entry.version, 4);
    const history = expect(await member.request(`/api/entries/${entry.id}/history`)).items;
    assert.equal(history.length, 4); assert.ok(history.some(row => row.action === 'restore'));
    expect(await other.request(`/api/entries/${entry.id}/history`), 404);
  });

  await t.test('chrono unique, requêtes parallèles, idempotence et archivage protégé', async () => {
    const payload = { task_id: task.id, project_id: project.id, expectedRunningId: null, description: 'Chrono PG' }, key = crypto.randomUUID();
    const started = await Promise.all([member.request('/api/timer/start', 'POST', payload, { key }), member.request('/api/timer/start', 'POST', payload, { key })]);
    started.forEach(result => expect(result)); assert.deepEqual(started[0].data, started[1].data);
    const running = started[0].data.entry;
    assert.equal((await app.store.one('SELECT COUNT(*) n FROM entries WHERE user_id=? AND "end" IS NULL AND deleted=false', 'demo-emma')).n, 1);
    expect(await member.request('/api/timer/start', 'POST', { ...payload, description: 'Autre contenu' }, { key }), 409);
    assert.equal(expect(await member.request('/api/timer/start', 'POST', payload), 409).error, 'timer_conflict');
    expect(await member.request(`/api/projects/${project.id}`, 'PATCH', { version: project.version, archived: true }), 409);
    expect(await member.request('/api/timer/stop', 'POST', { id: running.id, version: 0 }), 409);
    const stopped = expect(await member.request('/api/timer/stop', 'POST', { id: running.id, version: running.version })).entry;
    assert.equal(typeof stopped.end, 'number'); assert.equal(stopped.version, 2);
    expect(await member.request('/api/timer/stop', 'POST', { id: stopped.id, version: stopped.version }), 409);
  });

  await t.test('préférences JSONB, fusion de requêtes et rapports privés', async () => {
    const results = await Promise.all([
      member.request('/api/preferences', 'PATCH', { calendarDays: 7 }),
      member.request('/api/preferences', 'PATCH', { reminderHour: 15, taskProject: { projectId: project.id, pinned: true } }),
    ]);
    results.forEach(result => expect(result));
    const preferences = expect(await member.request('/api/state')).me.preferences;
    assert.equal(preferences.calendarDays, 7); assert.equal(preferences.reminderHour, 15); assert.equal(preferences.taskProjects[project.id].pinned, true);
    assert.equal((await pg.query('SELECT preferences FROM users WHERE id=$1', ['demo-emma'])).rows[0].preferences.calendarDays, 7);
    const report = expect(await member.request('/api/reports', 'POST', { from: '2026-02-10', to: '2026-02-10', group: 'project' }));
    assert.equal(report.total, 3600); assert.ok(report.rows.every(row => row.user_id === 'demo-emma'));
  });

  await t.test('modèles JSONB versionnés, aperçu et téléchargements CSV/Excel/PDF', async () => {
    const config = defaultExportConfig('2026-02-10', '2026-02-10');
    const template = expect(await member.request('/api/export-templates', 'POST', { name: 'Relevé PG', config })).template;
    assert.equal(expect(await member.request('/api/state')).exportTemplates[0].config.version, 1);
    expect(await other.request(`/api/export-templates/${template.id}`, 'DELETE', { version: 1 }), 404);
    expect(await member.request(`/api/export-templates/${template.id}`, 'PATCH', { version: 1, name: 'Renommé', config }));
    expect(await member.request(`/api/export-templates/${template.id}`, 'PATCH', { version: 1, name: 'Obsolète', config }), 409);
    assert.equal(expect(await member.request('/api/exports/preview', 'POST', { config })).totalSeconds, 3600);
    for (const format of ['csv', 'xlsx', 'pdf']) {
      const response = await member.request('/api/exports/download', 'POST', { config, format });
      expect(response); assert.ok(response.data.length > 0);
      assert.match(response.headers.get('content-disposition'), new RegExp(`\\.${format}`));
      if (format === 'pdf') assert.equal(response.data.subarray(0, 5).toString(), '%PDF-');
    }
    expect(await member.request(`/api/export-templates/${template.id}`, 'DELETE', { version: 2 }));
  });

  await t.test('notifications SSE après écriture validée', async () => {
    const abort = new AbortController();
    const response = await fetch(base + '/api/events', { headers: { Cookie: member.cookie }, signal: abort.signal });
    assert.equal(response.status, 200);
    const reader = response.body.getReader(), decoder = new TextDecoder();
    try {
      assert.match(decoder.decode((await reader.read()).value), /event: connected/);
      const changed = expect(await member.request('/api/preferences', 'PATCH', { calendarZoom: 125 }));
      const timeout = setTimeout(() => abort.abort(), 5000);
      try { assert.match(decoder.decode((await reader.read()).value), new RegExp(`"revision":${changed.revision}`)); }
      finally { clearTimeout(timeout); }
    } finally { abort.abort(); await reader.cancel().catch(() => {}); }
  });

  await t.test('échec du journal annule mutation, audit, révision et idempotence', async () => {
    const revision = await app.store.revision(), count = (await app.store.one('SELECT COUNT(*) n FROM audit')).n;
    await pg.exec(`CREATE FUNCTION public.fail_pg_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.category='audit' THEN RAISE EXCEPTION 'private fixture failure'; END IF; RETURN NEW; END;
      $$; CREATE TRIGGER fail_pg_test_audit BEFORE INSERT ON event_log FOR EACH ROW EXECUTE FUNCTION public.fail_pg_test_audit();`);
    const key = crypto.randomUUID();
    try {
      const failed = await member.request('/api/clients', 'POST', { name: 'Annulé par le journal' }, { key });
      expect(failed, 500); assert.ok(!JSON.stringify(failed.data).includes('private fixture failure'));
      assert.equal(await app.store.revision(), revision);
      assert.equal((await app.store.one('SELECT COUNT(*) n FROM audit')).n, count);
      assert.equal(await app.store.one('SELECT id FROM clients WHERE name=?', 'Annulé par le journal'), undefined);
      assert.equal(await app.store.one('SELECT key FROM requests WHERE user_id=? AND key=?', 'demo-emma', key), undefined);
      const errors = expect(await admin.request('/api/journal?requestId=' + failed.headers.get('x-request-id'))).items;
      assert.ok(errors.some(row => row.level === 'error')); assert.ok(!JSON.stringify(errors).includes('private fixture failure'));
    } finally { await pg.exec('DROP TRIGGER fail_pg_test_audit ON event_log; DROP FUNCTION public.fail_pg_test_audit();'); }
    assert.equal(expect(await admin.request('/api/journal/verify')).ok, true);
  });

  await t.test('comptes, rôles, identifiants, mots de passe, révocations et dernier admin', async () => {
    const newUser = { name: 'Compte PostgreSQL', username: 'pg.fixture', password: 'fixture-pass123', role: 'member' };
    expect(await member.request('/api/users', 'POST', newUser), 403);
    expect(await admin.request('/api/users', 'POST', newUser));
    expect(await admin.request('/api/users', 'POST', { ...newUser, username: 'PG.FIXTURE' }), 409);
    const person = await app.store.findUserByUsername(newUser.username), login = client(), second = client();
    expect(await login.request('/api/login', 'POST', { username: 'PG.FIXTURE', password: newUser.password }));
    expect(await second.request('/api/login', 'POST', newUser));
    expect(await admin.request(`/api/users/${person.id}/username`, 'PATCH', { previousUsername: newUser.username, username: 'pg.renamed' }));
    assert.equal(expect(await login.request('/api/state')).me.username, 'pg.renamed');
    expect(await login.request('/api/account/password', 'POST', { currentPassword: newUser.password, password: 'changed-pass123' }));
    expect(await second.request('/api/state'), 401);
    expect(await admin.request(`/api/users/${person.id}/password`, 'POST', { password: 'reset-pass123' }));
    expect(await login.request('/api/state'), 401);
    expect(await login.request('/api/login', 'POST', { username: 'pg.renamed', password: 'reset-pass123' }));
    expect(await admin.request(`/api/users/${person.id}/role`, 'PATCH', { previousRole: 'member', role: 'admin' }));
    expect(await login.request('/api/state'), 401);
    expect(await login.request('/api/login', 'POST', { username: 'pg.renamed', password: 'reset-pass123' }));
    assert.equal(expect(await login.request('/api/state')).me.role, 'admin');
    expect(await admin.request(`/api/users/${person.id}/role`, 'PATCH', { previousRole: 'admin', role: 'member' }));
    assert.equal(expect(await admin.request('/api/users/demo-alex/role', 'PATCH', { previousRole: 'admin', role: 'manager' }), 409).error, 'last_admin');
    expect(await login.request('/api/login', 'POST', { username: 'pg.renamed', password: 'reset-pass123' }));
    expect(await admin.request(`/api/users/${person.id}`, 'DELETE', { confirmUsername: 'pg.renamed' }));
    expect(await login.request('/api/state'), 401);
    expect(await login.request('/api/login', 'POST', { username: 'pg.renamed', password: 'reset-pass123' }), 401);
    assert.equal((await app.store.one('SELECT active FROM users WHERE id=?', person.id)).active, 0);
  });

  await t.test('suppression du catalogue conserve les temps et nettoie les préférences', async () => {
    expect(await member.request(`/api/clients/${customer.id}/deletion-preview`), 403);
    const preview = expect(await admin.request(`/api/clients/${customer.id}/deletion-preview`));
    assert.equal(preview.counts.entries, 2);
    const deletion = expect(await admin.request(`/api/clients/${customer.id}`, 'DELETE', { confirmation: preview.confirmation }));
    assert.equal(deletion.preservedEntries, 2);
    const preserved = await app.store.one('SELECT * FROM entries WHERE id=?', entry.id);
    assert.equal(preserved.task_id, null); assert.equal(preserved.project_id, null); assert.equal(preserved.start, entry.start);
    assert.equal(await app.store.one('SELECT id FROM tasks WHERE id=?', task.id), undefined);
    assert.equal(expect(await member.request('/api/state')).me.preferences.taskProjects?.[project.id], undefined);
    assert.equal(expect(await admin.request('/api/journal/verify')).ok, true);
  });

  await t.test('une session révoquée après authentification ne peut plus écrire', async () => {
    const waiting = Promise.withResolvers(), resume = Promise.withResolvers();
    const transaction = app.store.transaction;
    let intercepted = false;
    // Hold exactly the mutation boundary, after the HTTP authentication. The
    // actual revocation, transaction and second authentication all use PostgreSQL.
    app.store.transaction = async operation => {
      if (!intercepted && requestContext.getStore()?.route === '/api/clients') {
        intercepted = true; waiting.resolve(); await resume.promise;
      }
      return transaction(operation);
    };
    const timeout = setTimeout(() => waiting.reject(new Error('Mutation boundary not reached')), 5000);
    const attempted = other.request('/api/clients', 'POST', { name: 'Création après révocation' });
    try {
      await waiting.promise;
      await transaction(() => app.store.run('DELETE FROM sessions WHERE user_id=?', 'demo-lucas'));
      resume.resolve();
      expect(await attempted, 401);
      assert.equal(await app.store.one('SELECT id FROM clients WHERE name=?', 'Création après révocation'), undefined);
    } finally {
      clearTimeout(timeout); resume.resolve(); app.store.transaction = transaction;
      await attempted.catch(() => {});
    }
  });

  await t.test('fermeture attend les journaux de requêtes et ferme le stockage une fois', async () => {
    const last = await member.request('/api/preferences', 'PATCH', { calendarFit: true }); expect(last);
    await Promise.all([app.close(), app.close()]);
    assert.equal(env.disposed, 1);
    assert.equal((await pg.query('SELECT action FROM event_log ORDER BY seq DESC LIMIT 1')).rows[0].action, 'server-stop');
    const completed = await pg.query("SELECT count(*)::integer AS n FROM event_log WHERE request_id=$1 AND action='request-completed'", [last.headers.get('x-request-id')]);
    assert.equal(completed.rows[0].n, 1);
    const reopened = await openPostgresStore({ drizzle: env.orm });
    try { assert.equal((await reopened.verifyJournal()).ok, true); } finally { await reopened.close(); }
  });
});

test('PostgreSQL HTTP : configuration vierge concurrente et session initiale', async t => {
  const { app, client } = await fixture(t, false);
  const first = client(), second = client();
  assert.equal(expect(await first.request('/api/info')).setup, true);
  const data = { name: 'Admin initial', username: 'initial.admin', password: 'fixture-pass123' };
  const results = await Promise.all([first.request('/api/setup', 'POST', data), second.request('/api/setup', 'POST', { ...data, username: 'other.admin' })]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  assert.equal(results.find(result => result.status === 201).data.me.role, 'admin');
  assert.equal((await app.store.one('SELECT COUNT(*) n FROM users')).n, 1);
  assert.equal((await app.store.one('SELECT COUNT(*) n FROM user_admins')).n, 1);
  assert.equal((await app.store.verifyJournal()).ok, true);
});
