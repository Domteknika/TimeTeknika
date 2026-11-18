import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openStore, seedDemo } from '../server/store.mjs';
import { parseImportArguments, importErrorDiagnostic } from '../scripts/import-sqlite.mjs';
import { IMPORT_TABLES } from '../server/db/sqlite-import-source.mjs';

const privateMarker = 'fixture-private-material-should-not-appear';
const hash = value => createHash('sha256').update(value).digest('hex');

test('Import CLI : diagnostics de permissions et SQLite sans fuite des erreurs imbriquées', () => {
  const cause = Object.assign(new Error(privateMarker), { code: 'ERR_SQLITE_ERROR', errcode: 14, errstr: privateMarker });
  assert.deepEqual(importErrorDiagnostic(new Error(privateMarker, { cause })), { systemCode: 'ERR_SQLITE_ERROR', sqliteCode: 14 });
  assert.deepEqual(importErrorDiagnostic({ code: 'EROFS', message: privateMarker, path: privateMarker }), { systemCode: 'EROFS' });
  assert.equal(importErrorDiagnostic({ code: privateMarker, errcode: privateMarker, message: privateMarker }), undefined);
  const cycle = { message: privateMarker }; cycle.cause = cycle;
  assert.equal(importErrorDiagnostic(cycle), undefined);
});

function cli(args, extraEnvironment = {}) {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.DEMO_DATABASE_URL;
  return spawnSync(process.execPath, ['scripts/import-sqlite.mjs', ...args], {
    cwd: resolve('.'), env: { ...env, ...extraEnvironment }, encoding: 'utf8', timeout: 15_000,
  });
}

async function fixture(t) {
  await mkdir('.qa', { recursive: true });
  const directory = await mkdtemp(resolve('.qa/import-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, 'source with spaces.sqlite');
  const store = openStore(sourcePath);
  let checkpoint;
  try {
    seedDemo(store);
    store.run('UPDATE users SET name=? WHERE id=?', privateMarker, 'demo-emma');
    store.run('INSERT INTO sessions(token,user_id,csrf,expires) VALUES (?,?,?,?)', hash(privateMarker), 'demo-emma', privateMarker, Date.now() + 86400000);
    store.audit(store.one('SELECT * FROM users WHERE id=?', 'demo-alex'), 'entry', 'historical-id', 'create', null, { description: privateMarker }, 'demo-emma');
    checkpoint = store.verifyJournal();
    assert.equal(checkpoint.ok, true);
  } finally { store.db.close(); }
  return { directory, sourcePath, checkpoint };
}

test('Import CLI : options explicites et combinaisons invalides', () => {
  assert.deepEqual(parseImportArguments(['--source', 'backup with spaces.sqlite', '--dry-run', '--checkpoint', 'checkpoint.json', '--demo']), {
    sourcePath: 'backup with spaces.sqlite', dryRun: true, checkpointPath: 'checkpoint.json', demo: true,
  });
  assert.deepEqual(parseImportArguments(['--source', 'backup.sqlite', '--check-source']), { sourcePath: 'backup.sqlite', checkSource: true });
  assert.deepEqual(parseImportArguments(['--help']), { help: true });
  for (const args of [[], ['backup.sqlite'], ['--source'], ['--source', '--demo'], ['--source', 'x', '--source', 'y'],
    ['--source', 'x', '--dry-run', '--dry-run'], ['--source', 'x', '--check-source', '--dry-run'], ['--source', 'x', '--unknown']]) {
    assert.throws(() => parseImportArguments(args), /requis|inconnue|valeur|répétée|Choisir/);
  }
});

test('Import CLI : aide et validation SQLite sans PostgreSQL, avec sortie sans données personnelles', async t => {
  const source = await fixture(t);
  const before = hash(await readFile(source.sourcePath));
  const help = cli(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--check-source/);
  assert.match(help.stdout, /--checkpoint/);
  const checkpointPath = join(source.directory, 'checkpoint.json');
  await writeFile(checkpointPath, JSON.stringify({ checkpoint: source.checkpoint }));
  const result = cli(['--source', source.sourcePath, '--check-source', '--checkpoint', checkpointPath]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'source-validated');
  assert.equal(report.tables.users.count, 3);
  assert.equal(Object.keys(report.tables).length, IMPORT_TABLES.length);
  assert.deepEqual(report.checkpoint, source.checkpoint);
  assert.match(report.fingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(privateMarker));
  assert.ok(!result.stdout.includes(source.sourcePath));
  assert.equal(hash(await readFile(source.sourcePath)), before);
});

test('Import CLI : erreurs explicites sans création de source ni divulgation des paramètres', async t => {
  const source = await fixture(t);
  const before = hash(await readFile(source.sourcePath));
  const absent = join(source.directory, privateMarker + '.sqlite');
  const cases = [
    [[], {}],
    [['--source', absent, '--check-source'], {}],
    [['--source', source.sourcePath, '--dry-run'], {}],
    [['--source', source.sourcePath, '--demo'], { DATABASE_URL: privateMarker }],
    // A malformed connection value must never appear in driver diagnostics.
    [['--source', source.sourcePath], { DATABASE_URL: privateMarker }],
  ];
  for (const [args, env] of cases) {
    const result = cli(args, env);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout, '');
    const error = JSON.parse(result.stderr);
    assert.equal(error.status, 'failed');
    assert.equal(typeof error.code, 'string');
    assert.doesNotMatch(result.stderr, new RegExp(privateMarker));
    assert.ok(!result.stderr.includes(source.sourcePath));
    assert.doesNotMatch(result.stderr, /SELECT |INSERT INTO |at file:/);
  }
  await assert.rejects(stat(absent), { code: 'ENOENT' });
  assert.equal(hash(await readFile(source.sourcePath)), before);
});

test('Import CLI : contenu invalide de fichier ou checkpoint expurgé des messages', async t => {
  const source = await fixture(t);
  const invalidFile = join(source.directory, 'invalid.sqlite');
  const invalidCheckpoint = join(source.directory, 'invalid-checkpoint.json');
  await writeFile(invalidFile, privateMarker);
  await writeFile(invalidCheckpoint, `{ ${privateMarker}`);
  for (const args of [
    ['--source', invalidFile, '--check-source'],
    ['--source', source.sourcePath, '--check-source', '--checkpoint', invalidCheckpoint],
  ]) {
    const result = cli(args);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).status, 'failed');
    if (args[1] === invalidFile) assert.deepEqual(JSON.parse(result.stderr).diagnostic, { systemCode: 'ERR_SQLITE_ERROR', sqliteCode: 26 });
    assert.doesNotMatch(result.stderr + result.stdout, new RegExp(privateMarker));
  }
  assert.equal(await readFile(invalidFile, 'utf8'), privateMarker);
});
