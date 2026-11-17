import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtemp, rm, readFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createApplication } from '../server/index.mjs';
import { verifyJournal } from '../server/journal.mjs';
import { verifyRelease } from './verify-release.mjs';
import { buildExport } from '../server/exports.mjs';
import { csvExport, xlsxExport, pdfExport } from '../server/export-files.mjs';
import { defaultExportConfig } from '../public/export-config.js';

const tables=['meta','users','clients','projects','tasks','assignments','entries','audit','export_templates','requests','sessions'];
function fingerprint(db){
  const rows={};
  for(const table of tables){
    const data=db.prepare('SELECT * FROM '+table).all().map(row=>JSON.stringify(row)).sort();
    rows[table]={count:data.length,sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex')};
  }
  return rows;
}
function integrity(db){
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Intégrité SQLite invalide.');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Références SQLite invalides.');
  const journal=verifyJournal(db);
  if(!journal.ok)throw Error('Journal invalide.');
  return journal;
}
export async function verifyRestoredDatabase(source,{frontendDir=resolve('dist/web'),manifest=null,initialAdminUsername=''}={}){
  const folder=await mkdtemp(join(tmpdir(),'timeteknika-restore-'));
  let original, app;
  try{
    // A backup is a standalone SQLite file. Read a scratch copy so WAL sidecars
    // can be created without writing beside a read-only bind-mounted backup.
    const input=join(folder,'input.sqlite');
    const sourceHash=createHash('sha256').update(await readFile(resolve(source))).digest('hex');
    await copyFile(resolve(source),input);
    original=new DatabaseSync(input,{readOnly:true});
    const checkpoint=integrity(original);
    const hadAdminsTable=!!original.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_admins'").get();
    const originalAdmins=hadAdminsTable?original.prepare('SELECT user_id FROM user_admins ORDER BY user_id').all().map(row=>row.user_id):[];
    const before=fingerprint(original);
    const restored=join(folder,'restored.sqlite');
    await backup(original,restored);
    original.close();original=null;
    app=createApplication({dbPath:restored,frontendDir,initialAdminUsername});
    const newAdmins=app.store.all('SELECT user_id FROM user_admins ORDER BY user_id').map(row=>row.user_id);
    if(originalAdmins.length) {
      if(JSON.stringify(newAdmins)!==JSON.stringify(originalAdmins))throw Error('Administrateurs existants modifiés.');
    } else if(initialAdminUsername) {
      const target=app.store.one('SELECT id FROM users WHERE username=? AND active=1',initialAdminUsername.toLowerCase().trim());
      if(!target||JSON.stringify(newAdmins)!==JSON.stringify([target.id]))throw Error('Initialisation de l’administrateur incorrecte.');
    }
    await new Promise((yes,no)=>{app.server.once('error',no);app.server.listen(0,'127.0.0.1',yes);});
    const baseUrl='http://127.0.0.1:'+app.server.address().port;
    if(manifest)await verifyRelease({baseUrl,manifest});
    const health=await fetch(baseUrl+'/health');
    if(!health.ok)throw Error('Le serveur restauré ne répond pas.');
    const users=app.store.all('SELECT * FROM users');
    for(const user of users){
      const snapshot=app.store.snapshot(user);
      if(user.role!=='manager'&&snapshot.entries.some(entry=>entry.user_id!==user.id))throw Error('Isolation des comptes invalide.');
      JSON.stringify(snapshot);
    }
    const manager=users.find(user=>user.role==='manager');
    if(!manager)throw Error('Aucun responsable présent dans la base.');
    const day=new Date().toISOString().slice(0,10);
    const config=defaultExportConfig(day.slice(0,7)+'-01',day);
    const model=buildExport(app.store.visibleEntries(manager),app.store.lookups(),config,manager);
    if(!csvExport(model).length||!(await xlsxExport(model)).length||!(await pdfExport(model)).length)throw Error('Export vide.');
    if(JSON.stringify(fingerprint(app.store.db))!==JSON.stringify(before))throw Error('Données métier modifiées pendant le test.');
    integrity(app.store.db);
    if(!verifyJournal(app.store.db,checkpoint).ok)throw Error('Historique du journal non conservé.');
    await app.close();app=null;
    original=new DatabaseSync(input,{readOnly:true});
    if(createHash("sha256").update(await readFile(resolve(source))).digest("hex")!==sourceHash)throw Error("La sauvegarde source a changé.");
    if(JSON.stringify(fingerprint(original))!==JSON.stringify(before))throw Error('La sauvegarde source a changé.');
    return {ok:true,users:users.length,entries:before.entries.count,unchangedTables:tables.length,exports:['csv','xlsx','pdf']};
  }finally{
    if(original)original.close();
    if(app)await app.close();
    await rm(folder,{recursive:true,force:true});
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{
    if(!process.argv[2])throw Error('Indiquer une sauvegarde SQLite, jamais la base active.');
    const manifest=JSON.parse(await readFile(resolve('scripts/release-manifest.json'),'utf8'));
    console.log(JSON.stringify(await verifyRestoredDatabase(process.argv[2],{manifest,initialAdminUsername:process.argv[3]||''}),null,2));
  }catch(error){console.error('RESTAURATION NON VALIDÉE : '+error.message);process.exitCode=1;}
}
