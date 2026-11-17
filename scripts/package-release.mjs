import { readFile,readdir,writeFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { APP_VERSION } from '../public/release.js';
import { releasePath } from './release-paths.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=data=>createHash('sha256').update(data).digest('hex');
const paths=['Dockerfile','.dockerignore','package.json','pnpm-lock.yaml','tsconfig.json','vite.config.ts','index.html','components.json'];
const generated=new Set(['scripts/release-manifest.json','scripts/release-files.sha256']);
async function collect(directory){
  for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){
    const path=directory+'/'+entry.name;
    if(generated.has(path))continue;
    if(!releasePath(path))throw Error('Chemin non autorisé : '+path);
    if(entry.isDirectory())await collect(path);
    else if(entry.isFile())paths.push(path);
    else throw Error('Lien non autorisé : '+path);
  }
}
for(const dir of ['server','public','scripts','src','web-assets','dist/web'])await collect(dir);
await readFile(resolve(root,'dist/web/index.html'));
paths.sort();const files={};
for(const path of paths)files[path]=sha(await readFile(resolve(root,path)));
await writeFile(resolve(root,'scripts/release-manifest.json'),JSON.stringify({format:2,frontend:'react',version:APP_VERSION,files},null,2)+'\n');
paths.push('scripts/release-manifest.json');
const checks=[];for(const path of paths)checks.push(sha(await readFile(resolve(root,path)))+'  '+path);
await writeFile(resolve(root,'scripts/release-files.sha256'),checks.join('\n')+'\n');
paths.push('scripts/release-files.sha256');
await mkdir(resolve(root,'.qa/releases'),{recursive:true});
const archive=resolve(root,`.qa/releases/timeteknika-${APP_VERSION}.tar.gz`);
execFileSync('tar',['-czf',archive,...paths],{cwd:root});
const members=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split(/\r?\n/);
if(JSON.stringify(members)!==JSON.stringify(paths))throw Error('Contenu de livraison inattendu.');
await writeFile(archive+'.sha256',sha(await readFile(archive))+'  '+archive.split(/[\\/]/).pop()+'\n');
console.log(JSON.stringify({version:APP_VERSION,archive,files:paths.length,sha256:sha(await readFile(archive))},null,2));
