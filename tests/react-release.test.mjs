import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,mkdir,rm,readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { createHash } from 'node:crypto';
import { openStore,seedDemo } from '../server/store.mjs';
import { createApplication } from '../server/index.mjs';
import { verifyRelease } from '../scripts/verify-release.mjs';
import { verifyRestoredDatabase } from '../scripts/verify-restored-database.mjs';
import { releasePath } from '../scripts/release-paths.mjs';
import { APP_VERSION } from '../public/release.js';
const hash=data=>createHash('sha256').update(data).digest('hex');
test('Livraison React : vérifie le build servi et refuse une archive avec traversée',async t=>{
  await mkdir('.qa',{recursive:true});
  const folder=await mkdtemp(resolve('.qa/release-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const frontendDir=join(folder,'web');await mkdir(frontendDir);
  await writeFile(join(frontendDir,'index.html'),'<html>React test</html>');
  const app=await createApplication({dbPath:':memory:',frontendDir});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const baseUrl='http://127.0.0.1:'+app.server.address().port;
  const manifest={version:APP_VERSION,frontend:'react',files:{'dist/web/index.html':hash('<html>React test</html>')}};
  assert.equal((await verifyRelease({baseUrl,manifest})).served,1);
  for(const path of ['server/../data/teknika.sqlite','scripts/.env','dist/web/../../data/x','/etc/passwd']){
    assert.equal(releasePath(path),false);
    await assert.rejects(()=>verifyRelease({baseUrl,manifest:{...manifest,files:{...manifest.files,[path]:'a'.repeat(64)}}}),/Manifeste/);
  }
  await writeFile(join(frontendDir,'index.html'),'corrupted');
  await assert.rejects(()=>verifyRelease({baseUrl,manifest}),/Fichier servi incorrect/);
});
test('Restauration React : préserve la sauvegarde, les tables métier et teste les trois exports',async t=>{
  await mkdir('.qa',{recursive:true});
  const folder=await mkdtemp(resolve('.qa/restore-'));t.after(()=>rm(folder,{recursive:true,force:true}));
  const dbPath=join(folder,'backup.sqlite');
  const store=openStore(dbPath);seedDemo(store);store.db.close();
  const before=hash(await readFile(dbPath));
  const result=await verifyRestoredDatabase(dbPath);
  assert.equal(result.ok,true);assert.equal(result.users,3);assert.equal(result.unchangedTables,11);
  assert.deepEqual(result.exports,['csv','xlsx','pdf']);
  assert.equal(hash(await readFile(dbPath)),before);
});
