const {app,BrowserWindow,Menu,Tray,nativeImage,globalShortcut,Notification,dialog,session,ipcMain,safeStorage,powerMonitor}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const {TimerClient}=require('./timer-client.cjs');
const {ORIGIN,PROFILES,sameOrigin,sessionCookie,registerProfile,taskKeys}=require('./policy.cjs');
const {TaskShortcuts,availableTasks}=require('./task-shortcuts.cjs');
const {pathToFileURL}=require('node:url');

const APP_ID=app.isPackaged?'ch.domteknika.timeteknika':'ch.domteknika.timeteknika.development';
app.setAppUserModelId(APP_ID);
app.commandLine.appendSwitch('disable-http-cache');
// An ephemeral Chromium session prevents business data being cached on disk.
// Only the technical login cookie is explicitly saved, protected by Windows.
let win,tray,ses,client,quitting=false,status='unknown',syncing=null,syncTimer,profileIndex=0,registered=false;
let cookieWrites=Promise.resolve(),lastToggle=0;
let shortcuts,settingsWindow,accountState=null,shortcutsError='';
const assets=name=>path.join(__dirname,'assets',name);
const userFile=name=>path.join(app.getPath('userData'),name);
const statusText=()=>({active:'Chrono en cours',idle:'Chrono arrêté',unknown:'Connexion à vérifier','signed-out':'Connexion requise'})[status];

function show(){if(!win||win.isDestroyed())return;if(win.isMinimized())win.restore();win.show();win.focus();}
function notice(title,body){
  if(!app.isPackaged){console.info(title+': '+body);return;}
  if(Notification.isSupported())new Notification({title,body,icon:assets(status==='active'?'active.png':'app.png')}).on('click',show).show();
  else tray?.displayBalloon({title,content:body});
}
function updateStatus(next){
  status=next;if(next==='signed-out'){accountState=null;settingsWindow?.close();}
  if(!tray)return;
  const image=nativeImage.createFromPath(assets(next==='active'?'active.png':next==='idle'?'idle.png':'unknown.png'));
  tray.setImage(image.resize({width:20,height:20}));tray.setToolTip('TimeTeknika — '+statusText());
  win?.setIcon(image);updateMenus();
}
function queueCookieSave(){
  cookieWrites=cookieWrites.then(async()=>{
    const cookies=await ses.cookies.get({url:ORIGIN,name:'teknika_session'});
    const cookie=sessionCookie(cookies[0]);
    if(!cookie){await fs.rm(userFile('session.enc'),{force:true});return;}
    if(!await safeStorage.isAsyncEncryptionAvailable())throw Error('Chiffrement indisponible');
    // Store only this HttpOnly cookie, never the password or application data.
    const bytes=await safeStorage.encryptStringAsync(JSON.stringify(cookie));
    await fs.mkdir(app.getPath('userData'),{recursive:true});
    await fs.writeFile(userFile('session.enc.tmp'),bytes);
    await fs.rename(userFile('session.enc.tmp'),userFile('session.enc'));
  }).catch(()=>notice('Connexion non mémorisée','Vous devrez vous reconnecter au prochain lancement. Votre session actuelle reste utilisable.'));
}
async function restoreCookie(){
  try{
    const bytes=await fs.readFile(userFile('session.enc'));
    const {result}=await safeStorage.decryptStringAsync(bytes);
    const saved=JSON.parse(result);
    const cookie=sessionCookie({...saved,domain:new URL(ORIGIN).hostname});
    if(cookie)await ses.cookies.set(cookie);
    else await fs.rm(userFile('session.enc'),{force:true});
  }catch(error){if(error.code!=='ENOENT')await fs.rm(userFile('session.enc'),{force:true}).catch(()=>{});}
}
async function syncState(){
  if(!client||client.busy||quitting)return;
  if(syncing)return syncing;
  syncing=client.state().catch(error=>updateStatus(error.status===401?'signed-out':'unknown')).finally(()=>{syncing=null;});
  return syncing;
}
function toggle(){return timerCommand();}
function taskShortcut(index){return timerCommand(index);}
async function timerCommand(slot=null){
  if(!client||client.busy||Date.now()-lastToggle<1200)return;
  lastToggle=Date.now();
  try{
    if(syncing)await syncing;
    const result=slot===null?await client.toggle():await client.startTask(state=>shortcuts.get(state.me.id).slots[slot]);
    if(result.ignored)return;
    notice('TimeTeknika',result.action==='task-started'?`Chrono démarré · ${result.taskName}`:result.action==='already-running'?`Le chrono continue · ${result.taskName}`:result.action==='started'?'Chrono démarré · entrée à classer.':'Chrono arrêté · temps enregistré sur le serveur.');
    await syncState();
  }catch(error){
    notice('Action non confirmée',error.status===0&&client.pending?'La confirmation n’a pas été reçue. Réessayez le raccourci pour vérifier la même action, sans doublon.':error.message);
    if(error.status===401)show();
    else if(error.status>=400){await syncState();if(slot!==null&&error.status===400)openShortcutSettings();}
  }
}
async function chooseProfile(index,save=true){
  const previous=profileIndex;
  if(registerProfile(globalShortcut,PROFILES[index],{toggle,show,tasks:taskShortcut})){
    profileIndex=index;registered=true;
    if(save)try{await fs.writeFile(userFile('desktop-settings.json'),JSON.stringify({shortcutProfile:index}));}catch{notice('Préférence non enregistrée','Le choix sera à refaire au prochain lancement.');}
  }else{
    registered=registerProfile(globalShortcut,PROFILES[previous],{toggle,show,tasks:taskShortcut});
    notice('Raccourci indisponible','Une autre application utilise cette combinaison. Choisissez l’autre combinaison dans le menu Raccourcis.');
  }
  updateMenus();
  if(settingsWindow&&!settingsWindow.isDestroyed())settingsWindow.webContents.send('task-shortcuts-keys',taskKeys(PROFILES[profileIndex]));
}
async function loadServer(){
  try{await win.loadURL(ORIGIN+'/');}catch{if(!win.isDestroyed()){await win.loadFile(assets('offline.html')).catch(()=>{});updateStatus('unknown');}}
}
function startupItem(){return {label:'Lancer avec Windows',type:'checkbox',checked:app.getLoginItemSettings().openAtLogin,enabled:app.isPackaged,click:item=>{app.setLoginItemSettings({openAtLogin:item.checked,path:process.execPath,args:['--background']});updateMenus();}};}
function profileItems(){return PROFILES.map((p,i)=>({label:p.label,type:'radio',checked:registered&&profileIndex===i,click:()=>chooseProfile(i)}));}
function shortcutItems(){
  const slots=accountState?shortcuts.get(accountState.me.id).slots:Array(5).fill(null);
  const tasks=accountState?availableTasks(accountState):[];
  return [{label:'Configurer les 5 tâches…',click:openShortcutSettings},{type:'separator'},...slots.map((id,index)=>({
    label:('F'+(index+1)+' · '+(tasks.find(t=>t.id===id)?.name||(id?'Tâche indisponible':'Non affecté'))).replaceAll('&','&&'),
    click:()=>taskShortcut(index),enabled:!!accountState
  })),{type:'separator'},...profileItems()];
}
function settingsModel(state){return {userId:state.me.id,userName:state.me.name,...shortcuts.get(state.me.id),tasks:availableTasks(state),keys:taskKeys(PROFILES[profileIndex])};}
async function openShortcutSettings(){
  if(settingsWindow&&!settingsWindow.isDestroyed()){settingsWindow.show();settingsWindow.focus();return;}
  try{
    if(shortcutsError)throw Error(shortcutsError);
    await client.state();
    if(settingsWindow&&!settingsWindow.isDestroyed()){settingsWindow.focus();return;}
    settingsWindow=new BrowserWindow({title:'Mes raccourcis — TimeTeknika',width:820,height:790,minWidth:720,minHeight:650,show:false,icon:assets('app.png'),backgroundColor:'#faf8f8',
      webPreferences:{partition:'timeteknika-settings-memory',preload:path.join(__dirname,'settings-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,devTools:!app.isPackaged}});
    settingsWindow.setMenu(null);settingsWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    settingsWindow.webContents.on('will-navigate',event=>event.preventDefault());
    settingsWindow.webContents.session.setPermissionRequestHandler((_c,_p,callback)=>callback(false));
    settingsWindow.on('closed',()=>{settingsWindow=null;});
    await settingsWindow.loadFile(assets('shortcuts.html'));settingsWindow.show();
  }catch(error){notice('Configuration des raccourcis',error.message);if(error.status===401)show();}
}
function bindShortcutSettings(){
  const authorized=event=>settingsWindow&&!settingsWindow.isDestroyed()&&event.sender===settingsWindow.webContents&&event.senderFrame===settingsWindow.webContents.mainFrame&&event.senderFrame.url===pathToFileURL(assets('shortcuts.html')).href;
  ipcMain.handle('task-shortcuts-read',async event=>{
    if(!authorized(event))return {ok:false,error:'Accès refusé.'};
    try{if(shortcutsError)throw Error(shortcutsError);const {state}=await client.state();return {ok:true,model:settingsModel(state)};}catch(error){return {ok:false,error:error.message};}
  });
  ipcMain.handle('task-shortcuts-save',async(event,payload)=>{
    if(!authorized(event))return {ok:false,error:'Accès refusé.'};
    try{
      if(shortcutsError)throw Error(shortcutsError);
      const {state}=await client.state();
      if(!payload||payload.userId!==state.me.id)throw Error('Le compte connecté a changé. Actualisez la configuration.');
      await shortcuts.save(state,payload.slots,payload.revision);updateMenus();return {ok:true,model:settingsModel(state)};
    }catch(error){return {ok:false,error:error.message};}
  });
}
function updateMenus(){
  if(!win||!tray)return;
  const toggleItem=()=>({label:status==='active'?'Arrêter le chrono':'Démarrer / arrêter le chrono',click:toggle});
  const help=()=>dialog.showMessageBox(win,{type:'info',title:'TimeTeknika pour Windows',message:`TimeTeknika · ${app.getVersion()}`,detail:
    `Ctrl + ${profileIndex===0?'Maj':'Alt'} + F9 : démarrer / arrêter\nCtrl + ${profileIndex===0?'Maj':'Alt'} + F10 : afficher la fenêtre\n\nF1 à F5 avec les mêmes touches : démarrer une tâche affectée via Raccourcis → Configurer les 5 tâches.\nF9 sans chrono en cours crée une entrée « À classer ».\nFermer la fenêtre laisse les raccourcis actifs près de l’horloge. Quitter l’application ne coupe pas votre chrono.\n\nLes raccourcis nécessitent une session Windows ouverte, cette application lancée et une connexion au serveur.\n\nServeur : ${ORIGIN}\nLes données métier restent sur le serveur. Le cookie de connexion est chiffré par Windows. Les affectations des raccourcis sont conservées dans un fichier local, par compte.`});
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:statusText(),enabled:false},{type:'separator'},{label:'Ouvrir TimeTeknika',click:show},toggleItem(),
    {label:'Raccourcis',submenu:shortcutItems()},startupItem(),{label:'Aide',click:help},
    {type:'separator'},{label:'Quitter TimeTeknika',click:()=>app.quit()}
  ]));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'TimeTeknika',submenu:[toggleItem(),{label:'Recharger la connexion',accelerator:'Control+R',click:loadServer},startupItem(),{type:'separator'},{label:'Quitter',click:()=>app.quit()}]},
    {label:'Édition',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'Affichage',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]},
    {label:'Raccourcis',submenu:shortcutItems()},{label:'Aide',submenu:[{label:'Utiliser TimeTeknika',click:help}]}
  ]));
}

async function start(){
  shortcuts=new TaskShortcuts(userFile('task-shortcuts.json'));
  try{await shortcuts.load();}catch(error){shortcutsError=error.message;notice('Raccourcis',shortcutsError);}
  ses=session.fromPartition('timeteknika-memory',{cache:false});
  ses.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  ses.setPermissionCheckHandler(()=>false);
  ses.on('will-download',(_event,item,contents)=>{
    if(contents!==win?.webContents){item.cancel();return;}
    item.setSaveDialogOptions({title:'Enregistrer l’export TimeTeknika'});
  });
  await restoreCookie();
  client=new TimerClient({origin:ORIGIN,request:async(url,options)=>{
    if(!sameOrigin(url))throw Error('Origine refusée');
    // Main-process requests have no renderer site context for SameSite=Strict.
    // Attach only our validated HttpOnly session, to our exact HTTPS origin.
    const cookie=sessionCookie((await ses.cookies.get({url:ORIGIN,name:'teknika_session'}))[0]);
    return ses.fetch(url,{...options,headers:{...options.headers,...(cookie?{Cookie:`teknika_session=${cookie.value}`}:{})}});
  },onState:updateStatus,onSnapshot:state=>{if(accountState&&accountState.me.id!==state.me.id)settingsWindow?.close();accountState=state;}});
  bindShortcutSettings();
  ses.cookies.on('changed',(_event,cookie)=>{if(cookie.name==='teknika_session'&&cookie.domain===new URL(ORIGIN).hostname){queueCookieSave();syncState();}});
  try{const settings=JSON.parse(await fs.readFile(userFile('desktop-settings.json'),'utf8'));if(Number.isInteger(settings.shortcutProfile)&&PROFILES[settings.shortcutProfile])profileIndex=settings.shortcutProfile;}catch{}
  win=new BrowserWindow({title:'TimeTeknika',width:1440,height:960,minWidth:800,minHeight:600,show:false,backgroundColor:'#faf9f9',icon:assets('app.png'),
    webPreferences:{session:ses,preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,backgroundThrottling:false,spellcheck:false,devTools:!app.isPackaged}});
  // Windows Explorer cannot read an icon inside app.asar. Give the taskbar
  // an actual .ico file, with the same identity as the installed shortcuts.
  if(process.platform==='win32')win.setAppDetails({appId:APP_ID,
    appIconPath:app.isPackaged?path.join(process.resourcesPath,'timeteknika.ico'):assets('app.ico'),appIconIndex:0,
    relaunchCommand:app.isPackaged?`"${process.execPath}"`:`"${process.execPath}" "${app.getAppPath()}"`,
    relaunchDisplayName:'TimeTeknika'});
  win.on('close',event=>{if(!quitting){event.preventDefault();win.hide();}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(!sameOrigin(url))event.preventDefault();});
  win.webContents.on('will-redirect',(event,url)=>{if(!sameOrigin(url))event.preventDefault();});
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  win.webContents.on('render-process-gone',()=>{updateStatus('unknown');notice('Fenêtre interrompue','Rechargez la connexion depuis le menu TimeTeknika. Le chrono enregistré sur le serveur continue.');});
  ipcMain.on('timer-state-changed',event=>{if(event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame&&sameOrigin(event.senderFrame.url))syncState();});
  tray=new Tray(nativeImage.createFromPath(assets('idle.png')).resize({width:20,height:20}));
  tray.on('click',show);tray.on('double-click',show);updateStatus('unknown');
  await chooseProfile(profileIndex,false);
  if(!process.argv.includes('--background'))show();
  await loadServer();await syncState();
  syncTimer=setInterval(syncState,15000);
  powerMonitor.on('resume',()=>{syncState();if(!sameOrigin(win.webContents.getURL()))loadServer();});
  powerMonitor.on('unlock-screen',syncState);
}

if(!app.requestSingleInstanceLock())app.quit();
else{
  app.on('second-instance',show);
  app.whenReady().then(start).catch(error=>{dialog.showErrorBox('TimeTeknika ne peut pas démarrer',error.message);app.quit();});
  app.on('window-all-closed',()=>{});
  app.on('before-quit',()=>{quitting=true;clearInterval(syncTimer);globalShortcut.unregisterAll();});
}
