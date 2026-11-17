import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createApplication} from '../server/index.mjs';
const require=createRequire(import.meta.url);
const {TimerClient}=require('../desktop/timer-client.cjs');
const {ORIGIN,PROFILES,sameOrigin,sessionCookie,registerProfile,taskKeys}=require('../desktop/policy.cjs');
const snapshot=(entries=[])=>({me:{id:'me'},csrf:'csrf',entries});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});

test('Bureau : ne pilote que le chrono personnel, conserve la version et attend la confirmation',async()=>{
  const calls=[],states=[];
  const client=new TimerClient({origin:ORIGIN,onState:s=>states.push(s),request:async(url,options)=>{
    calls.push({url,options});
    return url.endsWith('/api/state')?json(snapshot([{id:'other',user_id:'other',end:null},{id:'mine',user_id:'me',end:null,version:4}])):json({entry:{end:1}});
  }});
  assert.equal((await client.toggle()).action,'stopped');
  assert.deepEqual(JSON.parse(calls[1].options.body),{id:'mine',version:4});
  assert.equal(calls[1].options.headers['X-CSRF-Token'],'csrf');
  assert.equal(calls[1].options.headers.Origin,ORIGIN);assert.equal(calls[1].options.credentials,'include');
  assert.deepEqual(states,['active','idle']);
});

test('Bureau : réponse perdue, le prochain raccourci reprend la même requête sans arrêter le chrono créé',async()=>{
  const writes=[];let started=false;
  const client=new TimerClient({origin:ORIGIN,request:async(url,options)=>{
    if(url.endsWith('/api/state'))return json(snapshot(started?[{id:'new',user_id:'me',end:null,version:1}]:[]));
    writes.push(options);if(!started){started=true;throw Error('Connexion coupée après commit');}
    return json({entry:{end:null}});
  }});
  await assert.rejects(()=>client.toggle(),/Serveur injoignable/);assert.ok(client.pending);
  assert.equal((await client.toggle()).action,'started');assert.equal(client.pending,null);
  assert.equal(writes[0].headers['Idempotency-Key'],writes[1].headers['Idempotency-Key']);
  assert.equal(writes[0].body,writes[1].body);assert.equal(JSON.parse(writes[1].body).expectedRunningId,null);
});

test('Bureau : pas de double commande simultanée, aucune écriture sans session ni après lecture réseau échouée',async()=>{
  let release;const wait=new Promise(resolve=>release=resolve),calls=[];
  const client=new TimerClient({origin:ORIGIN,request:async url=>{calls.push(url);await wait;return json(snapshot());}});
  const first=client.toggle();assert.deepEqual(await client.toggle(),{ignored:true});release();
  await assert.rejects(()=>first,/Confirmation/);
  for(const status of [401,403,503]){
    const paths=[];const broken=new TimerClient({origin:ORIGIN,request:async url=>{paths.push(url);return json({message:'Refus'},status);}});
    await assert.rejects(()=>broken.toggle(),e=>e.status===status);assert.equal(paths.length,1);
  }
});

test('Bureau : conflit multi-appareil refusé sans retenter une nouvelle mutation',async()=>{
  let writes=0;const client=new TimerClient({origin:ORIGIN,request:async url=>url.endsWith('/api/state')?json(snapshot()):(writes++,json({message:'Chrono modifié'},409))});
  await assert.rejects(()=>client.toggle(),e=>e.status===409);assert.equal(writes,1);assert.equal(client.pending,null);
});

test('Bureau : origine exacte et cookie technique uniquement, raccourcis en conflit libérés',()=>{
  assert.ok(sameOrigin(ORIGIN+'/'));
  for(const url of ['file:///tmp/test','http://timeteknika.domteknika.ch',ORIGIN+'.evil/',ORIGIN+'@evil.com/','https://user@timeteknika.domteknika.ch'])assert.equal(sameOrigin(url),false);
  const cookie={name:'teknika_session',value:'a'.repeat(64),domain:new URL(ORIGIN).hostname,path:'/',secure:true,httpOnly:true,expirationDate:Date.now()/1000+60};
  assert.ok(sessionCookie(cookie));
  for(const change of [{name:'business-data'},{secure:false},{httpOnly:false},{domain:'.domteknika.ch'},{expirationDate:1},{value:'invalid'}])assert.equal(sessionCookie({...cookie,...change}),null);
  let registrations=0,cleared=0;
  assert.equal(registerProfile({register:()=>++registrations===1,unregisterAll:()=>cleared++},PROFILES[0],{toggle(){},show(){}}),false);
  assert.equal(cleared,2);
});

test('Bureau HTTP : démarre et arrête sur le serveur existant, sans toucher aux collègues',async t=>{
  const app=createApplication({dbPath:':memory:',demo:true});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  const response=await fetch(origin+'/api/demo-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:'demo-alex'})});
  const cookie=response.headers.get('set-cookie').split(';')[0];
  const client=new TimerClient({origin,request:(url,options)=>fetch(url,{...options,headers:{...options.headers,Cookie:cookie}})});
  const before=await client.state();if(before.active)await client.toggle();
  assert.equal((await client.toggle()).action,'started');
  const active=(await client.state()).active;assert.equal(active.user_id,'demo-alex');assert.equal(active.task_id,null);
  assert.equal((await client.toggle()).action,'stopped');assert.equal((await client.state()).active,null);
});

const {TaskShortcuts,availableTasks}=require('../desktop/task-shortcuts.cjs');
const taskState=()=>({...snapshot(),tasks:[{id:'t1',name:'Admin',project_id:'p1',assignees:['me']},{id:'t2',name:'Étude',project_id:'p2',assignees:['me']},{id:'hidden',name:'Privée',project_id:'p1',assignees:['other']}],projects:[{id:'p1',name:'Interne',color:'#c65b65'},{id:'p2',name:'Client',color:'#abcabc'}],clients:[]});

test('Tâches bureau : changement atomique de tâche, même tâche sans découpage, droits et idempotence',async()=>{
 const state=taskState(),writes=[];
 state.entries=[{id:'running',user_id:'me',task_id:'t1',version:3,end:null}];
 const client=new TimerClient({origin:ORIGIN,request:async(url,options)=>{
  if(url.endsWith('/api/state'))return json(state);
  const data=JSON.parse(options.body);writes.push({data,key:options.headers['Idempotency-Key']});
  state.entries=[{id:'next',user_id:'me',task_id:data.task_id,end:null,version:1}];
  if(writes.length===1)throw Error('Lost response');return json({entry:state.entries[0]});
 }});
 assert.equal((await client.startTask(()=>'t1')).action,'already-running');assert.equal(writes.length,0);
 await assert.rejects(()=>client.startTask(()=>'hidden'),/plus disponible/);assert.equal(writes.length,0);
 await assert.rejects(()=>client.startTask(()=>'t2'),/injoignable/);
 assert.deepEqual(writes[0].data,{description:'',task_id:'t2',project_id:'p2',expectedRunningId:'running',expectedVersion:3});
 // Even a different shortcut first resolves the uncertain action, with its original key.
 const result=await client.startTask(()=>'t1');assert.equal(result.taskName,'Étude');assert.equal(result.action,'task-started');
 assert.equal(writes[0].key,writes[1].key);assert.deepEqual(writes[0].data,writes[1].data);
 assert.equal((await client.startTask(()=>'t2')).action,'already-running');assert.equal(writes.length,2);
});

test('Tâches bureau : cinq raccourcis persistants par compte, validation et conservation si échec disque',async t=>{
 const {mkdtemp,rm,readFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'timeteknika-shortcuts-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'shortcuts.json'),store=new TaskShortcuts(file),state=taskState();await store.load();
 assert.deepEqual(store.get('me').slots,Array(5).fill(null));
 const saved=await store.save(state,['t1','t2',null,null,null],'');
 const reload=new TaskShortcuts(file);await reload.load();assert.deepEqual(reload.get('me'),saved);assert.deepEqual(reload.get('other').slots,Array(5).fill(null));
 await assert.rejects(()=>store.save(state,['hidden',null,null,null,null],saved.revision),/plus disponible/);
 await assert.rejects(()=>store.save(state,['t1'],saved.revision),/cinq/);
 await assert.rejects(()=>store.save(state,Array(5).fill(null),''),/ont changé/);
 const removed={...state,tasks:[]};await store.save(removed,[null,'t2',null,null,null],saved.revision);
 const disk=await readFile(file,'utf8');assert.ok(!disk.includes('Admin'));assert.ok(!disk.includes('csrf'));
 const failed=new TaskShortcuts(join(dir,'missing','settings.json'));await assert.rejects(()=>failed.save(state,['t1',null,null,null,null],''));assert.deepEqual(failed.get('me').slots,Array(5).fill(null));
 assert.deepEqual(availableTasks(state).map(t=>t.id).sort(),['t1','t2']);
});

test('Tâches bureau : cinq touches supplémentaires et aucun enregistrement partiel si conflit',()=>{
 const keys=[],shortcuts={register:key=>{keys.push(key);return true;},unregisterAll:()=>{}};
 assert.ok(registerProfile(shortcuts,PROFILES[0],{toggle(){},show(){},tasks(){}}));
 assert.deepEqual(keys,[PROFILES[0].toggle,PROFILES[0].show,...taskKeys(PROFILES[0])]);
 let cleared=0;assert.equal(registerProfile({register:key=>!key.endsWith('F3'),unregisterAll:()=>cleared++},PROFILES[0],{toggle(){},show(){},tasks(){}}),false);assert.equal(cleared,2);
});
