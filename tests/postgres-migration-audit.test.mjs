import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { openStore, seedDemo } from '../server/store.mjs';
import { migrateDatabase, openPostgresDatabase } from '../server/db/postgres.mjs';
import { createPostgresJournal } from '../server/db/journal.mjs';
import { importSqliteToPostgres } from '../server/db/import-sqlite.mjs';
import { IMPORT_TABLES, canonicalRow } from '../server/db/sqlite-import-source.mjs';
import { APP_VERSION } from '../public/release.js';
import { auditPostgresMigration } from '../scripts/audit-postgres-migration.mjs';

const privateMarker = 'fixture-private-description-not-for-the-report';
const sha = value => createHash('sha256').update(value).digest('hex');
const json = (path, value) => writeFile(path, JSON.stringify(value));

async function fixture(t) {
  await mkdir('.qa', { recursive: true });
  const directory = await mkdtemp(resolve('.qa/migration-audit-'));
  const statePath = join(directory, 'state'), backupsPath = join(directory, 'backups');
  await mkdir(statePath); await mkdir(backupsPath);
  const sourcePath = join(statePath, 'final.sqlite');
  const sqlite = openStore(sourcePath);
  let entryId;
  try {
    seedDemo(sqlite);
    entryId = sqlite.one('SELECT id FROM entries ORDER BY id LIMIT 1').id;
    sqlite.run('UPDATE entries SET description=? WHERE id=?', privateMarker, entryId);
    sqlite.run('UPDATE users SET name=? WHERE id=?', privateMarker, 'demo-emma');
    sqlite.audit(sqlite.one('SELECT * FROM users WHERE id=?', 'demo-alex'), 'entry', entryId, 'create',
      null, sqlite.one('SELECT * FROM entries WHERE id=?', entryId), 'demo-emma');
  } finally { sqlite.db.close(); }
  const pg = new PGlite(), orm = drizzle(pg);
  let store;
  t.after(async () => {
    try { await store?.close(); }
    finally { await pg.close(); await rm(directory, { recursive: true, force: true }); }
  });
  await migrateDatabase({ drizzle: orm });
  store = await openPostgresDatabase({ drizzle: orm });
  const imported = await importSqliteToPostgres({ sourcePath, store });
  const source = { status: 'source-validated', tables: imported.tables, checkpoint: imported.checkpoint, fingerprint: imported.fingerprint };
  const verification = { ok: true, fingerprint: imported.fingerprint, snapshots: imported.summary.activeUsers,
    exports: ['csv', 'xlsx', 'pdf'], journal: imported.checkpoint, nativeConcurrency: false };
  for (const prefix of ['trial', 'final']) {
    await json(join(statePath, `${prefix}-source.json`), source);
    await json(join(statePath, `${prefix}-import.json`), imported);
    await json(join(statePath, `${prefix}-verification.json`), { ...verification, nativeConcurrency: prefix === 'trial' });
  }
  await json(join(statePath, 'restore-verification.json'), verification);
  await writeFile(join(statePath, 'COMPLETE'), APP_VERSION + '\n');
  await writeFile(join(statePath, 'final.sqlite.sha256'), `${sha(await readFile(sourcePath))}  ${sourcePath}\n`);
  const dumpPath = join(backupsPath, 'timeteknika-postgres-20261117T140000000000000Z.dump');
  // The auditor checks the retained dump's bytes; native restore rehearsal is
  // represented by its separate report, not performed against this fixture.
  await writeFile(dumpPath, 'fixture-dump');
  await writeFile(dumpPath + '.sha256', `${sha(await readFile(dumpPath))}  ${dumpPath}\n`);
  await writeFile(join(statePath, 'postgres-backup.log'), 'Sauvegarde PostgreSQL : /var/backups/timeteknika/timeteknika-postgres-20261117T140000000000000Z.dump\n');
  const journal = createPostgresJournal(store);
  await journal.log({ category: 'system', action: 'server-start', details: { private: true } });
  await json(join(statePath, 'private-journal.json'), await journal.verifyJournal(imported.checkpoint));
  await journal.log({ category: 'system', action: 'server-stop' });
  await journal.log({ category: 'system', action: 'server-start' });
  const published = await journal.verifyJournal(imported.checkpoint);
  await json(join(statePath, 'published-journal.json'), published);
  const checkpointPath = join(directory, 'external-checkpoint.json');
  await json(checkpointPath, { count: published.count, hash: published.hash });
  const expectedDatabase = (await store.one('SELECT current_database() AS name')).name;
  return { store, journal, statePath, backupsPath, sourcePath, dumpPath, checkpointPath, entryId, imported,
    audit: () => auditPostgresMigration({ statePath, backupsPath, expectedDatabase, checkpointPath, store }) };
}

async function databaseHash(store) {
  const hash = createHash('sha256');
  for (const table of IMPORT_TABLES) {
    const rows = await store.all(`SELECT * FROM "${table.name}"`);
    hash.update(table.name + '\n');
    for (const row of rows.map(row => canonicalRow(table, row)).sort()) hash.update(row + '\n');
  }
  return hash.digest('hex');
}

test('Audit migration : conservation vérifiée après démarrage, sans écriture ni données privées dans le rapport', async t => {
  const f = await fixture(t);
  const before = await databaseHash(f.store), original = sha(await readFile(f.sourcePath));
  const initial = await f.audit();
  assert.equal(initial.ok, true);
  assert.equal(initial.tablesComparedAtImport, 13);
  assert.equal(initial.current.preservation.users.missing, 0);
  assert.equal(initial.current.preservation.entries.changedSinceImport, 0);
  assert.equal(initial.current.preservation.audit.changedSinceImport, 0);
  assert.equal(initial.externalCheckpoint.verified, true);
  assert.equal(await databaseHash(f.store), before);
  assert.equal(sha(await readFile(f.sourcePath)), original);
  assert.ok(!JSON.stringify(initial).includes(privateMarker));

  // After publication users may legitimately change preferences and entries;
  // such changes must not be misreported as a failed historical import.
  await f.store.transaction(async () => {
    const previous = await f.store.one('SELECT * FROM entries WHERE id=?', f.entryId);
    await f.store.run('UPDATE entries SET "end"=?,version=version+1,updated_at=? WHERE id=?', previous.end + 60000, Date.now(), f.entryId);
    await f.journal.audit({ id: 'demo-alex' }, 'entry', f.entryId, 'update', previous,
      await f.store.one('SELECT * FROM entries WHERE id=?', f.entryId), previous.user_id);
    await f.store.run('UPDATE users SET preferences=? WHERE id=?', '{"weeklyTargetMinutes":2100}', 'demo-emma');
  });
  const changed = await databaseHash(f.store);
  assert.notEqual(changed, before);
  const currentCheckpoint = await f.journal.verifyJournal();
  await json(f.checkpointPath, { count: currentCheckpoint.count, hash: currentCheckpoint.hash });
  const result = await f.audit();
  assert.equal(result.ok, true);
  assert.deepEqual(result.externalCheckpoint, { verified: true, count: currentCheckpoint.count, hash: currentCheckpoint.hash });
  assert.equal(result.current.preservation.users.changedSinceImport, 1);
  assert.equal(result.current.preservation.entries.changedSinceImport, 1);
  assert.equal(BigInt(result.current.completedMilliseconds), BigInt(result.imported.completedMilliseconds) + 60000n);
  assert.equal(await databaseHash(f.store), changed);
  assert.equal(sha(await readFile(f.sourcePath)), original);
  assert.ok(!JSON.stringify(result).includes(privateMarker));
  await json(f.checkpointPath, { count: currentCheckpoint.count, hash: '0'.repeat(64) });
  await assert.rejects(f.audit, { code: 'PUBLISHED_CHECKPOINT_MISSING' });
  await json(f.checkpointPath, { count: String(currentCheckpoint.count), hash: currentCheckpoint.hash });
  await assert.rejects(f.audit, { code: 'EXTERNAL_CHECKPOINT_INVALID' });
  assert.equal(await databaseHash(f.store), changed);
});

test('Audit migration : une ancienne entrée manquante est détectée même si le journal est valide', async t => {
  const f = await fixture(t);
  await f.store.run('DELETE FROM entries WHERE id=?', f.entryId);
  assert.equal((await f.journal.verifyJournal(f.imported.checkpoint)).ok, true);
  await assert.rejects(f.audit);
});

test('Audit migration : une divergence entre les rapports de comparaison est refusée', async t => {
  const f = await fixture(t);
  const path = join(f.statePath, 'final-source.json');
  const altered = JSON.parse(await readFile(path, 'utf8'));
  altered.tables.users.count++;
  await json(path, altered);
  await assert.rejects(f.audit);
  altered.tables.users.count--;
  await json(path, altered);
  await writeFile(f.dumpPath, 'corrupted-dump');
  await assert.rejects(f.audit);
});
