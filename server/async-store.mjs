import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { openStore, seedDemo, passwordHash } from './store.mjs';
import { id, fail, midnight, dateInZone } from './domain.mjs';

// Transitional SQLite backend. Every server operation joins the same queue so
// another request cannot observe or join a transaction suspended at an await.
function sqliteStore(path) {
  const legacy = openStore(path), context = new AsyncLocalStorage();
  let pending = Promise.resolve(), closed = false, closePromise, savepoint = 0;
  const enqueue = operation => {
    const scope = context.getStore();
    if (scope && !scope.active) return Promise.reject(new Error('La transaction SQLite est déjà terminée.'));
    if (scope?.active) return Promise.resolve().then(operation);
    if (closed) return Promise.reject(new Error('Stockage fermé.'));
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  };
  const wrap = (name, convert = false) => (...args) => {
    if (context.getStore()?.readOnly && ['audit', 'log'].includes(name)) return Promise.reject(Error('Écriture dans un instantané en lecture seule.'));
    return enqueue(() => legacy[name](...args.map(value => convert && typeof value === 'boolean' ? Number(value) : value)));
  };
  async function transaction(operation, readOnly = false) {
    const parent = context.getStore();
    if (parent?.active) {
      if (parent.readOnly && !readOnly) throw Error('Écriture dans un instantané en lecture seule.');
      const name = `async_store_${++savepoint}`;
      const scope = { active: true, readOnly: parent.readOnly };
      legacy.db.exec(`SAVEPOINT ${name}`);
      try { const result = await context.run(scope, operation); legacy.db.exec(`RELEASE ${name}`); return result; }
      catch (error) { legacy.db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw error; }
      finally { scope.active = false; }
    }
    return enqueue(async () => {
      const scope = { active: true, readOnly };
      legacy.db.exec(readOnly ? 'BEGIN' : 'BEGIN IMMEDIATE');
      try {
        const result = await context.run(scope, operation);
        legacy.db.exec('COMMIT');
        return result;
      } catch (error) { if (legacy.db.isTransaction) legacy.db.exec('ROLLBACK'); throw error; }
      finally { scope.active = false; }
    });
  }
  const store = {
    kind: 'sqlite',
    // Existing SQLite inspection/recovery tools retain their synchronous API.
    // HTTP handlers always use this queued adapter, never inspectionStore.
    inspectionStore: legacy,
    all: wrap('all', true), one: wrap('one', true),
    run: (...args) => {
      if (context.getStore()?.readOnly) return Promise.reject(Error('Écriture dans un instantané en lecture seule.'));
      return wrap('run', true)(...args);
    },
    transaction: operation => transaction(operation),
    readTransaction: operation => transaction(operation, true),
    findUserByUsername: username => enqueue(() => legacy.one('SELECT * FROM users WHERE username=?', username)),
    seedDemo: () => enqueue(() => seedDemo(legacy)),
    close() {
      if (!closePromise) { closed = true; closePromise = pending.then(() => legacy.db.close()); }
      return closePromise;
    },
  };
  for (const name of ['revision', 'effectiveRole', 'userPublic', 'lookups', 'visibleEntries', 'snapshot', 'audit', 'ownedEntry', 'classification', 'overlaps', 'log', 'verifyJournal']) store[name] = wrap(name);
  return store;
}

export async function openApplicationStore({ dbPath, databaseUrl = '', store } = {}) {
  if (store) return store;
  if (databaseUrl) return openPostgresStore({ databaseUrl });
  return sqliteStore(dbPath);
}

// Injection of a Drizzle connection lets integration tests execute the complete
// HTTP application against PostgreSQL (PGlite) without substituting the storage API.
export async function openPostgresStore(options) {
  const { openPostgresDatabase } = await import('./db/postgres.mjs');
  const { createPostgresJournal } = await import('./db/journal.mjs');
  const store = await openPostgresDatabase(options);
  const journal = createPostgresJournal(store);
  Object.assign(store, journal);
  try { await journal.initializeJournal(); }
  catch (error) { await store.close(); throw error; }
  const { one, all } = store;
  store.revision = async () => (await one("SELECT value FROM meta WHERE key='revision'")).value;
  store.effectiveRole = async user => await one('SELECT 1 FROM user_admins WHERE user_id=?', user.id) ? 'admin' : user.role;
  store.findUserByUsername = username => one("SELECT * FROM users WHERE translate(username, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') = translate(?, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')", username);
  store.userPublic = async user => {
    const { password, preferences, ...rest } = user;
    return { ...rest, role: await store.effectiveRole(user), preferences: {
      balanceStartDate: dateInZone((await one("SELECT value FROM meta WHERE key='balance_start'")).value),
      ...JSON.parse(preferences),
    } };
  };
  store.lookups = async () => {
    const users = await all("SELECT u.id,u.name,u.username,CASE WHEN a.user_id IS NOT NULL THEN 'admin' ELSE u.role END role,u.active,u.color FROM users u LEFT JOIN user_admins a ON a.user_id=u.id ORDER BY u.name");
    const clients = await all('SELECT * FROM clients ORDER BY name');
    const projects = await all('SELECT * FROM projects ORDER BY name');
    const tasks = await all('SELECT * FROM tasks ORDER BY name');
    const assignments = await all('SELECT task_id,user_id FROM assignments ORDER BY task_id,user_id');
    const assignees = new Map();
    for (const row of assignments) { if (!assignees.has(row.task_id)) assignees.set(row.task_id, []); assignees.get(row.task_id).push(row.user_id); }
    return { users, clients, projects, tasks: tasks.map(task => ({ ...task, assignees: assignees.get(task.id) ?? [] })) };
  };
  store.visibleEntries = async (user, deleted = false) => ['manager', 'admin'].includes(await store.effectiveRole(user))
    ? all('SELECT * FROM entries WHERE deleted=? ORDER BY start DESC', !!deleted)
    : all('SELECT * FROM entries WHERE user_id=? AND deleted=? ORDER BY start DESC', user.id, !!deleted);
  store.snapshot = (user, entries) => store.readTransaction(async () => {
    const current = await one('SELECT * FROM users WHERE id=? AND active=true', user.id);
    if (!current) fail(401, 'Connectez-vous pour continuer.', 'unauthorized');
    return { ...await store.lookups(), me: await store.userPublic(current), entries: entries ?? await store.visibleEntries(current),
      exportTemplates: (await all('SELECT id,name,config,version FROM export_templates WHERE user_id=? ORDER BY name', current.id)).map(t => ({ ...t, config: JSON.parse(t.config) })),
      revision: await store.revision(), serverNow: Date.now(), timezone: 'Europe/Zurich' };
  });
  store.ownedEntry = async (user, entryId, version, allowDeleted = false) => {
    const entry = await one('SELECT * FROM entries WHERE id=?', entryId);
    if (!entry || (entry.deleted && !allowDeleted)) fail(404, 'Entrée introuvable.');
    if (entry.user_id !== user.id) fail(403, 'Seul l’auteur peut modifier cette entrée.');
    if (version !== entry.version) fail(409, 'Cette entrée a changé dans une autre session. Rechargez ses valeurs avant de la modifier.', 'version_conflict', { current: entry });
    return entry;
  };
  store.classification = async (user, taskId, projectId, previous = null) => {
    taskId = taskId || null; projectId = projectId || null;
    if (taskId) {
      const task = await one('SELECT * FROM tasks WHERE id=?', taskId);
      if (!task) fail(404, 'Tâche introuvable.');
      const unchanged = previous?.task_id === taskId;
      if (task.archived && !unchanged) fail(400, 'Cette tâche est archivée.');
      if (!unchanged && !await one('SELECT 1 FROM assignments WHERE task_id=? AND user_id=?', taskId, user.id)) fail(403, 'Cette tâche doit vous être affectée pour y enregistrer du temps.');
      if (projectId && projectId !== task.project_id) fail(400, 'Le projet ne correspond pas à la tâche.');
      projectId = task.project_id;
    }
    if (projectId) {
      const project = await one('SELECT * FROM projects WHERE id=?', projectId);
      if (!project) fail(404, 'Projet introuvable.');
      if (project.archived && previous?.project_id !== projectId) fail(400, 'Ce projet est archivé.');
    }
    return { task_id: taskId, project_id: projectId };
  };
  store.overlaps = (user, start, end, exclude = null) => all('SELECT id,description,start,"end" FROM entries WHERE user_id=? AND deleted=false AND id!=? AND start<? AND COALESCE("end",?)>?', user.id, exclude ?? '', end, Date.now(), start);
  return store;
}

export async function seedApplicationDemo(store) {
  if (store.seedDemo) return store.seedDemo();
  // The demo is explicit and only seeds an empty database; never resets existing data.
  await store.transaction(async () => {
    if (await store.one('SELECT id FROM users LIMIT 1')) return;
    const people = [
      ['demo-alex', 'Alex Martin', 'alex@demo.local', 'manager', '#7658c5'],
      ['demo-emma', 'Emma Laurent', 'emma@demo.local', 'member', '#d78b5c'],
      ['demo-lucas', 'Lucas Morel', 'lucas@demo.local', 'member', '#4f9c93'],
    ];
    for (const [uid, name, username, role, color] of people) await store.run('INSERT INTO users(id,name,username,password,role,color) VALUES (?,?,?,?,?,?)', uid, name, username, passwordHash(randomBytes(32).toString('hex')), role, color);
    await store.run('INSERT INTO user_admins(user_id) VALUES (?)', 'demo-alex');
    for (const [cid, name] of [['client-nova', 'Nova Immobilier'], ['client-atelier', 'Atelier Horizon'], ['client-interne', 'Interne']]) await store.run('INSERT INTO clients(id,name,created_by) VALUES (?,?,?)', cid, name, 'demo-alex');
    const projects = [
      ['project-cedres', 'Résidence Les Cèdres', 'client-nova', '#a88be0', 'Études techniques et coordination du projet.'],
      ['project-atelier', 'Rénovation Atelier', 'client-atelier', '#e4a072', 'Conception et suivi des installations.'],
      ['project-interne', 'Vie de l’équipe', 'client-interne', '#75a8a0', 'Organisation, réunions et amélioration continue.'],
    ];
    for (const p of projects) await store.run('INSERT INTO projects(id,name,client_id,color,description,created_by) VALUES (?,?,?,?,?,?)', ...p, 'demo-alex');
    const tasks = [
      ['task-plans', 'Plans d’exécution', 'project-cedres', 'doing', 'Préparer les plans puis vérifier les dimensions ensemble.'],
      ['task-coordination', 'Coordination technique', 'project-cedres', 'todo', 'Synthèse des interfaces et points ouverts.'],
      ['task-releve', 'Relevé sur site', 'project-atelier', 'done', 'Relevé et vérification des installations existantes.'],
      ['task-etude', 'Étude des installations', 'project-atelier', 'doing', 'Dimensionnement et variantes techniques.'],
      ['task-equipe', 'Point d’équipe', 'project-interne', 'todo', 'Avancement des projets et organisation de la semaine.'],
    ];
    for (const [tid, name, pid, status, description] of tasks) {
      await store.run('INSERT INTO tasks(id,name,project_id,status,description,created_by) VALUES (?,?,?,?,?,?)', tid, name, pid, status, description, 'demo-alex');
      for (const [uid] of people) await store.run('INSERT INTO assignments(task_id,user_id) VALUES (?,?)', tid, uid);
    }
    const today = midnight(dateInZone(Date.now()));
    const samples = [
      [0, 8, 120, 'task-plans', 'project-cedres', 'Préparation des plans du niveau 1'],
      [0, 10.5, 45, 'task-coordination', 'project-cedres', 'Échange avec l’architecte'],
      [0, 13.5, 90, 'task-etude', 'project-atelier', 'Dimensionnement des installations'],
      [0, 15.25, 20, null, null, 'Appel de suivi à classer'],
      [1, 9, 150, 'task-plans', 'project-cedres', 'Plans de détail et ajustements'],
      [1, 13, 120, 'task-releve', 'project-atelier', 'Vérification des relevés'],
      [2, 8.5, 180, 'task-etude', 'project-atelier', 'Étude des variantes'],
      [2, 13, 60, 'task-equipe', 'project-interne', 'Préparation du point hebdomadaire'],
    ];
    for (const [person, hour, minutes, task, project, description] of samples) {
      const start = today - 86400000 + hour * 3600000;
      await store.run('INSERT INTO entries(id,user_id,task_id,project_id,description,start,"end",created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', id(), people[person][0], task, project, description, start, start + minutes * 60000, Date.now(), Date.now());
    }
    await store.run("UPDATE meta SET value=value+1 WHERE key='revision'");
  });
}
