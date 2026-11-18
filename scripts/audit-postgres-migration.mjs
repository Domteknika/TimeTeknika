import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { APP_VERSION } from '../public/release.js';
import { openPostgresDatabase } from '../server/db/postgres.mjs';
import { createPostgresJournal } from '../server/db/journal.mjs';
import { openSqliteImportSource, IMPORT_TABLES, canonicalRow } from '../server/db/sqlite-import-source.mjs';

class MigrationAuditError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const requireCheck = (condition, code) => { if (!condition) throw new MigrationAuditError(code); };
const checkpointMatches = (left, right) => left?.ok === true && right?.ok === true &&
  left.count === right.count && left.hash === right.hash && left.auditCount === right.auditCount;

async function verifyFile(path) {
  const expected = /^([a-f0-9]{64}) [ *]/.exec(await readFile(path + '.sha256', 'utf8'))?.[1];
  requireCheck(expected && (await stat(path)).size > 0, 'BACKUP_CHECKSUM_MISSING');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  requireCheck(hash.digest('hex') === expected, 'BACKUP_CHECKSUM_MISMATCH');
}

function checkImportReports(sourceReport, importReport, verification) {
  requireCheck(sourceReport.status === 'source-validated' && importReport.status === 'imported', 'IMPORT_REPORT_STATUS_INVALID');
  requireCheck(isDeepStrictEqual(Object.keys(sourceReport.tables).sort(), IMPORT_TABLES.map(table => table.name).sort()), 'IMPORT_TABLES_INCOMPLETE');
  requireCheck(isDeepStrictEqual(sourceReport.tables, importReport.tables) && sourceReport.fingerprint === importReport.fingerprint,
    'IMPORT_REPORTS_DIFFER');
  requireCheck(checkpointMatches(sourceReport.checkpoint, importReport.checkpoint), 'IMPORT_CHECKPOINTS_DIFFER');
  requireCheck(verification.ok === true && verification.fingerprint === importReport.fingerprint &&
    checkpointMatches(verification.journal, importReport.checkpoint), 'PREPUBLICATION_VERIFICATION_INVALID');
}

async function comparePreservedRows(store, source, table) {
  const result = { original: source.counts[table], present: 0, missing: 0, changedSinceImport: 0 };
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    // Table names are fixed below, never supplied by a report or CLI argument.
    const current = new Map((await store.all(`SELECT * FROM "${table}" WHERE id IN (${batch.map(() => '?').join(',')})`,
      ...batch.map(row => row.id))).map(row => [row.id, row]));
    for (const row of batch) {
      const now = current.get(row.id);
      if (!now) result.missing++;
      else {
        result.present++;
        if (canonicalRow(table, now) !== canonicalRow(table, row)) result.changedSinceImport++;
      }
    }
    batch = [];
  };
  for (const row of source.rows(table)) { batch.push(row); if (batch.length === 250) await flush(); }
  await flush();
  requireCheck(result.missing === 0, table === 'users' ? 'ORIGINAL_USERS_MISSING' : table === 'entries' ? 'ORIGINAL_ENTRIES_MISSING' : 'ORIGINAL_AUDITS_MISSING');
  if (table === 'audit') requireCheck(result.changedSinceImport === 0, 'ORIGINAL_AUDITS_CHANGED');
  return result;
}

function summarizeSource(source) {
  let activeUsers = 0, deletedEntries = 0, runningTimers = 0, completedMilliseconds = 0n;
  for (const row of source.rows('users')) activeUsers += Number(row.active === 1);
  for (const row of source.rows('entries')) {
    if (row.deleted) deletedEntries++;
    else if (row.end === null) runningTimers++;
    else completedMilliseconds += BigInt(row.end) - BigInt(row.start);
  }
  return { users: source.counts.users, activeUsers, entries: source.counts.entries,
    deletedEntries, runningTimers, completedMilliseconds: completedMilliseconds.toString() };
}

// This audit never initializes a store, applies migrations, locks for writing,
// repairs history or replays the import. Live data may have evolved since cutover.
export async function auditPostgresMigration({ statePath, backupsPath, databaseUrl, expectedDatabase, checkpointPath, store: suppliedStore }) {
  const externalCheckpoint = checkpointPath ? JSON.parse(await readFile(checkpointPath, 'utf8')) : null;
  if (externalCheckpoint) requireCheck(Number.isSafeInteger(externalCheckpoint.count) && externalCheckpoint.count > 0 &&
    /^[a-f0-9]{64}$/.test(externalCheckpoint.hash), 'EXTERNAL_CHECKPOINT_INVALID');
  const json = async name => JSON.parse(await readFile(join(statePath, name + '.json'), 'utf8'));
  const finalSource = await json('final-source'), finalImport = await json('final-import');
  const finalVerification = await json('final-verification'), trialSource = await json('trial-source');
  const trialImport = await json('trial-import'), trialVerification = await json('trial-verification');
  const restoreVerification = await json('restore-verification');
  const privateJournal = await json('private-journal'), publishedJournal = await json('published-journal');
  requireCheck((await readFile(join(statePath, 'COMPLETE'), 'utf8')).trim() === APP_VERSION, 'MIGRATION_COMPLETION_INVALID');
  checkImportReports(finalSource, finalImport, finalVerification);
  checkImportReports(trialSource, trialImport, trialVerification);
  requireCheck(trialVerification.nativeConcurrency === true, 'NATIVE_CONCURRENCY_NOT_VERIFIED');
  requireCheck(restoreVerification.ok === true && restoreVerification.fingerprint === trialImport.fingerprint &&
    checkpointMatches(restoreVerification.journal, trialImport.checkpoint), 'RESTORE_NOT_VERIFIED');
  requireCheck(privateJournal.ok === true && publishedJournal.ok === true &&
    privateJournal.count >= finalImport.checkpoint.count && publishedJournal.count >= privateJournal.count, 'POSTPUBLICATION_JOURNAL_INVALID');

  const sourcePath = join(statePath, 'final.sqlite');
  await verifyFile(sourcePath);
  const backupLog = await readFile(join(statePath, 'postgres-backup.log'), 'utf8');
  const backupName = /^Sauvegarde PostgreSQL : \/var\/backups\/timeteknika\/(timeteknika-postgres-\d{8}T\d{15}Z\.dump)\s*$/m.exec(backupLog)?.[1];
  requireCheck(backupName, 'POSTGRES_BACKUP_REFERENCE_INVALID');
  await verifyFile(join(backupsPath, backupName));
  const source = await openSqliteImportSource(sourcePath, { checkpoint: finalImport.checkpoint });
  let store;
  try {
    requireCheck(source.fingerprint === finalImport.fingerprint && checkpointMatches(source.checkpoint, finalImport.checkpoint), 'SQLITE_BACKUP_DIFFERS_FROM_IMPORT');
    for (const table of IMPORT_TABLES) requireCheck(source.counts[table.name] === finalImport.tables[table.name].count &&
      source.tableHashes[table.name] === finalImport.tables[table.name].hash, 'SQLITE_TABLE_DIFFERS_FROM_IMPORT');
    const summary = summarizeSource(source);
    requireCheck(isDeepStrictEqual(summary, finalImport.summary), 'IMPORT_SUMMARY_DIFFERS_FROM_BACKUP');
    store = suppliedStore ?? await openPostgresDatabase({ databaseUrl });
    const current = await store.readTransaction(async () => {
      if (expectedDatabase) requireCheck((await store.one('SELECT current_database() AS name')).name === expectedDatabase, 'WRONG_ACTIVE_DATABASE');
      const journal = await createPostgresJournal(store).verifyJournal(source.checkpoint);
      requireCheck(journal.ok, 'LIVE_JOURNAL_INVALID');
      for (const checkpoint of [privateJournal, publishedJournal, ...(externalCheckpoint ? [externalCheckpoint] : [])]) {
        const event = await store.one('SELECT hash FROM event_log WHERE seq=?', checkpoint.count);
        requireCheck(event?.hash === checkpoint.hash, 'PUBLISHED_CHECKPOINT_MISSING');
      }
      const preservation = {};
      for (const table of ['users', 'entries', 'audit']) preservation[table] = await comparePreservedRows(store, source, table);
      const tables = {};
      for (const table of IMPORT_TABLES) tables[table.name] = (await store.one(`SELECT COUNT(*) AS n FROM "${table.name}"`)).n;
      const time = await store.one(`SELECT
        COUNT(*) FILTER (WHERE deleted=true) AS "deletedEntries",
        COUNT(*) FILTER (WHERE deleted=false AND "end" IS NULL) AS "runningTimers",
        COALESCE(SUM("end"::numeric-start::numeric) FILTER (WHERE deleted=false AND "end" IS NOT NULL),0)::text AS "completedMilliseconds"
        FROM entries`);
      const activeUsers = (await store.one('SELECT COUNT(*) AS n FROM users WHERE active=true')).n;
      return { tables, activeUsers, ...time, preservation, journal };
    });
    return {
      ok: true, checkedAt: new Date().toISOString(), version: APP_VERSION, readOnly: true,
      migrationComplete: true, tablesComparedAtImport: IMPORT_TABLES.length,
      imported: { ...summary, tables: Object.fromEntries(IMPORT_TABLES.map(table => [table.name, source.counts[table.name]])),
        journal: source.checkpoint },
      current, nativeConcurrencyVerified: true, restoreVerified: true,
      externalCheckpoint: externalCheckpoint ? { verified: true, count: externalCheckpoint.count, hash: externalCheckpoint.hash } : null,
      retainedBackups: { sqliteChecksumVerified: true, postgresChecksumVerified: true },
    };
  } finally {
    try { if (!suppliedStore) await store?.close(); }
    finally { await source.close(); }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [statePath, backupsPath, checkpointPath, extra] = process.argv.slice(2);
    requireCheck(statePath && backupsPath && !extra, 'AUDIT_ARGUMENTS_INVALID');
    const result = await auditPostgresMigration({ statePath, backupsPath, checkpointPath, databaseUrl: process.env.DATABASE_URL,
      expectedDatabase: process.env.TEKNIKA_DATABASE });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error instanceof MigrationAuditError ? error.code : 'AUDIT_UNCONFIRMED',
      message: 'Contrôle non confirmé. Ne pas relancer l’import ni restaurer SQLite sur la base active.' }));
    process.exitCode = 1;
  }
}
