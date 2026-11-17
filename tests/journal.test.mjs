import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import { openStore, seedDemo } from '../server/store.mjs';
import { createApplication } from '../server/index.mjs';
import { verifyJournal } from '../server/journal.mjs';

async function folder() { await mkdir('.qa',{recursive:true});return mkdtemp(resolve('.qa/journal-')); }
function fixture(t) { const store=openStore(':memory:');seedDemo(store);t.after(()=>store.db.close());return store; }
const actor=store=>store.one("SELECT * FROM users WHERE id='demo-alex'");
function change(store) { store.audit(actor(store),'client','client-nova','update',{name:'Avant'},{name:'Après'}); }

test('Journal : SQL UPDATE, DELETE et REPLACE interdits, vérification et rollback',t=>{
  const store=fixture(t);change(store);
  const audit=store.one('SELECT * FROM audit LIMIT 1');
  for(const table of ['audit','event_log']) {
    assert.throws(()=>store.run(`DELETE FROM ${table}`),/append-only/);
    assert.throws(()=>store.run(`UPDATE ${table} SET action='changed'`),/append-only/);
    assert.throws(()=>store.run(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table} LIMIT 1`),/append-only|Invalid journal chain/);
  }
  assert.equal(store.one('SELECT * FROM audit WHERE id=?',audit.id).action,'update');
  const before=store.verifyJournal();assert.equal(before.ok,true);
  store.db.exec('BEGIN IMMEDIATE');change(store);store.db.exec('ROLLBACK');
  assert.deepEqual(store.verifyJournal(),before);
  store.db.exec("CREATE TRIGGER fail_log BEFORE INSERT ON event_log WHEN NEW.category='audit' BEGIN SELECT RAISE(ABORT,'disk simulation'); END");
  assert.throws(()=>change(store),/disk simulation/);
  assert.deepEqual(store.verifyJournal(),before);
});

test('Journal : modification directe détectée même après contournement des protections SQL',t=>{
  const store=fixture(t);change(store);
  store.db.exec('DROP TRIGGER event_log_no_update');
  store.run("UPDATE event_log SET action='changed' WHERE seq=2");
  assert.equal(store.verifyJournal().ok,false);
});

test('Journal : historique altéré détecté et démarrage refusé sans réparer la preuve',async t=>{
  const dir=await folder(),path=join(dir,'tampered.sqlite'),store=openStore(path);seedDemo(store);change(store);
  store.db.exec("DROP TRIGGER audit_no_update; UPDATE audit SET action='tampered'");
  assert.equal(store.verifyJournal().ok,false);store.db.close();
  assert.throws(()=>openStore(path),/Journal invalide/);
  const copy=new DatabaseSync(path,{readOnly:true});t.after(()=>copy.close());
  assert.equal(copy.prepare('SELECT action FROM audit').get().action,'tampered');
});

test('Journal : migration unique de l’ancien historique, sauvegarde et contrôle externe',async t=>{
  const dir=await folder(),path=join(dir,'legacy.sqlite');
  let store=openStore(path);seedDemo(store);change(store);
  const original=store.all('SELECT * FROM audit');
  store.db.exec("DROP TABLE event_log; DELETE FROM meta WHERE key='journal_version'");store.db.close();
  store=openStore(path);
  assert.deepEqual(store.all('SELECT * FROM audit'),original);
  assert.equal(JSON.parse(store.one("SELECT details_json FROM event_log WHERE category='audit'").details_json).legacy,true);
  const checkpoint=store.verifyJournal();assert.equal(checkpoint.ok,true);
  const copyPath=join(dir,'backup.sqlite');await backup(store.db,copyPath);store.db.close();
  store=openStore(path);assert.deepEqual(store.verifyJournal(),checkpoint);store.db.close();
  const copy=new DatabaseSync(copyPath);t.after(()=>copy.close());assert.equal(verifyJournal(copy,checkpoint).ok,true);
  const reference=join(dir,'checkpoint.json');await writeFile(reference,JSON.stringify({checkpoint}));
  const result=spawnSync(process.execPath,['scripts/verify-journal.mjs',copyPath,reference],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).ok,true);
  copy.exec('DROP TRIGGER event_log_no_delete; DELETE FROM event_log WHERE seq=(SELECT MAX(seq) FROM event_log)');
  assert.equal(verifyJournal(copy,checkpoint).ok,false);
});

test('Journal : un point de contrôle détecte la suppression de la fin valide',t=>{
  const store=fixture(t);store.log({category:'system',action:'test'});
  const checkpoint=store.verifyJournal();
  store.db.exec('DROP TRIGGER event_log_no_delete; DELETE FROM event_log WHERE seq=(SELECT MAX(seq) FROM event_log)');
  assert.equal(store.verifyJournal().ok,true); // Cannot detect a valid prefix without an external anchor.
  assert.equal(store.verifyJournal(checkpoint).ok,false);
});

async function httpFixture(t) {
  const app=createApplication({dbPath:':memory:',demo:true});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const client=()=>{
    let cookie='',csrf='';
    return async(path,method='GET',data,key=crypto.randomUUID(),extra={})=>{
      const response=await fetch(base+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':key,...extra},body:method==='GET'?undefined:JSON.stringify(data??{})});
      if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
      const body=await response.json();if(body.csrf)csrf=body.csrf;
      return {status:response.status,body,requestId:response.headers.get('x-request-id')};
    };
  };
  return {app,client};
}

test('Journal HTTP : accès responsable, requêtes corrélées, replay, pagination et filtres',async t=>{
  const {app,client}=await httpFixture(t),manager=client(),member=client(),anonymous=client();
  assert.equal((await anonymous('/api/journal')).status,401);
  await manager('/api/demo-login','POST',{user_id:'demo-alex'});await member('/api/demo-login','POST',{user_id:'demo-emma'});
  for(const path of ['/api/journal','/api/journal/verify'])assert.equal((await member(path)).status,403);
  const key=crypto.randomUUID(),data={name:'Journal test'},created=await manager('/api/clients','POST',data,key);
  assert.equal(created.status,200);
  const replay=await manager('/api/clients','POST',data,key);assert.deepEqual(replay.body,created.body);
  const correlated=(await manager('/api/journal?requestId='+created.requestId)).body.items;
  assert.equal(correlated.filter(item=>item.category==='audit').length,1);
  assert.equal(correlated.find(item=>item.category==='audit').entity_id,created.body.client.id);
  assert.equal(correlated.find(item=>item.action==='mutation-committed').details.revision,created.body.revision);
  const replayItems=(await manager('/api/journal?requestId='+replay.requestId)).body.items;
  assert.equal(replayItems.length,1);assert.equal(replayItems[0].details.replayed,true);
  for(let i=0;i<110;i++)app.store.log({category:'system',action:'test'});
  const first=(await manager('/api/journal')).body;
  assert.equal(first.items.length,100);assert.ok(first.nextBefore);
  const second=(await manager('/api/journal?before='+first.nextBefore)).body;
  assert.ok(second.items.every(item=>item.seq<first.nextBefore));
  assert.equal(new Set([...first.items,...second.items].map(item=>item.seq)).size,first.items.length+second.items.length);
  assert.ok((await manager('/api/journal?level=warning')).body.items.every(item=>item.level==='warning'));
  assert.ok((await manager('/api/journal?category=audit')).body.items.every(item=>item.category==='audit'));
  assert.equal((await manager('/api/journal?before=NaN')).status,400);
  assert.equal((await manager('/api/journal?category=secrets')).status,400);
  assert.equal((await manager('/api/journal/verify')).body.ok,true);
  assert.equal((await manager('/api/journal','DELETE',{})).status,404);
});

test('Journal HTTP : secrets exclus, échecs conservés après rollback et référence d’erreur',async t=>{
  const {app,client}=await httpFixture(t),manager=client(),anonymous=client();
  const secret='SENSITIVE-UNIQUE-SECRET';
  await anonymous('/api/login?password='+secret,'POST',{username:'unknown',password:secret},crypto.randomUUID(),{Cookie:secret,Authorization:secret});
  await anonymous('/api/'+secret);
  await manager('/api/demo-login','POST',{user_id:'demo-alex'});
  app.store.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON event_log WHEN NEW.category='audit' BEGIN SELECT RAISE(ABORT,'SENSITIVE-UNIQUE-SECRET'); END");
  const revision=app.store.revision(),failed=await manager('/api/clients','POST',{name:'Should roll back'});
  assert.equal(failed.status,500);assert.equal(failed.body.requestId,failed.requestId);
  assert.equal(app.store.one("SELECT 1 FROM clients WHERE name='Should roll back'"),undefined);
  assert.equal(app.store.revision(),revision);
  const errors=(await manager('/api/journal?requestId='+failed.requestId)).body.items;
  assert.equal(errors.length,1);assert.equal(errors[0].level,'error');assert.equal(errors[0].details.error,'internal');
  assert.ok(errors[0].details.locations.length);
  assert.ok(!JSON.stringify(app.store.all('SELECT * FROM event_log')).includes(secret));
  assert.ok(!JSON.stringify(failed.body).includes(secret));
  app.store.db.exec('DROP TRIGGER fail_audit');
  assert.equal(app.store.verifyJournal().ok,true);
  const conflict=await manager('/api/timer/start','POST',{expectedRunningId:'outdated'});
  assert.equal(conflict.status,409);assert.equal(conflict.body.requestId,conflict.requestId);
  const logged=(await manager('/api/journal?requestId='+conflict.requestId)).body.items[0];
  assert.equal(logged.level,'warning');assert.equal(logged.details.error,'timer_conflict');
});
