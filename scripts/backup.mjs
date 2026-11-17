import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';

const source=resolve(process.argv[2]||join(process.env.DATA_DIR||'data','teknika.sqlite'));
const destination=resolve(process.argv[3]||join('data','backups',`teknika-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`));
if(source===destination)throw Error('La destination doit être différente de la base active.');
await stat(source);
try { await stat(destination); throw Error('La destination existe déjà ; choisissez un nouveau fichier.'); } catch(error) { if(error.code!=='ENOENT') throw error; }
await mkdir(dirname(destination),{recursive:true});
const db=new DatabaseSync(source,{readOnly:true});
try{await backup(db,destination);console.log(`Sauvegarde cohérente créée : ${destination}`);}finally{db.close();}
