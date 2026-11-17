import { loginName } from './auth.mjs';
import { journalTransaction } from './journal.mjs';

// Explicit deployment input only: never infer an administrator from a name or ID.
export function initializeAdministrator(store, username) {
  if (!username) return false;
  const existing=store.one('SELECT COUNT(*) n FROM user_admins').n;
  if(existing) {
    if(!store.one('SELECT 1 FROM user_admins a JOIN users u ON u.id=a.user_id WHERE u.active=1'))throw Error('Aucun administrateur actif. Intervention de récupération nécessaire.');
    return false;
  }
  const normalized=loginName({username});
  const user=store.one('SELECT * FROM users WHERE username=? AND active=1',normalized);
  if(!user||user.role!=='manager')throw Error('Le compte initial doit être un responsable existant et actif.');
  journalTransaction(store.db,()=>{
    store.run('INSERT INTO user_admins(user_id) VALUES (?)',user.id);
    store.log({category:'system',action:'administrator-initialized',actor:user.id,entity:'user',entity_id:user.id,details:{previousRole:'manager',role:'admin'}});
  });
  return true;
}
