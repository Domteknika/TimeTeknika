import { createHash } from 'node:crypto';
import { fail } from './domain.mjs';

function plan(store,user,kind,id){
  if(user.role!=='manager')fail(403,'Seul un responsable peut supprimer les éléments partagés.');
  if(!['clients','projects','tasks'].includes(kind))fail(404,'Élément introuvable.');
  const item=store.one(`SELECT * FROM ${kind} WHERE id=?`,id);
  if(!item)fail(404,'Élément introuvable.');
  const clients=kind==='clients'?[item]:[];
  const projects=kind==='clients'?store.all('SELECT * FROM projects WHERE client_id=? ORDER BY id',id):kind==='projects'?[item]:[];
  const projectIds=new Set(projects.map(p=>p.id));
  const tasks=kind==='tasks'?[item]:store.all('SELECT * FROM tasks ORDER BY id').filter(t=>projectIds.has(t.project_id));
  const taskIds=new Set(tasks.map(t=>t.id));
  const entries=store.all('SELECT * FROM entries ORDER BY id').filter(e=>taskIds.has(e.task_id)||projectIds.has(e.project_id));
  // Include all affected versions and descendants so a stale confirmation cannot delete new work.
  const confirmation=createHash('sha256').update(JSON.stringify([kind,item,clients,projects,tasks,entries.map(e=>[e.id,e.version,e.task_id,e.project_id])])).digest('hex');
  return {item,clients,projects,tasks,entries,confirmation};
}

export function previewCatalogDeletion(store,user,kind,id){
  const p=plan(store,user,kind,id);
  return {kind,item:{id:p.item.id,name:p.item.name},confirmation:p.confirmation,
    counts:{clients:p.clients.length,projects:p.projects.length,tasks:p.tasks.length,entries:p.entries.length,running:p.entries.filter(e=>!e.deleted&&e.end===null).length},
    projects:p.projects.map(p=>({id:p.id,name:p.name})),tasks:p.tasks.map(t=>({id:t.id,name:t.name}))};
}

// Called inside the same transaction as idempotency, revision and live notifications.
export function deleteCatalogItem(store,user,kind,id,confirmation){
  const p=plan(store,user,kind,id);
  if(confirmation!==p.confirmation)fail(409,'Les éléments concernés ont changé. Fermez puis rouvrez la confirmation de suppression.','deletion_changed');
  const projectIds=new Set(p.projects.map(x=>x.id));
  for(const entry of p.entries){
    const labels=store.one('SELECT p.name project_name,c.name client_name FROM projects p JOIN clients c ON c.id=p.client_id WHERE p.id=?',entry.project_id);
    const before={...entry,...labels,task_name:store.one('SELECT name FROM tasks WHERE id=?',entry.task_id)?.name};
    store.run('UPDATE entries SET task_id=NULL,project_id=?,version=version+1,updated_at=? WHERE id=?',projectIds.has(entry.project_id)?null:entry.project_id,Date.now(),entry.id);
    store.audit(user,'entry',entry.id,'classification-delete',before,store.one('SELECT * FROM entries WHERE id=?',entry.id),entry.user_id);
  }
  for(const [entity,items] of [['task',p.tasks],['project',p.projects],['client',p.clients]]){
    for(const item of items){
      const before=entity==='task'?{...item,assignees:store.all('SELECT user_id FROM assignments WHERE task_id=?',item.id).map(x=>x.user_id)}:item;
      store.audit(user,entity,item.id,'delete',before,null);
      store.run(`DELETE FROM ${entity==='task'?'tasks':entity==='project'?'projects':'clients'} WHERE id=?`,item.id);
    }
  }
  if(projectIds.size)for(const u of store.all('SELECT id,preferences FROM users')){
    const preferences=JSON.parse(u.preferences);let changed=false;
    for(const id of projectIds)if(preferences.taskProjects?.[id]){delete preferences.taskProjects[id];changed=true;}
    if(changed)store.run('UPDATE users SET preferences=? WHERE id=?',JSON.stringify(preferences),u.id);
  }
  return {deleted:true,preservedEntries:p.entries.length};
}
