import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { verifyJournal } from '../journal.mjs';

const descriptor = (name, columns, keys, integers = [], booleans = [], json = [], nullable = []) => Object.freeze({
  name, columns: Object.freeze(columns.split(',')), keys: Object.freeze(keys.split(',')),
  integers: Object.freeze(integers), booleans: Object.freeze(booleans), json: Object.freeze(json), nullable: Object.freeze(nullable),
});

// Dependency order. The importer never invents IDs, timestamps, roles or history.
export const IMPORT_TABLES = Object.freeze([
  descriptor('meta', 'key,value', 'key', ['value']),
  descriptor('users', 'id,name,username,password,role,active,color,preferences', 'id', [], ['active'], ['preferences']),
  descriptor('user_admins', 'user_id', 'user_id'),
  descriptor('sessions', 'token,user_id,csrf,expires', 'token', ['expires']),
  descriptor('clients', 'id,name,version,created_by', 'id', ['version']),
  descriptor('projects', 'id,name,client_id,color,description,archived,version,created_by', 'id', ['version'], ['archived']),
  descriptor('tasks', 'id,name,project_id,description,status,archived,version,created_by', 'id', ['version'], ['archived']),
  descriptor('assignments', 'task_id,user_id', 'task_id,user_id'),
  descriptor('entries', 'id,user_id,task_id,project_id,description,start,end,version,deleted,created_at,updated_at', 'id', ['start', 'end', 'version', 'created_at', 'updated_at'], ['deleted'], [], ['task_id', 'project_id', 'end']),
  descriptor('audit', 'id,actor,entity,entity_id,owner,action,before_json,after_json,at', 'id', ['at'], [], [], ['owner', 'before_json', 'after_json']),
  descriptor('requests', 'user_id,key,fingerprint,result,at', 'user_id,key', ['at'], [], ['result']),
  descriptor('export_templates', 'id,user_id,name,config,version,created_at,updated_at', 'id', ['version', 'created_at', 'updated_at'], [], ['config']),
  descriptor('event_log', 'seq,at,level,category,action,actor,entity,entity_id,request_id,details_json,previous_hash,hash', 'seq', ['seq', 'at'], [], [], ['actor', 'entity', 'entity_id', 'request_id']),
]);
const byName = new Map(IMPORT_TABLES.map(table => [table.name, table]));
const tableOf = table => {
  const descriptor = byName.get(typeof table === 'string' ? table : table?.name);
  if (!descriptor) throw new Error('Table d’import inconnue.');
  return descriptor;
};
const invalid = (table, column, reason) => new Error(`Source SQLite incompatible : ${table}.${column} (${reason}).`);

function validText(value, table, column) {
  if (typeof value !== 'string') throw invalid(table, column, 'texte attendu');
  if (value.includes('\0') || !value.isWellFormed()) throw invalid(table, column, 'texte non représentable dans PostgreSQL');
  return value;
}

function integer(value, table, column) {
  if (typeof value !== 'number' && typeof value !== 'bigint') throw invalid(table, column, 'entier attendu');
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw invalid(table, column, 'entier hors de la plage sûre JavaScript');
  if (column === 'version' && (number < -2147483648 || number > 2147483647)) throw invalid(table, column, 'version hors limites PostgreSQL');
  return number;
}

// Compare decimal values exactly without first rounding their original JSON token.
// Equivalent spellings (1.0 / 1e0) are fine; silently rounded values are refused.
function decimalToken(token) {
  const [, sign, integral, fraction = '', exponent = '0'] = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  let digits = (integral + fraction).replace(/^0+/, '');
  if (!digits) return '0';
  let power = BigInt(exponent) - BigInt(fraction.length);
  const trailing = /0+$/.exec(digits)?.[0].length ?? 0;
  if (trailing) { digits = digits.slice(0, -trailing); power += BigInt(trailing); }
  return `${sign}${digits}e${power}`;
}

function parseJson(value, table, column) {
  validText(value, table, column);
  let parsed;
  try {
    parsed = JSON.parse(value, (key, item, context) => {
      validText(key, table, column);
      if (typeof item === 'string') validText(item, table, column);
      if (typeof item === 'number') {
        if (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item))) throw invalid(table, column, 'nombre JSON hors limites');
        // Node >=24 provides the original primitive source in reviver context.
        if (!context?.source || decimalToken(context.source) !== decimalToken(JSON.stringify(item))) throw invalid(table, column, 'nombre JSON arrondi');
      }
      return item;
    });
  } catch { throw invalid(table, column, 'JSON invalide ou non représentable sans perte'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalid(table, column, 'objet JSON attendu');
  return parsed;
}

// Sorting object keys is the only normalization allowed, and only for JSONB.
// Journal TEXT columns are intentionally never parsed or reformatted here.
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function canonicalRow(table, row) {
  const definition = tableOf(table);
  return JSON.stringify(definition.columns.map(column => {
    const value = row[column];
    if (definition.json.includes(column)) {
      const json = typeof value === 'string' ? parseJson(value, definition.name, column) : value;
      return stableJson(json);
    }
    if (definition.booleans.includes(column)) return typeof value === 'boolean' ? Number(value) : value;
    if (typeof value === 'bigint') return integer(value, definition.name, column);
    return value;
  }));
}

function normalizeRow(table, row) {
  const result = {};
  for (const column of table.columns) {
    const value = row[column];
    if (value === null && table.nullable.includes(column)) { result[column] = null; continue; }
    if (table.integers.includes(column)) result[column] = integer(value, table.name, column);
    else if (table.booleans.includes(column)) {
      const flag = integer(value, table.name, column);
      if (flag !== 0 && flag !== 1) throw invalid(table.name, column, 'indicateur différent de 0 ou 1');
      result[column] = flag;
    } else {
      result[column] = validText(value, table.name, column);
      if (table.json.includes(column)) parseJson(value, table.name, column);
    }
  }
  if (table.name === 'users' && !['member', 'manager'].includes(result.role)) throw invalid(table.name, 'role', 'rôle inconnu');
  if (table.name === 'tasks' && !['todo', 'doing', 'done'].includes(result.status)) throw invalid(table.name, 'status', 'statut inconnu');
  if (table.name === 'event_log' && !['info', 'warning', 'error'].includes(result.level)) throw invalid(table.name, 'level', 'niveau inconnu');
  if (table.name === 'entries' && result.end !== null && result.end < result.start) throw invalid(table.name, 'end', 'fin antérieure au début');
  return result;
}

const references = [
  ['user_admins', 'user_id', 'users'], ['sessions', 'user_id', 'users'], ['clients', 'created_by', 'users'],
  ['projects', 'client_id', 'clients'], ['projects', 'created_by', 'users'], ['tasks', 'project_id', 'projects'],
  ['tasks', 'created_by', 'users'], ['assignments', 'task_id', 'tasks'], ['assignments', 'user_id', 'users'],
  ['entries', 'user_id', 'users'], ['entries', 'task_id', 'tasks'], ['entries', 'project_id', 'projects'],
  ['audit', 'actor', 'users'], ['audit', 'owner', 'users'], ['requests', 'user_id', 'users'], ['export_templates', 'user_id', 'users'],
];

function validateSchema(db) {
  const actual = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all().map(row => row.name);
  if (JSON.stringify(actual) !== JSON.stringify(IMPORT_TABLES.map(table => table.name).sort()))
    throw new Error('Source SQLite incompatible : les 13 tables de la version actuelle sont requises, sans table supplémentaire.');
  for (const table of IMPORT_TABLES) {
    const columns = db.prepare(`PRAGMA table_info("${table.name}")`).all();
    if (columns.length !== table.columns.length || columns.some(column => !table.columns.includes(column.name)))
      throw new Error(`Source SQLite incompatible : colonnes inattendues dans ${table.name}.`);
    const primary = columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name);
    if (JSON.stringify(primary) !== JSON.stringify(table.keys)) throw new Error(`Source SQLite incompatible : clé primaire de ${table.name}.`);
  }
  if (db.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok')) throw new Error('Intégrité SQLite invalide.');
  if (db.prepare('PRAGMA foreign_key_check').get()) throw new Error('Références SQLite invalides.');
  // Check actual relationships as well, even if a source constraint was removed.
  for (const [table, column, target] of references) {
    if (db.prepare(`SELECT 1 FROM "${table}" child LEFT JOIN "${target}" parent ON child."${column}"=parent.id WHERE child."${column}" IS NOT NULL AND parent.id IS NULL LIMIT 1`).get())
      throw invalid(table, column, 'référence absente');
  }
  for (const [table, columns] of [['users', 'username COLLATE NOCASE'], ['clients', 'name COLLATE NOCASE'], ['projects', 'client_id,name COLLATE NOCASE']]) {
    if (db.prepare(`SELECT 1 FROM "${table}" GROUP BY ${columns} HAVING COUNT(*)>1 LIMIT 1`).get()) throw new Error(`Source SQLite incompatible : doublon dans ${table}.`);
  }
  if (db.prepare('SELECT 1 FROM entries WHERE "end" IS NULL AND deleted=0 GROUP BY user_id HAVING COUNT(*)>1 LIMIT 1').get()) throw new Error('Source SQLite incompatible : plusieurs chronos actifs pour une personne.');
}

function validateCheckpoint(checkpoint) {
  if (checkpoint && (!Number.isSafeInteger(checkpoint.count) || checkpoint.count < 0 || !/^[a-f0-9]{64}$/.test(checkpoint.hash))) throw new Error('Point de contrôle du journal invalide.');
}

export async function openSqliteImportSource(sourcePath, { checkpoint = null } = {}) {
  validateCheckpoint(checkpoint);
  const source = resolve(sourcePath);
  if (!(await stat(source)).isFile()) throw new Error('La source SQLite doit être un fichier existant.');
  const directory = await mkdtemp(join(tmpdir(), 'timeteknika-sqlite-import-'));
  let original, db, closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    try { db?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
  try {
    original = new DatabaseSync(source, { readOnly: true });
    await backup(original, join(directory, 'snapshot.sqlite'));
    original.close(); original = null;
    db = new DatabaseSync(join(directory, 'snapshot.sqlite'), { readOnly: true });
    validateSchema(db);
    function* rows(name) {
      if (closed) throw new Error('La copie SQLite est fermée.');
      const table = tableOf(name);
      const order = table.keys.map(column => `"${column}"${table.integers.includes(column) ? '' : ' COLLATE BINARY'}`).join(',');
      const statement = db.prepare(`SELECT ${table.columns.map(column => `"${column}"`).join(',')} FROM "${table.name}" ORDER BY ${order}`);
      statement.setReadBigInts(true);
      for (const row of statement.iterate()) yield normalizeRow(table, row);
    }
    const counts = {}, tableHashes = {};
    for (const table of IMPORT_TABLES) {
      const hash = createHash('sha256');
      counts[table.name] = 0;
      for (const row of rows(table.name)) { counts[table.name]++; hash.update(canonicalRow(table, row) + '\n'); }
      tableHashes[table.name] = hash.digest('hex');
    }
    const metadata = new Map([...rows('meta')].map(row => [row.key, row.value]));
    if (metadata.get('journal_version') !== 1 || !metadata.has('balance_start') || !metadata.has('revision') || metadata.get('revision') < 0)
      throw new Error('Métadonnées SQLite absentes ou incompatibles.');
    const verified = verifyJournal(db, checkpoint);
    if (!verified.ok) throw new Error(`Journal SQLite invalide : ${verified.reason}.`);
    const fingerprint = createHash('sha256').update(JSON.stringify(IMPORT_TABLES.map(table => [table.name, counts[table.name], tableHashes[table.name]]))).digest('hex');
    return { db, tables: IMPORT_TABLES, counts, tableHashes, checkpoint: verified, fingerprint, rows, close };
  } catch (error) {
    try { original?.close(); } finally { await close(); }
    throw error;
  }
}
