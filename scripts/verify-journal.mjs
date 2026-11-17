import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { verifyJournal } from '../server/journal.mjs';

// A separately retained checkpoint detects truncation or replacement of the chain.
const source=resolve(process.argv[2]||join(process.env.DATA_DIR||'data','teknika.sqlite'));
const reference=process.argv[3]?JSON.parse(await readFile(resolve(process.argv[3]),'utf8')):null;
const checkpoint=reference?.checkpoint??reference;
if(checkpoint && (!Number.isSafeInteger(checkpoint.count)||checkpoint.count<0||!/^[a-f0-9]{64}$/.test(checkpoint.hash)))throw Error('Point de contrôle invalide.');
const db=new DatabaseSync(source,{readOnly:true});
try {
  const result=verifyJournal(db,checkpoint);
  console.log(JSON.stringify(result,null,2));
  if(!result.ok)process.exitCode=1;
} finally { db.close(); }
