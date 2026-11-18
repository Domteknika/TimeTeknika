import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, copyFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { openStore, seedDemo, passwordHash, passwordMatches } from '../server/store.mjs';
import { migrateDatabase, openPostgresDatabase } from '../server/db/postgres.mjs';
import { createPostgresJournal } from '../server/db/journal.mjs';
import { importSqliteToPostgres } from '../server/db/import-sqlite.mjs';
import { openPostgresStore } from '../server/async-store.mjs';
import { createApplication } from '../server/index.mjs';
import { IMPORT_TABLES } from '../server/db/sqlite-import-source.mjs';

const tableNames = IMPORT_TABLES.map(table => table.name);
const jsonColumns = Object.fromEntries(IMPORT_TABLES.map(table => [table.name, table.json]));
const at = Date.parse('2026-02-10T08:00:00.123Z');
const password = 'Import-fixture-2026!';
const retainedCookie = 'imported-session-cookie';
const sha = value => createHash('sha256').update(value).digest('hex');
const fields = ['seq', 'at', 'level', 'category', 'action', 'actor', 'entity', 'entity_id', 'request_id', 'details_json', 'previous_hash'];

function comparable(table, rows) {
  return rows.map(row => {
    const copy = { ...row };
    for (const key of jsonColumns[table] ?? []) copy[key] = typeof copy[key] === 'string' ? JSON.parse(copy[key]) : copy[key];
    return copy;
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
}

async function sourceFixture(t) {
  await mkdir('.qa', { recursive: true });
  const directory = await mkdtemp(resolve('.qa/postgres-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, 'source.sqlite');
  const source = openStore(sourcePath);
  try {
    seedDemo(source);
    for (const uid of ['demo-alex', 'demo-emma']) source.run('UPDATE users SET password=? WHERE id=?', passwordHash(password), uid);
    source.run('UPDATE users SET active=0 WHERE id=?', 'demo-lucas');
    source.run('UPDATE users SET preferences=? WHERE id=?', '{ "calendarFit": false, "taskProjects": {"project-cedres": {"pinned": true}}, "weeklyTargetMinutes": 2400 }', 'demo-emma');
    source.run('UPDATE projects SET archived=1,version=7 WHERE id=?', 'project-atelier');
    source.run('UPDATE tasks SET archived=1,version=4 WHERE id=?', 'task-releve');
    source.run('INSERT INTO sessions(token,user_id,csrf,expires) VALUES (?,?,?,?)', sha(retainedCookie), 'demo-emma', 'imported-csrf', Date.now() + 86400000);
    source.run('INSERT INTO sessions(token,user_id,csrf,expires) VALUES (?,?,?,?)', sha('expired-cookie'), 'demo-lucas', 'expired-csrf', at);
    source.run('INSERT INTO requests(user_id,key,fingerprint,result,at) VALUES (?,?,?,?,?)', 'demo-emma', 'old-request-key', sha('original request'), '{ "revision": 17, "entry": {"id":"entry-kept", "start": 1770710400123} }', at);
    source.run('INSERT INTO export_templates(id,user_id,name,config,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', 'template-kept', 'demo-emma', 'Relevé façade', '{ "version":1, "document":{"title":"Étude façade"}, "columns":[{"key":"description","label":"Libellé"}], "total":true }', 3, at, at + 10);
    source.run('INSERT INTO work_schedules(user_id,start_date,schedule,version) VALUES (?,?,?,?)',
      'demo-emma', '2026-12-21', '{"days":[[240,240],[240,240],[240,240],[240,240],[0,0],[0,0],[0,0]]}', 2);
    source.run('INSERT INTO leaves(id,user_id,start_date,end_date,start_part,end_part,exclusions,version) VALUES (?,?,?,?,?,?,?,?)',
      'leave-kept', 'demo-emma', '2026-12-24', '2026-12-28', 'pm', 'am', '{"dates":["2026-12-25","2026-12-26","2026-12-27"]}', 3);
    source.run('INSERT INTO holidays(id,date,name,kind,version) VALUES (?,?,?,?,?)', 'holiday-kept', '2026-12-25', 'Noël', 'holiday', 2);
    for (const [eid, uid, end, deleted, description, taskId, projectId] of [
      ['entry-running', 'demo-emma', null, 0, 'Chrono conservé ⏱', 'task-plans', 'project-cedres'],
      ['entry-zero', 'demo-alex', at, 0, 'Durée nulle', null, null],
      ['entry-deleted', 'demo-lucas', at + 3600000, 1, 'Historique retiré', 'task-releve', 'project-atelier'],
    ]) source.run('INSERT INTO entries(id,user_id,task_id,project_id,description,start,end,version,deleted,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', eid, uid, taskId, projectId, description, at, end, 5, deleted, at - 123, at + 456);
    const audit = { id: 'audit-exact', actor: 'demo-lucas', entity: 'entry', entity_id: 'entry-deleted', owner: 'demo-lucas', action: 'delete', before_json: '{ "description": "Étude façade", "z": 2, "a": 1 }', after_json: '{"deleted":1,"version":5}', at };
    source.run('INSERT INTO audit(id,actor,entity,entity_id,owner,action,before_json,after_json,at) VALUES (?,?,?,?,?,?,?,?,?)', ...Object.values(audit));
    source.log({ category: 'audit', action: audit.action, actor: audit.actor, entity: audit.entity, entity_id: audit.entity_id, details: { audit, legacy: true } });
    const head = source.one('SELECT seq,hash FROM event_log ORDER BY seq DESC LIMIT 1');
    const event = { seq: head.seq + 1, at, level: 'warning', category: 'system', action: 'legacy-detail', actor: 'removed-external-reference', entity: null, entity_id: null, request_id: null, details_json: '{ "z": 2, "a": [1, 3], "text": "français 🧭" }', previous_hash: head.hash };
    const hash = sha(JSON.stringify(fields.map(key => event[key])));
    source.run(`INSERT INTO event_log(${[...fields, 'hash'].join(',')}) VALUES (${Array(12).fill('?').join(',')})`, ...fields.map(key => event[key]), hash);
    source.run("UPDATE meta SET value=17 WHERE key='revision'");
    const checkpoint = source.verifyJournal();
    assert.equal(checkpoint.ok, true);
    const expected = Object.fromEntries(tableNames.map(table => [table, source.all(`SELECT * FROM "${table}"`).map(row => ({ ...row }))]));
    return { sourcePath, directory, expected, checkpoint };
  } finally { source.db.close(); }
}

async function targetFixture(t) {
  const pg = new PGlite(), orm = drizzle(pg);
  await migrateDatabase({ drizzle: orm });
  const store = await openPostgresDatabase({ drizzle: orm });
  const target = { pg, orm, store, beforeClose: undefined };
  t.after(async () => {
    try { await target.beforeClose?.(); }
    finally { await store.close(); await pg.close(); }
  });
  return target;
}

async function assertEmpty(store) {
  for (const table of tableNames) assert.equal((await store.one(`SELECT count(*) n FROM "${table}"`)).n, 0, `${table} should remain empty`);
}

test('Import PostgreSQL : les tables, mots de passe, temps et empreintes sont conservés', async t => {
  const source = await sourceFixture(t), target = await targetFixture(t);
  const sourceBytes = sha(await readFile(source.sourcePath));
  let imported;

  await t.test('la validation préalable n’écrit rien dans la cible ni dans la source', async () => {
    const result = await importSqliteToPostgres({ sourcePath: source.sourcePath, store: target.store, checkpoint: source.checkpoint, dryRun: true });
    assert.equal(result.status, 'validated');
    assert.equal(result.checkpoint.hash, source.checkpoint.hash);
    await assertEmpty(target.store);
    assert.equal(sha(await readFile(source.sourcePath)), sourceBytes);
  });

  await t.test('chaque ligne est copiée avec les seules conversions de types prévues', async () => {
    imported = await importSqliteToPostgres({ sourcePath: source.sourcePath, store: target.store, checkpoint: source.checkpoint });
    assert.equal(imported.status, 'imported');
    assert.match(imported.fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(Object.keys(imported.tables).length, IMPORT_TABLES.length);
    for (const table of tableNames) {
      const actual = await target.store.all(`SELECT * FROM "${table}"`);
      assert.deepEqual(comparable(table, actual), comparable(table, source.expected[table]), table);
      assert.equal(imported.tables[table].count, source.expected[table].length, table);
    }
    assert.deepEqual(await createPostgresJournal(target.store).verifyJournal(source.checkpoint), source.checkpoint);
    assert.equal(sha(await readFile(source.sourcePath)), sourceBytes);
    const member = await target.store.one('SELECT * FROM users WHERE id=?', 'demo-emma');
    assert.equal(passwordMatches(password, member.password), true);
    assert.equal((await target.store.one('SELECT * FROM entries WHERE id=?', 'entry-running')).end, null);
    assert.equal((await target.store.one('SELECT * FROM entries WHERE id=?', 'entry-deleted')).deleted, 1);
  });

  await t.test('un rejeu exact est reconnu sans dupliquer les données ni le journal', async () => {
    const replay = await importSqliteToPostgres({ sourcePath: source.sourcePath, store: target.store });
    assert.equal(replay.status, 'already-imported');
    assert.equal(replay.fingerprint, imported.fingerprint);
    assert.deepEqual(replay.tables, imported.tables);
    assert.deepEqual(await createPostgresJournal(target.store).verifyJournal(), source.checkpoint);
  });

  await t.test('le serveur retrouve les comptes, la session importée et l’historique privé', async () => {
    const applicationStore = await openPostgresStore({ drizzle: target.orm });
    const app = await createApplication({ store: applicationStore });
    // Even when an HTTP assertion fails, drain server logs before closing PGlite.
    target.beforeClose = () => app.close();
    await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const retained = await fetch(base + '/api/state', { headers: { Cookie: `teknika_session=${retainedCookie}` } });
    assert.equal(retained.status, 200);
    const mine = await retained.json();
    assert.equal(mine.me.id, 'demo-emma');
    assert.equal(mine.me.preferences.weeklyTargetMinutes, 2400);
    assert.ok(mine.entries.every(row => row.user_id === 'demo-emma'));
    assert.equal(mine.entries.find(row => row.id === 'entry-running').start, at);
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'alex@demo.local', password }) });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).me.role, 'admin');
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const history = await fetch(base + '/api/entries/entry-deleted/history', { headers: { Cookie: cookie } });
    assert.equal(history.status, 200);
    const audit = (await history.json()).items.find(row => row.id === 'audit-exact');
    assert.equal(audit.actor, 'demo-lucas');
    assert.deepEqual(audit.before, JSON.parse(source.expected.audit[0].before_json));
    assert.equal((await applicationStore.verifyJournal(source.checkpoint)).ok, true);
    await app.close();
    // Once the target has accepted new lifecycle/session events it cannot be overwritten by a replay.
    await assert.rejects(importSqliteToPostgres({ sourcePath: source.sourcePath, store: target.store }));
    assert.equal(sha(await readFile(source.sourcePath)), sourceBytes);
  });
});

test('Import PostgreSQL : les erreurs source sont refusées avant toute copie', async t => {
  const source = await sourceFixture(t), { store } = await targetFixture(t);
  const cases = [
    ['journal altéré', db => db.exec("DROP TRIGGER event_log_no_update; UPDATE event_log SET action='tampered' WHERE seq=1")],
    ['clé étrangère invalide', db => db.exec("PRAGMA foreign_keys=OFF; UPDATE entries SET user_id='missing-user' WHERE id='entry-zero'")],
    ['indicateur hors 0/1', db => db.exec("UPDATE users SET active=2 WHERE id='demo-emma'")],
    ['entier non représentable sans perte', db => db.exec("UPDATE entries SET created_at=9007199254740993 WHERE id='entry-zero'")],
    ['JSON invalide', db => db.prepare('UPDATE users SET preferences=? WHERE id=?').run('{broken', 'demo-emma')],
    ['nombre JSON non sûr', db => db.prepare('UPDATE users SET preferences=? WHERE id=?').run('{"weeklyTargetMinutes":9007199254740993}', 'demo-emma')],
    ['texte incompatible PostgreSQL', db => db.prepare('UPDATE users SET name=? WHERE id=?').run('Name\u0000tail', 'demo-emma')],
    ['table inconnue à préserver', db => db.exec('CREATE TABLE undiscovered_history(id TEXT PRIMARY KEY,detail TEXT); INSERT INTO undiscovered_history VALUES (\'kept\',\'do not lose\')')],
  ];
  for (const [name, corrupt] of cases) await t.test(name, async () => {
    const file = join(source.directory, `invalid-${cases.findIndex(([label]) => label === name)}.sqlite`);
    await copyFile(source.sourcePath, file);
    const db = new DatabaseSync(file);
    try { corrupt(db); } finally { db.close(); }
    const before = sha(await readFile(file));
    await assert.rejects(importSqliteToPostgres({ sourcePath: file, store }));
    await assertEmpty(store);
    assert.equal(sha(await readFile(file)), before);
  });
  await t.test('checkpoint externe différent et fichier absent', async () => {
    await assert.rejects(importSqliteToPostgres({ sourcePath: source.sourcePath, store, checkpoint: { count: source.checkpoint.count, hash: 'f'.repeat(64) } }));
    await assert.rejects(importSqliteToPostgres({ sourcePath: join(source.directory, 'absent.sqlite'), store }));
    await assertEmpty(store);
  });
});

test('Import PostgreSQL : cible occupée refusée et échec intermédiaire entièrement annulé', async t => {
  const source = await sourceFixture(t), { pg, store } = await targetFixture(t);
  const before = sha(await readFile(source.sourcePath));
  await t.test('une cible contenant déjà des données n’est jamais nettoyée', async () => {
    await store.run('INSERT INTO meta(key,value) VALUES (?,?)', 'existing', 42);
    await assert.rejects(importSqliteToPostgres({ sourcePath: source.sourcePath, store }));
    assert.deepEqual(await store.all('SELECT * FROM meta'), [{ key: 'existing', value: 42 }]);
    await store.run('DELETE FROM meta WHERE key=?', 'existing');
  });
  await t.test('une erreur après les premières insertions laisse toutes les tables vides', async () => {
    await pg.exec(`CREATE FUNCTION public.reject_import_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated audit import failure'; END; $$;
      CREATE TRIGGER reject_import_audit BEFORE INSERT ON public.audit
      FOR EACH ROW EXECUTE FUNCTION public.reject_import_audit();`);
    await assert.rejects(importSqliteToPostgres({ sourcePath: source.sourcePath, store }));
    await assertEmpty(store);
    assert.equal(sha(await readFile(source.sourcePath)), before);
    await pg.exec('DROP TRIGGER reject_import_audit ON public.audit; DROP FUNCTION public.reject_import_audit()');
    assert.equal((await importSqliteToPostgres({ sourcePath: source.sourcePath, store })).status, 'imported');
    assert.deepEqual(await createPostgresJournal(store).verifyJournal(), source.checkpoint);
  });
});

test('Import PostgreSQL : un journal déjà initialisé dans la cible est conservé sans remplacement', async t => {
  const source = await sourceFixture(t), { store } = await targetFixture(t);
  const journal = createPostgresJournal(store);
  const checkpoint = await journal.initializeJournal();
  const metadata = await store.all('SELECT * FROM meta ORDER BY key');
  await assert.rejects(importSqliteToPostgres({ sourcePath: source.sourcePath, store }), error => error.code === 'TARGET_NOT_EMPTY');
  assert.deepEqual(await store.all('SELECT * FROM meta ORDER BY key'), metadata);
  assert.deepEqual(await journal.verifyJournal(), checkpoint);
  assert.equal((await store.one('SELECT count(*) n FROM users')).n, 0);
});

test('Import PostgreSQL : la copie cohérente inclut les écritures validées encore dans le WAL SQLite', async t => {
  const source = await sourceFixture(t), { store } = await targetFixture(t);
  const writer = openStore(source.sourcePath);
  try {
    writer.db.exec('PRAGMA wal_autocheckpoint=0');
    writer.run('UPDATE entries SET description=?,version=version+1 WHERE id=?', 'Modification validée dans le WAL', 'entry-zero');
    writer.log({ category: 'system', action: 'committed-in-wal' });
    const checkpoint = writer.verifyJournal();
    const mainBytes = sha(await readFile(source.sourcePath));
    const result = await importSqliteToPostgres({ sourcePath: source.sourcePath, store, checkpoint });
    assert.equal(result.status, 'imported');
    assert.equal((await store.one('SELECT description FROM entries WHERE id=?', 'entry-zero')).description, 'Modification validée dans le WAL');
    assert.deepEqual(await createPostgresJournal(store).verifyJournal(checkpoint), checkpoint);
    assert.equal(sha(await readFile(source.sourcePath)), mainBytes);
  } finally { writer.db.close(); }
});

test('Import PostgreSQL : lots et pagination préservent les clés composées et l’ordre Unicode', async t => {
  const source = await sourceFixture(t), { store } = await targetFixture(t);
  const writer = openStore(source.sourcePath);
  const prefixes = ['A', 'Z', 'a', 'É', 'é', '東', '🧭'];
  const expected = {};
  let checkpoint;
  try {
    writer.db.exec('BEGIN IMMEDIATE');
    for (let index = 0; index < 530; index++) {
      const key = `${prefixes[index % prefixes.length]}-${String(index).padStart(4, '0')}`;
      writer.run('INSERT INTO entries(id,user_id,description,start,end,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', key, 'demo-emma', `Batch ${key}`, at + index * 60000, at + (index + 1) * 60000, at, at);
      writer.run('INSERT INTO requests(user_id,key,fingerprint,result,at) VALUES (?,?,?,?,?)', index % 2 ? 'demo-alex' : 'demo-emma', key, sha(key), JSON.stringify({ entry: { id: key }, revision: index }), at);
      if (index < 260) {
        writer.run('INSERT INTO tasks(id,name,project_id,created_by) VALUES (?,?,?,?)', key, `Task ${key}`, 'project-cedres', 'demo-alex');
        for (const userId of ['demo-alex', 'demo-emma']) writer.run('INSERT INTO assignments(task_id,user_id) VALUES (?,?)', key, userId);
      }
      writer.log({ category: 'system', action: 'batch-fixture', details: { index, key } });
    }
    writer.db.exec('COMMIT');
    checkpoint = writer.verifyJournal();
    assert.equal(checkpoint.ok, true);
    for (const table of ['entries', 'requests', 'assignments', 'event_log']) expected[table] = writer.all(`SELECT * FROM "${table}"`).map(row => ({ ...row }));
  } finally { writer.db.close(); }
  const before = sha(await readFile(source.sourcePath));
  const imported = await importSqliteToPostgres({ sourcePath: source.sourcePath, store, checkpoint });
  assert.equal(imported.status, 'imported');
  for (const [table, rows] of Object.entries(expected)) {
    assert.ok(rows.length > 500);
    assert.equal(imported.tables[table].count, rows.length);
    assert.deepEqual(comparable(table, await store.all(`SELECT * FROM "${table}"`)), comparable(table, rows), table);
  }
  assert.deepEqual(await createPostgresJournal(store).verifyJournal(), checkpoint);
  const replay = await importSqliteToPostgres({ sourcePath: source.sourcePath, store });
  assert.equal(replay.status, 'already-imported');
  assert.equal(replay.fingerprint, imported.fingerprint);
  assert.equal(sha(await readFile(source.sourcePath)), before);
});
