import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { importSqliteToPostgres, SqliteImportError } from '../server/db/import-sqlite.mjs';
import { openSqliteImportSource, IMPORT_TABLES } from '../server/db/sqlite-import-source.mjs';

const help = `Import SQLite vers PostgreSQL — TimeTeknika

  pnpm db:import --source CHEMIN.sqlite --check-source
  pnpm db:import --source CHEMIN.sqlite --dry-run
  pnpm db:import --source CHEMIN.sqlite

Options :
  --source CHEMIN       Fichier SQLite explicite (de préférence sauvegarde finale).
  --check-source        Vérifie SQLite uniquement ; PostgreSQL n’est pas nécessaire.
  --dry-run             Vérifie la source et la cible, sans copier de lignes.
  --checkpoint FICHIER  Compare le journal à un checkpoint conservé séparément.
  --demo                Utilise DEMO_DATABASE_URL au lieu de DATABASE_URL.
  --help                Affiche cette aide.

Ordre : arrêter les écritures SQLite, sauvegarder, db:migrate, db:import,
puis seulement démarrer le serveur PostgreSQL. La cible doit être vide après
les migrations. Aucune fusion, suppression ou réparation automatique.
Le résultat JSON ne contient ni mots de passe, ni sessions, ni données personnelles.
`;

export function parseImportArguments(args) {
  const options = {}, seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw Error('Option répétée. Utilisez --help.');
    seen.add(flag);
    if (['--source', '--checkpoint'].includes(flag)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw Error('Une valeur est requise après --source ou --checkpoint.');
      options[flag === '--source' ? 'sourcePath' : 'checkpointPath'] = value;
    } else if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--check-source') options.checkSource = true;
    else if (flag === '--demo') options.demo = true;
    else if (flag === '--help') options.help = true;
    else throw Error('Option inconnue. Utilisez --help.');
  }
  if (!options.help && !options.sourcePath) throw Error('Le chemin --source est requis. Utilisez --help.');
  if (options.checkSource && options.dryRun) throw Error('Choisir --check-source ou --dry-run.');
  return options;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseImportArguments(args);
  if (options.help) { console.log(help); return; }
  const reference = options.checkpointPath ? JSON.parse(await readFile(resolve(options.checkpointPath), 'utf8')) : null;
  const checkpoint = reference?.checkpoint ?? reference;
  if (options.checkSource) {
    const source = await openSqliteImportSource(options.sourcePath, { checkpoint });
    try {
      console.log(JSON.stringify({ status: 'source-validated',
        tables: Object.fromEntries(IMPORT_TABLES.map(table => [table.name, { count: source.counts[table.name], hash: source.tableHashes[table.name] }])),
        checkpoint: source.checkpoint, fingerprint: source.fingerprint }, null, 2));
    } finally { await source.close(); }
    return;
  }
  const variable = options.demo ? 'DEMO_DATABASE_URL' : 'DATABASE_URL';
  if (!process.env[variable]) throw Error(`${variable} est requis dans .env ou dans l’environnement. --check-source fonctionne sans PostgreSQL.`);
  const result = await importSqliteToPostgres({ sourcePath: options.sourcePath, databaseUrl: process.env[variable], checkpoint, dryRun: !!options.dryRun });
  console.log(JSON.stringify(result, null, 2));
}

// Codes identify filesystem/SQLite/connection failures without printing a
// driver's message, parameters, URLs or stack (which may contain private data).
export function importErrorDiagnostic(error) {
  const allowed = new Set(['EACCES', 'EPERM', 'EROFS', 'ENOENT', 'ENOSPC', 'EIO',
    'ERR_SQLITE_ERROR', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH']);
  const visited = new Set();
  for (let current = error; current && typeof current === 'object' && !visited.has(current); current = current.cause) {
    visited.add(current);
    const diagnostic = {};
    if (allowed.has(current.code)) diagnostic.systemCode = current.code;
    if (current.code === 'ERR_SQLITE_ERROR' && Number.isSafeInteger(current.errcode) && current.errcode >= 0)
      diagnostic.sqliteCode = current.errcode;
    if (Object.keys(diagnostic).length) return diagnostic;
  }
  return undefined;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); }
  catch (error) {
    // Never print a driver error/cause: it can contain SQL parameters or credentials.
    const safe = error instanceof SqliteImportError || /^(Source SQLite|Journal SQLite|Intégrité SQLite|Références SQLite|Métadonnées SQLite|Point de contrôle|La source SQLite|Option |Une valeur|Le chemin|Choisir |DATABASE_URL|DEMO_DATABASE_URL)/.test(error.message ?? '');
    const message = safe ? error.message : error.code === 'ENOENT' ? 'Fichier source ou checkpoint introuvable. Vérifiez le chemin indiqué.' : 'Vérification ou import impossible. Vérifiez le fichier SQLite, le checkpoint et la configuration PostgreSQL.';
    console.error(JSON.stringify({ status: 'failed', code: error instanceof SqliteImportError ? error.code : 'IMPORT_PRECHECK_FAILED', message,
      diagnostic: importErrorDiagnostic(error) }));
    process.exitCode = 1;
  }
}
