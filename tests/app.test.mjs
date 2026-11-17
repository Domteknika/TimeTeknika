import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createApplication } from '../server/index.mjs';
import { midnight, report, dateInZone } from '../server/domain.mjs';
import { weeklyProgress, longRunningEntry } from '../public/calendar-utils.js';
import { backup, DatabaseSync } from 'node:sqlite';
import { PROJECT_COLORS } from '../public/project-colors.js';

async function fixture(t,options={}){
  const app=createApplication({dbPath:':memory:',demo:true,...options});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  t.after(()=>app.close());
  async function client(uid){
    let cookie='',csrf='';
    const request=async(path,method='GET',data,key=crypto.randomUUID(),extra={})=>{
      const response=await fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),'Content-Type':'application/json','Idempotency-Key':key,'X-CSRF-Token':csrf,...extra},body:method==='GET'?undefined:JSON.stringify(data??{})});
      const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
      const body=await response.json();if(body.csrf)csrf=body.csrf;
      return {status:response.status,data:body,headers:response.headers};
    };
    if(uid)assert.equal((await request('/api/demo-login','POST',{user_id:uid})).status,200);
    return {request,get cookie(){return cookie;},get csrf(){return csrf;}};
  }
  return {app,base,client};
}
const manual=(extra={})=>({description:'Travail de test',task_id:'task-plans',project_id:'project-cedres',start:'2026-02-10T08:00:00Z',end:'2026-02-10T09:00:00Z',...extra});

test('Projets : quinze couleurs créables et modifiables sans changer les temps',async t=>{
  const {app,base,client}=await fixture(t),member=await client('demo-emma'),other=await client('demo-lucas');
  assert.equal((await fetch(base+'/project-colors.js')).status,200);
  for(const c of PROJECT_COLORS){
    const created=await member.request('/api/projects','POST',{name:'Palette '+c.name,client_id:'client-nova',color:c.value});
    assert.equal(created.status,200);assert.equal(created.data.project.color,c.value);
  }
  const before=app.store.all('SELECT * FROM entries ORDER BY id');
  let project=app.store.one('SELECT * FROM projects WHERE id=?','project-cedres');
  for(const c of PROJECT_COLORS){
    const response=await member.request('/api/projects/'+project.id,'PATCH',{color:c.value,version:project.version});
    assert.equal(response.status,200);project=response.data.project;assert.equal(project.color,c.value);
  }
  assert.equal((await other.request('/api/state')).data.projects.find(p=>p.id===project.id).color,PROJECT_COLORS.at(-1).value);
  assert.deepEqual(app.store.all('SELECT * FROM entries ORDER BY id'),before);
  assert.equal((await member.request('/api/projects/'+project.id,'PATCH',{color:PROJECT_COLORS[0].value,version:1})).status,409);
  assert.equal((await member.request('/api/projects/'+project.id,'PATCH',{color:'red',version:project.version})).status,400);
  assert.equal((await member.request('/api/projects','POST',{name:'Couleur invalide',client_id:'client-nova',color:'red'})).status,400);
  const renamed=await member.request('/api/projects/'+project.id,'PATCH',{name:'Nom modifié',version:project.version});
  assert.equal(renamed.data.project.color,project.color);
});

test('Suppression client : cascade réelle, heures et chrono conservés, reprise idempotente',async t=>{
  const {app,client}=await fixture(t),manager=await client('demo-alex'),member=await client('demo-emma');
  const customer=(await manager.request('/api/clients','POST',{name:'Client à supprimer'})).data.client;
  const project=(await manager.request('/api/projects','POST',{name:'Projet lié',client_id:customer.id})).data.project;
  const task=(await member.request('/api/tasks','POST',{name:'Tâche liée',project_id:project.id,assignees:['demo-emma']})).data.task;
  const entry=(await member.request('/api/entries','POST',manual({task_id:task.id,project_id:project.id}))).data.entry;
  const removed=(await member.request('/api/entries','POST',manual({task_id:null,project_id:project.id,start:'2026-02-11T08:00:00Z',end:'2026-02-11T09:00:00Z'}))).data.entry;
  await member.request('/api/entries/'+removed.id,'DELETE',{version:removed.version});
  const active=(await member.request('/api/timer/start','POST',{task_id:task.id,project_id:project.id,expectedRunningId:null})).data.entry;
  await manager.request('/api/preferences','PATCH',{taskProject:{projectId:project.id,pinned:true}});
  const before=app.store.all('SELECT * FROM entries ORDER BY id');
  const preview=await manager.request(`/api/clients/${customer.id}/deletion-preview`);
  assert.equal(preview.status,200);assert.deepEqual(preview.data.counts,{clients:1,projects:1,tasks:1,entries:3,running:1});
  const key=crypto.randomUUID(),data={confirmation:preview.data.confirmation};
  const deletion=await manager.request(`/api/clients/${customer.id}`,'DELETE',data,key);
  assert.equal(deletion.status,200);assert.equal(deletion.data.preservedEntries,3);
  assert.equal(app.store.one('SELECT * FROM clients WHERE id=?',customer.id),undefined);
  assert.equal(app.store.one('SELECT * FROM projects WHERE id=?',project.id),undefined);
  assert.equal(app.store.one('SELECT * FROM tasks WHERE id=?',task.id),undefined);
  assert.equal(app.store.one('SELECT * FROM assignments WHERE task_id=?',task.id),undefined);
  const after=app.store.all('SELECT * FROM entries ORDER BY id');assert.equal(after.length,before.length);
  const timeFields=rows=>rows.map(({id,user_id,start,end,description,deleted})=>({id,user_id,start,end,description,deleted}));
  assert.deepEqual(timeFields(after),timeFields(before));
  for(const id of [entry.id,removed.id,active.id]){const row=after.find(e=>e.id===id);assert.equal(row.task_id,null);assert.equal(row.project_id,null);assert.equal(row.version,before.find(e=>e.id===id).version+1);}
  assert.equal((await member.request('/api/state')).data.entries.find(e=>e.id===active.id).end,null);
  const audit=app.store.one('SELECT * FROM audit WHERE entity_id=? AND action=?',entry.id,'classification-delete');
  assert.equal(audit.owner,'demo-emma');assert.equal(JSON.parse(audit.before_json).task_name,'Tâche liée');
  const replay=await manager.request(`/api/clients/${customer.id}`,'DELETE',data,key);assert.deepEqual(replay.data,deletion.data);
  assert.equal(app.store.all('PRAGMA foreign_key_check').length,0);
  assert.equal((await manager.request('/api/state')).data.me.preferences.taskProjects?.[project.id],undefined);
  assert.equal((await member.request('/api/entries/'+removed.id+'/restore','POST',{})).status,200);
});

test('Suppression tâche et projet : préserve les parents et les temps, y compris les archives',async t=>{
  const {app,client}=await fixture(t),manager=await client('demo-alex');
  const old=app.store.one('SELECT * FROM entries WHERE task_id=? LIMIT 1','task-plans');
  let preview=(await manager.request('/api/tasks/task-plans/deletion-preview')).data;
  assert.equal((await manager.request('/api/tasks/task-plans','DELETE',{confirmation:preview.confirmation})).status,200);
  let row=app.store.one('SELECT * FROM entries WHERE id=?',old.id);
  assert.equal(row.task_id,null);assert.equal(row.project_id,old.project_id);assert.equal(row.end,old.end);
  const project=app.store.one('SELECT * FROM projects WHERE id=?','project-cedres');
  await manager.request('/api/projects/'+project.id,'PATCH',{version:project.version,archived:true});
  preview=(await manager.request('/api/projects/'+project.id+'/deletion-preview')).data;
  assert.equal((await manager.request('/api/projects/'+project.id,'DELETE',{confirmation:preview.confirmation})).status,200);
  assert.ok(app.store.one('SELECT * FROM clients WHERE id=?',project.client_id));
  assert.equal(app.store.one('SELECT * FROM tasks WHERE project_id=?',project.id),undefined);
  row=app.store.one('SELECT * FROM entries WHERE id=?',old.id);assert.equal(row.project_id,null);assert.equal(row.start,old.start);
});

test('Suppression partagée : droits serveur, confirmation obligatoire et concurrence contrôlée',async t=>{
  const {app,client}=await fixture(t),manager=await client('demo-alex'),member=await client('demo-emma');
  assert.equal((await member.request('/api/projects/project-cedres/deletion-preview')).status,403);
  assert.equal((await member.request('/api/projects/project-cedres','DELETE',{})).status,403);
  const preview=(await manager.request('/api/projects/project-cedres/deletion-preview')).data;
  assert.equal((await manager.request('/api/projects/project-cedres','DELETE',{})).status,409);
  await member.request('/api/tasks','POST',{name:'Ajout simultané',project_id:'project-cedres',assignees:['demo-emma']});
  const before=app.store.revision();
  const stale=await manager.request('/api/projects/project-cedres','DELETE',{confirmation:preview.confirmation});
  assert.equal(stale.status,409);assert.equal(stale.data.error,'deletion_changed');assert.equal(app.store.revision(),before);
  assert.ok(app.store.one('SELECT * FROM projects WHERE id=?','project-cedres'));
  const refreshed=(await manager.request('/api/projects/project-cedres/deletion-preview')).data;
  const entry=app.store.one('SELECT * FROM entries WHERE project_id=? LIMIT 1','project-cedres');
  app.store.run('UPDATE entries SET version=version+1 WHERE id=?',entry.id);
  assert.equal((await manager.request('/api/projects/project-cedres','DELETE',{confirmation:refreshed.confirmation})).status,409);
});

test('Vue horaire : préférence personnelle persistante et validation 7 h–18 h / 24 h',async t=>{
  const {client}=await fixture(t),emma=await client('demo-emma'),other=await client('demo-emma'),alex=await client('demo-alex');
  assert.equal((await emma.request('/api/preferences','PATCH',{calendarRange:'workday'})).status,200);
  assert.equal((await other.request('/api/state')).data.me.preferences.calendarRange,'workday');
  assert.equal((await emma.request('/api/preferences','PATCH',{calendarRange:'extended'})).status,200);
  assert.equal((await other.request('/api/state')).data.me.preferences.calendarRange,'extended');
  assert.equal((await alex.request('/api/state')).data.me.preferences.calendarRange,undefined);
  assert.equal((await emma.request('/api/preferences','PATCH',{calendarRange:'arbitrary'})).status,400);
  assert.equal((await emma.request('/api/preferences','PATCH',{calendarRange:'full'})).status,200);
  assert.equal((await other.request('/api/state')).data.me.preferences.calendarRange,'full');
  assert.equal((await emma.request('/api/preferences','PATCH',{calendarFit:true})).status,200);
  assert.equal((await other.request('/api/state')).data.me.preferences.calendarFit,true);
  assert.equal((await emma.request('/api/preferences','PATCH',{calendarFit:false,calendarZoom:150})).status,200);
  assert.equal((await other.request('/api/state')).data.me.preferences.calendarFit,false);
  assert.equal((await emma.request('/api/preferences','PATCH',{calendarFit:'oui'})).status,400);
});

test('Chrono oublié : corriger la fin arrête le chrono et actualise le solde dans une autre session',async t=>{
  const {app,client}=await fixture(t),emma=await client('demo-emma'),otherSession=await client('demo-emma');
  const active=(await emma.request('/api/timer/start','POST',{description:'Chrono oublié',expectedRunningId:null})).data.entry;
  const timestamp=Math.floor(Date.now()/1000)*1000,start=timestamp-7*3600000,end=start+2*3600000;
  // Simulate the elapsed night without changing the clock or waiting six hours.
  app.store.run('UPDATE entries SET start=? WHERE id=?',start,active.id);
  const before=(await otherSession.request('/api/state')).data;
  assert.equal(longRunningEntry(before.entries,'demo-emma',timestamp)?.id,active.id);
  const from=start-3600000,to=timestamp+3600000;
  assert.equal(weeklyProgress(before.entries.filter(e=>e.id===active.id),from,to,480,timestamp).remaining,3600);
  const corrected=await emma.request('/api/entries/'+active.id,'PATCH',{
    description:active.description,start:new Date(start).toISOString(),end:new Date(end).toISOString(),version:active.version,confirmOverlap:true
  });
  assert.equal(corrected.status,200);assert.equal(corrected.data.entry.end,end);
  const after=(await otherSession.request('/api/state')).data;
  assert.equal(longRunningEntry(after.entries,'demo-emma',timestamp),null);
  assert.equal(weeklyProgress(after.entries.filter(e=>e.id===active.id),from,to,480,timestamp).remaining,6*3600);
  assert.equal(after.entries.find(e=>e.id===active.id).version,active.version+1);
  assert.equal((await otherSession.request('/api/timer/stop','POST',{id:active.id,version:active.version})).status,409);
});

test('Un membre crée clients, projets et tâches multi-personnes sans obtenir les temps d’autrui',async t=>{
  const {client}=await fixture(t),emma=await client('demo-emma'),alex=await client('demo-alex');
  const c=await emma.request('/api/clients','POST',{name:'Client partagé'});assert.equal(c.status,200);
  const p=await emma.request('/api/projects','POST',{name:'Projet collaboratif',client_id:c.data.client.id});assert.equal(p.status,200);
  const task=await emma.request('/api/tasks','POST',{name:'Tâche commune',project_id:p.data.project.id,assignees:['demo-emma','demo-lucas']});assert.equal(task.status,200);assert.equal(task.data.task.assignees.length,2);
  const es=(await emma.request('/api/state')).data,as=(await alex.request('/api/state')).data;
  assert.ok(es.entries.every(e=>e.user_id==='demo-emma'));assert.equal(es.me.role,'member');assert.ok(as.entries.some(e=>e.user_id==='demo-lucas'));
  assert.ok(es.tasks.some(x=>x.id===task.data.task.id));assert.ok(!JSON.stringify(es).includes('password'));
  assert.equal((await emma.request('/api/users','POST',{name:'Intrus',email:'intrus@example.test',password:'A-test-long-password',role:'manager'})).status,403);
});
test('Seul l’auteur corrige/supprime ; historique protégé et conflits de version rejetés',async t=>{
  const {client}=await fixture(t),emma=await client('demo-emma'),alex=await client('demo-alex'),lucas=await client('demo-lucas');
  const original=(await emma.request('/api/entries','POST',manual())).data.entry;
  for(const c of [alex,lucas])assert.equal((await c.request('/api/entries/'+original.id,'PATCH',manual({version:1,description:'Autrui'}))).status,403);
  assert.equal((await lucas.request('/api/entries/'+original.id+'/history')).status,404);
  const edited=await emma.request('/api/entries/'+original.id,'PATCH',manual({version:1,description:'Corrigé'}));assert.equal(edited.data.entry.version,2);
  const stale=await emma.request('/api/entries/'+original.id,'PATCH',manual({version:1}));assert.equal(stale.status,409);assert.equal(stale.data.error,'version_conflict');
  const history=(await alex.request('/api/entries/'+original.id+'/history')).data.items;assert.equal(history.length,2);assert.equal(history[0].after.description,'Corrigé');
  assert.equal((await emma.request('/api/entries/'+original.id,'DELETE',{version:2})).status,200);
  assert.ok(!(await emma.request('/api/state')).data.entries.some(e=>e.id===original.id));
  assert.equal((await alex.request('/api/entries/'+original.id+'/restore','POST',{})).status,403);
  assert.equal((await emma.request('/api/entries/'+original.id+'/restore','POST',{})).status,200);
});
test('Un seul chrono ; concurrence, répétition de requête et reprise atomique',async t=>{
  const {client}=await fixture(t),a=await client('demo-emma'),b=await client('demo-emma');
  const payload={description:'Premier',task_id:'task-plans',expectedRunningId:null},key=crypto.randomUUID();
  const [one,two]=await Promise.all([a.request('/api/timer/start','POST',payload,key),b.request('/api/timer/start','POST',payload)]);
  assert.deepEqual([one.status,two.status].sort(),[200,409]);
  const started=one.status===200?one:two;
  if(one.status===200){const repeated=await a.request('/api/timer/start','POST',payload,key);assert.equal(repeated.data.entry.id,one.data.entry.id);}
  const next=await a.request('/api/timer/start','POST',{task_id:'task-etude',description:'Suivant',expectedRunningId:started.data.entry.id,expectedVersion:1});assert.equal(next.status,200);
  let entries=(await a.request('/api/state')).data.entries;assert.equal(entries.filter(e=>e.end===null).length,1);assert.notEqual(entries.find(e=>e.id===started.data.entry.id).end,null);
  assert.equal((await b.request('/api/timer/stop','POST',{id:started.data.entry.id,version:1})).status,409);
  assert.equal((await a.request('/api/timer/stop','POST',{id:next.data.entry.id,version:1})).status,200);
  entries=(await a.request('/api/state')).data.entries;assert.equal(entries.filter(e=>e.end===null).length,0);assert.ok(entries.find(e=>e.id===next.data.entry.id));
});
test('Idempotence : même clé = même création ; contenu différent refusé et transaction utilisable',async t=>{
  const {client}=await fixture(t),c=await client('demo-emma'),key=crypto.randomUUID();
  const first=await c.request('/api/clients','POST',{name:'Unique'},key),second=await c.request('/api/clients','POST',{name:'Unique'},key);
  assert.equal(first.data.client.id,second.data.client.id);assert.equal(first.data.revision,second.data.revision);
  assert.equal((await c.request('/api/clients','POST',{name:'Différent'},key)).status,409);
  assert.equal((await c.request('/api/clients','POST',{name:'Après conflit'})).status,200);
});
test('Classement cohérent, affectation nécessaire et protection de l’historique',async t=>{
  const {client}=await fixture(t),emma=await client('demo-emma'),alex=await client('demo-alex');
  assert.equal((await emma.request('/api/entries','POST',manual({project_id:'project-atelier'}))).status,400);
  const task=(await alex.request('/api/tasks','POST',{name:'Alex uniquement',project_id:'project-cedres',assignees:['demo-alex']})).data.task;
  assert.equal((await emma.request('/api/entries','POST',manual({task_id:task.id}))).status,403);
  const e=(await emma.request('/api/entries','POST',manual({project_id:null}))).data.entry;assert.equal(e.project_id,'project-cedres');
  assert.equal((await emma.request('/api/tasks/task-plans','PATCH',{version:1,project_id:'project-atelier'})).status,409);
  const unc=await emma.request('/api/entries','POST',manual({task_id:null,project_id:null,start:'2026-02-11T08:00:00Z',end:'2026-02-11T08:00:07Z'}));assert.equal(unc.status,200);
  const rep=await emma.request('/api/reports','POST',{from:'2026-02-11',to:'2026-02-11'});assert.equal(rep.data.unclassified,7);assert.equal(rep.data.total,7);
});
test('Chevauchement détecté, confirmation explicite et dates invalides rejetées',async t=>{
  const {client}=await fixture(t),c=await client('demo-emma');
  assert.equal((await c.request('/api/entries','POST',manual())).status,200);
  assert.equal((await c.request('/api/entries','POST',manual())).data.error,'overlap');
  assert.equal((await c.request('/api/entries','POST',manual({confirmOverlap:true}))).status,200);
  assert.equal((await c.request('/api/entries','POST',manual({start:'bad'}))).status,400);
  assert.equal((await c.request('/api/entries','POST',manual({end:'2026-02-10T07:00:00Z'}))).status,400);
});
test('Rapports : privacy côté serveur et cumuls exacts de deux personnes sur une tâche',async t=>{
  const {client}=await fixture(t),emma=await client('demo-emma'),lucas=await client('demo-lucas'),alex=await client('demo-alex');
  await emma.request('/api/entries','POST',manual());await lucas.request('/api/entries','POST',manual({end:'2026-02-10T10:30:00Z'}));
  const filter={from:'2026-02-10',to:'2026-02-10',group:'task',task:'task-plans'};
  const full=(await alex.request('/api/reports','POST',filter)).data;assert.equal(full.total,12600);assert.equal(full.groups.length,2);
  const personal=(await emma.request('/api/reports','POST',filter)).data;assert.equal(personal.total,3600);assert.equal(personal.groups.length,1);
  assert.equal((await emma.request('/api/reports','POST',{...filter,person:'demo-lucas'})).data.total,0);
});
test('Préférences calendrier, objectif et graphiques : propres à la personne, partagées entre ses sessions et validées',async t=>{
  const {client}=await fixture(t),emma=await client('demo-emma'),otherEmma=await client('demo-emma'),lucas=await client('demo-lucas');
  assert.equal((await emma.request('/api/preferences','PATCH',{calendarDays:5,calendarZoom:150,weeklyTargetMinutes:2550,reminderHour:17,reportChart:'pie'})).status,200);
  const preferences=(await otherEmma.request('/api/state')).data.me.preferences;
  assert.equal(preferences.calendarDays,5);assert.equal(preferences.calendarZoom,150);assert.equal(preferences.weeklyTargetMinutes,2550);assert.equal(preferences.reportChart,'pie');
  assert.equal((await lucas.request('/api/state')).data.me.preferences.weeklyTargetMinutes,undefined);
  assert.equal((await lucas.request('/api/state')).data.me.preferences.reportChart,undefined);
  for(const data of [{reportChart:'unknown'},{reportChart:null},{calendarDays:6},{calendarDays:'5'},{calendarZoom:201},{weeklyTargetMinutes:-1},{weeklyTargetMinutes:10081},{weeklyTargetMinutes:0.5}])assert.equal((await emma.request('/api/preferences','PATCH',data)).status,400);
  assert.equal((await emma.request('/api/preferences','PATCH',{weeklyTargetMinutes:null})).status,200);
  const updated=(await otherEmma.request('/api/state')).data.me.preferences;
  assert.equal(updated.weeklyTargetMinutes,null);assert.equal(updated.calendarDays,5);assert.equal(updated.reminderHour,17);assert.equal(updated.reportChart,'pie');
});

test('Projets épinglés et repliés : préférences personnelles, fusion entre sessions, validation et désépinglage',async t=>{
  const {client,base}=await fixture(t),emma=await client('demo-emma'),other=await client('demo-emma'),lucas=await client('demo-lucas');
  await emma.request('/api/preferences','PATCH',{calendarDays:5,weeklyTargetMinutes:2400});
  const before=(await emma.request('/api/state')).data.entries;
  const results=await Promise.all([
    emma.request('/api/preferences','PATCH',{taskProject:{projectId:'project-cedres',pinned:true}}),
    other.request('/api/preferences','PATCH',{taskProject:{projectId:'project-cedres',collapsed:true}})
  ]);
  assert.ok(results.every(r=>r.status===200));
  let prefs=(await other.request('/api/state')).data.me.preferences;
  assert.deepEqual(prefs.taskProjects,{'project-cedres':{pinned:true,collapsed:true}});
  assert.equal(prefs.weeklyTargetMinutes,2400);assert.equal(prefs.calendarDays,5);
  assert.equal((await lucas.request('/api/state')).data.me.preferences.taskProjects,undefined);
  const together=await Promise.all([
    emma.request('/api/preferences','PATCH',{taskProject:{projectId:'project-atelier',pinned:true}}),
    other.request('/api/preferences','PATCH',{timerView:'calendar'})
  ]);
  assert.ok(together.every(r=>r.status===200));
  prefs=(await other.request('/api/state')).data.me.preferences;
  assert.equal(prefs.timerView,'calendar');assert.equal(Object.keys(prefs.taskProjects).length,2);
  for(const taskProject of [null,[],true,{}, {projectId:'project-cedres'}, {projectId:'project-cedres',pinned:'true'}, {projectId:'project-cedres',collapsed:0}, {projectId:2,pinned:true}, {projectId:'project-cedres',pinned:true,userId:'demo-lucas'}]) {
    assert.equal((await emma.request('/api/preferences','PATCH',{taskProject,calendarDays:7})).status,400);
  }
  assert.equal((await emma.request('/api/preferences','PATCH',{taskProject:{projectId:'missing',pinned:true}})).status,404);
  assert.deepEqual((await other.request('/api/state')).data.me.preferences,prefs);
  assert.equal((await emma.request('/api/preferences','PATCH',{taskProject:{projectId:'project-cedres',pinned:false}})).status,200);
  assert.deepEqual((await other.request('/api/state')).data.me.preferences.taskProjects['project-cedres'],{pinned:false,collapsed:true});
  assert.equal((await emma.request('/api/preferences','PATCH',{taskProject:{projectId:'project-cedres',collapsed:false}})).status,200);
  const after=(await other.request('/api/state')).data;
  assert.deepEqual(after.me.preferences.taskProjects,{'project-atelier':{pinned:true,collapsed:false}});
  assert.deepEqual(after.entries,before);
  const module=await fetch(base+'/task-projects.js');assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/javascript/);
});

test('Début du solde global : 26 octobre par défaut, date personnelle validée et synchronisée',async t=>{
  const {client}=await fixture(t),emma=await client('demo-emma'),otherEmma=await client('demo-emma'),lucas=await client('demo-lucas');
  assert.equal((await emma.request('/api/state')).data.me.preferences.balanceStartDate,'2026-10-26');
  assert.equal((await emma.request('/api/preferences','PATCH',{balanceStartDate:'2026-11-02',weeklyTargetMinutes:2400})).status,200);
  const preferences=(await otherEmma.request('/api/state')).data.me.preferences;
  assert.equal(preferences.balanceStartDate,'2026-11-02');assert.equal(preferences.weeklyTargetMinutes,2400);
  assert.equal((await lucas.request('/api/state')).data.me.preferences.balanceStartDate,'2026-10-26');
  for(const date of [null,'','2026-10-27','2026-02-30','1999-12-27','2100-01-04','2026-1-05','2026-10-26T00:00:00Z',5,{}]) {
    assert.equal((await emma.request('/api/preferences','PATCH',{balanceStartDate:date,weeklyTargetMinutes:600})).status,400);
  }
  const unchanged=(await otherEmma.request('/api/state')).data.me.preferences;
  assert.equal(unchanged.balanceStartDate,'2026-11-02');assert.equal(unchanged.weeklyTargetMinutes,2400);
});

test('SSE : notification après commit sans données privées, resynchronisation par snapshot',async t=>{
  const {client,base}=await fixture(t),emma=await client('demo-emma'),alex=await client('demo-alex');
  const abort=new AbortController();t.after(()=>abort.abort());
  const response=await fetch(base+'/api/events',{headers:{Cookie:emma.cookie},signal:abort.signal});assert.equal(response.status,200);
  const reader=response.body.getReader(),decoder=new TextDecoder();assert.match(decoder.decode((await reader.read()).value),/event: connected/);
  const created=await alex.request('/api/tasks','POST',{name:'Tâche en direct',project_id:'project-cedres',assignees:['demo-emma','demo-lucas']});
  const event=decoder.decode((await reader.read()).value);assert.match(event,/event: change/);assert.match(event,new RegExp(String(created.data.revision)));assert.ok(!event.includes('Tâche en direct'));assert.ok(!event.includes('description'));
  assert.ok((await emma.request('/api/state')).data.tasks.some(t=>t.id===created.data.task.id));
  const preference=await emma.request('/api/preferences','PATCH',{taskProject:{projectId:'project-cedres',pinned:true,collapsed:true}});
  const preferenceEvent=decoder.decode((await reader.read()).value);assert.match(preferenceEvent,/event: change/);assert.match(preferenceEvent,new RegExp(String(preference.data.revision)));
  assert.ok(!preferenceEvent.includes('project-cedres'));
  assert.deepEqual((await emma.request('/api/state')).data.me.preferences.taskProjects['project-cedres'],{pinned:true,collapsed:true});
  await reader.cancel();
});
test('Authentication, CSRF, absence de cache et refus du mode démo via proxy',async t=>{
  const {client,base}=await fixture(t),anon=await client(),emma=await client('demo-emma');
  assert.equal((await anon.request('/api/state')).status,401);
  const s=await emma.request('/api/state');assert.match(s.headers.get('cache-control'),/no-store/);
  assert.equal((await emma.request('/api/clients','POST',{name:'CSRF'},undefined,{'X-CSRF-Token':''})).status,403);
  assert.equal((await emma.request('/api/clients','POST',{name:'Crosssite'},undefined,{Origin:'https://elsewhere.test'})).status,403);
  assert.equal((await anon.request('/api/demo-login','POST',{user_id:'demo-alex'},undefined,{'X-Forwarded-Host':'example.test'})).status,404);
  const html=await fetch(base);assert.match(html.headers.get('content-security-policy'),/script-src 'self'/);assert.match(html.headers.get('cache-control'),/no-store/);
  const login=await anon.request('/api/demo-login','POST',{user_id:'demo-alex'});assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
});
test('Installation vierge, mot de passe et connexion sans compte de démonstration',async t=>{
  const {client}=await fixture(t,{demo:false}),c=await client();
  assert.equal((await c.request('/api/info')).data.setup,true);
  assert.equal((await c.request('/api/setup','POST',{name:'Responsable',email:'admin@example.test',password:'court'})).status,400);
  assert.equal((await c.request('/api/setup','POST',{name:'Responsable',email:'admin@example.test',password:'Long-test-password-42'})).status,201);
  assert.equal((await c.request('/api/setup','POST',{})).status,409);
  await c.request('/api/logout','POST',{});assert.equal((await c.request('/api/state')).status,401);
  assert.equal((await c.request('/api/login','POST',{email:'admin@example.test',password:'Long-test-password-42'})).status,200);
  assert.equal((await c.request('/api/demo-login','POST',{user_id:'demo-alex'})).status,404);
});
test('Fuseau Zurich : journées de 23/25 heures et découpage à minuit',()=>{
  assert.equal(midnight('2026-03-30')-midnight('2026-03-29'),23*3600000);
  assert.equal(midnight('2026-10-26')-midnight('2026-10-25'),25*3600000);
  const entries=[{id:'e',user_id:'u',task_id:null,project_id:null,description:'Nuit',start:Date.parse('2026-02-10T22:30:00Z'),end:Date.parse('2026-02-11T00:30:00Z')}];
  const r=report(entries,{from:'2026-02-11',to:'2026-02-11'},{users:[{id:'u',name:'Test'}],clients:[],projects:[],tasks:[]});assert.equal(r.total,5400);assert.equal(r.days[0].seconds,5400);
});
test('Les entrées de durée nulle restent visibles dans les rapports et modifiables',async t=>{
  const {app,client}=await fixture(t),c=await client('demo-emma');
  const start=Date.parse('2026-02-12T08:00:00Z');
  app.store.run("INSERT INTO entries(id,user_id,description,start,end,created_at,updated_at) VALUES ('zero','demo-emma','Très bref',?,?,?,?)",start,start,start,start);
  const result=await c.request('/api/reports','POST',{from:'2026-02-12',to:'2026-02-12'});assert.equal(result.data.rows.length,1);assert.equal(result.data.total,0);
  const edit=await c.request('/api/entries/zero','PATCH',manual({task_id:null,project_id:null,start:new Date(start).toISOString(),end:new Date(start).toISOString(),version:1,description:'Bref corrigé'}));assert.equal(edit.status,200);
});
test('Sept sessions simultanées : aucun chrono perdu ni cumul partagé entre personnes',async t=>{
  const {client}=await fixture(t),admin=await client('demo-alex');const sessions=[await client('demo-emma'),await client('demo-lucas'),admin];
  for(let i=0;i<4;i++){
    const email=`concurrent-${i}@example.test`,password='Test-local-long-password';
    assert.equal((await admin.request('/api/users','POST',{name:`Membre ${i}`,email,password})).status,200);
    const session=await client();assert.equal((await session.request('/api/login','POST',{email,password})).status,200);sessions.push(session);
  }
  const started=await Promise.all(sessions.map(c=>c.request('/api/timer/start','POST',{description:'Travail en équipe',expectedRunningId:null})));assert.ok(started.every(r=>r.status===200));assert.equal(new Set(started.map(r=>r.data.entry.user_id)).size,7);
  const state=(await admin.request('/api/state')).data;assert.equal(state.entries.filter(e=>e.end===null).length,7);
  const stopped=await Promise.all(sessions.map((c,i)=>c.request('/api/timer/stop','POST',{id:started[i].data.entry.id,version:1})));assert.ok(stopped.every(r=>r.status===200));
  assert.equal((await admin.request('/api/state')).data.entries.filter(e=>e.end===null).length,0);
});
test('Données, préférences et chrono conservés au redémarrage ; sauvegarde SQLite cohérente',async t=>{
  const {mkdir}=await import('node:fs/promises');const base=resolve('.qa');await mkdir(base,{recursive:true});const dir=await mkdtemp(join(base,'persistence-')),dbPath=join(dir,'test.sqlite');
  const a=createApplication({dbPath,demo:true});await new Promise(r=>a.server.listen(0,'127.0.0.1',r));
  const savedPreferences={reminderHour:17,calendarDays:5,calendarZoom:150,weeklyTargetMinutes:2550,reportChart:'pie',balanceStartDate:'2026-11-02',taskProjects:{'project-cedres':{pinned:true,collapsed:true}}};
  a.store.run("UPDATE users SET preferences=? WHERE id='demo-emma'",JSON.stringify(savedPreferences));
  a.store.run("INSERT INTO entries(id,user_id,description,start,end,created_at,updated_at) VALUES ('running','demo-emma','Persisté',?,NULL,?,?)",Date.now()-10000,Date.now(),Date.now());
  const copy=join(dir,'backup.sqlite');await backup(a.store.db,copy);await a.close();
  const b=createApplication({dbPath});await new Promise(r=>b.server.listen(0,'127.0.0.1',r));t.after(()=>b.close());
  assert.equal(b.store.one("SELECT description FROM entries WHERE id='running'").description,'Persisté');assert.equal(JSON.parse(b.store.one("SELECT preferences FROM users WHERE id='demo-emma'").preferences).reminderHour,17);
  assert.deepEqual(JSON.parse(b.store.one("SELECT preferences FROM users WHERE id='demo-emma'").preferences),savedPreferences);
  assert.equal(b.store.userPublic(b.store.one("SELECT * FROM users WHERE id='demo-lucas'")).preferences.balanceStartDate,'2026-10-26');
  assert.equal(b.store.userPublic(b.store.one("SELECT * FROM users WHERE id='demo-emma'")).preferences.balanceStartDate,'2026-11-02');
  const restore=new DatabaseSync(copy,{readOnly:true});assert.equal(restore.prepare("SELECT COUNT(*) n FROM entries WHERE id='running'").get().n,1);restore.close();
});
test('Frontend : aucune persistance métier dans le navigateur ni dépendance distante',async()=>{
  const files=await readdir(new URL('../public/',import.meta.url));
  for(const name of files){const content=await readFile(new URL('../public/'+name,import.meta.url),'utf8');assert.doesNotMatch(content,/localStorage|sessionStorage|indexedDB|serviceWorker|caches\.(open|put)|https:\/\//,name);}
});

test('Identifiants sans email, huit caractères, changement et réinitialisation des mots de passe',async t=>{
  const {client,app}=await fixture(t,{demo:false,setupToken:'installation-test'});
  const admin=await client();
  const setup={name:'Responsable',username:'Chef.Bureau',password:'12345678',setupToken:'installation-test'};
  assert.equal((await admin.request('/api/setup','POST',{...setup,setupToken:''})).status,403);
  assert.equal((await admin.request('/api/setup','POST',{...setup,password:'1234567'})).status,400);
  assert.equal((await admin.request('/api/setup','POST',setup)).status,201);
  assert.equal((await admin.request('/api/state')).data.me.username,'chef.bureau');
  assert.equal((await admin.request('/api/users','POST',{name:'Alex',username:'alex',password:'abcdefgh'})).status,200);
  assert.equal((await admin.request('/api/users','POST',{name:'Doublon',username:'ALEX',password:'abcdefgh'})).status,409);
  assert.equal((await admin.request('/api/users','POST',{name:'Invalide',username:'a b',password:'abcdefgh'})).status,400);
  const member=await client(),second=await client();
  for(const c of [member,second])assert.equal((await c.request('/api/login','POST',{username:'ALEX',password:'abcdefgh'})).status,200);
  const uid=(await member.request('/api/state')).data.me.id;
  assert.equal((await member.request('/api/account/password','POST',{currentPassword:'incorrect',password:'newpass8'})).status,400);
  assert.equal((await member.request('/api/account/password','POST',{currentPassword:'abcdefgh',password:'newpass8'})).status,200);
  assert.equal((await second.request('/api/state')).status,401);
  assert.equal((await member.request('/api/state')).status,200);
  assert.equal((await member.request('/api/users/'+uid+'/password','POST',{password:'reset123'})).status,403);
  assert.equal((await admin.request('/api/users/'+uid+'/password','POST',{password:'reset123'})).status,200);
  assert.equal((await member.request('/api/state')).status,401);
  assert.equal((await second.request('/api/login','POST',{username:'alex',password:'newpass8'})).status,401);
  assert.equal((await second.request('/api/login','POST',{username:'alex',password:'reset123'})).status,200);
  const history=JSON.stringify(app.store.all('SELECT * FROM audit'));
  assert.ok(!history.includes('reset123')&&!history.includes('newpass8'));
});

test('Migration de la colonne email : comptes, mots de passe et temps préservés',async t=>{
  const dir=await mkdtemp(resolve('.qa/auth-migration-')),dbPath=join(dir,'legacy.sqlite');
  const original=createApplication({dbPath,demo:true});
  const entries=original.store.all('SELECT * FROM entries ORDER BY id');
  original.store.db.exec('ALTER TABLE users RENAME COLUMN username TO email');
  await original.close();
  const migrated=createApplication({dbPath});
  t.after(()=>migrated.close());
  assert.equal(migrated.store.one('SELECT username FROM users WHERE id=?','demo-alex').username,'alex@demo.local');
  assert.deepEqual(migrated.store.all('SELECT * FROM entries ORDER BY id'),entries);
});
