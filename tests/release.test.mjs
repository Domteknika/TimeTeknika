import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyRelease } from '../scripts/verify-release.mjs';
import { createApplication } from '../server/index.mjs';
import { APP_VERSION } from '../public/release.js';

test('Installateur : vérifie la version, chaque fichier public et refuse un ancien serveur',async t=>{
  const app=await createApplication({dbPath:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const baseUrl=`http://127.0.0.1:${app.server.address().port}`,root=fileURLToPath(new URL('../',import.meta.url)),manifest={version:APP_VERSION,files:{}};
  for(const file of await readdir(new URL('../public/',import.meta.url))){manifest.files['public/'+file]=createHash('sha256').update(await readFile(new URL('../public/'+file,import.meta.url))).digest('hex');}
  const result=await verifyRelease({baseUrl,root,manifest});assert.equal(result.version,APP_VERSION);assert.equal(result.served,Object.keys(manifest.files).length);
  await assert.rejects(()=>verifyRelease({baseUrl,manifest,request:async()=>new Response(JSON.stringify({status:'ok'}),{status:200})}),/Ancienne version/);
  const bad={...manifest,files:{'public/app.js':'0'.repeat(64)}};
  await assert.rejects(()=>verifyRelease({baseUrl,manifest:bad}),/Fichier servi incorrect/);
  await assert.rejects(()=>verifyRelease({baseUrl,root,manifest:bad}),/Fichier installé incorrect/);
});
