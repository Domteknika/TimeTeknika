import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../server/db/schema.ts';

const migrationsFolder = fileURLToPath(new URL('../drizzle/', import.meta.url));
const at = 1_794_903_600_123;
const genesis = '0'.repeat(64);
const journalFields = ['seq', 'at', 'level', 'category', 'action', 'actor', 'entity', 'entity_id', 'request_id', 'details_json', 'previous_hash'];
const digest = row => createHash('sha256').update(JSON.stringify(journalFields.map(key => row[key]))).digest('hex');
const databaseError = error => error.cause ?? error;
const rejectsSql = (operation, code, constraint) => assert.rejects(async () => { await operation(); }, error => {
  const cause = databaseError(error);
  assert.equal(cause.code, code, cause.message);
  if (constraint) assert.equal(cause.constraint, constraint, cause.message);
  return true;
});
const user = (id, username = id) => ({ id, name: id, username, password: 'fixture:scrypt-hash', role: 'member', color: '#7658c5' });
const client = (id, name = id) => ({ id, name, created_by: 'user-a' });
const project = (id, name, client_id = 'client-a') => ({ id, name, client_id, color: '#7658c5', created_by: 'user-a' });
const task = id => ({ id, name: id, project_id: 'project-a', created_by: 'user-a' });
const entry = (id, extra = {}) => ({ id, user_id: 'user-a', start: at, end: at + 60_000, created_at: at, updated_at: at, ...extra });
const event = (seq, previous_hash, extra = {}) => {
  const row = { seq, at, level: 'info', category: 'system', action: 'test', actor: null, entity: null, entity_id: null, request_id: null, details_json: '{}', previous_hash, ...extra };
  return { ...row, hash: digest(row) };
};

// PGlite executes PostgreSQL SQL/PLpgSQL locally. This suite exercises the committed
// migrations and Drizzle mappings; it does not claim multi-connection concurrency coverage.
test('PostgreSQL : migrations, types et invariants du schéma Drizzle', async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  const db = drizzle(pg);
  await migrate(db, { migrationsFolder });

  await t.test('les deux migrations s’appliquent puis restent sans effet au second passage', async () => {
    const expected = ['assignments', 'audit', 'clients', 'entries', 'event_log', 'export_templates', 'meta', 'projects', 'requests', 'sessions', 'tasks', 'user_admins', 'users'];
    const tables = await pg.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    assert.deepEqual(tables.rows.map(row => row.tablename), expected);
    await migrate(db, { migrationsFolder });
    const applied = await pg.query('SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations');
    assert.equal(applied.rows[0].count, 2);
  });

  const preferences = { weeklyTargetMinutes: 2400, taskProjects: { 'project-a': { pinned: true } }, calendarFit: false };
  await db.insert(schema.users).values([{ ...user('user-a', 'Alice'), preferences }, user('user-b', 'Bob')]);
  await db.insert(schema.clients).values([client('client-a', 'Atelier'), client('client-b', 'Autre client')]);
  await db.insert(schema.projects).values([project('project-a', 'Plans'), project('project-b', 'Maintenance', 'client-b')]);
  await db.insert(schema.tasks).values([task('task-a'), task('task-cascade')]);
  await db.insert(schema.assignments).values([{ task_id: 'task-a', user_id: 'user-a' }, { task_id: 'task-cascade', user_id: 'user-a' }]);

  await t.test('Drizzle restitue les millisecondes, booléens, JSON et identifiants texte', async () => {
    await db.insert(schema.meta).values({ key: 'balance_start', value: at });
    await db.insert(schema.sessions).values({ token: 'session-hash', user_id: 'user-a', csrf: 'csrf-fixture', expires: at + 604_800_000 });
    await db.insert(schema.userAdmins).values({ user_id: 'user-a' });
    await db.insert(schema.entries).values(entry('typed-entry', { task_id: 'task-a', project_id: 'project-a' }));
    const config = { version: 1, columns: [{ key: 'description', label: 'Description' }], total: true };
    const result = { revision: 17, entry: { id: 'typed-entry', start: at } };
    await db.insert(schema.exportTemplates).values({ id: 'template-a', user_id: 'user-a', name: 'Relevé', config, created_at: at, updated_at: at });
    await db.insert(schema.requests).values({ user_id: 'user-a', key: 'request-a', fingerprint: 'fingerprint-a', result, at });
    const [person] = await db.select().from(schema.users).where(eq(schema.users.id, 'user-a'));
    assert.equal(person.active, true);
    assert.equal(person.role, 'member'); // Administrator membership is stored separately.
    assert.deepEqual(person.preferences, preferences);
    assert.equal((await db.select().from(schema.meta))[0].value, at);
    assert.equal((await db.select().from(schema.sessions))[0].expires, at + 604_800_000);
    const [saved] = await db.select().from(schema.entries).where(eq(schema.entries.id, 'typed-entry'));
    assert.equal(saved.start, at);
    assert.equal(saved.end, at + 60_000);
    assert.equal(saved.created_at, at);
    assert.equal(saved.updated_at, at);
    assert.equal(saved.deleted, false);
    assert.equal(saved.version, 1);
    assert.deepEqual((await db.select().from(schema.exportTemplates))[0].config, config);
    assert.deepEqual((await db.select().from(schema.requests))[0].result, result);
    assert.equal((await db.select().from(schema.projects).where(eq(schema.projects.id, 'project-a')))[0].archived, false);
  });

  await t.test('un seul chrono actif par personne, périodes terminées et supprimées conservées', async () => {
    await db.insert(schema.entries).values([
      entry('running-a', { end: null }), entry('running-b', { user_id: 'user-b', end: null }),
      entry('deleted-running', { end: null, deleted: true }), entry('zero-duration', { end: at }),
    ]);
    await rejectsSql(() => db.insert(schema.entries).values(entry('second-running', { end: null })), '23505', 'one_running_per_user');
    await rejectsSql(() => db.update(schema.entries).set({ end: null }).where(eq(schema.entries.id, 'typed-entry')), '23505', 'one_running_per_user');
    await rejectsSql(() => db.update(schema.entries).set({ deleted: false }).where(eq(schema.entries.id, 'deleted-running')), '23505', 'one_running_per_user');
    await rejectsSql(() => db.insert(schema.entries).values(entry('negative-duration', { end: at - 1 })), '23514', 'entries_period_check');
    assert.equal((await db.select().from(schema.entries).where(eq(schema.entries.id, 'zero-duration')))[0].end, at);
    assert.equal((await db.select().from(schema.entries).where(eq(schema.entries.id, 'deleted-running')))[0].deleted, true);
  });

  await t.test('unicité ASCII compatible SQLite pour identifiants, clients et projets', async () => {
    await rejectsSql(() => db.insert(schema.users).values(user('duplicate-user', 'aLICE')), '23505', 'users_username_nocase');
    await rejectsSql(() => db.insert(schema.clients).values(client('duplicate-client', 'aTELIER')), '23505', 'clients_name_nocase');
    await rejectsSql(() => db.insert(schema.projects).values(project('duplicate-project', 'pLANS')), '23505', 'projects_client_name_nocase');
    await db.insert(schema.projects).values(project('same-name-other-client', 'pLANS', 'client-b'));
    // SQLite NOCASE does not fold accented characters: migration must not merge these.
    await db.insert(schema.users).values([user('accent-user-upper', 'Équipe'), user('accent-user-lower', 'équipe')]);
    await db.insert(schema.clients).values([client('accent-client-upper', 'Équipe'), client('accent-client-lower', 'équipe')]);
    await db.insert(schema.projects).values([project('accent-project-upper', 'Équipe'), project('accent-project-lower', 'équipe')]);
    // Tasks with identical names remain distinct catalog items.
    await db.insert(schema.tasks).values({ ...task('same-task-name'), name: 'task-a' });
  });

  await t.test('références restrictives, cascade des affectations et clés composées', async () => {
    for (const [table, column, id] of [
      [schema.users, schema.users.id, 'user-a'], [schema.clients, schema.clients.id, 'client-a'],
      [schema.projects, schema.projects.id, 'project-a'], [schema.tasks, schema.tasks.id, 'task-a'],
    ]) await rejectsSql(() => db.delete(table).where(eq(column, id)), '23503');
    await rejectsSql(() => db.insert(schema.entries).values(entry('missing-user', { user_id: 'absent' })), '23503');
    await rejectsSql(() => db.insert(schema.entries).values(entry('missing-task', { task_id: 'absent' })), '23503');
    await rejectsSql(() => db.insert(schema.assignments).values({ task_id: 'task-a', user_id: 'user-a' }), '23505', 'assignments_task_id_user_id_pk');
    await db.insert(schema.assignments).values({ task_id: 'task-a', user_id: 'user-b' });
    const request = { key: 'request-a', fingerprint: 'fingerprint-a', result: { ok: true }, at };
    await rejectsSql(() => db.insert(schema.requests).values({ ...request, user_id: 'user-a' }), '23505', 'requests_user_id_key_pk');
    await db.insert(schema.requests).values({ ...request, user_id: 'user-b' });
    await db.delete(schema.tasks).where(eq(schema.tasks.id, 'task-cascade'));
    assert.deepEqual(await db.select().from(schema.assignments).where(eq(schema.assignments.task_id, 'task-cascade')), []);
    const [preserved] = await db.select().from(schema.entries).where(eq(schema.entries.id, 'typed-entry'));
    assert.equal(preserved.task_id, 'task-a');
    assert.equal(preserved.project_id, 'project-a');
    assert.equal(preserved.version, 1);
  });

  await t.test('les rôles, statuts et niveaux invalides sont refusés par PostgreSQL', async () => {
    await rejectsSql(() => db.insert(schema.users).values({ ...user('invalid-role'), role: 'admin' }), '23514', 'users_role_check');
    await rejectsSql(() => db.insert(schema.tasks).values({ ...task('invalid-status'), status: 'unknown' }), '23514', 'tasks_status_check');
    await rejectsSql(() => db.insert(schema.eventLog).values(event(1, genesis, { level: 'debug' })), '23514', 'event_log_level_check');
  });

  await t.test('journal : texte signé intact, append-only, chaîne et rollback sans trou', async () => {
    const record = {
      id: 'audit-a', actor: 'user-a', entity: 'entry', entity_id: 'typed-entry', owner: 'user-a', action: 'update',
      before_json: '{ "z": 1, "a": [2, 3] }', after_json: '{"description":"Étude — façade","active":true}', at,
    };
    await db.insert(schema.audit).values(record);
    const first = event(1, genesis, {
      category: 'audit', action: 'update', actor: 'user-a', entity: 'entry', entity_id: 'typed-entry', request_id: 'request-a',
      details_json: JSON.stringify({ audit: record }, null, 2),
    });
    await db.insert(schema.eventLog).values(first);
    const [saved] = await db.select().from(schema.eventLog);
    assert.deepEqual(saved, first);
    assert.equal(digest(saved), first.hash);
    assert.deepEqual((await db.select().from(schema.audit))[0], record);
    assert.deepEqual(JSON.parse(saved.details_json).audit, record);

    const second = event(2, first.hash, { actor: 'technical-actor-without-account', action: 'rollback-check' });
    const rollback = new Error('Simulated business rollback');
    await assert.rejects(db.transaction(async tx => {
      await tx.insert(schema.eventLog).values(second);
      throw rollback;
    }), error => error === rollback);
    assert.equal((await db.select().from(schema.eventLog)).length, 1);
    await db.insert(schema.eventLog).values(second);
    await rejectsSql(() => db.insert(schema.eventLog).values(event(4, second.hash)), '23514', 'event_log_chain');
    await rejectsSql(() => db.insert(schema.eventLog).values(event(3, genesis)), '23514', 'event_log_chain');
    const [beforeEntry] = await db.select().from(schema.entries).where(eq(schema.entries.id, 'typed-entry'));
    const beforeAudit = await db.select().from(schema.audit);
    await rejectsSql(() => db.transaction(async tx => {
      await tx.update(schema.entries).set({ description: 'Must roll back', version: beforeEntry.version + 1 }).where(eq(schema.entries.id, beforeEntry.id));
      await tx.insert(schema.audit).values({ ...record, id: 'audit-rolled-back', before_json: JSON.stringify(beforeEntry), after_json: '{"description":"Must roll back"}' });
      await tx.insert(schema.eventLog).values(event(3, genesis));
    }), '23514', 'event_log_chain');
    assert.deepEqual((await db.select().from(schema.entries).where(eq(schema.entries.id, 'typed-entry')))[0], beforeEntry);
    assert.deepEqual(await db.select().from(schema.audit), beforeAudit);
    for (const table of ['audit', 'event_log']) {
      for (const statement of [`UPDATE ${table} SET action='tampered'`, `DELETE FROM ${table}`, `TRUNCATE TABLE ${table}`]) {
        await assert.rejects(pg.query(statement), error => error.code === '23514' && /Journal append-only/.test(error.message));
      }
    }
    await assert.rejects(pg.query("INSERT INTO audit SELECT * FROM audit WHERE id='audit-a' ON CONFLICT (id) DO UPDATE SET action='tampered'"), error => /Journal append-only/.test(error.message));
    assert.deepEqual(await db.select().from(schema.eventLog).orderBy(schema.eventLog.seq), [first, second]);
    assert.deepEqual((await db.select().from(schema.audit))[0], record);
  });
});
