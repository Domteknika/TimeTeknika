// Native integration test. All HTTPS is intercepted with synthetic fixtures;
// no production request or real working-time entry is made.
const {app,session,BrowserWindow,Menu,globalShortcut,safeStorage}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {ORIGIN,PROFILES,taskKeys}=require('../policy.cjs');
const output=path.resolve(__dirname,'../../.qa/desktop-smoke');
app.setPath('userData',path.join(output,'profile'));
app.setPath('sessionData',path.join(output,'session'));
process.argv.push('--background');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let n=0;n<80;n++){if(await check())return;await pause(100);}throw Error('Native test timeout');}
let active=null,writes=0,cookiesSeen=false;
app.whenReady().then(async()=>{
  await fs.mkdir(output,{recursive:true});
  await fs.mkdir(path.join(output,'profile'),{recursive:true});
  await fs.writeFile(path.join(output,'profile/desktop-settings.json'),JSON.stringify({shortcutProfile:1}));
  await fs.writeFile(path.join(output,'profile/task-shortcuts.json'),JSON.stringify({version:1,accounts:[]}));
  BrowserWindow.prototype.show=function(){}; // Keep every synthetic test window hidden.
  const ses=session.fromPartition('timeteknika-memory',{cache:false});
  assert.equal(ses.isPersistent(),false);
  await ses.protocol.handle('https',async request=>{
    const url=new URL(request.url);
    assert.equal(url.origin,ORIGIN);
    const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
    if(url.pathname==='/')return new Response('<!doctype html><title>TimeTeknika native test</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"><p>Fixture de test</p>',{headers:{'Content-Type':'text/html'}});
    if(url.pathname==='/api/state'){
      cookiesSeen=!!request.headers.get('cookie')?.includes('teknika_session=');
      return cookiesSeen?json({me:{id:'fixture',name:'Test Windows'},csrf:'fixture-csrf',entries:active?[active]:[],tasks:[{id:'t1',name:'Admin',project_id:'p1',assignees:['fixture']},{id:'t2',name:'Étude',project_id:'p1',assignees:['fixture']}],projects:[{id:'p1',name:'Projet test',color:'#729fd0'}],clients:[]}):json({message:'Login required'},401);
    }
    if(url.pathname==='/api/timer/start'||url.pathname==='/api/timer/stop'){
      assert.equal(request.headers.get('x-csrf-token'),'fixture-csrf');
      assert.equal(request.headers.get('origin'),ORIGIN);
      assert.ok(request.headers.get('idempotency-key'));
      const data=await request.json();
      writes++;
      if(url.pathname.endsWith('/start')){assert.equal(data.expectedRunningId,active?.id??null);active={id:'synthetic-'+writes,user_id:'fixture',task_id:data.task_id,end:null,version:1};return json({entry:active});}
      active=null;return json({entry:{end:123}});
    }
    return new Response('',{status:404});
  });
  // Synthetic session only. The application will encrypt this fixture cookie.
  await ses.cookies.set({url:ORIGIN,name:'teknika_session',value:'a'.repeat(64),path:'/',httpOnly:true,secure:true,sameSite:'strict',expirationDate:Date.now()/1000+3600});
  require('../main.cjs');
  await until(()=>BrowserWindow.getAllWindows()[0]?.webContents.getURL()===ORIGIN+'/');
  await until(()=>cookiesSeen);
  const win=BrowserWindow.getAllWindows()[0],prefs=win.webContents.getLastWebPreferences();
  assert.equal(win.isVisible(),false);assert.equal(prefs.nodeIntegration,false);assert.equal(prefs.contextIsolation,true);assert.equal(prefs.sandbox,true);
  assert.ok(globalShortcut.isRegistered(PROFILES[1].toggle));assert.ok(globalShortcut.isRegistered(PROFILES[1].show));
  const timerCommand=()=>Menu.getApplicationMenu().items[0].submenu.items[0].click();
  timerCommand();await until(()=>writes===1);assert.ok(active);
  await pause(1300);timerCommand();await until(()=>writes===2);assert.equal(active,null);
  for(const key of taskKeys(PROFILES[1]))assert.ok(globalShortcut.isRegistered(key));
  const shortcutsMenu=()=>Menu.getApplicationMenu().items.find(item=>item.label==='Raccourcis').submenu;
  shortcutsMenu().items[0].click();
  await until(()=>BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().endsWith('/shortcuts.html')));
  const settings=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/shortcuts.html'));
  await until(async()=>await settings.webContents.executeJavaScript('document.querySelectorAll(".slot").length===5'));
  const configResult=await settings.webContents.executeJavaScript('(async()=>{const r=await window.taskShortcuts.read();return window.taskShortcuts.save({userId:r.model.userId,revision:r.model.revision,slots:["t1","t2",null,null,null]});})()');
  assert.ok(configResult.ok);assert.equal(configResult.model.slots[1],'t2');
  await pause(1300);shortcutsMenu().items[2].click();await until(()=>writes===3);assert.equal(active.task_id,'t1');
  await pause(1300);shortcutsMenu().items[2].click();await pause(250);assert.equal(writes,3);
  await pause(1300);shortcutsMenu().items[3].click();await until(()=>writes===4);assert.equal(active.task_id,'t2');
  settings.destroy();
  win.close();assert.equal(win.isDestroyed(),false);assert.equal(win.isVisible(),false);
  await ses.cookies.set({url:ORIGIN,name:'teknika_session',value:'b'.repeat(64),path:'/',httpOnly:true,secure:true,sameSite:'strict',expirationDate:Date.now()/1000+3600});
  await until(async()=>{try{return !!await fs.stat(path.join(output,'profile/session.enc'));}catch{return false;}});
  const encrypted=await fs.readFile(path.join(output,'profile/session.enc'));
  assert.ok(!encrypted.includes(Buffer.from('b'.repeat(64))));
  const {result}=await safeStorage.decryptStringAsync(encrypted);assert.equal(JSON.parse(result).value,'b'.repeat(64));
  await ses.cookies.remove(ORIGIN,'teknika_session');
  await until(async()=>{try{await fs.stat(path.join(output,'profile/session.enc'));return false;}catch{return true;}});
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify({ok:true,electron:process.versions.electron,checks:['seven native shortcuts registered','five-slot settings rendered','settings saved through isolated IPC','atomic task switch and same-task continuity','background window','sandbox and isolation','session cookie sent by native fetch','start and stop through native menus','close keeps background alive','Windows encrypted technical cookie','logout removes saved cookie'],productionRequests:0},null,2));
  globalShortcut.unregisterAll();win.destroy();app.exit(0);
}).catch(async error=>{
  await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'result.json'),JSON.stringify({ok:false,error:error.stack},null,2));globalShortcut.unregisterAll();app.exit(1);
});
setTimeout(async()=>{await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'result.json'),JSON.stringify({ok:false,error:'Test timeout'}));app.exit(1);},30000).unref();
