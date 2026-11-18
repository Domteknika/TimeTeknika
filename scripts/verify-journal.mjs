import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { verifyJournal } from '../server/journal.mjs';

// A separately retained checkpoint detects truncation or replacement of the chain.
const postgres = process.argv[2] === '--postgres';
if (!postgres && !process.argv[2] && process.env.DATABASE_URL) throw Error('PostgreSQL configuré : utilisez --postgres pour vérifier son journal, ou indiquez explicitement un fichier SQLite.');
const source=postgres ? null : resolve(process.argv[2]||join(process.env.DATA_DIR||'data','teknika.sqlite'));
const reference=process.argv[3]?JSON.parse(await readFile(resolve(process.argv[3]),'utf8')):null;
const checkpoint=reference?.checkpoint??reference;
if(checkpoint && (!Number.isSafeInteger(checkpoint.count)||checkpoint.count<0||!/^[a-f0-9]{64}$/.test(checkpoint.hash)))throw Error('Point de contrôle invalide.');
if (postgres) {
  const { openPostgresDatabase } = await import('../server/db/postgres.mjs');
  const { createPostgresJournal } = await import('../server/db/journal.mjs');
  let store;
  try {
    store = await openPostgresDatabase({ databaseUrl: process.env.DATABASE_URL });
    // Verification must never initialize or repair the journal being inspected.
    const result = await createPostgresJournal(store).verifyJournal(checkpoint);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch {
    console.error('Vérification PostgreSQL impossible. Vérifiez la connexion, les migrations et les protections du journal.');
    process.exitCode = 1;
  } finally { await store?.close(); }
} else {
  const db=new DatabaseSync(source,{readOnly:true});
  try {
    const result=verifyJournal(db,checkpoint);
    console.log(JSON.stringify(result,null,2));
    if(!result.ok)process.exitCode=1;
  } finally { db.close(); }
}
