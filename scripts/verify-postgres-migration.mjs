import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { importSqliteToPostgres } from '../server/db/import-sqlite.mjs';
import { openPostgresStore } from '../server/async-store.mjs';
import { buildExport } from '../server/exports.mjs';
import { csvExport, xlsxExport, pdfExport } from '../server/export-files.mjs';
import { defaultExportConfig } from '../public/export-config.js';
import { dateInZone } from '../server/domain.mjs';

// Server-side verification against native pg. --concurrency is for the disposable
// trial database only: it deliberately appends probe events to its journal.
export async function verifyPostgresMigration({ sourcePath, reportPath, databaseUrl, appDatabaseUrl, concurrency = false }) {
  const expected = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.ok(['imported', 'already-imported'].includes(expected.status), 'Rapport d’import validé requis.');
  const comparison = await importSqliteToPostgres({ sourcePath, databaseUrl, checkpoint: expected.checkpoint, dryRun: true });
  assert.equal(comparison.target, 'identical', 'La cible doit correspondre exactement à la sauvegarde.');
  assert.equal(comparison.fingerprint, expected.fingerprint, 'Empreinte différente du rapport d’import.');
  const store = await openPostgresStore({ databaseUrl: appDatabaseUrl || databaseUrl });
  try {
    const result = await store.readTransaction(async () => {
      const journal = await store.verifyJournal(expected.checkpoint);
      assert.ok(journal.ok);
      if (appDatabaseUrl) {
        const privileges = await store.one(`SELECT
          (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,
          has_table_privilege(current_user, 'public.audit', 'UPDATE') AS audit_update,
          has_table_privilege(current_user, 'public.event_log', 'DELETE') AS journal_delete,
          (SELECT c.relowner=r.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            CROSS JOIN pg_roles r WHERE n.nspname='public' AND c.relname='audit' AND r.rolname=current_user) AS owns_audit`);
        assert.equal(privileges.superuser, 0, 'Le compte applicatif ne doit pas être superutilisateur.');
        assert.equal(privileges.audit_update, 0, 'Le compte applicatif ne doit pas modifier l’historique.');
        assert.equal(privileges.journal_delete, 0, 'Le compte applicatif ne doit pas supprimer le journal.');
        assert.equal(privileges.owns_audit, 0, 'Le compte applicatif ne doit pas posséder les tables d’historique.');
      }
      const users = await store.all('SELECT * FROM users WHERE active=true ORDER BY id');
      let snapshots = 0, exportOwner;
      for (const user of users) {
        const snapshot = await store.snapshot(user);
        assert.equal(snapshot.me.id, user.id);
        assert.equal(typeof snapshot.me.preferences, 'object');
        if (!['manager', 'admin'].includes(snapshot.me.role)) assert.ok(snapshot.entries.every(entry => entry.user_id === user.id));
        else exportOwner ??= { ...user, role: snapshot.me.role };
        JSON.stringify(snapshot);
        snapshots++;
      }
      exportOwner ??= users[0];
      const exports = [];
      if (exportOwner) {
        const today = dateInZone(Date.now()), config = defaultExportConfig(today.slice(0, 7) + '-01', today);
        const model = buildExport(await store.visibleEntries(exportOwner), await store.lookups(), config, exportOwner);
        for (const [format, generate] of [['csv', csvExport], ['xlsx', xlsxExport], ['pdf', pdfExport]]) {
          assert.ok((await generate(model)).length > 0, `Export ${format} vide.`);
          exports.push(format);
        }
      }
      return { snapshots, exports, journal };
    });
    if (concurrency) {
      const first = await openPostgresStore({ databaseUrl }), second = await openPostgresStore({ databaseUrl });
      try {
        const key = `migration_probe_${randomBytes(8).toString('hex')}`;
        await first.run('INSERT INTO meta(key,value) VALUES (?,?)', key, 0);
        await Promise.all(Array.from({ length: 12 }, (_, index) => {
          const connection = index % 2 ? first : second;
          return connection.transaction(async () => {
            const previous = await connection.one('SELECT value FROM meta WHERE key=?', key);
            await connection.run('UPDATE meta SET value=? WHERE key=?', previous.value + 1, key);
            await connection.log({ category: 'system', action: 'migration-concurrency-probe', details: { index } });
          });
        }));
        assert.equal((await first.one('SELECT value FROM meta WHERE key=?', key)).value, 12);
        assert.ok((await first.verifyJournal(expected.checkpoint)).ok);
        await first.run('DELETE FROM meta WHERE key=?', key);
      } finally { await Promise.allSettled([first.close(), second.close()]); }
    }
    return { ok: true, fingerprint: comparison.fingerprint, ...result, nativeConcurrency: concurrency };
  } finally { await store.close(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [sourcePath, reportPath, flag] = process.argv.slice(2);
    if (!sourcePath || !reportPath || flag && flag !== '--concurrency') throw Error('Source, rapport et option invalides.');
    const result = await verifyPostgresMigration({ sourcePath, reportPath, databaseUrl: process.env.DATABASE_URL,
      appDatabaseUrl: process.env.APP_DATABASE_URL, concurrency: flag === '--concurrency' });
    console.log(JSON.stringify(result, null, 2));
  } catch {
    console.error('Vérification de la migration PostgreSQL échouée. Conserver la sauvegarde et les rapports avant toute bascule.');
    process.exitCode = 1;
  }
}
