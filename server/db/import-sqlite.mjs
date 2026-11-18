import { createHash } from 'node:crypto';
import { openPostgresDatabase } from './postgres.mjs';
import { createPostgresJournal } from './journal.mjs';
import { IMPORT_TABLES, canonicalRow, openSqliteImportSource } from './sqlite-import-source.mjs';

export class SqliteImportError extends Error {
  constructor(code, message, options) { super(message, options); this.name = 'SqliteImportError'; this.code = code; }
}

// Identifiers come exclusively from the fixed, reviewed table descriptors.
const quoted = name => `"${name}"`;
const targetName = table => `public.${quoted(table.name)}`;
const orderedKey = (table, key) => table.name === 'event_log' && key === 'seq' ? quoted(key) : `${quoted(key)} COLLATE "C"`;
const fingerprintOf = tables => createHash('sha256').update(JSON.stringify(IMPORT_TABLES.map(table => [table.name, tables[table.name].count, tables[table.name].hash]))).digest('hex');

async function inspectTarget(store) {
  const tables = {};
  for (const table of IMPORT_TABLES) {
    const hash = createHash('sha256');
    let count = 0, after;
    const columns = table.columns.map(quoted).join(','), order = table.keys.map(key => orderedKey(table, key)).join(',');
    for (;;) {
      const condition = after ? ` WHERE (${order}) > (${table.keys.map(() => '?').join(',')})` : '';
      const rows = await store.all(`SELECT ${columns} FROM ${targetName(table)}${condition} ORDER BY ${order} LIMIT 500`, ...(after ?? []));
      if (!rows.length) break;
      for (const row of rows) { hash.update(canonicalRow(table, row)); hash.update('\n'); count++; }
      after = table.keys.map(key => rows.at(-1)[key]);
    }
    tables[table.name] = { count, hash: hash.digest('hex') };
  }
  return { tables, fingerprint: fingerprintOf(tables) };
}

function sourceSummary(source) {
  let activeUsers = 0, deletedEntries = 0, runningTimers = 0, completedMilliseconds = 0n;
  for (const user of source.rows('users')) activeUsers += Number(user.active === 1);
  for (const entry of source.rows('entries')) {
    if (entry.deleted) { deletedEntries++; continue; }
    if (entry.end === null) runningTimers++;
    else completedMilliseconds += BigInt(entry.end) - BigInt(entry.start);
  }
  return { users: source.counts.users, activeUsers, entries: source.counts.entries, deletedEntries, runningTimers,
    // Decimal text avoids overflow when aggregating a very large history.
    completedMilliseconds: completedMilliseconds.toString() };
}

async function insertSource(store, source) {
  for (const table of IMPORT_TABLES) {
    let batch = [];
    const flush = async () => {
      if (!batch.length) return;
      const values = [], group = `(${table.columns.map(() => '?').join(',')})`;
      for (const row of batch) for (const column of table.columns) {
        const value = row[column];
        values.push(table.booleans.includes(column) ? value === 1 : value);
      }
      await store.run(`INSERT INTO ${targetName(table)} (${table.columns.map(quoted).join(',')}) VALUES ${batch.map(() => group).join(',')}`, ...values);
      batch = [];
    };
    for (const row of source.rows(table.name)) { batch.push(row); if (batch.length === 200) await flush(); }
    await flush();
  }
}

function assertJournalMatches(expected, actual) {
  if (!actual.ok || actual.count !== expected.count || actual.hash !== expected.hash || actual.auditCount !== expected.auditCount) {
    throw new SqliteImportError('JOURNAL_MISMATCH', 'Le journal importé ne correspond pas exactement au journal SQLite. Import annulé.');
  }
}

/**
 * Import one verified SQLite snapshot into a migrated, uninitialized PostgreSQL
 * database. Never initializes, clears, merges or repairs either database.
 * An identical replay is read-only; a different nonempty target is rejected.
 */
export async function importSqliteToPostgres({ sourcePath, databaseUrl, store: suppliedStore, checkpoint, dryRun = false } = {}) {
  if (!sourcePath) throw new SqliteImportError('SOURCE_REQUIRED', 'Indiquer explicitement le fichier SQLite à importer.');
  const source = await openSqliteImportSource(sourcePath, { checkpoint });
  let store;
  try {
    // Full source validation precedes even opening the target connection.
    const tables = Object.fromEntries(IMPORT_TABLES.map(table => [table.name, { count: source.counts[table.name], hash: source.tableHashes[table.name] }]));
    const report = { tables, checkpoint: source.checkpoint, fingerprint: source.fingerprint, summary: sourceSummary(source) };
    store = suppliedStore ?? await openPostgresDatabase({ databaseUrl });
    return await store.transaction(async () => {
      // The application advisory lock is already held by transaction(). Table
      // locks additionally exclude ordinary SQL writers during validation/import.
      await store.run(`LOCK TABLE ${IMPORT_TABLES.map(targetName).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
      const existing = await inspectTarget(store);
      const identical = existing.fingerprint === report.fingerprint;
      const empty = Object.values(existing.tables).every(table => table.count === 0);
      if (!empty && !identical) throw new SqliteImportError('TARGET_NOT_EMPTY', 'La cible PostgreSQL contient des données différentes. Utiliser une base dédiée vide après les migrations, avant de démarrer le serveur.');
      if (identical) {
        assertJournalMatches(source.checkpoint, await createPostgresJournal(store).verifyJournal());
        return { status: dryRun ? 'validated' : 'already-imported', target: 'identical', ...report };
      }
      if (dryRun) return { status: 'validated', target: 'empty', ...report };
      await insertSource(store, source);
      const imported = await inspectTarget(store);
      if (imported.fingerprint !== report.fingerprint) throw new SqliteImportError('DATA_MISMATCH', 'Les comptes, temps ou autres données importées diffèrent de SQLite. Import annulé.');
      assertJournalMatches(source.checkpoint, await createPostgresJournal(store).verifyJournal());
      // No import event or marker is appended: the complete original journal,
      // its checkpoint, meta revision and every table remain exactly comparable.
      return { status: 'imported', target: 'imported', ...report };
    });
  } catch (error) {
    if (error instanceof SqliteImportError) throw error;
    throw new SqliteImportError('IMPORT_FAILED', 'Import PostgreSQL non confirmé. Vérifier la connexion et relancer la validation : la transaction contient tout l’import ou aucune ligne, et une cible identique est reconnue sans duplication.', { cause: error });
  } finally {
    try { if (!suppliedStore) await store?.close(); }
    finally { await source.close(); }
  }
}
