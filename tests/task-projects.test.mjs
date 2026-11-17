import test from 'node:test';
import assert from 'node:assert/strict';
import { taskProjectGroups } from '../public/task-projects.js';

const projects=[{id:'p2',name:'Atelier',client_id:'c2'},{id:'p1',name:'Atelier',client_id:'c1'},{id:'p3',name:'REX',client_id:'c1'},{id:'p4',name:'Archives',client_id:'c1',archived:1}];
const clients=[{id:'c1',name:'Softcar'},{id:'c2',name:'Métallover'}];
const task=(id,project_id,name,extra={})=>({id,project_id,name,assignees:['alice'],...extra});
const tasks=[task('t2','p1','Pièce 10'),task('t1','p1','Pièce 2'),task('t3','p2','Plans'),task('t4','p3','Siège Alu'),task('t5','p3','Privé',{assignees:['bob']}),task('t6','p3','Ancien',{archived:1}),task('t7','p4','Historique')];
const model=overrides=>taskProjectGroups({tasks,projects,clients,userId:'alice',...overrides});

test('Choix de tâche : projets distincts, favoris en tête et tri naturel des tâches',()=>{
  const before=JSON.stringify({tasks,projects,clients});
  let groups=model();
  assert.deepEqual(groups.map(g=>g.project.id),['p1','p2','p3']);
  assert.deepEqual(groups[0].tasks.map(t=>t.name),['Pièce 2','Pièce 10']);
  assert.equal(groups[0].client.name,'Softcar');assert.equal(groups[1].client.name,'Métallover');
  groups=model({preferences:{p3:{pinned:true},p1:{collapsed:true}}});
  assert.deepEqual(groups.map(g=>g.project.id),['p3','p1','p2']);
  assert.equal(groups[0].pinned,true);assert.equal(groups[1].expanded,false);
  assert.equal(JSON.stringify({tasks,projects,clients}),before);
});

test('Recherche : trouve tâches, projets et clients sans accents dans les projets repliés',()=>{
  const preferences={p3:{collapsed:true,pinned:true},p2:{collapsed:true}};
  assert.equal(model({preferences}).find(g=>g.project.id==='p3').expanded,false);
  let groups=model({preferences,query:' SIEGE alu '});
  assert.equal(groups.length,1);assert.equal(groups[0].expanded,true);assert.equal(groups[0].tasks[0].id,'t4');
  assert.equal(model({preferences,query:'metallover'})[0].project.id,'p2');
  assert.deepEqual(model({query:'atelier'}).map(g=>g.project.id),['p1','p2']);
  assert.equal(model({query:'introuvable'}).length,0);
  assert.equal(model({preferences}).find(g=>g.project.id==='p3').expanded,false);
});

test('Choix de tâche : respecte les affectations et archives, conserve le classement d’une entrée existante',()=>{
  const ids=groups=>groups.flatMap(g=>g.tasks.map(t=>t.id));
  assert.deepEqual(ids(model()),['t1','t2','t3','t4']);
  assert.deepEqual(ids(model({userId:'bob'})),['t5']);
  assert.ok(ids(model({selectedTaskId:'t6'})).includes('t6'));
  assert.ok(ids(model({selectedTaskId:'t7'})).includes('t7'));
  assert.ok(ids(model({selectedTaskId:'t5'})).includes('t5'));
  assert.deepEqual(model({tasks:[],preferences:{p1:{pinned:true}}}),[]);
});
