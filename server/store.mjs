import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { id, fail, seconds, midnight, dateInZone } from './domain.mjs';
import { initializeJournal, appendEvent, journalTransaction, verifyJournal } from './journal.mjs';

export function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function passwordMatches(password, hash) {
  const [salt, value] = hash.split(':');
  return timingSafeEqual(Buffer.from(value, 'hex'), scryptSync(password, salt, 64));
}
export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
    INSERT OR IGNORE INTO meta VALUES ('revision',0);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('member','manager')), active INTEGER NOT NULL DEFAULT 1, color TEXT NOT NULL, preferences TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE, client_id TEXT NOT NULL REFERENCES clients(id), color TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL REFERENCES users(id), UNIQUE(name,client_id));
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id), description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')), archived INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS assignments (task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(task_id,user_id));
    CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), task_id TEXT REFERENCES tasks(id), project_id TEXT REFERENCES projects(id), description TEXT NOT NULL DEFAULT '', start INTEGER NOT NULL, end INTEGER, version INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, CHECK(end IS NULL OR end >= start));
    CREATE UNIQUE INDEX IF NOT EXISTS one_running_per_user ON entries(user_id) WHERE end IS NULL AND deleted=0;
    CREATE INDEX IF NOT EXISTS entries_period ON entries(user_id,start,end);
    CREATE INDEX IF NOT EXISTS entries_task ON entries(task_id);
    CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, actor TEXT NOT NULL REFERENCES users(id), entity TEXT NOT NULL, entity_id TEXT NOT NULL, owner TEXT REFERENCES users(id), action TEXT NOT NULL, before_json TEXT, after_json TEXT, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS requests (user_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(user_id,key));
    CREATE TABLE IF NOT EXISTS export_templates (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, config TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS user_admins (user_id TEXT PRIMARY KEY REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS work_schedules (
      user_id TEXT NOT NULL REFERENCES users(id), start_date TEXT NOT NULL,
      schedule TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(user_id,start_date)
    );
    CREATE TABLE IF NOT EXISTS leaves (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), start_date TEXT NOT NULL, end_date TEXT NOT NULL,
      start_part TEXT NOT NULL CHECK(start_part IN ('full','am','pm')), end_part TEXT NOT NULL CHECK(end_part IN ('full','am')),
      exclusions TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, CHECK(end_date >= start_date)
    );
    CREATE INDEX IF NOT EXISTS leaves_user_period ON leaves(user_id,start_date,end_date);
    CREATE TABLE IF NOT EXISTS holidays (
      id TEXT PRIMARY KEY, date TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('holiday','closure')), version INTEGER NOT NULL DEFAULT 1
    );
    PRAGMA user_version=1;`);
  if (db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'email')) {
    db.exec('ALTER TABLE users RENAME COLUMN email TO username');
  }
  try { initializeJournal(db); } catch (error) { db.close(); throw error; }
  const all = (query, ...args) => db.prepare(query).all(...args);
  const one = (query, ...args) => db.prepare(query).get(...args);
  const run = (query, ...args) => db.prepare(query).run(...args);
  // Initial tracking date for this workspace; personal overrides live in preferences.
  run('INSERT OR IGNORE INTO meta VALUES (?,?)', 'balance_start', midnight('2026-10-26'));
  const revision = () => one("SELECT value FROM meta WHERE key='revision'").value;
  const effectiveRole = user => one('SELECT 1 FROM user_admins WHERE user_id=?',user.id) ? 'admin' : user.role;
  const userPublic = user => { const { password, preferences, ...rest } = user; return { ...rest, role: effectiveRole(user), preferences: { balanceStartDate: dateInZone(one("SELECT value FROM meta WHERE key='balance_start'").value), ...JSON.parse(preferences) } }; };
  function lookups() {
    return {
      users: all("SELECT u.id,u.name,u.username,CASE WHEN a.user_id IS NOT NULL THEN 'admin' ELSE u.role END role,u.active,u.color FROM users u LEFT JOIN user_admins a ON a.user_id=u.id ORDER BY u.name"),
      clients: all('SELECT * FROM clients ORDER BY name'),
      projects: all('SELECT * FROM projects ORDER BY name'),
      tasks: all('SELECT * FROM tasks ORDER BY name').map(task => ({ ...task, assignees: all('SELECT user_id FROM assignments WHERE task_id=?', task.id).map(x => x.user_id) }))
    };
  }
  function visibleEntries(user, deleted = false) {
    return ['manager','admin'].includes(effectiveRole(user))
      ? all('SELECT * FROM entries WHERE deleted=? ORDER BY start DESC', +deleted)
      : all('SELECT * FROM entries WHERE user_id=? AND deleted=? ORDER BY start DESC', user.id, +deleted);
  }
  function snapshot(user, entries = visibleEntries(user)) {
    return { ...lookups(), me: userPublic(user), entries, exportTemplates: all('SELECT id,name,config,version FROM export_templates WHERE user_id=? ORDER BY name',user.id).map(t=>({...t,config:JSON.parse(t.config)})), revision: revision(), serverNow: Date.now(), timezone: 'Europe/Zurich' };
  }
  function audit(user, entity, entityId, action, before, after, owner = null) {
    return journalTransaction(db, () => {
      const aid = id();
      run('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?,?)', aid, user.id, entity, entityId, owner, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, Date.now());
      const record = one('SELECT * FROM audit WHERE id=?',aid);
      appendEvent(db,{category:'audit',action,actor:user.id,entity,entity_id:entityId,details:{audit:record}});
    });
  }
  function ownedEntry(user, entryId, version, allowDeleted = false) {
    const entry = one('SELECT * FROM entries WHERE id=?', entryId);
    if (!entry || (entry.deleted && !allowDeleted)) fail(404, 'Entrée introuvable.');
    if (entry.user_id !== user.id) fail(403, 'Seul l’auteur peut modifier cette entrée.');
    if (version !== entry.version) fail(409, 'Cette entrée a changé dans une autre session. Rechargez ses valeurs avant de la modifier.', 'version_conflict', { current: entry });
    return entry;
  }
  function classification(user, taskId, projectId, previous = null) {
    taskId = taskId || null; projectId = projectId || null;
    if (taskId) {
      const task = one('SELECT * FROM tasks WHERE id=?', taskId);
      if (!task) fail(404, 'Tâche introuvable.');
      const unchanged = previous?.task_id === taskId;
      if (task.archived && !unchanged) fail(400, 'Cette tâche est archivée.');
      if (!unchanged && !one('SELECT 1 FROM assignments WHERE task_id=? AND user_id=?', taskId, user.id)) fail(403, 'Cette tâche doit vous être affectée pour y enregistrer du temps.');
      if (projectId && projectId !== task.project_id) fail(400, 'Le projet ne correspond pas à la tâche.');
      projectId = task.project_id;
    }
    if (projectId) {
      const project = one('SELECT * FROM projects WHERE id=?', projectId);
      if (!project) fail(404, 'Projet introuvable.');
      if (project.archived && previous?.project_id !== projectId) fail(400, 'Ce projet est archivé.');
    }
    return { task_id: taskId, project_id: projectId };
  }
  function overlaps(user, start, end, exclude = null) {
    return all('SELECT id,description,start,end FROM entries WHERE user_id=? AND deleted=0 AND id!=? AND start<? AND COALESCE(end,?)>?', user.id, exclude ?? '', end, Date.now(), start);
  }
  return { db, all, one, run, revision, lookups, snapshot, visibleEntries, audit, ownedEntry, classification, overlaps, userPublic, effectiveRole,
    log: event => appendEvent(db,event), verifyJournal: checkpoint => verifyJournal(db,checkpoint) };
}

export function seedDemo(store) {
  if (store.one('SELECT id FROM users LIMIT 1')) return;
  const { db, run } = store;
  db.exec('BEGIN IMMEDIATE');
  try {
    const people = [
      ['demo-alex', 'Alex Martin', 'alex@demo.local', 'manager', '#7658c5'],
      ['demo-emma', 'Emma Laurent', 'emma@demo.local', 'member', '#d78b5c'],
      ['demo-lucas', 'Lucas Morel', 'lucas@demo.local', 'member', '#4f9c93']
    ];
    for (const [uid, name, username, role, color] of people) run('INSERT INTO users(id,name,username,password,role,color) VALUES (?,?,?,?,?,?)', uid, name, username, passwordHash(randomBytes(32).toString('hex')), role, color);
    run('INSERT INTO user_admins(user_id) VALUES (?)','demo-alex');
    for (const [cid, name] of [['client-nova','Nova Immobilier'], ['client-atelier','Atelier Horizon'], ['client-interne','Interne']]) run('INSERT INTO clients(id,name,created_by) VALUES (?,?,?)', cid,name,'demo-alex');
    const projects = [
      ['project-cedres','Résidence Les Cèdres','client-nova','#a88be0','Études techniques et coordination du projet.'],
      ['project-atelier','Rénovation Atelier','client-atelier','#e4a072','Conception et suivi des installations.'],
      ['project-interne','Vie de l’équipe','client-interne','#75a8a0','Organisation, réunions et amélioration continue.']
    ];
    for (const p of projects) run('INSERT INTO projects(id,name,client_id,color,description,created_by) VALUES (?,?,?,?,?,?)', ...p,'demo-alex');
    const tasks = [
      ['task-plans','Plans d’exécution','project-cedres','doing','Préparer les plans puis vérifier les dimensions ensemble.'],
      ['task-coordination','Coordination technique','project-cedres','todo','Synthèse des interfaces et points ouverts.'],
      ['task-releve','Relevé sur site','project-atelier','done','Relevé et vérification des installations existantes.'],
      ['task-etude','Étude des installations','project-atelier','doing','Dimensionnement et variantes techniques.'],
      ['task-equipe','Point d’équipe','project-interne','todo','Avancement des projets et organisation de la semaine.']
    ];
    for (const [tid,name,pid,status,description] of tasks) {
      run('INSERT INTO tasks(id,name,project_id,status,description,created_by) VALUES (?,?,?,?,?,?)',tid,name,pid,status,description,'demo-alex');
      for (const [uid] of people) run('INSERT INTO assignments VALUES (?,?)',tid,uid);
    }
    const today = midnight(dateInZone(Date.now()));
    const samples = [
      [0,8,120,'task-plans','project-cedres','Préparation des plans du niveau 1'],
      [0,10.5,45,'task-coordination','project-cedres','Échange avec l’architecte'],
      [0,13.5,90,'task-etude','project-atelier','Dimensionnement des installations'],
      [0,15.25,20,null,null,'Appel de suivi à classer'],
      [1,9,150,'task-plans','project-cedres','Plans de détail et ajustements'],
      [1,13,120,'task-releve','project-atelier','Vérification des relevés'],
      [2,8.5,180,'task-etude','project-atelier','Étude des variantes'],
      [2,13,60,'task-equipe','project-interne','Préparation du point hebdomadaire']
    ];
    for (const [person, hour, minutes, task, project, description] of samples) {
      // Demo history is yesterday and before; it never fabricates a running timer.
      const start = today - 86400000 + hour * 3600000;
      run('INSERT INTO entries(id,user_id,task_id,project_id,description,start,end,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',id(),people[person][0],task,project,description,start,start+minutes*60000,Date.now(),Date.now());
    }
    run("UPDATE meta SET value=value+1 WHERE key='revision'");
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
