import test from 'node:test';
import assert from 'node:assert/strict';
import { workCatalog, filterTaskCatalog, filterProjectCatalog } from '../public/task-projects.js';

const clients = [{ id: 'c1', name: 'Softcar' }, { id: 'c2', name: 'Métallover' }];
const projects = [
  { id: 'p1', name: 'Atelier', client_id: 'c2' },
  { id: 'p2', name: 'REX', client_id: 'c1' },
  { id: 'p3', name: 'Atelier', client_id: 'c1' },
  { id: 'p4', name: 'Ancien', client_id: 'c1', archived: 1 }
];
const tasks = [
  { id: 't1', name: 'Pièce 2', project_id: 'p1', status: 'todo', assignees: ['alice'] },
  { id: 't2', name: 'Pièce 10', project_id: 'p1', status: 'doing', assignees: ['alice', 'bob'] },
  { id: 't3', name: 'Siège Alu', project_id: 'p2', status: 'done', assignees: ['bob'] },
  { id: 't4', name: 'Plans', project_id: 'p3', status: 'todo', assignees: ['alice'] },
  { id: 't5', name: 'Historique', project_id: 'p4', status: 'done', assignees: ['alice'] },
  { id: 't6', name: 'Archivée', project_id: 'p2', status: 'done', assignees: ['alice'], archived: 1 },
  { id: 't7', name: 'Relevé', project_id: 'p2', status: 'doing', assignees: ['alice'] }
];
const entry = (task_id, project_id, user_id, start, end, extra = {}) => ({ task_id, project_id, user_id, start: start * 1000, end: end === null ? null : end * 1000, ...extra });
const entries = [
  entry('t1', 'p1', 'alice', 0, 180), entry('t1', 'p1', 'bob', 180, 240),
  entry('t2', 'p1', 'alice', 240, null), entry('t3', 'p2', 'bob', 0, 120),
  entry('t6', 'p2', 'alice', 0, 30), entry(null, 'p2', 'alice', 0, 45),
  entry('t4', 'p3', 'alice', 0, 900, { deleted: 1 }), entry('t5', 'p4', 'alice', 0, 90),
  entry(null, null, 'alice', 0, 60)
];
const data = { projects, tasks, clients, entries };
const ids = rows => rows.map(row => row.id);

test('Catalogue : filtres combinés, recherche sans accents, affectations et projets homonymes', () => {
  const catalog = workCatalog(data, 300000);
  assert.deepEqual(ids(filterTaskCatalog(catalog, {}, 'alice')), ['t1', 't2', 't4', 't7']);
  assert.deepEqual(ids(filterTaskCatalog(catalog, { query: ' SIEGE ' }, 'alice', 'all')), ['t3']);
  assert.deepEqual(ids(filterTaskCatalog(catalog, { client: 'c2', project: 'p1', status: 'doing', time: 'tracked', query: 'metallover' }, 'alice')), ['t2']);
  assert.deepEqual(ids(filterTaskCatalog(catalog, { client: 'c1', project: 'p1' }, 'alice')), []);
  assert.deepEqual(ids(filterTaskCatalog(catalog, { project: 'p3', query: 'atelier' }, 'alice')), ['t4']);
  assert.deepEqual(ids(filterTaskCatalog(catalog, { time: 'untracked' }, 'alice', 'all')), ['t4', 't7']);
  assert.deepEqual(ids(filterTaskCatalog(catalog, { sort: 'status' }, 'alice', 'all')), ['t1', 't4', 't2', 't7', 't3']);
  assert.deepEqual(ids(filterTaskCatalog(catalog, { sort: 'project-asc' }, 'alice', 'all')), ['t1', 't2', 't4', 't7', 't3']);
  assert.deepEqual(ids(filterTaskCatalog(catalog, { sort: 'client-asc' }, 'alice', 'all')), ['t1', 't2', 't4', 't7', 't3']);
});

test('Catalogue : tris numériques, chronos actifs, suppressions et temps sans tâche', () => {
  const before = JSON.stringify(data), catalog = workCatalog(data, 300000);
  assert.deepEqual(ids(filterTaskCatalog(catalog, { sort: 'time-desc' }, 'alice', 'all')), ['t1', 't3', 't2', 't4', 't7']);
  assert.deepEqual(ids(filterTaskCatalog(catalog, { sort: 'time-asc' }, 'alice', 'all')), ['t4', 't7', 't2', 't3', 't1']);
  assert.equal(catalog.projects.find(row => row.id === 'p1').seconds, 300);
  assert.equal(catalog.projects.find(row => row.id === 'p2').seconds, 195);
  assert.equal(catalog.projects.find(row => row.id === 'p2').taskCount, 2);
  assert.equal(catalog.projects.find(row => row.id === 'p2').doneCount, 1);
  assert.equal(catalog.projects.find(row => row.id === 'p3').seconds, 0);
  const later = workCatalog(data, 600000);
  assert.equal(filterTaskCatalog(later, { sort: 'time-desc' }, 'alice', 'all')[0].id, 't2');
  assert.equal(later.projects.find(row => row.id === 'p1').seconds, 600);
  const justStarted = workCatalog(data, 240000);
  assert.ok(ids(filterTaskCatalog(justStarted, { time: 'untracked' }, 'alice')).includes('t2'));
  assert.ok(!ids(filterTaskCatalog(workCatalog(data, 241000), { time: 'untracked' }, 'alice')).includes('t2'));
  assert.equal(JSON.stringify(data), before);
});

test('Catalogue projets : clients, archives, durées, tris et entrée visible seule', () => {
  const catalog = workCatalog(data, 300000);
  assert.deepEqual(ids(filterProjectCatalog(catalog)), ['p1', 'p3', 'p2']);
  assert.deepEqual(ids(filterProjectCatalog(catalog, { client: 'c1', sort: 'time-desc' })), ['p2', 'p3']);
  assert.deepEqual(ids(filterProjectCatalog(catalog, { status: 'archived', client: 'c1', time: 'tracked' })), ['p4']);
  assert.deepEqual(ids(filterProjectCatalog(catalog, { status: 'all', sort: 'name-desc' })), ['p2', 'p3', 'p1', 'p4']);
  assert.deepEqual(ids(filterProjectCatalog(catalog, { query: 'metallover' })), ['p1']);
  assert.deepEqual(ids(filterProjectCatalog(catalog, { time: 'untracked' })), ['p3']);
  assert.deepEqual(ids(filterProjectCatalog(catalog, { sort: 'tasks-desc' })), ['p1', 'p2', 'p3']);
  const member = workCatalog({ ...data, entries: entries.filter(e => e.user_id === 'alice') }, 300000);
  assert.equal(member.tasks.find(row => row.id === 't3').seconds, 0);
  assert.equal(member.projects.find(row => row.id === 'p1').seconds, 240);
  assert.equal(member.projects.find(row => row.id === 'p2').seconds, 75);
  assert.deepEqual(ids(filterTaskCatalog(member, { query: 'siege', time: 'tracked' }, 'alice', 'all')), []);
  const empty = workCatalog({ tasks: [], projects: [], clients: [], entries: [] }, 300000);
  assert.deepEqual(filterTaskCatalog(empty, {}, 'alice'), []);
  assert.deepEqual(filterProjectCatalog(empty), []);
});
