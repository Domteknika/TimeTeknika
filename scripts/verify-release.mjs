import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releasePath, runtimePath } from './release-paths.mjs';

const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
export async function verifyRelease({baseUrl,manifest,root,request=fetch}){
  const base=new URL(baseUrl);
  if(!['http:','https:'].includes(base.protocol))throw Error('Adresse HTTP(S) attendue.');
  if(!manifest.version||!manifest.files||!Object.keys(manifest.files).length)throw Error('Manifeste de version incomplet.');
  const react=manifest.frontend==='react';
  if(react&&!manifest.files['dist/web/index.html'])throw Error('Build React absent du manifeste.');
  for(const [path,expected] of Object.entries(manifest.files)){
    if(!releasePath(path)||!/^[a-f0-9]{64}$/.test(expected))throw Error('Manifeste de fichiers invalide.');
  }
  const url=path=>new URL(path+'?verification='+Date.now(),base);
  const health=await request(url('/health'),{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!health.ok)throw Error(`Santé du serveur : HTTP ${health.status}`);
  const status=await health.json();
  if(status.status!=='ok'||status.version!==manifest.version)throw Error(`Ancienne version ou version incorrecte : ${status.version||'non identifiée'} ; attendue : ${manifest.version}`);
  let served=0;
  for(const [path,expected] of Object.entries(manifest.files)){
    if(root&&runtimePath(path)&&hash(await readFile(resolve(root,path)))!==expected)throw Error('Fichier installé incorrect : '+path);
    const prefix=react?'dist/web/':'public/';
    if(!path.startsWith(prefix))continue;
    const relative=path.slice(prefix.length);
    const route=relative==='index.html'?'/':'/'+relative;
    const response=await request(url(route),{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(react&&response.headers.get('X-TimeTeknika-UI')!=='react')throw Error('Interface React non servie : '+route);
    if(!response.ok||hash(Buffer.from(await response.arrayBuffer()))!==expected)throw Error('Fichier servi incorrect : '+route);
    served++;
  }
  return {version:manifest.version,served};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  try{
    const manifest=JSON.parse(await readFile(resolve(root,'scripts/release-manifest.json'),'utf8'));
    const result=await verifyRelease({baseUrl:process.argv[2]||'http://127.0.0.1:4310',manifest,root});
    console.log(`VERSION VALIDÉE : ${result.version} — ${result.served} fichiers publics identiques à la livraison.`);
  }catch(error){console.error('MISE À JOUR NON VALIDÉE : '+error.message);process.exitCode=1;}
}
