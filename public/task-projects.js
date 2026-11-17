const names = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
export const normalizeTaskSearch = text => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim();

export function compareTaskProjects(a, b, preferences = {}) {
  return Number(!!preferences[b.id]?.pinned) - Number(!!preferences[a.id]?.pinned) ||
    names.compare(a.name, b.name) || a.id.localeCompare(b.id);
}

// Group by identity, including when two clients use the same project name.
export function taskProjectGroups({ tasks, projects, clients, userId, selectedTaskId = '', preferences = {}, query = '' }) {
  const search = normalizeTaskSearch(query), byProject = new Map(projects.map(p => [p.id, p]));
  const byClient = new Map(clients.map(c => [c.id, c])), groups = new Map();
  for (const task of tasks) {
    const project = byProject.get(task.project_id), client = byClient.get(project?.client_id);
    if (!project || task.id !== selectedTaskId && (task.archived || project.archived || !task.assignees.includes(userId))) continue;
    if (search && !normalizeTaskSearch([task.name, project.name, client?.name].join(' ')).includes(search)) continue;
    if (!groups.has(project.id)) groups.set(project.id, {
      project, client, tasks: [], pinned: !!preferences[project.id]?.pinned,
      expanded: !!search || !preferences[project.id]?.collapsed
    });
    groups.get(project.id).tasks.push(task);
  }
  return [...groups.values()].sort((a, b) => compareTaskProjects(a.project, b.project, preferences)).map(group => ({
    ...group, tasks: group.tasks.sort((a, b) => names.compare(a.name, b.name) || a.id.localeCompare(b.id))
  }));
}

// Entries are already restricted to the signed-in user's visibility by /api/state.
// Keep the catalog transient and never mutate the shared snapshot while sorting.
export function workCatalog({ tasks, projects, clients, entries }, timestamp) {
  const taskSeconds = new Map(), projectSeconds = new Map();
  for (const entry of entries) {
    if (entry.deleted) continue;
    const seconds = Math.max(0, Math.floor(((entry.end ?? timestamp) - entry.start) / 1000));
    taskSeconds.set(entry.task_id, (taskSeconds.get(entry.task_id) || 0) + seconds);
    projectSeconds.set(entry.project_id, (projectSeconds.get(entry.project_id) || 0) + seconds);
  }
  const byClient = new Map(clients.map(client => [client.id, client]));
  const byProject = new Map(projects.map(project => [project.id, {
    id: project.id, name: project.name, project, client: byClient.get(project.client_id),
    seconds: projectSeconds.get(project.id) || 0, taskCount: 0, doneCount: 0
  }]));
  const taskRows = [];
  for (const task of tasks) {
    const row = byProject.get(task.project_id);
    if (!row || task.archived) continue;
    row.taskCount++;
    if (task.status === 'done') row.doneCount++;
    if (!row.project.archived) taskRows.push({
      id: task.id, name: task.name, task, project: row.project, client: row.client,
      seconds: taskSeconds.get(task.id) || 0
    });
  }
  return { tasks: taskRows, projects: [...byProject.values()] };
}

export function sortWorkRows(rows, sort = 'name-asc') {
  const byName = (a, b) => names.compare(a.name, b.name) || a.id.localeCompare(b.id);
  const byProject = (a, b) => names.compare(a.project.name, b.project.name) || byName(a, b);
  const ranks = { todo: 0, doing: 1, done: 2 };
  const comparisons = {
    'name-asc': byName,
    'name-desc': (a, b) => -byName(a, b),
    'client-asc': (a, b) => names.compare(a.client?.name || '', b.client?.name || '') || byProject(a, b),
    'project-asc': byProject,
    status: (a, b) => (ranks[a.task?.status] ?? 0) - (ranks[b.task?.status] ?? 0) || byName(a, b),
    'time-desc': (a, b) => b.seconds - a.seconds || byName(a, b),
    'time-asc': (a, b) => a.seconds - b.seconds || byName(a, b),
    'tasks-desc': (a, b) => b.taskCount - a.taskCount || byName(a, b)
  };
  return [...rows].sort(comparisons[sort] || byName);
}

function matchesWorkFilters(row, filters) {
  const query = normalizeTaskSearch(filters.query);
  return (!filters.client || row.project.client_id === filters.client) &&
    (!filters.project || row.project.id === filters.project) &&
    (!query || normalizeTaskSearch([row.name, row.project.name, row.client?.name].join(' ')).includes(query)) &&
    (filters.time === 'tracked' ? row.seconds > 0 : filters.time === 'untracked' ? row.seconds === 0 : true);
}

export function filterTaskCatalog(catalog, filters = {}, userId, scope = 'mine') {
  return sortWorkRows(catalog.tasks.filter(row =>
    (scope === 'all' || row.task.assignees.includes(userId)) &&
    (!filters.status || row.task.status === filters.status) && matchesWorkFilters(row, filters)
  ), filters.sort);
}

export function filterProjectCatalog(catalog, filters = {}) {
  return sortWorkRows(catalog.projects.filter(row =>
    (filters.status === 'all' || (filters.status === 'archived' ? !!row.project.archived : !row.project.archived)) &&
    matchesWorkFilters(row, filters)
  ), filters.sort);
}
