import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../server/index.mjs';
import { passwordHash } from '../server/store.mjs';

async function fixture(t) {
  const app=await createApplication({dbPath:':memory:',demo:true});
  const password='test-passphrase-123';
  for(const user of app.store.all('SELECT id FROM users'))app.store.run('UPDATE users SET password=? WHERE id=?',passwordHash(password),user.id);
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;
  async function client(username) {
    let cookie='',csrf='';
    const request=async(path,method='GET',body,key=crypto.randomUUID(),extra={})=>{
      const response=await fetch(base+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':key,...extra},body:method==='GET'?undefined:JSON.stringify(body??{})});
      if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
      const data=await response.json();if(data.csrf)csrf=data.csrf;
      return {status:response.status,data};
    };
    if(username)assert.equal((await request('/api/login','POST',{username,password})).status,200);
    return {request};
  }
  return {app,client,password};
}
const target='/api/users/demo-emma';
const rename=(username,previousUsername='emma@demo.local')=>({username,previousUsername});
test('Identifiant : comptes, sessions, chrono et affectations conservés ; nouvelle connexion et audit',async t=>{
  const {app,client,password}=await fixture(t);
  const manager=await client('alex@demo.local'),member=await client('emma@demo.local'),other=await client('emma@demo.local');
  assert.equal((await member.request('/api/timer/start','POST',{description:'Chrono à conserver',task_id:'task-plans'})).status,200);
  const before=app.store.one('SELECT * FROM users WHERE id=?','demo-emma');
  const entries=app.store.all('SELECT * FROM entries ORDER BY id'),assignments=app.store.all('SELECT * FROM assignments ORDER BY task_id,user_id');
  const sessions=app.store.all('SELECT * FROM sessions ORDER BY token');
  const key=crypto.randomUUID(),payload=rename(' Emma.Nouveau ');
  const changed=await manager.request(target+'/username','PATCH',payload,key);
  assert.equal(changed.status,200);assert.equal(changed.data.username,'emma.nouveau');
  assert.deepEqual({...app.store.one('SELECT * FROM users WHERE id=?','demo-emma')},{...before,username:'emma.nouveau'});
  assert.deepEqual(app.store.all('SELECT * FROM entries ORDER BY id'),entries);
  assert.deepEqual(app.store.all('SELECT * FROM assignments ORDER BY task_id,user_id'),assignments);
  assert.deepEqual(app.store.all('SELECT * FROM sessions ORDER BY token'),sessions);
  assert.equal((await member.request('/api/state')).data.me.username,'emma.nouveau');
  assert.equal((await other.request('/api/state')).status,200);
  assert.deepEqual((await manager.request(target+'/username','PATCH',payload,key)).data,changed.data);
  const audit=app.store.all("SELECT * FROM audit WHERE action='username-change'");
  assert.equal(audit.length,1);assert.equal(audit[0].entity_id,'demo-emma');
  assert.equal(JSON.parse(audit[0].before_json).username,'emma@demo.local');
  assert.equal(JSON.parse(audit[0].after_json).username,'emma.nouveau');
  assert.ok(!JSON.stringify(audit).includes(before.password));
  const fresh=await client();
  assert.equal((await fresh.request('/api/login','POST',{username:'emma@demo.local',password})).status,401);
  assert.equal((await fresh.request('/api/login','POST',{username:'EMMA.NOUVEAU',password})).status,200);
  assert.equal((await fresh.request('/api/state')).data.me.id,'demo-emma');
  assert.equal(app.store.verifyJournal().ok,true);
});
test('Identifiant : autorisations, validation, doublons, concurrence et propre compte',async t=>{
  const {app,client}=await fixture(t);
  const admin=await client('alex@demo.local'),second=await client('alex@demo.local'),member=await client('emma@demo.local'),anonymous=await client();
  assert.equal((await anonymous.request(target+'/username','PATCH',rename('nouveau'))).status,401);
  assert.equal((await member.request(target+'/username','PATCH',rename('nouveau'))).status,403);
  assert.equal((await admin.request(target+'/username','PATCH',rename('nouveau'),crypto.randomUUID(),{'X-CSRF-Token':'invalid'})).status,403);
  for(const value of ['', 'ab', 'prenom nom', 'équipe', 'email@example.ch', 'a'.repeat(41)]) {
    assert.equal((await admin.request(target+'/username','PATCH',rename(value))).status,400);
  }
  assert.equal((await admin.request(target+'/username','PATCH',{username:'newname'})).status,400);
  assert.equal((await admin.request('/api/users/demo-alex/username','PATCH',rename('responsable','alex@demo.local'))).status,200);
  assert.equal((await admin.request('/api/state')).data.me.username,'responsable');
  const duplicate=await admin.request(target+'/username','PATCH',rename('RESPONSABLE'));
  assert.equal(duplicate.status,409);assert.equal(duplicate.data.error,'username_taken');
  const results=await Promise.all([
    admin.request(target+'/username','PATCH',rename('emma.premier')),
    second.request(target+'/username','PATCH',rename('emma.second')),
  ]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal(results.find(r=>r.status===409).data.error,'version_conflict');
  assert.equal(app.store.all("SELECT * FROM audit WHERE entity_id='demo-emma' AND action='username-change'").length,1);
  assert.equal((await admin.request('/api/users/absent/username','PATCH',rename('nouveau'))).status,404);
});
test('Retrait : sessions révoquées, login refusé, heures et affectations consultables et modifiables',async t=>{
  const {app,client,password}=await fixture(t);
  const admin=await client('alex@demo.local'),member=await client('emma@demo.local'),second=await client('emma@demo.local');
  const before=app.store.one('SELECT * FROM users WHERE id=?','demo-emma');
  const entries=app.store.all('SELECT * FROM entries ORDER BY id'),assignments=app.store.all('SELECT * FROM assignments ORDER BY task_id,user_id');
  const key=crypto.randomUUID(),payload={confirmUsername:'emma@demo.local'};
  const removed=await admin.request(target,'DELETE',payload,key);
  assert.equal(removed.status,200);
  assert.deepEqual({...app.store.one('SELECT * FROM users WHERE id=?','demo-emma')},{...before,active:0});
  assert.deepEqual(app.store.all('SELECT * FROM entries ORDER BY id'),entries);
  assert.deepEqual(app.store.all('SELECT * FROM assignments ORDER BY task_id,user_id'),assignments);
  assert.equal(app.store.one('SELECT count(*) n FROM sessions WHERE user_id=?','demo-emma').n,0);
  for(const c of [member,second])assert.equal((await c.request('/api/state')).status,401);
  assert.equal((await member.request('/api/login','POST',{username:before.username,password})).status,401);
  assert.equal((await member.request('/api/demo-login','POST',{user_id:'demo-emma'})).status,404);
  assert.ok(!(await member.request('/api/info')).data.demoUsers.some(u=>u.id==='demo-emma'));
  const state=(await admin.request('/api/state')).data;
  assert.equal(state.users.find(u=>u.id==='demo-emma').active,0);
  assert.ok(state.entries.some(e=>e.user_id==='demo-emma'));
  assert.deepEqual((await admin.request(target,'DELETE',payload,key)).data,removed.data);
  assert.equal(app.store.all("SELECT * FROM audit WHERE action='user-remove'").length,1);
  const task=state.tasks.find(t=>t.id==='task-plans');
  assert.equal((await admin.request('/api/tasks/task-plans','PATCH',{version:task.version,name:'Nom actualisé'})).status,200);
  assert.equal((await admin.request('/api/tasks','POST',{name:'Interdit',project_id:'project-cedres',assignees:['demo-emma']})).status,400);
  const claimed=await admin.request('/api/users','POST',{name:'Autre',username:'reserved',password});
  assert.equal(claimed.status,200);
  const report=await admin.request('/api/reports','POST',{from:'2026-01-01',to:'2026-12-31',group:'person'});
  assert.equal(report.status,200);assert.ok(report.data.rows.some(r=>r.user_id==='demo-emma'));
  assert.equal(app.store.verifyJournal().ok,true);
});
test('Retrait : membre et propre compte interdits, confirmation et chrono en cours protégés',async t=>{
  const {app,client}=await fixture(t);
  const admin=await client('alex@demo.local'),member=await client('emma@demo.local'),anonymous=await client();
  const confirmation={confirmUsername:'emma@demo.local'};
  assert.equal((await anonymous.request(target,'DELETE',confirmation)).status,401);
  assert.equal((await member.request('/api/users/demo-lucas','DELETE',{confirmUsername:'lucas@demo.local'})).status,403);
  assert.equal((await admin.request('/api/users/demo-alex','DELETE',{confirmUsername:'alex@demo.local'})).data.error,'own_account');
  assert.equal((await admin.request(target,'DELETE',confirmation,crypto.randomUUID(),{'X-CSRF-Token':'bad'})).status,403);
  assert.equal((await admin.request(target,'DELETE',{confirmUsername:'wrong'})).data.error,'confirmation_mismatch');
  assert.equal((await member.request('/api/timer/start','POST',{description:'En cours'})).status,200);
  const blocked=await admin.request(target,'DELETE',confirmation);
  assert.equal(blocked.status,409);assert.equal(blocked.data.error,'running_timer');
  assert.equal((await member.request('/api/state')).status,200);
  assert.equal(app.store.one('SELECT active FROM users WHERE id=?','demo-emma').active,1);
  assert.equal((await admin.request('/api/users/unknown','DELETE',confirmation)).status,404);
});
test('Gestion de compte : échec du journal annule identifiant, retrait et révocation des sessions',async t=>{
  const {app,client}=await fixture(t);
  const admin=await client('alex@demo.local'),member=await client('emma@demo.local');
  app.store.db.exec("CREATE TRIGGER reject_user_audit BEFORE INSERT ON audit WHEN NEW.entity='user' BEGIN SELECT RAISE(ABORT,'audit failure'); END");
  assert.equal((await admin.request(target+'/username','PATCH',rename('refuse'))).status,500);
  assert.equal((await admin.request(target,'DELETE',{confirmUsername:'emma@demo.local'})).status,500);
  const state=await member.request('/api/state');
  assert.equal(state.status,200);assert.equal(state.data.me.username,'emma@demo.local');assert.equal(state.data.me.active,1);
});
