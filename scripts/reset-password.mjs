// Recovery by a server administrator. Read the password from stdin, never argv.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openStore, passwordHash } from '../server/store.mjs';
import { secret } from '../server/auth.mjs';
const username = process.argv[2]?.trim().toLowerCase();
if (!username) throw Error('Usage : node scripts/reset-password.mjs IDENTIFIANT (mot de passe sur stdin)');
const password = secret(readFileSync(0,'utf8').replace(/\r?\n$/, ''), true);
const store = openStore(join(process.env.DATA_DIR || 'data', 'teknika.sqlite'));
try {
  const user = store.one('SELECT * FROM users WHERE username=? AND active=1',username);
  if (!user) throw Error('Compte actif introuvable.');
  store.db.exec('BEGIN IMMEDIATE');
  store.run('UPDATE users SET password=? WHERE id=?',passwordHash(password),user.id);
  store.run('DELETE FROM sessions WHERE user_id=?',user.id);
  store.audit(user,'user',user.id,'server-password-reset',null,{sessionsRevoked:true});
  store.run("UPDATE meta SET value=value+1 WHERE key='revision'");
  store.db.exec('COMMIT');
  console.log('Mot de passe modifié. Toutes les sessions de ce compte sont révoquées.');
} finally { store.db.close(); }
