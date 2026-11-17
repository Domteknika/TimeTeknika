const ORIGIN='https://timeteknika.domteknika.ch';
const PROFILES=[
  {label:'Ctrl + Maj · F1–F5, F9, F10',toggle:'Control+Shift+F9',show:'Control+Shift+F10'},
  {label:'Ctrl + Alt · F1–F5, F9, F10',toggle:'Control+Alt+F9',show:'Control+Alt+F10'}
];
function sameOrigin(value,origin=ORIGIN){try{const u=new URL(value);return u.origin===origin&&!u.username&&!u.password;}catch{return false;}}
function sessionCookie(cookie,origin=ORIGIN,now=Date.now()){
  if(!cookie||cookie.name!=='teknika_session'||cookie.domain!==new URL(origin).hostname||cookie.path!=='/'||!cookie.httpOnly||!cookie.secure||!/^[a-f0-9]{64}$/.test(cookie.value)||!Number.isFinite(cookie.expirationDate)||cookie.expirationDate*1000<=now)return null;
  return {url:origin,name:'teknika_session',value:cookie.value,path:'/',httpOnly:true,secure:true,sameSite:'strict',expirationDate:cookie.expirationDate};
}
function registerProfile(shortcuts,profile,actions){
  shortcuts.unregisterAll();
  try{
    if(shortcuts.register(profile.toggle,actions.toggle)&&shortcuts.register(profile.show,actions.show)){
      if(!actions.tasks||taskKeys(profile).every((key,i)=>shortcuts.register(key,()=>actions.tasks(i))))return true;
    }
  }catch{}
  shortcuts.unregisterAll();return false;
}
function taskKeys(profile){const prefix=profile.toggle.slice(0,profile.toggle.lastIndexOf('+')+1);return Array.from({length:5},(_,i)=>prefix+'F'+(i+1));}
module.exports={ORIGIN,PROFILES,sameOrigin,sessionCookie,registerProfile,taskKeys};
