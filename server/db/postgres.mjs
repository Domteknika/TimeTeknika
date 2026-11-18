import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle as nodePostgres } from 'drizzle-orm/node-postgres';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './schema.ts';

export const migrationsFolder = fileURLToPath(new URL('../../drizzle/', import.meta.url));
const tables = ['assignments', 'audit', 'clients', 'entries', 'event_log', 'export_templates', 'meta', 'projects', 'requests', 'sessions', 'tasks', 'user_admins', 'users'];
const applicationLock = sql`select pg_advisory_xact_lock(1414808906, 1)`;

// SQL stays portable at its call site. Only placeholders become Drizzle-bound
// parameters; quoted strings/identifiers and comments are never rewritten.
export function parameterizedSql(query, parameters = []) {
  if (typeof query !== 'string') throw new TypeError('Une requête SQL texte est attendue.');
  const chunks = [];
  let index = 0, start = 0, parameter = 0;
  while (index < query.length) {
    const char = query[index];
    if (char === "'" || char === '"') {
      const quote = char;
      const escaped = quote === "'" && /(?:^|[^\w])E$/i.test(query.slice(0, index));
      index++;
      let closed = false;
      while (index < query.length) {
        if (escaped && query[index] === '\\') { index += 2; continue; }
        if (query[index] === quote) {
          if (query[index + 1] === quote) { index += 2; continue; }
          index++; closed = true; break;
        }
        index++;
      }
      if (!closed) throw new Error('Chaîne SQL non terminée.');
      continue;
    }
    if (query.startsWith('--', index)) {
      const end = query.indexOf('\n', index + 2);
      index = end === -1 ? query.length : end + 1;
      continue;
    }
    if (query.startsWith('/*', index)) {
      let depth = 1; index += 2;
      while (index < query.length && depth) {
        if (query.startsWith('/*', index)) { depth++; index += 2; }
        else if (query.startsWith('*/', index)) { depth--; index += 2; }
        else index++;
      }
      if (depth) throw new Error('Commentaire SQL non terminé.');
      continue;
    }
    if (char === '$') {
      const tag = query.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (tag) {
        const end = query.indexOf(tag, index + tag.length);
        if (end === -1) throw new Error('Bloc SQL non terminé.');
        index = end + tag.length;
        continue;
      }
    }
    if (char === '?') {
      if (parameter >= parameters.length) throw new Error('Paramètre SQL manquant.');
      chunks.push(sql.raw(query.slice(start, index)), sql`${parameters[parameter++]}`);
      start = index + 1;
    }
    index++;
  }
  if (parameter !== parameters.length) throw new Error('Trop de paramètres SQL.');
  chunks.push(sql.raw(query.slice(start)));
  return sql.join(chunks, sql.raw(''));
}

function safeInteger(value) {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) throw new RangeError('Entier PostgreSQL hors de la plage sûre JavaScript.');
  return converted;
}

function rowsOf(result) {
  const fields = new Map((result.fields ?? []).map(field => [field.name, field.dataTypeID]));
  return (result.rows ?? []).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (value === null) return [key, null];
    const type = fields.get(key);
    if (type === 20 || typeof value === 'bigint') return [key, safeInteger(value)];
    if (type === 16 || typeof value === 'boolean') return [key, value ? 1 : 0];
    if (type === 114 || type === 3802) return [key, JSON.stringify(value)];
    return [key, value];
  })));
}

function validateDatabaseUrl(databaseUrl) {
  let parsed;
  try { parsed = new URL(databaseUrl); } catch { throw new Error('DATABASE_URL doit être une URL PostgreSQL valide.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1) || parsed.hash)
    throw new Error('DATABASE_URL doit désigner un serveur et une base PostgreSQL.');
}

function connection({ databaseUrl, pool, drizzle, close } = {}) {
  if (drizzle) return { orm: drizzle, dispose: close ?? (async () => {}) };
  if (!pool) validateDatabaseUrl(databaseUrl);
  const client = pool ?? new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
    application_name: 'TimeTeknika',
  });
  const onError = error => console.error(JSON.stringify({
    event: 'postgres-pool-error',
    code: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'unknown',
  }));
  client.on?.('error', onError);
  return {
    orm: nodePostgres(client, { schema }),
    dispose: async () => {
      try { await (close ? close() : client.end()); }
      finally { client.off?.('error', onError); }
    },
  };
}

export async function openPostgresDatabase(options = {}) {
  const { orm, dispose } = connection(options);
  const context = new AsyncLocalStorage();
  const pending = new Set();
  let closing = false, closePromise;

  function current() {
    const state = context.getStore();
    if (state && !state.active) throw new Error('La transaction PostgreSQL est déjà terminée.');
    return state;
  }
  function track(operation) {
    if (closing) return Promise.reject(new Error('Le stockage PostgreSQL est fermé.'));
    const promise = Promise.resolve().then(operation);
    pending.add(promise);
    promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  }
  function execute(query, args) {
    const statement = parameterizedSql(query, args);
    const state = current();
    return state ? state.tx.execute(statement) : track(() => orm.execute(statement));
  }
  const all = async (query, ...args) => rowsOf(await execute(query, args));
  const one = async (query, ...args) => (await all(query, ...args))[0];

  async function within(tx, readOnly, operation) {
    const state = { tx, readOnly, active: true };
    try { return await context.run(state, operation); }
    finally { state.active = false; }
  }
  async function transaction(operation) {
    const state = current();
    if (state?.readOnly) throw new Error('Écriture interdite dans un instantané en lecture seule.');
    if (state) return state.tx.transaction(tx => within(tx, false, operation));
    return track(() => orm.transaction(async tx => {
      // READ COMMITTED observes writes committed while waiting for this lock.
      // Every mutation and journal append takes it before any business read.
      await tx.execute(applicationLock);
      return within(tx, false, operation);
    }, { isolationLevel: 'read committed', accessMode: 'read write' }));
  }
  async function readTransaction(operation) {
    if (current()) return operation();
    return track(() => orm.transaction(tx => within(tx, true, operation), {
      isolationLevel: 'repeatable read', accessMode: 'read only',
    }));
  }
  async function run(query, ...args) {
    const state = current();
    if (state?.readOnly) throw new Error('Écriture interdite dans un instantané en lecture seule.');
    if (!state) return transaction(() => run(query, ...args));
    const result = await execute(query, args);
    return { changes: result.rowCount ?? result.affectedRows ?? 0, rows: rowsOf(result) };
  }
  async function close() {
    if (!closePromise) {
      closing = true;
      closePromise = (async () => {
        await Promise.allSettled([...pending]);
        await dispose();
      })();
    }
    return closePromise;
  }
  const adapter = { kind: 'postgres', drizzle: orm, all, one, run, transaction, readTransaction, close };
  try {
    const present = await all("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public'");
    const names = new Set(present.map(row => row.tablename));
    if (tables.some(table => !names.has(table))) throw new Error('Schéma PostgreSQL incomplet. Exécutez pnpm db:migrate avant de démarrer.');
    const metadata = await one("SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present");
    if (!metadata.present) throw new Error('Historique des migrations PostgreSQL absent. Exécutez pnpm db:migrate.');
    const migrations = readMigrationFiles({ migrationsFolder });
    const applied = await all('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at');
    if (applied.length !== migrations.length || applied.some((row, index) => row.created_at !== migrations[index].folderMillis || row.hash !== migrations[index].hash))
      throw new Error('Version du schéma PostgreSQL incompatible. Exécutez pnpm db:migrate avec la bonne version de l’application.');
    const guards = await all(`SELECT c.relname, t.tgname FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')`);
    const triggers = new Set(guards.map(row => `${row.relname}.${row.tgname}`));
    if (['audit.audit_append_only', 'event_log.event_log_append_only', 'event_log.event_log_chain'].some(name => !triggers.has(name)))
      throw new Error('Protections du journal PostgreSQL absentes ou désactivées. Restaurer une base vérifiée.');
    return adapter;
  } catch (error) {
    await close();
    throw error;
  }
}

// An explicit, atomic migration command. The normal application never runs DDL.
// Keep the standard Drizzle metadata format so Drizzle tooling can inspect it.
export async function migrateDatabase(options = {}) {
  const migrations = readMigrationFiles({ migrationsFolder });
  const { orm, dispose } = connection(options);
  try {
    return await orm.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(1414808906, 2)`);
      await tx.execute(applicationLock);
      await tx.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
      await tx.execute(sql`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id serial PRIMARY KEY, hash text NOT NULL, created_at bigint
      )`);
      const applied = rowsOf(await tx.execute(sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`));
      if (applied.length > migrations.length || applied.some((row, index) => row.created_at !== migrations[index].folderMillis || row.hash !== migrations[index].hash))
        throw new Error('Historique de migration PostgreSQL incompatible avec cette version.');
      let count = 0;
      for (const migration of migrations.slice(applied.length)) {
        for (const statement of migration.sql) if (statement.trim()) await tx.execute(sql.raw(statement));
        await tx.execute(sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`);
        count++;
      }
      return { applied: count, total: migrations.length };
    });
  } finally { await dispose(); }
}
