import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApplication } from '../server/index.mjs';
import { verifyRestoredDatabase } from '../scripts/verify-restored-database.mjs';

async function fixture(t){
 const app=await createApplication({dbPath:':memory:',demo:true});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const base='http://127.0.0.1:'+app.server.address().port;
 async function client(id){
  let cookie='',csrf='';
  const request=async(path,method='GET',data,key=crypto.randomUUID())=>{
   const response=await fetch(base+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':key},body:method==='GET'?undefined:JSON.stringify(data??{})});
   if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
   const result=await response.json();if(result.csrf)csrf=result.csrf;
   return {status:response.status,data:result};
  };
  if(id)assert.equal((await request('/api/demo-login','POST',{user_id:id})).status,200);
  return {request};
 }
 return {app,client};
}
test('Administrateurs multiples : nomination, création, gestion des rôles, sessions et audit',async t=>{
 const {app,client}=await fixture(t),admin=await client('demo-alex'),member=await client('demo-emma');
 assert.equal((await admin.request('/api/state')).data.me.role,'admin');
 const key=crypto.randomUUID(),payload={role:'admin',previousRole:'member'};
 const promoted=await admin.request('/api/users/demo-emma/role','PATCH',payload,key);
 assert.equal(promoted.status,200);assert.equal((await member.request('/api/state')).status,401);
 assert.deepEqual((await admin.request('/api/users/demo-emma/role','PATCH',payload,key)).data,promoted.data);
 const other=await client('demo-emma');assert.equal((await other.request('/api/state')).data.me.role,'admin');
 assert.equal(app.store.one('SELECT COUNT(*) n FROM user_admins').n,2);
 assert.equal((await other.request('/api/users','POST',{name:'Admin de test',username:'admin.test',password:'fixture-pass123',role:'admin'})).status,200);
 const added=app.store.one('SELECT * FROM users WHERE username=?','admin.test');assert.equal(app.store.effectiveRole(added),'admin');
 assert.equal((await other.request('/api/users/demo-lucas/role','PATCH',{role:'manager',previousRole:'member'})).status,200);
 const manager=await client('demo-lucas');assert.equal((await manager.request('/api/state')).data.me.role,'manager');
 assert.ok((await manager.request('/api/state')).data.entries.some(e=>e.user_id==='demo-alex'));
 assert.equal((await manager.request('/api/journal')).status,200);
 for(const [path,method,data] of [
  ['/api/users','POST',{name:'Non',username:'intrus.test',password:'fixture-pass123',role:'admin'}],
  ['/api/users/demo-lucas/role','PATCH',{role:'admin',previousRole:'manager'}],
  ['/api/users/demo-emma/username','PATCH',{username:'non',previousUsername:'emma@demo.local'}],
  ['/api/users/demo-emma/password','POST',{password:'fixture-pass123'}],
  ['/api/users/demo-emma','DELETE',{confirmUsername:'emma@demo.local'}],
 ])assert.equal((await manager.request(path,method,data)).status,403,path);
 assert.equal((await other.request('/api/users/demo-alex/role','PATCH',{role:'manager',previousRole:'admin'})).status,200);
 assert.equal((await admin.request('/api/state')).status,401);
 assert.equal((await (await client('demo-alex')).request('/api/users','POST',{})).status,403);
 assert.equal(app.store.verifyJournal().ok,true);
});
test('Dernier administrateur protégé, rôles invalides et modifications concurrentes',async t=>{
 const {app,client}=await fixture(t),admin=await client('demo-alex'),member=await client('demo-emma'),guest=await client();
 const path='/api/users/demo-alex/role';
 assert.equal((await guest.request(path,'PATCH',{role:'admin',previousRole:'admin'})).status,401);
 assert.equal((await member.request(path,'PATCH',{role:'member',previousRole:'admin'})).status,403);
 assert.equal((await admin.request(path,'PATCH',{role:'member',previousRole:'admin'})).data.error,'last_admin');
 assert.equal((await admin.request(path,'PATCH',{role:'owner',previousRole:'admin'})).status,400);
 assert.equal((await admin.request(path,'PATCH',{role:'manager',previousRole:'member'})).data.error,'version_conflict');
 assert.equal((await admin.request('/api/users','POST',{name:'Non',username:'invalid.test',password:'fixture-pass123',role:'owner'})).status,400);
 assert.equal((await admin.request('/api/users/demo-emma/role','PATCH',{role:'admin',previousRole:'member'})).status,200);
 const other=await client('demo-emma');
 const results=await Promise.all([
  admin.request('/api/users/demo-alex/role','PATCH',{role:'manager',previousRole:'admin'}),
  other.request('/api/users/demo-emma/role','PATCH',{role:'member',previousRole:'admin'}),
 ]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal(results.find(r=>r.status===409).data.error,'last_admin');
 assert.equal(app.store.one('SELECT COUNT(*) n FROM user_admins a JOIN users u ON u.id=a.user_id WHERE u.active=1').n,1);
});
test('Installation neuve : premier compte administrateur',async t=>{
 const app=await createApplication({dbPath:':memory:',setupToken:'fixture-only'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const response=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Admin fictif',username:'admin.fixture',password:'fixture-pass123',setupToken:'fixture-only'})});
 assert.equal(response.status,201);assert.equal((await response.json()).me.role,'admin');
 assert.equal(app.store.one('SELECT COUNT(*) n FROM user_admins').n,1);
});
test('Migration additive : seul le compte explicitement désigné devient admin ; sauvegarde et ancien schéma conservés',async t=>{
 await mkdir('.qa',{recursive:true});const folder=await mkdtemp(resolve('.qa/admin-migration-'));t.after(()=>rm(folder,{recursive:true,force:true}));
 const source=join(folder,'old.sqlite');const original=await createApplication({dbPath:source,demo:true});
 original.store.run("UPDATE users SET role='manager' WHERE id='demo-emma'");
 const beforeUsers=original.store.all('SELECT * FROM users ORDER BY id'),beforeEntries=original.store.all('SELECT * FROM entries ORDER BY id');
 await original.close();
 const old=new DatabaseSync(source);old.exec('DROP TABLE user_admins');old.close();
 const result=await verifyRestoredDatabase(source,{initialAdminUsername:'alex@demo.local'});
 assert.equal(result.ok,true);assert.equal(result.unchangedTables,14);
 const untouched=new DatabaseSync(source,{readOnly:true});assert.equal(untouched.prepare("SELECT 1 FROM sqlite_master WHERE name='user_admins'").get(),undefined);untouched.close();
 const migrated=await createApplication({dbPath:source,initialAdminUsername:'alex@demo.local'});
 assert.deepEqual(migrated.store.all('SELECT * FROM users ORDER BY id'),beforeUsers);
 assert.deepEqual(migrated.store.all('SELECT * FROM entries ORDER BY id'),beforeEntries);
 assert.equal(migrated.store.snapshot(migrated.store.one("SELECT * FROM users WHERE id='demo-alex'")).me.role,'admin');
 assert.equal(migrated.store.snapshot(migrated.store.one("SELECT * FROM users WHERE id='demo-emma'")).me.role,'manager');
 await migrated.close();
 const restarted=await createApplication({dbPath:source,initialAdminUsername:'emma@demo.local'});
 assert.equal(restarted.store.one('SELECT COUNT(*) n FROM user_admins').n,1);
 assert.equal(restarted.store.one("SELECT COUNT(*) n FROM event_log WHERE action='administrator-initialized'").n,1);
 assert.equal(restarted.store.verifyJournal().ok,true);await restarted.close();
});
test('Initialisation refuse un compte inconnu ou un membre, sans accorder de privilèges',async t=>{
 await mkdir('.qa',{recursive:true});const folder=await mkdtemp(resolve('.qa/admin-reject-'));t.after(()=>rm(folder,{recursive:true,force:true}));
 const source=join(folder,'old.sqlite');const original=await createApplication({dbPath:source,demo:true});
 original.store.run('DELETE FROM user_admins');await original.close();
 for(const username of ['unknown.test','emma@demo.local'])await assert.rejects(()=>createApplication({dbPath:source,initialAdminUsername:username}),/responsable existant et actif/);
 const checked=new DatabaseSync(source,{readOnly:true});assert.equal(checked.prepare('SELECT COUNT(*) n FROM user_admins').get().n,0);checked.close();
});
