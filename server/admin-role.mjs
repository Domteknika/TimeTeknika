import { loginName } from './auth.mjs';

// Explicit deployment input only: never infer an administrator from a name or ID.
export async function initializeAdministrator(store, username) {
  if (!username) return false;
  return store.transaction(async()=>{
    const existing=(await store.one('SELECT COUNT(*) n FROM user_admins')).n;
    if(existing) {
      if(!await store.one('SELECT 1 FROM user_admins a JOIN users u ON u.id=a.user_id WHERE u.active=true'))throw Error('Aucun administrateur actif. Intervention de récupération nécessaire.');
      return false;
    }
    const normalized=loginName({username});
    const user=await store.findUserByUsername(normalized);
    if(!user||!user.active||user.role!=='manager')throw Error('Le compte initial doit être un responsable existant et actif.');
    await store.run('INSERT INTO user_admins(user_id) VALUES (?)',user.id);
    await store.log({category:'system',action:'administrator-initialized',actor:user.id,entity:'user',entity_id:user.id,details:{previousRole:'manager',role:'admin'}});
    return true;
  });
}
