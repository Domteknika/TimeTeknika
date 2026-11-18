// Recovery by a server administrator. Read the password from stdin, never argv.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { passwordHash } from '../server/store.mjs';
import { openApplicationStore } from '../server/async-store.mjs';
import { secret } from '../server/auth.mjs';
const username = process.argv[2]?.trim().toLowerCase();
if (!username) throw Error('Usage : node scripts/reset-password.mjs IDENTIFIANT (mot de passe sur stdin)');
const password = secret(readFileSync(0,'utf8').replace(/\r?\n$/, ''), true);
const store = await openApplicationStore({ databaseUrl: process.env.DATABASE_URL || '', dbPath: join(process.env.DATA_DIR || 'data', 'teknika.sqlite') });
try {
  await store.transaction(async () => {
    const user = await store.findUserByUsername(username);
    if (!user?.active) throw Error('Compte actif introuvable.');
    await store.run('UPDATE users SET password=? WHERE id=?',passwordHash(password),user.id);
    await store.run('DELETE FROM sessions WHERE user_id=?',user.id);
    await store.audit(user,'user',user.id,'server-password-reset',null,{sessionsRevoked:true});
    await store.run("UPDATE meta SET value=value+1 WHERE key='revision'");
  });
  console.log('Mot de passe modifié. Toutes les sessions de ce compte sont révoquées.');
} finally { await store.close(); }
