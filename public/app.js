import { isoWeek, CALENDAR_ZOOMS, fitCalendarScale, layoutCalendarEntries, calendarSelection, calendarWallTime, calendarDayTotals, weeklyProgress, cumulativeProgress, longRunningEntry } from './calendar-utils.js';
import { REPORT_CHARTS, renderReportChart } from './report-charts.js';
import { enhanceSelects } from './rich-select.js';
import { projectColorOptions } from './project-colors.js';
import { APP_VERSION } from './release.js';
import { taskProjectGroups, compareTaskProjects, normalizeTaskSearch, workCatalog, sortWorkRows, filterTaskCatalog, filterProjectCatalog } from './task-projects.js';
import { startExportBuilder, stopExportBuilder, renderExportBuilder, bindExportBuilder } from './export-builder.js';
const $ = (s,root=document)=>root.querySelector(s);
const $$ = (s,root=document)=>[...root.querySelectorAll(s)];
const esc = value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={clock:'M12 8v4l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',box:'m3 7 9-4 9 4-9 4-9-4 M3 7v10l9 4 9-4V7 M12 11v10',task:'M9 5h11M9 12h11M9 19h11M3 5l1 1 2-2M3 12l1 1 2-2M3 19l1 1 2-2',folder:'M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11H3V7',people:'M16 21v-3a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v3M14 4a4 4 0 0 1 0 8M20 21v-3a4 4 0 0 0-3-4 M14 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0',chart:'M4 4v16h17M8 16v-5M13 16V6M18 16v-8',settings:'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',plus:'M12 5v14M5 12h14',play:'m8 5 10 7-10 7Z',stop:'M6 6h12v12H6Z',chevron:'m9 5 7 7-7 7',left:'m15 5-7 7 7 7',down:'m6 9 6 6 6-6',edit:'m4 15-1 6 6-1L21 8l-5-5L4 15 M13 6l5 5',close:'m6 6 12 12M6 18 18 6',list:'M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1',calendar:'M4 5h16v16H4V5 M8 3v4M16 3v4M4 10h16',search:'M15 15l6 6 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',arrow:'M4 12h16m-6-6 6 6-6 6',check:'m5 12 4 4L19 6',spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',logout:'M9 4H4v16h5M10 12h11m-4-4 4 4-4 4',history:'M3 11a9 9 0 1 1 1 5M3 4v7h7M12 7v6l3 2',trash:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7'};
paths.pin='m16 3 5 5-4 1-3 5 1 3-2 2-4-4-6 6 6-6-4-4 2-2 3 1 5-3 1-4Z';
const icon = name=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.box}"/></svg>`;
const button = (action,label,ico='',cls='',id='')=>`<button class="btn ${cls}" data-action="${action}"${id?` data-id="${esc(id)}"`:''}>${ico?icon(ico):''}${esc(label)}</button>`;
const ib = (action,label,ico,id='')=>`<button class="icon-button" data-action="${action}" data-id="${esc(id)}" aria-label="${esc(label)}" title="${esc(label)}">${icon(ico)}</button>`;
let state=null, info=null, stream=null, connected=false, offset=0, page='timer', timerView='list', taskScope='mine';
let timerDraft={description:'',task_id:'',project_id:''}, weekOffset=0, filters=null, reportData=null, reportTicket=0, toastTimer, refreshing=false, again=false, timerBusy=false;
const defaultCatalogFilters=kind=>({query:'',client:'',project:'',status:kind==='projects'?'active':'',time:'',sort:'name-asc'});
let catalogFilters={tasks:defaultCatalogFilters('tasks'),projects:defaultCatalogFilters('projects')};
let calendarDrag=null, calendarRenderPending=false, calendarPreferenceBusy=false, weeklyGoalDraft=null;
let reportChartBusy=false;
let fittedCalendarScale=null,calendarResizeObserver=null,calendarFitFrame=0;
let notifiedLongTimer=null;
let renderedDate='';
let balanceStartDraft=null;
let dialogRefresh=null;
const taskProjectPending=new Map();
const dialog=$('#dialog');
const now=()=>Date.now()+offset;
const dateKey=(ms=now())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).format(ms);
const shiftDate=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const week=(offset=weekOffset)=>{const today=dateKey(), dow=new Date(today+'T12:00:00Z').getUTCDay();const start=shiftDate(today,-((dow+6)%7)+offset*7);return Array.from({length:7},(_,i)=>shiftDate(start,i));};
const calendarDays=()=>week().slice(0,state.me.preferences.calendarDays===5?5:7);
const calendarZoom=()=>CALENDAR_ZOOMS.includes(state.me.preferences.calendarZoom)?state.me.preferences.calendarZoom:100;
const calendarRange=()=>['workday','extended'].includes(state.me.preferences.calendarRange)?state.me.preferences.calendarRange:'full';
const calendarFit=()=>state.me.preferences.calendarFit!==false;
const prettyDate=(date,options={day:'numeric',month:'long'})=>new Intl.DateTimeFormat('fr-CH',{timeZone:'Europe/Zurich',...options}).format(typeof date==='string'?new Date(date+'T12:00:00Z'):date);
const time=ms=>new Intl.DateTimeFormat('fr-CH',{timeZone:'Europe/Zurich',hour:'2-digit',minute:'2-digit'}).format(ms);
const duration=(s,secs=false)=>{s=Math.max(0,Math.floor(s));return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s/60)%60).padStart(2,'0')}${secs?':'+String(s%60).padStart(2,'0'):''}`;};
const hours=s=>`${Math.floor(s/3600)}<span> h </span>${String(Math.floor(s/60)%60).padStart(2,'0')}<span> min</span>`;
const elapsed=(e,timestamp=now())=>Math.max(0,Math.floor(((e.end??timestamp)-e.start)/1000));
const own=()=>state.entries.filter(e=>e.user_id===state.me.id);
const running=()=>own().find(e=>e.end===null);
function updateTimerFavicon(){
  const link=$('link[rel="icon"]');
  const active=!!(state&&running()),status=active?'active':'idle';
  if(!link||link.dataset.timerStatus===status)return;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="${active?'#c65b65':'#a7a3aa'}"/><path d="M18 20h28v8H36v20h-8V28H18z" fill="white"/>${active?'<path d="m43 38 9 6-9 6z" fill="white"/>':'<circle cx="46" cy="44" r="5" fill="white"/>'}</svg>`;
  link.href='data:image/svg+xml,'+encodeURIComponent(svg);
  link.dataset.timerStatus=status;
  link.title=active?'Chrono en cours':'Chrono arrêté';
}
const get=(list,id)=>state[list].find(x=>x.id===id);
const refs=e=>{const project=get('projects',e.project_id),task=get('tasks',e.task_id);return {project,task,client:get('clients',project?.client_id)};};
const initials=name=>name.split(' ').filter(Boolean).slice(0,2).map(x=>x[0]).join('');
const avatar=user=>user?`<span class="avatar" style="background:${esc(user.color)}18;color:${esc(user.color)}" title="${esc(user.name)}">${esc(initials(user.name))}</span>`:'';
const avatars=ids=>`<div class="avatar-stack">${ids.map(id=>avatar(get('users',id))).join('')}</div>`;
const status=t=>`<span class="status ${t.status}"><i class="dot"></i>${{todo:'À faire',doing:'En cours',done:'Terminée'}[t.status]}</span>`;
const options=(list,selected,blank='Sélectionner…')=>`<option value="">${esc(blank)}</option>${list.map(x=>`<option value="${esc(x.id)}"${x.id===selected?' selected':''}>${esc(x.name)}</option>`).join('')}`;
function decorateSelects(root=document){
  enhanceSelects(root,select=>{
    const kind=select.dataset.selectKind||(select.id==='reminder-hour'?'hour':select.id==='entry-new-task-project'?'project':select.name.replace(/_id$/,''));
    const clientColor=id=>{const palette=['#9676c4','#ba815d','#5b9289','#648bbb','#bc718b','#9c884e'];return palette[[...id].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0)%palette.length];};
    return {kind,icon,compact:!!select.closest('.filters, .catalog-filters, .export-builder'),searchable:['client','project','task','person','hour'].includes(kind),
      heading:{client:'Les clients',project:'Les projets',task:'Les tâches',person:'Les personnes',color:'La couleur du projet',status:'L’avancement de la tâche',role:'Le rôle dans l’équipe',group:'Organiser le rapport',unclassified:'Le classement des temps',hour:'L’heure du rappel',sort:'Trier les résultats',spent:'Temps enregistré',availability:'Afficher les projets'}[kind],
      placeholder:{client:'Rechercher un client…',project:'Rechercher un projet ou un client…',task:'Rechercher une tâche ou un projet…',person:'Rechercher une personne…',hour:'Rechercher une heure…'}[kind],
      option:(value,label)=>{
        if(kind==='client'){const c=get('clients',value),projects=state.projects.filter(p=>p.client_id===value);return c?{label:c.name,initials:initials(c.name),color:clientColor(c.id),subtitle:`${projects.length} projet${projects.length>1?'s':''}`,swatches:projects.slice(0,4).map(p=>p.color)}:{label:select.required?'Choisir un client':label,icon:'people',subtitle:select.required?'Associer le projet à un client':'Voir tous les clients'};}
        if(kind==='project'){const p=get('projects',value);return p?{label:p.name,icon:'folder',color:p.color,subtitle:get('clients',p.client_id)?.name||'Projet partagé'}:{label:select.required?'Choisir un projet':label,icon:'folder',subtitle:select.required?'Choisir où ranger cette tâche':'Voir tous les projets'};}
        if(kind==='task'){const t=get('tasks',value),p=get('projects',t?.project_id);return t?{label:t.name,icon:'task',color:p?.color,subtitle:`${p?.name||''} · ${{todo:'À faire',doing:'En cours',done:'Terminée'}[t.status]} · ${t.assignees.length} participants`}:{label,icon:'task',subtitle:'Voir toutes les tâches'};}
        if(kind==='person'){const u=get('users',value);return u?{label:u.name,initials:initials(u.name),color:u.color,subtitle:u.role==='manager'?'Responsable':'Membre de l’équipe'}:{label,icon:'people',subtitle:'Les contributions de toute l’équipe'};}
        if(kind==='color')return {label,color:value};
        if(kind==='status')return {label,color:{todo:'#9e8eaf',doing:'#c09852',done:'#6a9f8e'}[value],icon:value==='done'?'check':value==='doing'?'clock':'task',subtitle:{todo:'Prête à démarrer',doing:'Le travail est en cours',done:'Le travail est terminé'}[value]};
        if(kind==='role')return {label:value==='manager'?'Responsable':'Membre',icon:'people',color:value==='manager'?'#9676c4':'#75a8a0',subtitle:value==='manager'?'Consulte les temps de toute l’équipe':'Consulte uniquement ses propres temps'};
        if(kind==='group')return {label,icon:{project:'folder',task:'task',client:'people',person:'people'}[value],subtitle:{project:'Comparer le temps consacré aux projets',task:'Suivre chaque tâche et ses contributions',client:'Regrouper les projets d’un même client',person:'Voir la contribution de chaque personne'}[value]};
        if(kind==='unclassified')return {label,icon:value?'box':'list',subtitle:value?'Seulement les entrées sans tâche':'Temps classés et temps à classer'};
        if(kind==='sort')return {label,icon:value.startsWith('time')?'clock':value.startsWith('client')?'people':value.startsWith('project')?'folder':value==='tasks-desc'?'task':'list'};
        if(kind==='spent')return {label,icon:'clock',subtitle:value==='tracked'?'Au moins une seconde enregistrée':value==='untracked'?'Aucune durée enregistrée':'Toutes les durées, chronos en cours inclus'};
        if(kind==='availability')return {label,icon:value==='archived'?'box':'folder',subtitle:value==='active'?'Les projets en activité':value==='archived'?'Les projets rangés dans les archives':'Les projets actifs et archivés'};
        if(kind==='export')return {label,icon:'list'};
        return {label,icon:'clock',subtitle:'Rappel quotidien · Europe/Zurich'};
      }};
  });
}
const empty=(title,sub='',action='')=>`<div class="empty">${icon('clock')}<strong>${esc(title)}</strong>${esc(sub)}${action}</div>`;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),5000);}
async function api(path,{method='GET',data,key=crypto.randomUUID()}={}){
  const headers={'Accept':'application/json'};if(data!==undefined)headers['Content-Type']='application/json';if(state?.csrf)headers['X-CSRF-Token']=state.csrf;if(method!=='GET')headers['Idempotency-Key']=key;
  let response;try{response=await fetch(path,{method,headers,body:data===undefined?undefined:JSON.stringify(data),cache:'no-store',credentials:'same-origin'});}catch{throw Object.assign(Error('Serveur injoignable. Vérifiez la connexion avant de réessayer.'),{network:true});}
  const result=await response.json();if(!response.ok){const error=Object.assign(Error(result.message),result,{status:response.status,message:result.message+(result.requestId?' Référence : '+result.requestId:'')});if(response.status===401&&state){signOutLocal();await showLogin();}throw error;}return result;
}
function signOutLocal(){stopExportBuilder(true);calendarResizeObserver?.disconnect();cancelAnimationFrame(calendarFitFrame);dialogRefresh=null;taskProjectPending.clear();balanceStartDraft=null;notifiedLongTimer=null;stream?.close();stream=null;state=null;updateTimerFavicon();connected=false;dialog.close();weeklyGoalDraft=null;timerDraft={description:'',task_id:'',project_id:''};reportData=null;}
async function refresh(){
  if(refreshing){again=true;return;}refreshing=true;
  try{do{again=false;const latest=await api('/api/state');if(!state||latest.me.id!==state.me.id){balanceStartDraft=null;weeklyGoalDraft=null;catalogFilters={tasks:defaultCatalogFilters('tasks'),projects:defaultCatalogFilters('projects')};state=latest;page=latest.me.preferences.page||'timer';timerView=latest.me.preferences.timerView||'list';taskScope=latest.me.preferences.taskScope||'mine';}else if(latest.revision>=state.revision)state=latest;offset=latest.serverNow-Date.now();render();}while(again);}finally{refreshing=false;}
}
function connect(){stream?.close();stream=new EventSource('/api/events');stream.addEventListener('connected',()=>{connected=true;refresh().catch(e=>toast(e.message));});stream.addEventListener('change',()=>refresh().catch(e=>toast(e.message)));stream.addEventListener('auth',async()=>{signOutLocal();await showLogin();});stream.onerror=()=>{connected=false;updateConnection();};}
function updateConnection(){const badge=$('#live');if(badge){badge.className='live'+(connected?'':' offline');badge.innerHTML=`<i class="dot"></i>${connected?'Synchronisé en direct':'Reconnexion…'}`;}const b=$('#connection-banner');if(b)b.classList.toggle('hidden',connected);}
async function write(path,method,data,{close=true,message='Modifications enregistrées.'}={}){
  const key=crypto.randomUUID();let result;
  try{result=await api(path,{method,data,key});}catch(e){if(e.network){try{result=await api(path,{method,data,key});}catch(second){if(second.network)second.message='Connexion interrompue : la confirmation n’a pas été reçue. Retrouvez l’état enregistré après reconnexion avant de recréer cette opération.';throw second;}}else{if(e.status===409)await refresh();throw e;}}
  if(close)dialog.close();await refresh();if(message)toast(message);return result;
}
async function preference(data){try{await write('/api/preferences','PATCH',data,{close:false,message:''});}catch(e){toast(e.message);}}
async function showLogin(){
  updateTimerFavicon();
  info=await api('/api/info');
  $('#app').innerHTML=`<div class="login"><section class="login-art"><div class="brand"><img src="/favicon.svg" alt="">TimeTeknika</div><div class="eyebrow">LE TEMPS EN ÉQUIPE</div><h1>Chaque minute.<br>Un projet commun.</h1><p>Un suivi simple pour vous.<br>Une vision claire pour toute l’équipe.</p><div class="orbit"></div></section><section class="login-form"><div class="login-inner"><h2>${info.setup?'Bienvenue chez vous.':info.demo?'Découvrez votre espace.':'Bon retour.'}</h2><p>${info.setup?'Créez le compte du premier responsable pour ouvrir votre espace.':info.demo?'Trois profils, des tâches partagées et quelques heures fictives pour explorer le prototype.':'Retrouvez vos tâches et reprenez le fil de votre journée.'}</p>${info.demo?info.demoUsers.map(u=>`<button class="demo-account" data-action="demo-login" data-id="${esc(u.id)}">${avatar(u)}<div><strong>${esc(u.name)}</strong><small>${u.role==='manager'?'Responsable · vue de toute l’équipe':'Membre · ses propres temps'}</small></div>${icon('arrow')}</button>`).join(''):''}<form id="login-form">${info.setup?'<label class="field">Votre nom<input name="name" autocomplete="name" required maxlength="100"></label>':''}<label class="field">Identifiant<input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="200" placeholder="ex. alex.martin"></label><label class="field">Mot de passe<input name="password" type="password" autocomplete="${info.setup?'new-password':'current-password'}" ${info.setup?'minlength="8"':''} required>${info.setup?'<small>8 caractères minimum.</small>':''}</label>${info.setup?'<label class="field">Jeton de configuration distante<input name="setupToken" type="password" autocomplete="off"><small>Laisser vide pour une installation sur cet ordinateur.</small></label>':''}<div class="form-error" role="alert"></div><button class="btn primary full" type="submit">${info.setup?'Créer mon espace':'Se connecter'}${icon('arrow')}</button></form><div class="note">${info.demo?'Démonstration locale · données fictives conservées sur cet ordinateur.':'Vos données sont conservées sur le serveur de votre entreprise.'}</div></div></section></div>`;
  $('#login-form')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,b=$('button',f);b.disabled=true;try{await api(info.setup?'/api/setup':'/api/login',{method:'POST',data:Object.fromEntries(new FormData(f))});await refresh();connect();}catch(error){$('.form-error',f).textContent=error.message;b.disabled=false;}});
}
const titles={timer:'Mon temps',unclassified:'À classer',tasks:'Mes tâches',projects:'Projets',clients:'Clients',reports:'Rapports',exports:'Exports',settings:'Mon profil'};
function render(){
  updateTimerFavicon();
  if(!state)return;
  if(timerDraft.task_id&&!get('tasks',timerDraft.task_id))timerDraft.task_id='';
  if(timerDraft.project_id&&!get('projects',timerDraft.project_id)){timerDraft.project_id='';timerDraft.task_id='';}
  if(calendarDrag){calendarRenderPending=true;return;}
  calendarResizeObserver?.disconnect();cancelAnimationFrame(calendarFitFrame);fittedCalendarScale=null;
  if(page==='exports'){const days=week();startExportBuilder(state,filters||{from:days[0],to:days[6]});}else stopExportBuilder();
  renderedDate=dateKey();
  const oldCalendar=$('.calendar-wrap'),oldGrid=$('.calendar'),reportScroll=$('.report-legend')?.scrollTop;
  const calendarPosition=oldCalendar&&oldGrid?{day:oldGrid.dataset.firstDay,hour:oldCalendar.scrollTop/Number(oldGrid.dataset.scale)+Number(oldGrid.dataset.minHour),left:oldCalendar.scrollLeft}:null;
  const focus=document.activeElement,focusId=focus?.id,sel=focus?.selectionStart;
  if(focusId==='timer-description')timerDraft.description=focus.value;
  const unclassified=own().filter(e=>!e.task_id).length;
  $('#app').innerHTML=`<div class="shell ${page==='timer'?'timer-workspace':''} ${page==='timer'&&timerView==='calendar'?'calendar-workspace':''}"><aside class="sidebar"><div class="brand"><img src="/favicon.svg" alt="">TimeTeknika<span>beta</span></div><div class="workspace"><b>T</b><div>Teknika<small>Espace de l’équipe</small></div></div><div class="nav-label">VOTRE QUOTIDIEN</div><nav class="nav" aria-label="Navigation principale">${[['timer','clock','Mon temps'],['unclassified','box','À classer'],['tasks','task','Mes tâches'],['projects','folder','Projets'],['clients','people','Clients'],['reports','chart','Rapports']].map(([p,i,t])=>`<button data-action="page" data-id="${p}" class="${page===p?'active':''}"${page===p?' aria-current="page"':''}>${icon(i)}${t}${p==='unclassified'&&unclassified?`<span class="count">${unclassified}</span>`:''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="team-tip"><div class="spark">${icon('spark')}</div><b>Le travail avance ensemble.</b><p>Une tâche partagée.<br>Le temps de chacun compte.</p></div><nav class="nav"><button data-action="page" data-id="settings" class="${page==='settings'?'active':''}">${icon('settings')}Mon profil</button></nav><button class="profile" data-action="account">${avatar(state.me)}<div><strong>${esc(state.me.name)}</strong><small>${['manager','admin'].includes(state.me.role)?'Responsable':'Membre de l’équipe'}</small></div>${icon('down')}</button></div></aside><main class="main"><header class="topbar"><div class="breadcrumbs">Espace de travail <span>/</span> <b>${titles[page]}</b></div><div class="top-right"><span>${prettyDate(now(),{weekday:'long',day:'numeric',month:'long'})}</span>${running()&&page!=='timer'&&page!=='unclassified'?`<div class="running-nav"><button data-action="page" data-id="timer" title="Revenir au chrono">${icon('clock')}<span data-live-entry="${running().id}">${duration(elapsed(running()),true)}</span></button>${ib('timer-stop','Arrêter le chrono','stop')}</div>`:''}${state.demo?'<span class="demo-label">DÉMONSTRATION</span>':''}<span id="live"></span>${ib('account','Mon compte','people')}</div></header><div id="connection-banner" class="connection-banner hidden">La connexion au serveur est interrompue. Un chrono déjà enregistré continue ; les modifications nécessitent une connexion.</div><div class="content" id="content"></div></main></div>`;
  const content=$('#content');content.classList.toggle('time-content',page==='timer'||page==='unclassified');content.innerHTML='<aside id="long-timer-alert" class="long-timer-alert" aria-label="Vérifier le chrono" hidden></aside>'+(page==='timer'||page==='unclassified'?timePage():page==='tasks'?tasksPage():page==='projects'?projectsPage():page==='clients'?clientsPage():page==='reports'?reportsPage():page==='exports'?heading('Exporter les temps.','Composez un relevé à votre image, prêt à joindre à une facture.',button('page','Retour aux rapports','left','','reports'))+renderExportBuilder(state,icon):settingsPage());
  if(page==='timer')$('.sidebar-bottom').append($('#live'));
  updateConnection();tick();bindPage();
  if(page==='exports')$('.nav [data-id="reports"]')?.classList.add('active');
  const newCalendar=$('.calendar-wrap'),newGrid=$('.calendar');
  if(newCalendar&&newGrid){newCalendar.scrollTop=Math.max(0,(calendarPosition?.day===newGrid.dataset.firstDay?calendarPosition.hour:7)-Number(newGrid.dataset.minHour))*Number(newGrid.dataset.scale);newCalendar.scrollLeft=calendarPosition?.left||0;}
  observeCalendarSize();
  if(focusId&&!dialog.open){const el=document.getElementById(focusId);if(el){el.focus();if(typeof sel==='number'&&el.setSelectionRange)el.setSelectionRange(sel,sel);}}
  if(page==='reports'){if($('.report-legend')&&reportScroll!==undefined)$('.report-legend').scrollTop=reportScroll;loadReport();}
  if(dialog.open)dialogRefresh?.();
}
function heading(title,sub,action='',eyebrow=''){return `<div class="page-heading"><div>${eyebrow?`<div class="eyebrow">${esc(eyebrow)}</div>`:''}<h1>${esc(title)}</h1><p>${esc(sub)}</p></div>${action}</div>`;}
function timerCard(){const active=running(),item=active||timerDraft,{task,project,client}=refs(item);return `<section class="timer-card ${active?'running':''}" aria-label="Chronomètre"><div class="timer-dot">${icon('clock')}</div><div class="timer-main"><input id="timer-description" aria-label="Description de votre activité" maxlength="2000" value="${esc(active?.description??timerDraft.description)}" placeholder="Sur quoi travaillez-vous ?" ${active?'readonly':''}><button class="task-pick" data-action="${active?'entry-edit':'timer-pick'}" data-id="${active?.id||''}">${icon('plus')}${task?esc(task.name):project?esc(project.name)+' · À classer':'Choisir une tâche ou classer plus tard'}${task?` <span class="muted">· ${esc(project?.name)} · ${esc(client?.name)}</span>`:''}${icon('down')}</button></div><div class="separator"></div><div class="timer-time" id="timer-clock">${duration(active?elapsed(active):0,true)}</div><button class="play-main" data-action="${active?'timer-stop':'timer-start'}" aria-label="${active?'Arrêter le chrono':'Démarrer le chrono'}"${timerBusy?' disabled':''}>${icon(active?'stop':'play')}</button></section>`;}
function metric(label,value,foot,ico='clock',extra=''){return `<div class="metric"><div class="metric-label">${icon(ico)}${label}</div><strong>${value}</strong><div class="metric-foot">${foot}</div>${extra}</div>`;}
function timePage(){
  const days=week(),entries=own(),from=zoneInstant(days[0]+'T00:00'),to=zoneInstant(shiftDate(days[6],1)+'T00:00');
  const current=entries.filter(e=>e.start<to&&(e.end??now())>=from),unclassified=entries.filter(e=>!e.task_id);
  const isTimer=page==='timer',list=isTimer?current:unclassified;
  const hour=Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Zurich',hour:'numeric',hourCycle:'h23'}).format(now()));
  const remind=unclassified.length&&hour>=(state.me.preferences.reminderHour??16);
  const classify=isTimer&&unclassified.length?`<button class="classify-chip ${remind?'needs-attention':''}" data-action="page" data-id="unclassified" title="${remind?'Rappel : ':''}${unclassified.length} entrées sans tâche à classer">${icon('box')}<b>${unclassified.length}</b> à classer${icon('chevron')}</button>`:'';
  return (isTimer?`<div class="time-work-header"><h1>Mon temps</h1>${timerCard()}${button('entry-new','Saisir du temps','plus')}</div>`:heading('À classer','Associez ces entrées à une tâche pour affiner vos rapports.',button('entry-new','Saisir du temps','plus'))+timerCard())+timeSummary()+`
    <div class="toolbar time-toolbar">
      <div class="period">${isTimer?`${ib('week-prev','Semaine précédente','left')}<strong>${prettyDate(days[0])} — ${prettyDate(days[6])}</strong>${ib('week-next','Semaine suivante','chevron')}<span class="week-number" title="Semaine ISO ${isoWeek(days[0]).number} · ${isoWeek(days[0]).year}">S${isoWeek(days[0]).number}</span>${button('week-today','Cette semaine','','text')}`:'<strong>Toutes les entrées sans tâche</strong>'}</div>
      <div class="time-toolbar-actions">${classify}${isTimer?`<div class="segmented"><button data-action="timer-view" data-id="list" class="${timerView==='list'?'active':''}">${icon('list')}Liste</button><button data-action="timer-view" data-id="calendar" class="${timerView==='calendar'?'active':''}">${icon('calendar')}Calendrier</button></div>`:''}${isTimer&&timerView==='calendar'?calendarControls(calendarDays()):''}</div>
    </div>
    ${isTimer&&weekOffset!==0?'<p id="selected-week-total" class="selected-week-total"></p>':''}
    ${isTimer&&timerView==='calendar'?calendar(current,calendarDays()):entryGroups(list)}`;
}

function entryGroups(entries){if(!entries.length)return empty('Une page prête à se remplir.','Démarrez un chrono ou ajoutez une entrée manuellement.');const groups=new Map();for(const e of [...entries].sort((a,b)=>b.start-a.start)){const d=dateKey(e.start);if(!groups.has(d))groups.set(d,[]);groups.get(d).push(e);}return [...groups].map(([d,items])=>`<section class="day-group"><div class="day-heading"><b>${d===dateKey()?'Aujourd’hui':d===shiftDate(dateKey(),-1)?'Hier':prettyDate(d,{weekday:'long',day:'numeric',month:'long'})}<span class="muted"> · ${prettyDate(d)}</span></b><span>${duration(items.reduce((s,e)=>s+elapsed(e),0))}</span></div><div class="entries">${items.map(entryRow).join('')}</div></section>`).join('');}
function entryRow(e){const {task,project,client}=refs(e),isOwn=e.user_id===state.me.id;return `<article class="entry ${e.end===null?'is-running':''}" style="--entry-color:${project?.color||'#c8bad5'}"><div class="entry-stripe"></div><div><div class="entry-description">${esc(e.description||'Sans description')}</div><div class="entry-meta">${!isOwn?`${esc(get('users',e.user_id)?.name)} · `:''}<span class="task-name">${task?esc(task.name):'<span class="tag">À classer</span>'}</span>${project?`<span>·</span>${esc(project.name)} <span>·</span> ${esc(client?.name)}`:''}</div></div><div class="entry-time">${time(e.start)} — ${e.end!==null?time(e.end):'<span class="running-text">en cours</span>'}</div><div class="entry-duration" ${e.end===null?`data-live-entry="${e.id}"`:''}>${duration(elapsed(e),true)}</div><div class="entry-actions">${isOwn?`${e.end!==null?ib('entry-continue','Continuer cette activité','play',e.id):''}${ib('entry-edit','Modifier cette entrée','edit',e.id)}`:ib('entry-history','Historique de l’entrée','history',e.id)}</div></article>`;}
const balanceStartDate=()=>state.me.preferences.balanceStartDate||'2026-10-26';
function globalBalanceValues(timestamp=now(),includeCurrentWeek=true) {
  const days=week(0),until=includeCurrentWeek?shiftDate(days[6],1):days[0];
  return cumulativeProgress(own(),zoneInstant(balanceStartDate()+'T00:00'),zoneInstant(until+'T00:00'),state.me.preferences.weeklyTargetMinutes,timestamp);
}
function weekProgress(weekIndex=0,timestamp=now()) {
  const days=week(weekIndex);
  return weeklyProgress(own(),zoneInstant(days[0]+'T00:00'),zoneInstant(shiftDate(days[6],1)+'T00:00'),state.me.preferences.weeklyTargetMinutes,timestamp);
}
const targetHours=seconds=>`${Math.floor(seconds/3600)} h${Math.floor(seconds/60)%60?' '+String(Math.floor(seconds/60)%60).padStart(2,'0')+' min':''}`;
const balanceHours=balance=>hours(balance<0?Math.ceil(-balance/60)*60:Math.max(0,balance));
function timeSummary() {
  return `<section class="time-summary" aria-label="Résumé de mon temps">
    <div class="summary-stat"><div class="summary-stat-title">${icon('clock')}Aujourd’hui</div><strong id="summary-today" class="summary-value"></strong><small id="summary-today-note" class="summary-note"></small></div>
    <div class="summary-stat"><div class="summary-stat-title">${icon('chart')}Cette semaine</div><div class="summary-week-amount"><strong id="summary-week" class="summary-value"></strong><span id="summary-week-target"></span></div><div id="summary-week-progress" class="summary-progress" role="progressbar" aria-label="Objectif de cette semaine" aria-valuemin="0" aria-valuemax="100"><i></i></div><small id="summary-goal-missing" class="summary-note" hidden>Objectif à renseigner dans Mon profil</small></div>
    <div class="summary-stat" id="summary-global"><div class="summary-stat-title">${icon('history')}Solde global${ib('balance-info','Comprendre le calcul du solde','chevron')}</div><strong id="summary-global-value" class="summary-value"></strong><small id="summary-global-label" class="summary-note"></small></div>
    <div class="summary-stat" id="summary-previous"><div class="summary-stat-title">${icon('calendar')}Semaines précédentes</div><strong id="summary-previous-value" class="summary-value"></strong><small id="summary-previous-label" class="summary-note"></small></div>
  </section>`;
}
function updateTimeSummary(timestamp=now()) {
  if(!$('.time-summary'))return;
  const classify=$('.classify-chip');
  if(classify){
    const hour=Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Zurich',hour:'numeric',hourCycle:'h23'}).format(timestamp));
    const remind=hour>=(state.me.preferences.reminderHour??16);
    classify.classList.toggle('needs-attention',remind);
    classify.title=`${remind?'Rappel : ':''}${own().filter(e=>!e.task_id).length} entrées sans tâche à classer`;
  }
  const today=dateKey(timestamp),todaySeconds=weeklyProgress(own(),zoneInstant(today+'T00:00'),zoneInstant(shiftDate(today,1)+'T00:00'),null,timestamp).seconds;
  $('#summary-today').innerHTML=hours(todaySeconds);
  $('#summary-today-note').textContent=running()?'Chrono en cours inclus':'Temps enregistré';
  const current=weekProgress(0,timestamp),progress=$('#summary-week-progress');
  $('#summary-week').innerHTML=hours(current.seconds);
  $('#summary-week-target').textContent=current.target===null?'':`sur ${targetHours(current.target)}`;
  progress.hidden=current.target===null;$('#summary-goal-missing').hidden=current.target!==null;
  progress.setAttribute('aria-valuenow',String(Math.round(current.percent)));
  progress.setAttribute('aria-valuetext',current.target===null?'Objectif non renseigné':`${duration(current.seconds)} sur ${duration(current.target)}`);
  $('i',progress).style.width=current.percent+'%';
  progress.classList.toggle('is-complete',current.target!==null&&current.remaining===0);
  const total=globalBalanceValues(timestamp),previous=globalBalanceValues(timestamp,false);
  const labels={unset:'Objectif non renseigné',waiting:'Suivi à venir',deficit:'À rattraper',exceeded:'À récupérer',reached:'À l’équilibre'};
  $('#summary-global').dataset.status=total.status;
  $('#summary-global-value').innerHTML=total.target===null?'—':balanceHours(total.balance);
  $('#summary-global-label').textContent=labels[total.status];
  $('#summary-global').title=`Depuis le ${prettyDate(balanceStartDate(),{day:'numeric',month:'long',year:'numeric'})} · semaine en cours incluse`;
  $('#summary-previous').dataset.status=previous.status;
  $('#summary-previous-value').innerHTML=previous.target===null?'—':balanceHours(previous.balance);
  $('#summary-previous-label').textContent=previous.status==='waiting'?`Premier bilan le ${prettyDate(shiftDate(balanceStartDate(),7),{day:'numeric',month:'short'})}`:labels[previous.status];
  $('#summary-previous').title=previous.weeks?`${previous.weeks} semaine${previous.weeks>1?'s':''} terminée${previous.weeks>1?'s':''}, jusqu’au ${prettyDate(shiftDate(week(0)[0],-1),{day:'numeric',month:'long',year:'numeric'})}`:'Aucune semaine terminée depuis le début du suivi';
  const selected=$('#selected-week-total');
  if(selected){const p=weekProgress(weekOffset,timestamp);selected.textContent=`Semaine affichée : ${targetHours(p.seconds)} enregistrées${p.target===null?'':` sur ${targetHours(p.target)} prévues`}`;}
}
function balanceInfo() {
  modal('Comprendre mon solde',`<div id="balance-details"><p class="help">Le solde global compare toutes vos heures aux objectifs des semaines commencées. L’objectif entier de la semaine en cours est compté dès le lundi.</p><dl class="balance-breakdown"><div><dt>Début du suivi</dt><dd id="balance-detail-start"></dd></div><div><dt>Temps enregistré</dt><dd id="balance-detail-hours"></dd></div><div><dt>Temps attendu</dt><dd id="balance-detail-target"></dd></div><div><dt>Semaines précédentes</dt><dd id="balance-detail-previous"></dd></div></dl><p class="help">Le report des semaines précédentes s’arrête au dimanche soir. Une correction d’une ancienne entrée recalcule les deux soldes.</p><p class="help">Votre objectif et votre date de départ se renseignent dans <strong>Mon profil</strong>. L’objectif actuel s’applique à toute la période.</p><p id="balance-detail-warning" class="long-timer-help" hidden>Un chrono dépasse 6 h : vérifiez son heure de fin avant de confirmer ces totaux.</p></div>`,button('modal-close','Fermer'));
  updateBalanceDetails();
}
function updateBalanceDetails(timestamp=now()) {
  if(!dialog.open||!$('#balance-details',dialog))return;
  const p=globalBalanceValues(timestamp),previous=globalBalanceValues(timestamp,false);
  $('#balance-detail-start').textContent=prettyDate(balanceStartDate(),{day:'numeric',month:'long',year:'numeric'});
  $('#balance-detail-hours').textContent=duration(p.seconds,true);
  $('#balance-detail-target').textContent=p.target===null?'Objectif non renseigné':`${duration(p.target)} · ${p.weeks} semaine${p.weeks>1?'s':''} × ${targetHours(state.me.preferences.weeklyTargetMinutes*60)}`;
  $('#balance-detail-previous').textContent=previous.target===null?'Objectif non renseigné':previous.weeks===0?'Aucune semaine terminée':`${duration(Math.abs(previous.balance))} ${previous.balance<0?'à rattraper':previous.balance>0?'à récupérer':'· à l’équilibre'}`;
  $('#balance-detail-warning').hidden=!longRunningEntry(state.entries,state.me.id,timestamp);
}

function updateLongTimer(timestamp=now()) {
  const host=$('#long-timer-alert');if(!host)return;
  const entry=longRunningEntry(state.entries,state.me.id,timestamp);
  if(!entry){host.hidden=true;host.replaceChildren();delete host.dataset.entry;notifiedLongTimer=null;return;}
  host.hidden=false;
  if(host.dataset.entry!==entry.id){
    host.dataset.entry=entry.id;
    host.innerHTML=`<div class="long-timer-symbol">${icon('clock')}</div><div class="long-timer-copy"><strong>Votre chrono dépasse 6 heures</strong><p><span data-long-timer-name></span> · <b data-live-entry="${esc(entry.id)}"></b></p><p data-long-timer-start></p><small>Un oubli ? Renseignez votre heure de fin réelle, ou arrêtez le chrono maintenant.</small></div><div class="long-timer-actions">${button('timer-correct','Corriger l’heure de fin','edit','',entry.id)}${button('timer-stop','Arrêter maintenant','stop','',entry.id)}</div>`;
  }
  $('[data-long-timer-name]',host).textContent=entry.description||get('tasks',entry.task_id)?.name||'Activité à classer';
  $('[data-long-timer-start]',host).textContent=`Démarré le ${prettyDate(entry.start,{day:'numeric',month:'short'})} à ${time(entry.start)}.`;
  $$('button',host).forEach(b=>b.disabled=timerBusy);
  const notice=state.me.id+':'+entry.id;
  if(notifiedLongTimer!==notice){notifiedLongTimer=notice;toast('Votre chrono dépasse 6 heures. Pensez à vérifier son heure de fin.');}
}
function weeklyTargetSettings() {
  const target=state.me.preferences.weeklyTargetMinutes;
  return `<form id="weekly-target-form" class="weekly-target-form"><label class="field">Heures à travailler par semaine<input id="weekly-hours" name="weeklyHours" type="number" min="0" max="168" step="any" value="${esc(weeklyGoalDraft??(target==null?'':target/60))}" placeholder="Ex. 40 ou 42,5"><small>Total à travailler sur les 7 jours, du lundi au dimanche, sans objectif quotidien. Le chrono en cours est inclus. Laissez vide pour désactiver l’objectif. Cet objectif est appliqué à toutes les semaines depuis le début du suivi.</small></label><label class="field">Début du suivi du solde global<input id="balance-start" name="balanceStartDate" type="date" min="2000-01-03" max="2099-12-28" step="7" required value="${esc(balanceStartDraft??balanceStartDate())}"><small>Le lundi de votre première semaine de suivi. Les heures antérieures restent dans vos rapports, mais sont exclues du solde global.</small></label><button type="submit" class="btn primary">Enregistrer mon rythme${icon('check')}</button></form>`;
}
const calendarTime = new Intl.DateTimeFormat('en', {
  timeZone: 'Europe/Zurich', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23'
});
function calendarHour(ms) {
  const parts = Object.fromEntries(calendarTime.formatToParts(ms).map(x => [x.type, x.value]));
  return +parts.hour + (+parts.minute) / 60 + (+parts.second) / 3600;
}
function calendarModel(entries, days, timestamp = now()) {
  const today = dateKey(timestamp);
  const minHour = calendarRange()==='workday'?7:calendarRange()==='extended'?8:0, maxHour = calendarRange()==='workday'?18:calendarRange()==='extended'?20:24, scale = calendarFit()&&fittedCalendarScale!==null?fittedCalendarScale:calendarZoom();
  const ranges = days.map(day => ({day,from:zoneInstant(day + 'T00:00'),to:zoneInstant(shiftDate(day,1) + 'T00:00')}));
  const totals = calendarDayTotals(entries, ranges, timestamp);
  const segments = ranges.map(({day,from,to}) => {
    return layoutCalendarEntries(entries.filter(e => !e.deleted && e.start < to && (e.end ?? timestamp) >= from).map(e => {
      const start = Math.max(e.start, from), end = Math.min(e.end ?? timestamp, to);
      return {
        ...e, key: e.id + ':' + day, live: e.end === null && day === today,
        topHour: start === from ? 0 : calendarHour(start),
        endHour: end === to ? 24 : calendarHour(end),
        clippedSeconds: Math.max(0, (end - start) / 1000),
        elapsedSeconds: Math.max(0, ((e.end ?? timestamp) - e.start) / 1000)
      };
    }),scale,minHour,maxHour);
  });
  const all = segments.flat();
  // Rebuild the grid only when its range/columns change, including midnight.
  const layout = JSON.stringify([days, minHour, maxHour, scale, all.map(e => [e.key, e.live])]);
  return { days, today, segments, totals, minHour, maxHour, scale, layout };
}
function calendarEntryStyle(entry) {
  return `top:${entry.top}px;height:${entry.height}px;left:calc(${entry.column*100/entry.columns}% + 4px);width:calc(${entry.span*100/entry.columns}% - 8px);--elapsed-height:${entry.durationHeight}px`;
}
const calendarEntrySize=e=>e.height<12?'micro':e.height<40?'compact':e.height<64?'medium':'large';
function calendarEntryCopy(e){
  const r=refs(e),label=e.description||r.task?.name||r.project?.name||'À classer';
  const context=[e.description?r.task?.name:null,r.project?.name===label?null:r.project?.name,r.client?.name].filter(Boolean).join(' · ');
  const title=[label,context,`${time(e.start)} → ${e.end===null?'maintenant':time(e.end)}`,calendarDuration(e)].filter(Boolean).join(' · ');
  return {label,context,title};
}
const calendarDuration = e => e.live ? `En cours · ${duration(e.elapsedSeconds, true)}` : duration(e.clippedSeconds);
const calendarDayDuration = seconds => `${Math.floor(seconds/3600)} h ${String(Math.floor(seconds/60)%60).padStart(2,'0')}`;
function calendarGrid(model) {
  const { days, today, segments, totals, minHour, maxHour, scale, layout } = model;
  const height=(maxHour-minHour)*scale;
  return `<div class="calendar" data-layout="${esc(layout)}" data-first-day="${days[0]}" data-scale="${scale}" data-min-hour="${minHour}" data-max-hour="${maxHour}" style="--calendar-days:${days.length};--calendar-height:${height}px;--calendar-scale:${scale}px">
    <div class="cal-head">h</div>${days.map((d,index) => `<div class="cal-head ${d === today ? 'today' : ''}">${prettyDate(d, { weekday: 'short' })}<strong>${prettyDate(d, { day: 'numeric' })}</strong><span class="cal-day-total ${totals[index].seconds?'':'is-empty'}" data-calendar-total="${d}" title="Temps travaillé · chrono en cours inclus" aria-label="Temps travaillé : ${targetHours(totals[index].seconds)}">${calendarDayDuration(totals[index].seconds)}</span></div>`).join('')}
    <div class="cal-hours">${Array.from({ length: (maxHour - minHour)*2 }, (_, i) => `<span class="${i%2?'half-hour':''}" style="top:${i * scale/2}px">${minHour + Math.floor(i/2)}:${i%2?'30':'00'}</span>`).join('')}</div>
    ${segments.map((items,index) => `<div class="cal-day" data-date="${days[index]}" tabindex="0" aria-label="${esc(prettyDate(days[index],{weekday:'long',day:'numeric',month:'long'}))} · Glissez pour saisir du temps, ou appuyez sur Entrée" style="background:repeating-linear-gradient(to bottom,transparent 0,transparent ${scale - 1}px,var(--calendar-line) ${scale - 1}px,var(--calendar-line) ${scale}px),repeating-linear-gradient(to bottom,transparent 0,transparent ${scale/2 - 1}px,#f6f3f4 ${scale/2 - 1}px,#f6f3f4 ${scale/2}px)">${items.map(e => {
      const r=refs(e),copy=calendarEntryCopy(e);
      return `<button class="cal-entry ${e.live ? 'is-running' : ''}" data-size="${calendarEntrySize(e)}" data-action="entry-edit" data-id="${e.id}" data-calendar-key="${esc(e.key)}" style="${calendarEntryStyle(e)};--entry-color:${r.project?.color || '#b9a5ce'}" title="${esc(copy.title)}" aria-label="${esc(copy.title)}"><span class="cal-entry-label"><span class="cal-entry-heading"><strong>${esc(copy.label)}</strong><span class="cal-entry-context">${esc(copy.context)}</span></span><small>${calendarDuration(e)}</small></span></button>`;
    }).join('')}</div>`).join('')}
  </div>`;
}
function calendarControls(days) {
  const fit=calendarFit(),zoom=calendarZoom(),disabled=calendarPreferenceBusy?' disabled':'';
  return `<div class="calendar-controls"><div class="segmented" aria-label="Jours visibles">${[[5,'5 jours'],[7,'7 jours']].map(([n,label])=>`<button data-action="calendar-days" data-id="${n}" class="${days.length===n?'active':''}" aria-pressed="${days.length===n}"${disabled}>${label}</button>`).join('')}</div><div class="segmented calendar-range" aria-label="Plage horaire">${[['workday','7 h–18 h'],['extended','8 h–20 h'],['full','24 h']].map(([value,label])=>`<button data-action="calendar-range" data-id="${value}" class="${calendarRange()===value?'active':''}" aria-pressed="${calendarRange()===value}"${disabled}>${label}</button>`).join('')}</div><button class="btn calendar-fit ${fit?'is-active':''}" data-action="calendar-fit" aria-pressed="${fit}" title="Afficher toute la plage dans la hauteur disponible, sans réduire les textes"${disabled}>Ajuster</button><div class="calendar-zoom" role="group" aria-label="Zoom des horaires"><button class="icon-button" data-action="calendar-zoom" data-id="-1" aria-label="Réduire le zoom" ${!fit&&zoom===CALENDAR_ZOOMS[0]?'disabled':disabled}>−</button><output aria-label="Niveau de zoom">${fit?'Auto':zoom+' %'}</output><button class="icon-button" data-action="calendar-zoom" data-id="1" aria-label="Augmenter le zoom" ${!fit&&zoom===CALENDAR_ZOOMS.at(-1)?'disabled':disabled}>+</button></div></div>`;
}
function calendar(entries, days) {
  return `<div class="calendar-wrap" aria-label="Calendrier des temps" title="Glissez pour saisir du temps. Les totaux incluent la journée entière.">${calendarGrid(calendarModel(entries, days))}</div>`;
}
function fitCalendarToSpace(){
  const wrap=$('.calendar-wrap'),grid=$('.calendar');
  if(!wrap||!grid||!state||!calendarFit()||calendarDrag||wrap.clientHeight<=0)return;
  const scale=fitCalendarScale(wrap.clientHeight,$('.cal-head',grid).offsetHeight,Number(grid.dataset.maxHour)-Number(grid.dataset.minHour));
  if(fittedCalendarScale!==null&&Math.abs(scale-fittedCalendarScale)<.01)return;
  fittedCalendarScale=scale;
  const focusedKey=grid.contains(document.activeElement)?document.activeElement?.dataset.calendarKey:null;
  grid.outerHTML=calendarGrid(calendarModel(own(),calendarDays()));wrap.scrollTop=0;
  if(focusedKey)$$('[data-calendar-key]').find(el=>el.dataset.calendarKey===focusedKey)?.focus({preventScroll:true});
}
function observeCalendarSize(){
  const wrap=$('.calendar-wrap');if(!wrap)return;
  fitCalendarToSpace();
  calendarResizeObserver=new ResizeObserver(()=>{cancelAnimationFrame(calendarFitFrame);calendarFitFrame=requestAnimationFrame(fitCalendarToSpace);});
  calendarResizeObserver.observe(wrap);
}
function updateCalendar(timestamp) {
  const grid = $('.calendar');
  if (!grid || !running() || calendarDrag) return;
  const model = calendarModel(own(), calendarDays(), timestamp);
  if (grid.dataset.layout !== model.layout) {
    const focusedKey = grid.contains(document.activeElement) ? document.activeElement.dataset.calendarKey : null;
    grid.outerHTML = calendarGrid(model);
    if (focusedKey) $$('[data-calendar-key]').find(el => el.dataset.calendarKey === focusedKey)?.focus({ preventScroll: true });
    return;
  }
  const positions = new Map(model.segments.flat().map(e => [e.key, e]));
  for(const {day,seconds} of model.totals) {
    const total=$(`[data-calendar-total="${day}"]`,grid);
    if(total){total.textContent=calendarDayDuration(seconds);total.setAttribute('aria-label',`Temps travaillé : ${targetHours(seconds)}`);total.classList.toggle('is-empty',seconds===0);}
  }
  $$('.cal-entry', grid).forEach(slot => {
    const entry = positions.get(slot.dataset.calendarKey);
    if (!entry) return;
    const r=refs(entry);
    slot.style.cssText = `${calendarEntryStyle(entry)};--entry-color:${r.project?.color || '#b9a5ce'}`;
    slot.dataset.size=calendarEntrySize(entry);
    if(!entry.live)return;
    $('small', slot).textContent = calendarDuration(entry);
    slot.title = calendarEntryCopy(entry).title;slot.setAttribute('aria-label',slot.title);
  });
}
async function saveCalendarPreference(data) {
  if(calendarPreferenceBusy)return;
  calendarPreferenceBusy=true;$$('.calendar-controls button').forEach(b=>{b.disabled=true;});
  try{await preference(data);}finally{calendarPreferenceBusy=false;render();}
}
function drawCalendarSelection() {
  const d=calendarDrag;if(!d||!d.moved)return;
  d.range=calendarSelection(d.anchor,d.minHour*60+(d.y-d.day.getBoundingClientRect().top)/d.scale*60,d.minHour*60,d.maxHour*60);
  d.preview.hidden=false;d.preview.style.top=(d.range.start/60-d.minHour)*d.scale+'px';
  d.preview.style.height=(d.range.end-d.range.start)/60*d.scale+'px';
  d.preview.textContent=`${duration(d.range.start*60)} — ${duration(d.range.end*60)}`;
}
function calendarDragFrame(timestamp) {
  const d=calendarDrag;if(!d)return;
  if(d.moved) {
    const rect=d.wrap.getBoundingClientRect(),top=Math.max(0,rect.top)+$('.cal-head',d.wrap).offsetHeight+28,bottom=Math.min(innerHeight,rect.bottom)-28;
    const direction=d.y<top?-1:d.y>bottom?1:0;
    if(direction)d.wrap.scrollTop+=direction*Math.min(32,timestamp-(d.frameTime||timestamp))*0.6;
    drawCalendarSelection();
  }
  d.frameTime=timestamp;d.frame=requestAnimationFrame(calendarDragFrame);
}
function finishCalendarDrag(cancel=false) {
  const d=calendarDrag;if(!d)return;
  calendarDrag=null;cancelAnimationFrame(d.frame);d.preview.remove();
  if(d.day.hasPointerCapture(d.pointerId))d.day.releasePointerCapture(d.pointerId);
  if(calendarRenderPending){calendarRenderPending=false;render();}
  if(cancel||!d.moved||!d.range)return;
  try {
    const start=zoneInstant(calendarWallTime(d.date,d.range.start)),end=zoneInstant(calendarWallTime(d.date,d.range.end));
    editEntry('',{start,end});
  } catch(error){toast(error.message);}
}
document.addEventListener('pointerdown',event=>{
  const day=event.target.closest('.cal-day');
  if(!day||event.target.closest('.cal-entry')||event.button!==0||!event.isPrimary||event.pointerType==='touch'||dialog.open)return;
  const grid=day.closest('.calendar'),preview=document.createElement('div');
  preview.className='cal-selection';preview.hidden=true;preview.setAttribute('role','status');day.append(preview);
  const scale=Number(grid.dataset.scale);
  const minHour=Number(grid.dataset.minHour),maxHour=Number(grid.dataset.maxHour);
  calendarDrag={day,preview,scale,minHour,maxHour,date:day.dataset.date,wrap:grid.parentElement,pointerId:event.pointerId,anchor:minHour*60+(event.clientY-day.getBoundingClientRect().top)/scale*60,originY:event.clientY,y:event.clientY,moved:false};
  day.setPointerCapture(event.pointerId);event.preventDefault();calendarDrag.frame=requestAnimationFrame(calendarDragFrame);
});
document.addEventListener('pointermove',event=>{
  if(!calendarDrag||event.pointerId!==calendarDrag.pointerId)return;
  calendarDrag.y=event.clientY;
  if(Math.abs(event.clientY-calendarDrag.originY)>=5)calendarDrag.moved=true;
  drawCalendarSelection();
});
document.addEventListener('pointerup',event=>{if(calendarDrag&&event.pointerId===calendarDrag.pointerId){calendarDrag.y=event.clientY;drawCalendarSelection();finishCalendarDrag();}});
document.addEventListener('pointercancel',()=>finishCalendarDrag(true));
document.addEventListener('lostpointercapture',()=>finishCalendarDrag(true));
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&calendarDrag){event.preventDefault();finishCalendarDrag(true);return;}
  if(event.key==='Enter'&&event.target.matches('.cal-day')){event.preventDefault();const date=event.target.dataset.date;editEntry('',{start:zoneInstant(date+'T09:00'),end:zoneInstant(date+'T10:00')});}
});
function catalogModel(kind, timestamp=now()) {
  const catalog=workCatalog(state,timestamp), criteria=catalogFilters[kind];
  if(criteria.project&&!catalog.projects.some(row=>row.id===criteria.project&&!row.project.archived&&(!criteria.client||row.project.client_id===criteria.client)))criteria.project='';
  const rows=kind==='tasks'?filterTaskCatalog(catalog,criteria,state.me.id,taskScope):filterProjectCatalog(catalog,criteria);
  const total=kind==='tasks'?filterTaskCatalog(catalog,{},state.me.id,taskScope).length:catalog.projects.length;
  return {catalog,criteria,rows,total};
}
function catalogModified(kind) {
  const defaults=defaultCatalogFilters(kind);
  return Object.entries(catalogFilters[kind]).some(([key,value])=>value!==defaults[key]);
}
function catalogCount(kind,model) {
  return `${model.rows.length} / ${model.total} ${kind==='tasks'?'tâches':'projets'}`;
}
function catalogToolbar(kind,model) {
  const tasks=kind==='tasks',f=model.criteria;
  const select=(name,label,choices,selectKind=name)=>`<label>${label}<select name="${name}" data-select-kind="${selectKind}">${choices.map(([value,text])=>`<option value="${esc(value)}"${f[name]===value?' selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
  const sortedClients=[...state.clients].sort((a,b)=>a.name.localeCompare(b.name,'fr',{sensitivity:'base',numeric:true}));
  const projects=sortWorkRows(model.catalog.projects.filter(row=>!row.project.archived&&(!f.client||row.project.client_id===f.client)));
  const sorts=[['name-asc','Nom · A → Z'],['name-desc','Nom · Z → A'],['client-asc','Client · A → Z'],...(tasks?[['project-asc','Projet · A → Z'],['status','Statut · à faire en premier']]:[]),['time-desc','Temps · le plus d’abord'],['time-asc','Temps · le moins d’abord'],...(!tasks?[['tasks-desc','Nombre de tâches · décroissant']]:[])];
  return `<section class="catalog-tools" aria-label="Filtrer et trier les ${tasks?'tâches':'projets'}"><div class="catalog-toolbar">${tasks?`<div class="segmented" aria-label="Afficher les tâches"><button data-action="task-scope" data-id="mine" aria-pressed="${taskScope==='mine'}" class="${taskScope==='mine'?'active':''}">Mes tâches</button><button data-action="task-scope" data-id="all" aria-pressed="${taskScope==='all'}" class="${taskScope==='all'?'active':''}">Toute l’équipe</button></div>`:''}<label class="search">${icon('search')}<input type="search" id="catalog-search" value="${esc(f.query)}" placeholder="${tasks?'Tâche, projet ou client…':'Projet ou client…'}" aria-label="Rechercher ${tasks?'une tâche, un projet ou un client':'un projet ou un client'}" autocomplete="off"></label></div>
    <form id="catalog-filters" class="catalog-filters ${tasks?'for-tasks':'for-projects'}">
      ${select('client','Client',[['','Tous les clients'],...sortedClients.map(c=>[c.id,c.name])])}
      ${tasks?select('project','Projet',[['','Tous les projets'],...projects.map(row=>[row.id,row.name])]):''}
      ${tasks?select('status','Statut',[['','Tous les statuts'],['todo','À faire'],['doing','En cours'],['done','Terminée']]):select('status','Afficher',[['active','Projets actifs'],['archived','Projets archivés'],['all','Tous les projets']],'availability')}
      ${select('time','Temps passé',[['','Toutes les durées'],['tracked','Avec du temps'],['untracked','Sans temps enregistré']],'spent')}
      ${select('sort','Trier par',sorts)}
    </form><div class="catalog-meta"><span id="catalog-count" role="status">${catalogCount(kind,model)}</span><span class="catalog-time-scope">${['manager','admin'].includes(state.me.role)?'Temps de l’équipe':'Mes heures uniquement'} · toutes dates · chronos inclus</span><button class="catalog-reset" id="catalog-reset" data-action="catalog-reset" ${catalogModified(kind)?'':'disabled'}>${icon('close')}Réinitialiser</button></div></section>`;
}
function catalogResults(kind,model) {
  if(!model.rows.length) {
    if(catalogModified(kind))return empty('Aucun résultat avec ces filtres.','Élargissez votre recherche ou réinitialisez les filtres.',button('catalog-reset','Réinitialiser','close'));
    return kind==='tasks'?empty('Aucune tâche dans cette vue.','Créez une tâche ou consultez celles de toute l’équipe.',button('task-new','Créer une tâche','plus')):empty('Aucun projet actif.','Créez un projet ou choisissez « Projets archivés » dans le filtre Afficher.',button('project-new','Créer un projet','plus'));
  }
  if(kind==='tasks')return `<div class="table-wrap"><table class="catalog-table"><thead><tr><th>Tâche / projet / client</th><th>Participants</th><th>Statut</th><th>${['manager','admin'].includes(state.me.role)?'Temps de l’équipe':'Mon temps'}</th><th></th></tr></thead><tbody>${model.rows.map(({task:t,project:p,client,seconds})=>`<tr data-catalog-id="${esc(t.id)}"><td><button class="catalog-task-name" data-action="task-edit" data-id="${esc(t.id)}"><strong>${esc(t.name)}</strong><small><i class="dot" style="color:${esc(p.color)}"></i> ${esc(p.name)}${client?` <span class="catalog-client">· ${esc(client.name)}</span>`:''}</small></button></td><td>${avatars(t.assignees)}</td><td>${status(t)}</td><td class="catalog-duration" data-task-total="${esc(t.id)}">${duration(seconds)}</td><td><div class="row">${t.assignees.includes(state.me.id)?ib('task-start','Démarrer cette tâche','play',t.id):''}${ib('task-edit','Modifier la tâche','edit',t.id)}</div></td></tr>`).join('')}</tbody></table></div>`;
  return `<div class="project-grid">${model.rows.map(({project:p,client,seconds,taskCount,doneCount})=>`<button class="project-card" data-catalog-id="${esc(p.id)}" data-action="project-detail" data-id="${esc(p.id)}" style="--project-color:${esc(p.color)}"><div class="project-card-heading"><div class="project-icon">${icon('folder')}</div>${p.archived?'<span class="catalog-archive">Archivé</span>':''}</div><h3>${esc(p.name)}</h3><p>${esc(client?.name)}</p><div class="project-progress"><i style="width:${taskCount?doneCount/taskCount*100:0}%"></i></div><div class="project-bottom"><span>${doneCount} / ${taskCount} tâches terminées</span><strong class="catalog-duration" data-project-total="${esc(p.id)}">${duration(seconds)}</strong></div></button>`).join('')}</div>`;
}
function tasksPage(){const model=catalogModel('tasks');return heading('Du travail, en commun.','Créez une tâche, réunissez les bonnes personnes et suivez vos contributions.',button('task-new','Nouvelle tâche','plus'))+catalogToolbar('tasks',model)+`<div id="catalog-results">${catalogResults('tasks',model)}</div>`;}
function projectsPage(){const model=catalogModel('projects');return heading('Une vue sur vos projets.','Des clients, des équipes et une histoire qui se construit heure après heure.',button('project-new','Nouveau projet','plus'))+catalogToolbar('projects',model)+`<div id="catalog-results">${catalogResults('projects',model)}</div>`;}
function updateCatalogResults(timestamp=now()) {
  const root=$('#catalog-results');if(!root||!['tasks','projects'].includes(page))return;
  const model=catalogModel(page,timestamp),elements=$$('[data-catalog-id]',root);
  // Reorder only when needed: ticking must not replace focused controls every second.
  const ids=new Set(elements.map(el=>el.dataset.catalogId));
  if(elements.length!==model.rows.length||model.rows.some(row=>!ids.has(row.id))||!elements.length&&!!$('[data-action="catalog-reset"]',root)!==catalogModified(page))root.innerHTML=catalogResults(page,model);
  else if(elements.length) {
    const byId=new Map(elements.map(el=>[el.dataset.catalogId,el])),container=elements[0].parentElement;
    const focused=document.activeElement,restoreFocus=root.contains(focused);
    model.rows.forEach((row,index)=>{const element=byId.get(row.id);if(container.children[index]!==element)container.insertBefore(element,container.children[index]||null);});
    if(restoreFocus&&document.activeElement!==focused)focused.focus({preventScroll:true});
  }
  const rowById=new Map(model.rows.map(row=>[row.id,row])),kind=page==='tasks'?'task':'project';
  $$(`[data-${kind}-total]`,root).forEach(el=>{el.textContent=duration(rowById.get(el.dataset[kind+'Total']).seconds);});
  const count=$('#catalog-count'),label=catalogCount(page,model);if(count.textContent!==label)count.textContent=label;
  $('#catalog-reset').disabled=!catalogModified(page);
}
function clientsPage(){return heading('Vos clients, au même endroit.','Le point de départ de chaque projet et de vos prochains rapports.',button('client-new','Nouveau client','plus'))+`<div class="table-wrap"><table><thead><tr><th>Client</th><th>Projets</th><th>${['manager','admin'].includes(state.me.role)?'Temps de l’équipe':'Mon temps'}</th><th></th></tr></thead><tbody>${state.clients.map(c=>{const projects=state.projects.filter(p=>p.client_id===c.id);return `<tr><td><strong>${esc(c.name)}</strong></td><td>${projects.length}<small>${esc(projects.map(p=>p.name).join(' · '))}</small></td><td>${duration(state.entries.filter(e=>projects.some(p=>p.id===e.project_id)).reduce((s,e)=>s+elapsed(e),0))}</td><td>${ib('client-report','Voir le rapport du client','chart',c.id)}${catalogDeleteButton('client',c.id)}</td></tr>`;}).join('')}</tbody></table></div>`;}
function reportsPage(){if(!filters){const d=week();filters={from:d[0],to:d[6],group:'project',person:'',project:'',task:'',client:'',search:''};}return heading('Les heures racontent le projet.',['manager','admin'].includes(state.me.role)?'Analysez la contribution de chaque personne, tâche par tâche.':'Vos contributions par client, projet et tâche.')+`<form class="filters" id="report-filters"><label>Du<input type="date" name="from" value="${filters.from}" required></label><label>Au<input type="date" name="to" value="${filters.to}" required></label><label>Client<select name="client">${options(state.clients,filters.client,'Tous les clients')}</select></label><label>Projet<select name="project">${options(state.projects.filter(p=>!filters.client||p.client_id===filters.client),filters.project,'Tous les projets')}</select></label><label>Tâche<select name="task">${options(state.tasks.filter(t=>!filters.project||t.project_id===filters.project),filters.task,'Toutes les tâches')}</select></label>${['manager','admin'].includes(state.me.role)?`<label>Personne<select name="person">${options(state.users,filters.person,'Toute l’équipe')}</select></label>`:''}<label>Regrouper par<select name="group">${[['project','Projet'],['task','Tâche'],['client','Client'],['person','Personne']].map(([v,l])=>`<option value="${v}" ${filters.group===v?'selected':''}>${l}</option>`).join('')}</select></label><label>Description<input name="search" value="${esc(filters.search)}" placeholder="Rechercher…" maxlength="200"></label><label>Classement<select name="unclassified"><option value="">Toutes les entrées</option><option value="1" ${filters.unclassified?'selected':''}>À classer uniquement</option></select></label></form><div id="report-results">${reportData?reportResults():empty('Calcul du rapport…')}</div>`;}
async function loadReport(){const ticket=++reportTicket;try{const result=await api('/api/reports',{method:'POST',data:filters});if(ticket!==reportTicket||page!=='reports')return;reportData=result;const focusId=document.activeElement?.id,scroll=$('.report-legend')?.scrollTop;$('#report-results').innerHTML=reportResults();if(scroll!==undefined&&$('.report-legend'))$('.report-legend').scrollTop=scroll;if(focusId?.startsWith('report-')&&!dialog.open)document.getElementById(focusId)?.focus({preventScroll:true});}catch(e){if(page==='reports'&&ticket===reportTicket)$('#report-results').innerHTML=empty(e.message);}}
function reportResults(){const r=reportData;return `<section class="metrics">${metric('Temps total',hours(r.total),`${r.rows.length} entrées sur la période`,'chart')}${metric('Temps finalisé',hours(r.completed),'Entrées dont le chrono est arrêté','check')}${metric('À classer',hours(r.unclassified),'Inclus dans le temps total','box')}</section>${renderReportChart(r,{mode:state.me.preferences.reportChart||'columns',group:filters.group,projects:state.projects,users:state.users})}<div class="toolbar"><h2>${{project:'Par projet',task:'Par tâche',client:'Par client',person:'Par personne'}[filters.group]}</h2><small>Contributions individuelles</small></div>${r.groups.length?`<div class="table-wrap"><table><thead><tr><th>${{project:'Projet',task:'Tâche',client:'Client',person:'Personne'}[filters.group]}</th>${filters.group!=='person'?'<th>Personne</th>':''}<th>Entrées</th><th>Temps</th><th>Part</th></tr></thead><tbody>${r.groups.map(g=>`<tr><td><strong>${esc(g.label)}</strong></td>${filters.group!=='person'?`<td><div class="row">${avatar(get('users',g.user_id))}${esc(g.person)}</div></td>`:''}<td>${g.count}</td><td><strong>${duration(g.seconds,true)}</strong></td><td><div class="bar-inline"><i style="width:${r.total?g.seconds/r.total*100:0}%"></i></div></td></tr>`).join('')}</tbody></table></div>`:empty('Aucune heure dans cette sélection.','Essayez une autre période ou retirez un filtre.')}<p class="report-note">${['manager','admin'].includes(state.me.role)?'Vous voyez les temps de toute l’équipe. Chaque auteur reste seul à pouvoir corriger ses entrées.':'Ce rapport contient uniquement vos propres entrées.'} ${r.running?`Un chrono est actif : ${duration(r.running,true)} incluses à l’actualisation du rapport.`:''}</p><div class="section-title">Détail des entrées</div><div class="entries">${r.rows.map(e=>entryRow({...e,_report:true})).join('')}</div><p class="note">Les totaux sont limités à la période sélectionnée ; les lignes détaillent les horaires complets d’origine.</p>`;}
function inspectReportChart(target){
  const item=target.closest?.('[data-report-detail]'),chart=target.closest?.('.report-chart');
  if(!chart)return;
  const detail=$('.report-chart-inspect',chart);
  detail.textContent=item?.dataset.reportDetail||detail.dataset.hint;
  const index=item?.dataset.reportIndex;
  $$('[data-report-index]',chart).forEach(mark=>{
    mark.classList.toggle('is-highlighted',index!==undefined&&mark.dataset.reportIndex===index);
    mark.classList.toggle('is-muted',index!==undefined&&mark.dataset.reportIndex!==index);
  });
}
document.addEventListener('pointerover',event=>inspectReportChart(event.target));
document.addEventListener('focusin',event=>inspectReportChart(event.target));
document.addEventListener('pointerout',event=>{const chart=event.target.closest?.('.report-chart');if(chart&&!chart.contains(event.relatedTarget))inspectReportChart(chart);});
document.addEventListener('focusout',event=>{const chart=event.target.closest?.('.report-chart');if(chart&&!chart.contains(event.relatedTarget))inspectReportChart(chart);});
function settingsPage(){return heading('Mon profil','Votre rythme de travail et vos préférences.')+(['manager','admin'].includes(state.me.role)?`<section class="settings-panel"><h2>Journal de suivi</h2><p>Retrouvez les changements, les erreurs et les connexions pour comprendre un problème.</p>${button('journal-open','Consulter le journal','history')}</section>`:'')+`<section class="settings-panel profile-panel"><div class="profile-identity">${avatar(state.me)}<div><h2>${esc(state.me.name)}</h2><p>${esc(state.me.username)}</p></div><span class="profile-role">${state.me.role==='admin'?'Administrateur':state.me.role==='manager'?'Responsable':'Membre'}</span></div>${weeklyTargetSettings()}${button('password-change','Changer mon mot de passe','settings')}</section><section class="settings-panel"><h2>Mes rappels</h2><p>Choisissez quand retrouver vos entrées à classer.</p><label class="field">Rappel des entrées à classer<select id="reminder-hour">${Array.from({length:24},(_,i)=>`<option value="${i}" ${i===(state.me.preferences.reminderHour??16)?'selected':''}>À partir de ${String(i).padStart(2,'0')}:00</option>`).join('')}</select><small>Fuseau de l’espace : Europe/Zurich.</small></label></section><section class="settings-panel"><div class="row" style="justify-content:space-between"><h2>L’équipe · ${state.users.length}</h2>${state.me.role==='admin'?button('user-new','Ajouter une personne','plus'):''}</div><p>Chacun peut créer clients, projets et tâches, et affecter plusieurs personnes à une tâche.</p><div class="table-wrap"><table><thead><tr><th>Personne</th><th>Rôle</th><th>Accès aux temps</th></tr></thead><tbody>${state.users.map(u=>`<tr><td><div class="row">${avatar(u)}<div>${esc(u.name)}<small>${esc(u.username)}</small></div></div></td><td>${u.role==='admin'?'Administrateur':u.role==='manager'?'Responsable':'Membre'}</td><td>${u.role==='manager'?'Lecture de toute l’équipe':'Ses propres entrées'}${state.me.role==='admin'&&u.id!==state.me.id?button('password-reset','Réinitialiser le mot de passe','','text',u.id):''}</td></tr>`).join('')}</tbody></table></div></section><section class="settings-panel"><h2>Vos données restent chez vous.</h2>${state.access?`<label class="field">Adresse d’accès à l’application<input readonly value="${esc(state.access.url||location.origin)}"></label><p>${state.access.demo?'Mode démonstration locale':'Espace de travail'} · ${state.access.secure?'Connexion HTTPS':'Connexion HTTP'}. L’adresse se configure sur le serveur avec APP_URL ; elle ne crée pas le tunnel.</p>`:''}<p>Les données et préférences sont enregistrées dans une base de données sur l’ordinateur qui héberge ce prototype. Le navigateur utilise uniquement un cookie technique pour votre connexion. Les corrections de temps conservent un historique.</p><p class="app-version">Version ${APP_VERSION}</p>${button('logout','Se déconnecter','logout')}</section>`;}
function bindPage(){
  decorateSelects();
  if(page==='reports')$('.page-heading').insertAdjacentHTML('beforeend',button('page','Exporter les temps','arrow','primary','exports'));
  if(page==='exports')bindExportBuilder({root:$('.export-builder'),state:()=>state,api,notify:toast,render,refresh,download:downloadExport});
  $('#weekly-hours')?.addEventListener('input',event=>{weeklyGoalDraft=event.target.value;});
  $('#balance-start')?.addEventListener('input',event=>{balanceStartDraft=event.target.value;});
  $('#weekly-target-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,b=$('button',form),raw=$('[name="weeklyHours"]',form).value;b.disabled=true;try{await write('/api/preferences','PATCH',{weeklyTargetMinutes:raw===''?null:Math.round(Number(raw)*60),balanceStartDate:$('[name=balanceStartDate]',form).value},{close:false,message:'Votre objectif et le début du suivi sont enregistrés.'});weeklyGoalDraft=null;balanceStartDraft=null;}catch(error){toast(error.message);}finally{b.disabled=false;}});
  $('#timer-description')?.addEventListener('input',e=>timerDraft.description=e.target.value);
  $('#catalog-search')?.addEventListener('input',e=>{catalogFilters[page].query=e.target.value;updateCatalogResults();});
  $('#catalog-filters')?.addEventListener('submit',e=>e.preventDefault());
  $('#catalog-filters')?.addEventListener('change',e=>{if(e.target.tagName!=='SELECT')return;catalogFilters[page][e.target.name]=e.target.value;render();});
  $('#reminder-hour')?.addEventListener('change',e=>preference({reminderHour:+e.target.value}));
  $('#report-filters')?.addEventListener('change',e=>{const data=Object.fromEntries(new FormData(e.currentTarget));data.unclassified=!!data.unclassified;if(e.target.name==='client'){data.project='';data.task='';}if(e.target.name==='project')data.task='';filters=data;reportData=null;render();});
}
function tick(timestamp=now()){
  if(!state)return;
  if(state.entries.some(e=>e.end===null))updateCatalogResults(timestamp);
  const r=running(),clock=$('#timer-clock');if(clock)clock.textContent=duration(r?elapsed(r,timestamp):0,true);
  updateLongTimer(timestamp);updateTimeSummary(timestamp);updateBalanceDetails(timestamp);
  $$('[data-live-entry]').forEach(el=>{const e=state.entries.find(e=>e.id===el.dataset.liveEntry);if(e)el.textContent=duration(elapsed(e,timestamp),true);});
}
setInterval(() => { const timestamp = now(); if(state&&renderedDate!==dateKey(timestamp)){render();return;} tick(timestamp); updateCalendar(timestamp); }, 1000);
setInterval(()=>{if(state&&connected&&page==='reports'&&!document.hidden)loadReport();},15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state)refresh().catch(e=>toast(e.message));});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
async function journalDialog(filters={}) {
  if(!['manager','admin'].includes(state?.me.role))return;
  const viewer=state.me.id;
  const query=new URLSearchParams(Object.entries(filters).filter(([,value])=>value));
  const result=await api('/api/journal?'+query);
  if(state?.me.id!==viewer)return;
  const levels={info:'Information',warning:'Avertissement',error:'Erreur'};
  const categories={audit:'Changement',request:'Requête',system:'Serveur'};
  const actions={'mutation-committed':'Modification enregistrée','request-completed':'Requête terminée','request-aborted':'Connexion interrompue','server-start':'Démarrage du serveur','server-stop':'Arrêt du serveur','journal-enabled':'Activation du journal',create:'Création',update:'Modification',delete:'Suppression',restore:'Rétablissement','password-change':'Mot de passe changé','password-reset':'Mot de passe réinitialisé','classification-delete':'Classement supprimé'};
  const options=(labels,selected)=>'<option value="">Tous</option>'+Object.entries(labels).map(([value,label])=>`<option value="${value}" ${value===selected?'selected':''}>${label}</option>`).join('');
  modal('Journal de suivi',`<p class="help">Historique en ajout seul. Consultez les détails ou recherchez la référence affichée lors d’une erreur.</p>
    <div class="field-pair">${field('Niveau',`<select name="level">${options(levels,filters.level)}</select>`)}${field('Catégorie',`<select name="category">${options(categories,filters.category)}</select>`)}</div>
    ${field('Référence de requête',`<input name="requestId" value="${esc(filters.requestId||'')}" maxlength="36" placeholder="Identifiant affiché dans le message d’erreur">`)}
    <div class="row"><button type="submit" data-submit="1" class="btn">Filtrer / Actualiser</button><button type="button" class="btn" id="journal-verify">Vérifier l’intégrité</button></div>
    <p id="journal-integrity" class="help" role="status"></p>
    <p class="help">${result.items.length} événements affichés, du plus récent au plus ancien.</p>
    ${result.items.map(item=>`<details class="history-row"><summary><b>#${item.seq} · ${esc(levels[item.level])} · ${esc(actions[item.action]||item.action)}</b><small>${esc(prettyDate(item.at))} à ${time(item.at)} · ${esc(categories[item.category])} · ${esc(get('users',item.actor)?.name||item.actor||'Serveur / anonyme')}</small>${item.details.route?`<small>${esc(item.details.method||'')} ${esc(item.details.route)} · HTTP ${item.details.status??'—'}</small>`:''}</summary>${item.request_id?`<p class="help">Référence : ${esc(item.request_id)}</p>`:''}<pre class="journal-details">${esc(JSON.stringify(item.details,null,2))}</pre></details>`).join('')||'<p class="help">Aucun événement ne correspond à ces filtres.</p>'}`,
    `<button type="button" class="btn" id="journal-export">Exporter cette page</button>${result.nextBefore?'<button type="button" class="btn" id="journal-next">Plus anciens</button>':''}${button('modal-close','Fermer')}`,
    data=>journalDialog(data));
  const panel=$('#modal-form');
  $('#journal-next',panel)?.addEventListener('click',()=>journalDialog({...filters,before:result.nextBefore}).catch(error=>toast(error.message)));
  $('#journal-verify',panel).addEventListener('click',async event=>{
    const target=event.currentTarget,status=$('#journal-integrity',panel);target.disabled=true;status.textContent='Vérification en cours…';
    try { const integrity=await api('/api/journal/verify');status.textContent=integrity.ok?`Intégrité vérifiée : ${integrity.count} événements. Empreinte : ${integrity.hash}`:`Altération détectée : ${integrity.reason} (#${integrity.seq}).`; }
    catch(error){status.textContent=error.message;}finally{target.disabled=false;}
  });
  $('#journal-export',panel).addEventListener('click',()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`timeteknika-journal-${result.items[0]?.seq??0}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
}

function modal(title,body,footer='',submit=null){
  dialogRefresh=null;
  dialog.innerHTML=`<form id="modal-form" autocomplete="off"><header class="modal-header"><h2>${esc(title)}</h2>${ib('modal-close','Fermer','close')}</header><div class="modal-body">${body}<div class="form-error" role="alert"></div></div>${footer?`<footer class="modal-footer">${footer}</footer>`:''}</form>`;
  $$('button',dialog).forEach(b=>{if(!b.hasAttribute('type'))b.type=b.dataset.submit?'submit':'button';});
  const form=$('#modal-form');form.addEventListener('submit',async e=>{e.preventDefault();if(!submit)return;const b=$('[type=submit]',form);if(b)b.disabled=true;$('.form-error',form).textContent='';try{await submit(Object.fromEntries(new FormData(form)),form);}catch(error){if(dialog.open){$('.form-error',form).textContent=error.message;if(error.error==='version_conflict'||error.error==='timer_conflict'){const extra=document.createElement('button');extra.type='button';extra.className='btn text';extra.textContent='Recharger les valeurs actuelles';extra.addEventListener('click',()=>{const eid=form.dataset.entryId,tid=form.dataset.taskId;if(eid)editEntry(eid);else if(tid)taskForm(tid);else dialog.close();});$('.form-error',form).append(extra);}}else toast(error.message);}finally{if(b)b.disabled=false;}});
  decorateSelects(dialog);
  if(!dialog.open)dialog.showModal();
}
const saveFooter=(label='Enregistrer',left='')=>`${left}<div class="right">${button('modal-close','Annuler')}<button type="submit" data-submit="1" class="btn primary">${esc(label)}${icon('check')}</button></div>`;
const field=(label,control,help='')=>`<label class="field">${label}${control}${help?`<small>${help}</small>`:''}</label>`;
function taskProjectPreferences() {
  const preferences={...state.me.preferences.taskProjects};
  for(const [id,pending] of taskProjectPending)if(pending.userId===state.me.id)preferences[id]={...preferences[id],...pending.flags};
  return preferences;
}
function groupedTasks(selectedTaskId,query) {
  return taskProjectGroups({...state,userId:state.me.id,selectedTaskId,preferences:taskProjectPreferences(),query});
}
function taskGroupsHTML(groups,renderTask,selectedTaskId,prefix) {
  let section='',html='';const hasPinned=groups.some(g=>g.pinned);
  for(const group of groups) {
    const {project,client,tasks,pinned,expanded}=group,id=project.id;
    const heading=pinned?'Épinglés':'Autres projets';
    if(hasPinned&&section!==heading){section=heading;html+=`<div class="task-project-section">${pinned?icon('pin'):''}${heading}</div>`;}
    const groupId=`${prefix}-project-${encodeURIComponent(id)}`,selected=tasks.some(t=>t.id===selectedTaskId);
    const busy=taskProjectPending.get(id)?.userId===state.me.id;
    html+=`<section class="task-project ${pinned?'is-pinned':''} ${selected?'has-selection':''}" style="--project-color:${esc(project.color)}">
      <div class="task-project-header"><button type="button" class="task-project-toggle" data-task-project-toggle="${esc(id)}" data-picker-key="toggle:${esc(id)}" id="${groupId}-label" aria-expanded="${expanded}" aria-controls="${groupId}" aria-disabled="${busy}">
        ${icon('chevron')}<span class="task-project-color">${icon('folder')}</span><span class="task-project-name"><strong>${esc(project.name)}${project.archived?' · Archivé':''}</strong><small>${esc(client?.name||'Sans client')}</small></span><span class="task-project-count">${tasks.length}<span class="visually-hidden"> tâche${tasks.length>1?'s':''}</span></span>${selected?`<span class="task-project-selected" title="Contient la tâche sélectionnée">${icon('check')}</span>`:''}
      </button><button type="button" class="task-project-pin" data-task-project-pin="${esc(id)}" data-picker-key="pin:${esc(id)}" aria-pressed="${pinned}" aria-disabled="${busy}" aria-label="${pinned?'Désépingler':'Épingler'} le projet ${esc(project.name)}" title="${pinned?'Désépingler':'Épingler'} le projet">${icon('pin')}</button></div>
      <div class="task-project-tasks" id="${groupId}" role="group" aria-labelledby="${groupId}-label" ${expanded?'':'hidden'}>${tasks.map(renderTask).join('')}</div></section>`;
  }
  return html;
}
function replaceTaskChoices(list,html) {
  const active=list.contains(document.activeElement)?document.activeElement:null,key=active?.dataset.pickerKey,scroll=list.scrollTop;
  list.innerHTML=html;list.scrollTop=scroll;
  if(key){const next=$$('[data-picker-key]',list).find(b=>b.dataset.pickerKey===key);next?.focus({preventScroll:true});next?.scrollIntoView({block:'nearest'});}
}
async function saveTaskProject(id,flags,redraw) {
  const userId=state.me.id;if(taskProjectPending.get(id)?.userId===userId)return;
  const pending={userId,flags};taskProjectPending.set(id,pending);redraw();
  try {await write('/api/preferences','PATCH',{taskProject:{projectId:id,...flags}},{close:false,message:''});}
  catch(error){toast(error.message);}
  finally {if(taskProjectPending.get(id)===pending)taskProjectPending.delete(id);if(state?.me.id===userId)redraw();}
}
function bindTaskProjectControls(root,redraw,getQuery) {
  let lastQuery='';const searchCollapsed=new Set();
  root.addEventListener('click',event=>{
    const toggle=event.target.closest('[data-task-project-toggle]'),pin=event.target.closest('[data-task-project-pin]');
    if(!toggle&&!pin)return;
    const id=toggle?.dataset.taskProjectToggle??pin.dataset.taskProjectPin;
    if(taskProjectPending.get(id)?.userId===state.me.id)return;
    if(toggle&&normalizeTaskSearch(getQuery())) {
      // Searching opens matching projects without changing the saved organisation.
      toggle.getAttribute('aria-expanded')==='true'?searchCollapsed.add(id):searchCollapsed.delete(id);redraw();
    } else saveTaskProject(id,pin?{pinned:pin.getAttribute('aria-pressed')!=='true'}:{collapsed:toggle.getAttribute('aria-expanded')==='true'},redraw);
  });
  root.addEventListener('keydown',event=>{
    if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
    const group=event.target.closest('.task-project');if(!group)return;
    const toggle=$('[data-task-project-toggle]',group);
    if(event.target===toggle){event.preventDefault();if((event.key==='ArrowRight')!==(toggle.getAttribute('aria-expanded')==='true'))toggle.click();}
    else if(event.key==='ArrowLeft'&&event.target.closest('.task-project-tasks')){event.preventDefault();toggle.focus();}
  });
  return groups=>{
    const query=normalizeTaskSearch(getQuery());
    if(query!==lastQuery){searchCollapsed.clear();lastQuery=query;}
    return groups.map(group=>({...group,expanded:query?!searchCollapsed.has(group.project.id):group.expanded}));
  };
}
function picker(){
  modal('Choisir votre tâche',`<div class="timer-task-picker"><div class="entry-choice-search">${icon('search')}<input id="picker-search" type="search" autofocus placeholder="Rechercher une tâche, un projet, un client…" aria-label="Rechercher une tâche" autocomplete="off"></div><div class="entry-choice-heading"><span>Mes tâches par projet</span><span class="entry-choice-count"></span></div><p class="task-project-help">Épinglez vos projets fréquents pour les retrouver en tête.</p><div id="picker-results" class="entry-choice-list" role="group" aria-label="Tâches par projet"></div></div>`);
  const root=$('.timer-task-picker',dialog),search=$('#picker-search',root),list=$('#picker-results',root);
  const applyExpansion=bindTaskProjectControls(root,draw,()=>search.value);
  function draw(){
    if(!root.isConnected)return;
    const groups=applyExpansion(groupedTasks('',search.value));
    const option=task=>`<button type="button" class="entry-choice ${task.id===timerDraft.task_id?'is-selected':''}" data-action="pick-task" data-id="${esc(task.id)}" data-picker-key="task:${esc(task.id)}" aria-pressed="${task.id===timerDraft.task_id}"><span class="entry-choice-symbol" style="--choice-color:${esc(get('projects',task.project_id)?.color)}">${icon('task')}</span><span class="entry-choice-copy"><strong>${esc(task.name)}</strong><small>${{todo:'À faire',doing:'En cours',done:'Terminée'}[task.status]} · ${task.assignees.length} participant${task.assignees.length>1?'s':''}</small></span>${avatars(task.assignees)}${task.id===timerDraft.task_id?`<span class="entry-choice-check">${icon('check')}</span>`:''}</button>`;
    const blank=normalizeTaskSearch(search.value)?'':`<button type="button" class="entry-choice" data-action="pick-task" data-id="" data-picker-key="task:"><span class="entry-choice-symbol" style="--choice-color:#a79aaf">${icon('task')}</span><span class="entry-choice-copy"><strong>À classer plus tard</strong><small>Le chrono démarre sans tâche</small></span></button>`;
    replaceTaskChoices(list,blank+taskGroupsHTML(groups,option,timerDraft.task_id,'timer')+(groups.length?'':'<div class="entry-choice-empty"><strong>Aucune tâche disponible</strong><span>Essayez un autre nom ou vérifiez vos affectations.</span></div>'));
    $('.entry-choice-count',root).textContent=`${groups.reduce((n,g)=>n+g.tasks.length,0)} tâches · ${groups.length} projets`;
  }
  search.addEventListener('input',draw);
  root.addEventListener('keydown',event=>{
    const choices=$$('[data-action="pick-task"], [data-task-project-toggle], [data-task-project-pin]',root).filter(b=>!b.closest('[hidden]')),index=choices.indexOf(event.target);
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();choices[index<0?(event.key==='ArrowDown'?0:choices.length-1):(index+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length]?.focus();}
    else if(event.key==='Enter'&&event.target===search){event.preventDefault();(choices.find(b=>b.dataset.action==='pick-task'&&b.dataset.id)||choices[0])?.click();}
  });
  dialogRefresh=draw;draw();search.focus();
}
// Form dates use the workspace's time zone, independently of the device time zone.
function localDateTime(ms){return dateKey(ms)+'T'+time(ms).replace('h',':');}
function zoneCandidates(value){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return[];const nominal=Date.parse(value+':00Z');if(!Number.isFinite(nominal))return[];return [nominal-3600000,nominal-7200000].filter(ms=>localDateTime(ms)===value);}
function zoneInstant(value,choice='first'){const candidates=zoneCandidates(value);if(!candidates.length)throw Error('Horaire inexistant dans le fuseau Europe/Zurich. Vérifiez la date, notamment lors du passage à l’heure d’été.');return candidates[choice==='last'?candidates.length-1:0];}
function entrySelectors(entry) {
  return `<section class="entry-classification" aria-label="Classement du temps">
    <input type="hidden" name="task_id" value="${esc(entry.task_id||'')}">
    <input type="hidden" name="project_id" value="${esc(entry.project_id||'')}">
    <input type="hidden" name="client_id" value="${esc(get('projects',entry.project_id)?.client_id||'')}">
    <div class="entry-selector-grid">${[['task','Tâche'],['project','Projet'],['client','Client']].map(([kind,label])=>`
      <div class="entry-selector-field entry-selector-${kind}"><span id="entry-label-${kind}">${label}</span>
      <button type="button" class="entry-selector" data-entry-picker="${kind}" aria-labelledby="entry-label-${kind} entry-value-${kind}" aria-expanded="false" aria-controls="entry-choice-panel"></button></div>`).join('')}</div>
    <div id="entry-choice-panel" class="entry-choice-panel" hidden></div>
    <p class="entry-classification-hint" aria-live="polite"></p>
  </section>`;
}
function bindEntrySelectors(entry) {
  const root=$('.entry-classification',dialog), panel=$('#entry-choice-panel',root);
  const names={task:'tâche',project:'projet',client:'client'};
  const normalize=normalizeTaskSearch;
  const value=kind=>$(`[name="${kind}_id"]`,root).value;
  const set=(kind,id)=>{$(`[name="${kind}_id"]`,root).value=id||'';};
  const projects=()=>state.projects.filter(p=>!p.archived||p.id===entry.project_id);
  const clientColor=id=>{const palette=['#9676c4','#ba815d','#5b9289','#648bbb','#bc718b','#9c884e'];return palette[[...id].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0)%palette.length];};
  const symbol=(kind,color,text='')=>`<span class="entry-choice-symbol ${kind==='client'?'is-client':''}" style="--choice-color:${esc(color)}">${kind==='client'?(text?esc(initials(text)):icon('people')):icon(kind==='task'?'task':'folder')}</span>`;
  let openKind='', clientFilter='', creating=false, createBusy=false, taskQuery='', pendingCreation=null;
  const form=$('#modal-form');
  const applyExpansion=bindTaskProjectControls(root,()=>{if(root.isConnected&&openKind&&!creating)drawChoices();},()=>$('.entry-choice-search input',panel)?.value||'');
  function creationMode(active) {
    creating=active;
    $$('[data-entry-picker]',root).forEach(b=>{b.disabled=active;});
    $('[type="submit"]',form).disabled=active;
  }
  function refreshFields() {
    const task=get('tasks',value('task')),project=get('projects',value('project')),client=get('clients',value('client'));
    const rows={
      task:[task?.name||'Choisir une tâche',task?(project?.name||''):'À classer plus tard',project?.color||'#9c88b3'],
      project:[project?.name||'Choisir un projet',project?(client?.name||''):'Tous vos projets',project?.color||'#9c88b3'],
      client:[client?.name||'Choisir un client',client?(project?'Client du projet':'Choisir son projet'):'Tous vos clients',client?clientColor(client.id):'#9c88b3']
    };
    for(const kind of Object.keys(rows)) {
      const [title,subtitle,color]=rows[kind],trigger=$(`[data-entry-picker="${kind}"]`,root);
      trigger.classList.toggle('has-value',!!value(kind));
      trigger.innerHTML=`${symbol(kind,color,kind==='client'?(client?.name||''):'')}<span class="entry-selector-copy"><strong id="entry-value-${kind}">${esc(title)}</strong><small>${esc(subtitle)}</small></span>${icon('down')}`;
      trigger.title=title;
      trigger.setAttribute('aria-expanded',String(kind===openKind));
    }
    $('.entry-classification-hint',root).textContent=client&&!project?'Choisissez un projet de ce client pour y associer votre temps.':task?'Projet et client associés à la tâche.':'Une tâche sélectionnée associe automatiquement son projet et son client.';
  }
  function closePicker(focus=false) {
    creationMode(false);
    const previous=openKind;openKind='';panel.hidden=true;panel.innerHTML='';refreshFields();
    if(focus&&previous)$(`[data-entry-picker="${previous}"]`,root).focus();
  }
  function drawChoices() {
    const query=normalize($('.entry-choice-search input',panel).value.trim());
    const groups=openKind==='task'?applyExpansion(groupedTasks(entry.task_id,query)):[];
    let items=openKind==='task'?groups.flatMap(group=>group.tasks):openKind==='project'?projects():state.clients;
    if(openKind==='project'&&clientFilter)items=items.filter(p=>p.client_id===clientFilter);
    items=items.filter(item=>{
      const p=openKind==='task'?get('projects',item.project_id):openKind==='project'?item:null;
      return normalize([item.name,p?.name,get('clients',p?.client_id)?.name].filter(Boolean).join(' ')).includes(query);
    }).sort((a,b)=>openKind==='project'?compareTaskProjects(a,b,taskProjectPreferences()):a.name.localeCompare(b.name,'fr'));
    const option=(id,title,subtitle,color,tail='',kind=openKind)=>`<button type="button" class="entry-choice ${value(openKind)===id?'is-selected':''}" data-entry-choice="${esc(id)}" data-picker-key="${openKind}:${esc(id)}" aria-pressed="${value(openKind)===id}">${symbol(kind,color,title)}<span class="entry-choice-copy"><strong>${esc(title)}</strong><small>${esc(subtitle)}</small></span>${tail}${value(openKind)===id?`<span class="entry-choice-check">${icon('check')}</span>`:''}</button>`;
    let html=query?'':option('',openKind==='task'?'À classer plus tard':openKind==='project'?'Sans projet':'Sans client',openKind==='task'?'Garder le temps sans tâche':openKind==='project'?'Retirer le projet et la tâche':'Retirer le client, le projet et la tâche','#a79aaf','','task');
    const renderItem=item=>{
      const project=openKind==='task'?get('projects',item.project_id):openKind==='project'?item:null;
      const client=openKind==='client'?item:get('clients',project?.client_id);
      const count=openKind==='client'?projects().filter(p=>p.client_id===item.id).length:0;
      const subtitle=openKind==='task'?`${{todo:'À faire',doing:'En cours',done:'Terminée'}[item.status]}${item.archived?' · Archivée':''} · ${item.assignees.length} participant${item.assignees.length>1?'s':''}`:openKind==='project'?`${client?.name||''}${item.archived?' · Archivé':''}`:`${count} projet${count>1?'s':''}`;
      const tail=openKind==='task'?avatars(item.assignees):openKind==='client'?`<span class="entry-client-colors" aria-hidden="true">${projects().filter(p=>p.client_id===item.id).slice(0,4).map(p=>`<i style="background:${esc(p.color)}"></i>`).join('')}</span>`:taskProjectPreferences()[item.id]?.pinned?`<span class="task-project-mark" title="Projet épinglé">${icon('pin')}</span>`:'';
      return option(item.id,item.name,subtitle,project?.color||clientColor(item.id),tail);
    };
    html+=openKind==='task'?taskGroupsHTML(groups,renderItem,value('task'),'entry'):items.map(renderItem).join('');
    if(!items.length)html+=`<div class="entry-choice-empty">${icon('search')}<strong>${query?'Aucun résultat':'Aucun élément disponible'}</strong><span>${query?'Essayez un autre nom de tâche, de projet ou de client.':openKind==='task'?'Les tâches qui vous sont attribuées apparaîtront ici.':openKind==='project'?'Créez votre projet avec le bouton ci-dessous.':'Ajoutez un client depuis la rubrique Clients.'}</span></div>`;
    replaceTaskChoices($('.entry-choice-list',panel),html);
    $('.entry-choice-count',panel).textContent=`${items.length} ${names[openKind]}${items.length>1?'s':''}${openKind==='task'?` · ${groups.length} projet${groups.length>1?'s':''}`:''}`;
  }
  function openPicker(kind,filter='') {
    openKind=kind;clientFilter=filter;panel.hidden=false;
    const client=get('clients',filter);
    panel.innerHTML=`<div class="entry-choice-search">${icon('search')}<input type="search" aria-label="Rechercher ${kind==='task'?'une tâche':kind==='project'?'un projet':'un client'}" placeholder="Rechercher ${kind==='task'?'une tâche, un projet…':kind==='project'?'un projet…':'un client…'}" autocomplete="off"><button type="button" class="icon-button" data-entry-dismiss aria-label="Fermer la liste">${icon('close')}</button></div>
      <div class="entry-choice-heading"><span>${kind==='task'?'Mes tâches par projet':kind==='project'?(client?esc(client.name):'Tous les projets'):'Tous les clients'}</span>${client?'<button type="button" data-entry-all>Tous les clients</button>':'<span class="entry-choice-count"></span>'}</div>
      ${kind==='task'?'<p class="task-project-help">Épinglez vos projets fréquents pour les retrouver en tête.</p>':''}
      ${client?'<span class="entry-choice-count visually-hidden"></span>':''}<div class="entry-choice-list" role="group" aria-label="${kind==='task'?'Tâches disponibles':kind==='project'?'Projets disponibles':'Clients disponibles'}"></div>
      ${kind!=='client'?`<div class="entry-choice-footer"><button type="button" class="entry-create-task" data-entry-create>${icon('plus')}<span>${kind==='task'?'Créer une tâche':'Créer un projet'}</span>${icon('arrow')}</button></div>`:''}`;
    refreshFields();drawChoices();$('.entry-choice-search input',panel).focus();
  }
  function returnToChoices() {
    if(createBusy)return;
    creationMode(false);pendingCreation=null;openPicker(openKind,clientFilter);
    $('.entry-choice-search input',panel).value=taskQuery;drawChoices();
    $('[data-entry-create]',panel).focus();
  }
  function newTask() {
    taskQuery=$('.entry-choice-search input',panel).value;
    creationMode(true);pendingCreation=null;
    const active=state.projects.filter(p=>!p.archived),current=active.find(p=>p.id===value('project'));
    const matching=active.filter(p=>p.client_id===value('client'));
    const selected=current?.id||(matching.length===1?matching[0].id:'');
    panel.innerHTML=`<div class="entry-task-create-header"><span class="entry-choice-symbol" style="--choice-color:#9676c4">${icon('plus')}</span><div><strong>Nouvelle tâche</strong><small>Créez-la et associez-la à votre temps.</small></div><button type="button" class="icon-button" data-entry-create-cancel aria-label="Annuler la création">${icon('close')}</button></div>
      <div class="entry-task-create-body"><fieldset class="entry-task-create-fields">
      ${field('Nom de la tâche',`<input id="entry-new-task-name" maxlength="200" value="${esc(taskQuery.slice(0,200))}" placeholder="Ex. Coordination des plans" required>`)}
      ${field('Projet',`<select id="entry-new-task-project" required>${options(active.map(p=>({...p,name:p.name+' · '+(get('clients',p.client_id)?.name||'')})),selected,'Choisir un projet…')}</select>`)}
      <div class="entry-task-participants-label">Participants<small>Vous participez à cette tâche. Ajoutez vos collègues.</small></div>
      <div class="entry-task-participants">${state.users.filter(u=>u.active).map(u=>`<label class="entry-task-person"><input type="checkbox" data-task-assignee value="${esc(u.id)}" ${u.id===state.me.id?'checked disabled':''}>${avatar(u)}<span>${esc(u.name)}${u.id===state.me.id?' <small>· vous</small>':''}</span></label>`).join('')}</div>
      </fieldset><p class="entry-task-create-error" role="alert"></p>
      ${!active.length?'<p class="help">Revenez à la liste, puis ouvrez le sélecteur Projet pour créer votre premier projet. Votre saisie de temps est conservée ici.</p>':''}
      <div class="entry-task-create-actions"><button type="button" class="btn" data-entry-create-cancel>Retour à la liste</button><button type="button" class="btn primary" data-entry-create-save ${active.length?'':'disabled'}>Créer et sélectionner${icon('check')}</button></div></div>`;
    decorateSelects(panel);
    $('#entry-new-task-name',panel).focus();
  }
  function newProject() {
    taskQuery=$('.entry-choice-search input',panel).value;
    creationMode(true);pendingCreation=null;
    const selected=value('client')||clientFilter||(state.clients.length===1?state.clients[0].id:'');
    panel.innerHTML=`<div class="entry-task-create-header"><span class="entry-choice-symbol" style="--choice-color:#b77b87">${icon('folder')}</span><div><strong>Nouveau projet</strong><small>Créez-le et associez-le à votre temps.</small></div><button type="button" class="icon-button" data-entry-create-cancel aria-label="Annuler la création">${icon('close')}</button></div>
      <div class="entry-task-create-body"><fieldset class="entry-task-create-fields">
      ${field('Nom du projet',`<input id="entry-new-project-name" maxlength="150" value="${esc(taskQuery.slice(0,150))}" placeholder="Ex. Résidence Les Cèdres" required>`)}
      ${field('Client',`<select id="entry-new-project-client" data-select-kind="client" required>${options(state.clients,selected,'Choisir un client…')}</select>`)}
      ${field('Description','<textarea id="entry-new-project-description" maxlength="2000" placeholder="Le contexte du projet…"></textarea>')}
      ${field('Couleur',`<select id="entry-new-project-color" data-select-kind="color">${projectColorOptions()}</select>`)}
      </fieldset><p class="entry-task-create-error" role="alert"></p>
      ${!state.clients.length?'<p class="help">Ajoutez d’abord un client dans la rubrique Clients pour pouvoir créer un projet.</p>':''}
      <div class="entry-task-create-actions"><button type="button" class="btn" data-entry-create-cancel>Retour à la liste</button><button type="button" class="btn primary" data-entry-create-save ${state.clients.length?'':'disabled'}>Créer et sélectionner${icon('check')}</button></div></div>`;
    decorateSelects(panel);
    $('#entry-new-project-name',panel).focus();
  }
  async function saveNewItem() {
    if(createBusy)return;
    const isProject=openKind==='project',kind=openKind;
    const name=$(`#entry-new-${kind}-name`,panel),parent=$(isProject?'#entry-new-project-client':'#entry-new-task-project',panel);
    if(!pendingCreation) {
      name.value=name.value.trim();
      if(!name.reportValidity()||!parent.reportValidity())return;
      pendingCreation={key:crypto.randomUUID(),data:isProject?{name:name.value,client_id:parent.value,description:$('#entry-new-project-description',panel).value,color:$('#entry-new-project-color',panel).value}:{name:name.value,project_id:parent.value,status:'todo',assignees:$$('[data-task-assignee]:checked',panel).map(x=>x.value)}};
    }
    const fields=$('.entry-task-create-fields',panel),save=$('[data-entry-create-save]',panel),error=$('.entry-task-create-error',panel),userId=state.me.id;
    createBusy=true;fields.disabled=true;save.disabled=true;save.textContent='Création…';error.textContent='';
    $$('[data-entry-create-cancel]',panel).forEach(b=>{b.disabled=true;});
    try {
      const result=await api(isProject?'/api/projects':'/api/tasks',{method:'POST',...pendingCreation});
      const item=result[kind],collection=isProject?'projects':'tasks';
      pendingCreation=null;
      if(state?.me.id!==userId)return;
      // Keep the confirmed item available even if the following state refresh is interrupted.
      if(!get(collection,item.id))state[collection].push(item);
      if(root.isConnected&&dialog.open) {
        set('task',isProject?'':item.id);set('project',isProject?item.id:item.project_id);set('client',isProject?item.client_id:get('projects',item.project_id)?.client_id);
        $('.form-error',form).textContent='';closePicker();$(`[data-entry-picker="${kind}"]`,root).focus();
      }
      toast(`${isProject?'Projet créé et sélectionné':'Tâche créée et sélectionnée'}. Enregistrez votre entrée pour conserver ce classement.`);
      refresh().catch(e=>toast(e.message));
    } catch(e) {
      if(!e.network)pendingCreation=null;
      error.textContent=e.network?'La confirmation n’a pas été reçue. Réessayez pour retrouver la même création, sans doublon.':e.message;
      fields.disabled=!!pendingCreation;save.disabled=false;save.innerHTML=`${pendingCreation?'Réessayer':'Créer et sélectionner'}${icon('check')}`;
      $$('[data-entry-create-cancel]',panel).forEach(b=>{b.disabled=false;});
    } finally {createBusy=false;}
  }
  root.addEventListener('click',event=>{
    if(event.target.closest('[data-entry-create]')){openKind==='project'?newProject():newTask();return;}
    if(event.target.closest('[data-entry-create-cancel]')){returnToChoices();return;}
    if(event.target.closest('[data-entry-create-save]')){saveNewItem();return;}
    const trigger=event.target.closest('[data-entry-picker]');
    if(trigger){const kind=trigger.dataset.entryPicker;kind===openKind?closePicker(true):openPicker(kind,kind==='project'?value('client'):'');return;}
    if(event.target.closest('[data-entry-dismiss]')){closePicker(true);return;}
    if(event.target.closest('[data-entry-all]')){openPicker('project');return;}
    const choice=event.target.closest('[data-entry-choice]');if(!choice)return;
    $('.form-error',dialog).textContent='';
    const kind=openKind,id=choice.dataset.entryChoice;
    if(kind==='task') {
      set('task',id);
      if(id){const project=get('projects',get('tasks',id).project_id);set('project',project.id);set('client',project.client_id);}
    } else if(kind==='project') {
      set('project',id);set('client',get('projects',id)?.client_id);
      if(get('tasks',value('task'))?.project_id!==id)set('task','');
    } else {
      set('client',id);
      if(!id||get('projects',value('project'))?.client_id!==id){set('project','');set('task','');}
      if(id&&!value('project')){openPicker('project',id);return;}
    }
    closePicker();$(`[data-entry-picker="${kind}"]`,root).focus();
  });
  root.addEventListener('input',event=>{if(event.target.matches('.entry-choice-search input'))drawChoices();});
  $('#modal-form').addEventListener('click',event=>{if(openKind&&!creating&&!event.composedPath().includes(root))closePicker();});
  form.addEventListener('submit',event=>{if(creating){event.preventDefault();event.stopImmediatePropagation();}},true);
  $('#modal-form').addEventListener('keydown',event=>{
    if(!openKind)return;
    if(creating) {
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();returnToChoices();}
      else if(event.key==='Enter'&&event.target.id===`entry-new-${openKind}-name`){event.preventDefault();saveNewItem();}
      return;
    }
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closePicker(true);return;}
    if(!panel.contains(event.target))return;
    const choices=$$('[data-entry-choice], [data-entry-create], [data-task-project-toggle], [data-task-project-pin]',panel).filter(b=>!b.closest('[hidden]')),index=choices.indexOf(event.target);
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();choices[index<0?(event.key==='ArrowDown'?0:choices.length-1):(index+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length]?.focus();
    } else if(event.key==='Enter'&&event.target.matches('.entry-choice-search input')) {
      event.preventDefault();const first=choices.find(b=>b.dataset.entryChoice)||choices[0];first?.click();
    }
  });
  dialogRefresh=()=>{if(root.isConnected){refreshFields();if(openKind&&!creating)drawChoices();}};
  refreshFields();
}
function editEntry(eid='',preset={}){
  const entry=eid?state.entries.find(e=>e.id===eid):null;
  if(eid&&!entry)return toast('Cette entrée n’est plus disponible.');
  if(entry&&entry.user_id!==state.me.id)return entryHistory(eid);
  const e=entry||{description:'',task_id:'',project_id:'',start:now()-3600000,end:now(),...preset};
  const correcting=!!preset.correctEnd&&entry?.end===null;
  modal(correcting?'Corriger le chrono oublié':entry?'Modifier mon entrée':'Saisir du temps',`${correcting?'<p class="long-timer-help">Indiquez l’heure à laquelle vous avez réellement terminé. L’enregistrement arrêtera ce chrono et recalculera votre solde hebdomadaire.</p>':''}${field('Description','<textarea name="description" maxlength="2000" placeholder="Qu’avez-vous fait ?">'+esc(e.description)+'</textarea>')}${entrySelectors(e)}<div class="field-pair">${field('Début',`<input type="datetime-local" name="start" value="${localDateTime(e.start)}" required>`)}${field(e.end===null?'Fin · chrono en cours':'Fin',`<input type="datetime-local" name="end" value="${e.end===null?'':localDateTime(e.end)}" ${e.end===null&&!correcting?'':'required'}>`)}</div><p class="help">Horaires en Europe/Zurich.${e.end===null&&!correcting?' Laissez la fin vide pour garder le chrono en cours.':''}</p><div id="ambiguous-time" class="hidden"><label class="check-item"><input type="checkbox" name="lateOffset">Utiliser la deuxième occurrence de cette heure</label><p class="help" style="margin-top:12px">Au passage à l’heure d’hiver, cette heure existe deux fois. Sans changement d’horaire, l’occurrence d’origine est conservée.</p></div><label class="check-item"><input type="checkbox" name="confirmOverlap">Autoriser un chevauchement avec mes autres entrées</label>`,saveFooter('Enregistrer',entry?`<div class="row">${ib('entry-history','Historique des corrections','history',eid)}${entry.end!==null?ib('entry-delete','Supprimer cette entrée','trash',eid):''}</div>`:''),async data=>{
    if(data.client_id&&!data.project_id)throw Error('Choisissez un projet pour ce client, ou sélectionnez « Sans client ».');
    const resolveTime=(v,old)=>old!=null&&localDateTime(old)===v?old:zoneInstant(v,data.lateOffset?'last':'first');
    await write(eid?'/api/entries/'+eid:'/api/entries',eid?'PATCH':'POST',{description:data.description,task_id:data.task_id||null,project_id:data.project_id||null,start:new Date(resolveTime(data.start,entry?.start)).toISOString(),end:data.end?new Date(resolveTime(data.end,entry?.end)).toISOString():null,version:entry?.version,confirmOverlap:!!data.confirmOverlap},{message:'Votre entrée a été enregistrée.'});
  });
  $('#modal-form').dataset.entryId=eid;
  bindEntrySelectors(e);
  const ambiguity=()=>$('#ambiguous-time').classList.toggle('hidden',!['start','end'].some(n=>zoneCandidates($('[name='+n+']',dialog).value).length>1));
  $$('input[type=datetime-local]',dialog).forEach(el=>el.addEventListener('change',ambiguity));ambiguity();
  if(correcting)$('[name=end]',dialog).focus();
}
function catalogDeleteButton(kind,id){return ['manager','admin'].includes(state.me.role)?button(`${kind}-delete`,'Supprimer','trash','danger',id):'';}
async function confirmCatalogDeletion(kind,id){
  const collection={task:'tasks',project:'projects',client:'clients'}[kind];
  const preview=await api(`/api/${collection}/${id}/deletion-preview`);
  const c=preview.counts;
  const label={task:'cette tâche',project:'ce projet',client:'ce client'}[kind];
  modal(`Supprimer ${label} ?`,`<p class="help"><strong>${esc(preview.item.name)}</strong><br>Cette suppression est définitive.</p>
    <p class="help">${c.clients} client(s), ${c.projects} projet(s) et ${c.tasks} tâche(s) seront supprimés.</p>
    ${(preview.projects.length||preview.tasks.length)?`<details class="deletion-details"><summary>Voir les éléments concernés</summary><ul>${preview.projects.map(p=>`<li>Projet : ${esc(p.name)}</li>`).join('')}${preview.tasks.map(t=>`<li>Tâche : ${esc(t.name)}</li>`).join('')}</ul></details>`:''}
    <p class="help"><strong>${c.entries} entrée(s) de temps conservée(s).</strong> Les durées, descriptions et historiques restent enregistrés. ${kind==='task'?'Le projet et son client restent associés aux heures ; seule la tâche est retirée.':'Le classement vers ces projets et tâches est retiré des heures, qui apparaîtront dans « À classer ».'}${c.running?`<br>${c.running} chrono(s) en cours continueront de tourner.`:''}</p>
    <label class="check-item"><input type="checkbox" required>Je confirme la suppression et le retrait de ce classement dans les rapports.</label>`,
    saveFooter('Supprimer définitivement'),async()=>write(`/api/${collection}/${id}`,'DELETE',{confirmation:preview.confirmation},{message:'Suppression effectuée. Toutes les heures sont conservées.'}));
  $('[type="submit"]',dialog).className='btn danger';
}
function clientForm(){modal('Nouveau client',field('Nom du client','<input name="name" required maxlength="100" autofocus placeholder="Ex. Atelier Horizon">'),saveFooter('Créer le client'),async data=>write('/api/clients','POST',data,{message:'Le client est disponible pour toute l’équipe.'}));}
function projectForm(){
  if(!state.clients.length){clientForm();return toast('Créez votre premier client, puis son projet.');}
  modal('Nouveau projet',`${field('Nom du projet','<input name="name" required maxlength="150" autofocus placeholder="Ex. Résidence Les Cèdres">')}${field('Client',`<select name="client_id" required>${options(state.clients,'')}</select>`)}${field('Description','<textarea name="description" maxlength="2000" placeholder="Le contexte du projet…"></textarea>')}${field('Couleur',`<select name="color">${projectColorOptions()}</select>`)}<p class="help">Toute l’équipe pourra créer des tâches dans ce projet. Les droits de consultation des temps restent ceux de chaque rôle.</p>`,saveFooter('Créer le projet'),async data=>write('/api/projects','POST',data,{message:'Le projet est prêt à accueillir vos tâches.'}));
}
function taskForm(tid='',projectId=''){
  const task=tid?get('tasks',tid):null;
  if(!task&&!state.projects.some(p=>!p.archived)){projectForm();return toast('Créez un projet avant d’ajouter une tâche.');}
  modal(task?'Modifier la tâche partagée':'Nouvelle tâche',`${field('Nom de la tâche',`<input name="name" required maxlength="200" autofocus value="${esc(task?.name||'')}" placeholder="Ex. Plans d’exécution">`)}${field('Projet',`<select name="project_id" required>${options(state.projects.filter(p=>!p.archived||p.id===task?.project_id),task?.project_id||projectId)}</select>`)}${field('Description commune',`<textarea name="description" maxlength="2000" placeholder="Ce qu’il faut accomplir ensemble…">${esc(task?.description||'')}</textarea>`)}<div class="field">Participants<small>Chaque participant pourra choisir cette tâche dans son chrono.</small></div><div class="check-list">${state.users.filter(u=>u.active).map(u=>`<label class="check-item"><input type="checkbox" name="assignees" value="${u.id}" ${(task?.assignees||[state.me.id]).includes(u.id)?'checked':''}>${avatar(u)}${esc(u.name)}</label>`).join('')}</div>${field('Statut',`<select name="status">${[['todo','À faire'],['doing','En cours'],['done','Terminée']].map(([v,l])=>`<option value="${v}" ${(task?.status||'todo')===v?'selected':''}>${l}</option>`).join('')}</select>`)}${task?`<label class="check-item"><input type="checkbox" name="archived" ${task.archived?'checked':''}>Archiver cette tâche</label>`:''}`,saveFooter(task?'Enregistrer':'Créer la tâche',task?catalogDeleteButton('task',tid):''),async(data,form)=>{data.assignees=new FormData(form).getAll('assignees');data.version=task?.version;data.archived=!!data.archived;await write(task?'/api/tasks/'+tid:'/api/tasks',task?'PATCH':'POST',data,{message:'La tâche et ses participants sont synchronisés.'});});$('#modal-form').dataset.taskId=tid;
}
function projectDetail(pid){const p=get('projects',pid),tasks=state.tasks.filter(t=>t.project_id===pid);modal(p.name,`<p class="help">${esc(get('clients',p.client_id)?.name)}${p.description?' · '+esc(p.description):''}</p>${field('Nom du projet',`<input name="name" value="${esc(p.name)}" required maxlength="150">`)}${field('Couleur',`<select name="color">${projectColorOptions(p.color)}</select>`)}<div class="field">Tâches partagées</div><div class="picker-list">${tasks.map(t=>`<button class="picker-option" data-action="task-edit" data-id="${t.id}"><div><b>${esc(t.name)}${t.archived?' · archivée':''}</b><small>${t.assignees.length} participants</small></div>${avatars(t.assignees)}</button>`).join('')||'<p class="help">Aucune tâche pour le moment.</p>'}</div><div class="row" style="margin:18px 0">${!p.archived?button('task-project-new','Ajouter une tâche','plus','',pid):''}${button('project-report','Voir le rapport','chart','',pid)}</div><label class="check-item"><input type="checkbox" name="archived" ${p.archived?'checked':''}>Projet archivé</label>`,saveFooter('Enregistrer',catalogDeleteButton('project',pid)),async data=>write('/api/projects/'+pid,'PATCH',{name:data.name,color:data.color,archived:!!data.archived,version:p.version}));}
function userForm(){modal('Ajouter une personne',`${field('Nom complet','<input name="name" required maxlength="100" autocomplete="name">')}${field('Identifiant','<input name="username" required minlength="3" maxlength="40" pattern="[a-zA-Z0-9][a-zA-Z0-9._\\-]{2,39}" autocomplete="off" placeholder="ex. alex.martin">','Lettres sans accents, chiffres, point et tiret. Aucune adresse mail nécessaire.')}${field('Mot de passe initial','<input name="password" type="password" minlength="8" maxlength="200" required autocomplete="new-password">','8 caractères minimum. À transmettre directement à la personne.')}${button('password-generate','Générer un mot de passe de 8 caractères','spark')}${field('Rôle','<select name="role"><option value="member">Membre — ses propres temps</option><option value="manager">Responsable — tous les temps de l’équipe</option></select>')}<p class="help">Chaque rôle peut créer des clients, des projets, des tâches et les affecter à plusieurs personnes.</p>`,saveFooter('Créer le compte'),async data=>write('/api/users','POST',data,{message:'Le compte est créé. La personne peut se connecter.'}));}
async function entryHistory(eid){const {items}=await api('/api/entries/'+eid+'/history');modal('Historique de l’entrée',items.length?items.map(a=>`<div class="history-row"><b>${{create:'Entrée créée',update:'Entrée corrigée',delete:'Entrée supprimée',restore:'Entrée restaurée','classification-delete':'Classement supprimé — temps conservé'}[a.action]||esc(a.action)}</b><small>${esc(a.actor_name)} · ${prettyDate(a.at)} à ${time(a.at)}</small>${a.before?`<p>Avant : ${esc(a.before.description||'Sans description')}<br>${time(a.before.start)} — ${a.before.end!==null?time(a.before.end):'en cours'} · ${esc(get('tasks',a.before.task_id)?.name||a.before.task_name||a.before.project_name||'À classer')}</p>`:''}${a.after?`<p>Après : ${esc(a.after.description||'Sans description')}<br>${time(a.after.start)} — ${a.after.end!==null?time(a.after.end):'en cours'} · ${esc(get('tasks',a.after.task_id)?.name||'À classer')}</p>`:''}</div>`).join(''):'<p class="help">Cette entrée de démonstration n’a pas encore été modifiée.</p>',`<div class="right">${button('modal-close','Fermer')}</div>`);}
async function startTimer(data){
  if(timerBusy)return;timerBusy=true;const current=running();render();
  try{await write('/api/timer/start','POST',{...data,task_id:data.task_id||null,project_id:data.project_id||null,expectedRunningId:current?.id??null,expectedVersion:current?.version},{close:false,message:current?'Activité précédente arrêtée, nouveau chrono démarré.':'Le chrono est démarré.'});timerDraft={description:'',task_id:'',project_id:''};}finally{timerBusy=false;render();}
}
async function downloadExport(config,format){
  const response=await fetch('/api/exports/download',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},credentials:'same-origin',cache:'no-store',body:JSON.stringify({config,format})});
  if(!response.ok){const error=await response.json();if(response.status===401){signOutLocal();await showLogin();}throw Error(error.message||'Impossible de générer cet export.');}
  const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]||`TimeTeknika.${format}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function go(p){page=p;render();await preference({page:p==='exports'?'reports':p});}
document.addEventListener('click',async event=>{
  const target=event.target.closest('[data-action]');if(!target)return;if(target.disabled)return;
  if(target.closest('form'))event.preventDefault();const action=target.dataset.action,eid=target.dataset.id;
  try{
    if(action==='modal-close'){dialog.close();return;}
    if(action==='password-generate'){
      const input=$('input[name=password]',dialog), alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
      const values=crypto.getRandomValues(new Uint32Array(8));
      input.value=Array.from(values,n=>alphabet[Math.floor(n/4294967296*alphabet.length)]).join('');input.type='text';return;
    }
    if(action==='password-change'||action==='password-reset'){
      const self=action==='password-change',person=self?state.me:get('users',eid);
      modal(self?'Changer mon mot de passe':'Réinitialiser · '+person.name,
        (self?field('Mot de passe actuel','<input name="currentPassword" type="password" autocomplete="current-password" required>'):'<p>Les sessions de cette personne seront déconnectées.</p>')+
        field('Nouveau mot de passe','<input name="password" type="password" minlength="8" maxlength="200" autocomplete="new-password" required>','8 caractères minimum.')+button('password-generate','Générer un mot de passe de 8 caractères','spark'),saveFooter('Enregistrer'),async data=>write(self?'/api/account/password':'/api/users/'+eid+'/password','POST',data,{message:'Mot de passe modifié.'}));return;
    }
    if(action==='demo-login'){target.disabled=true;await api('/api/demo-login',{method:'POST',data:{user_id:eid}});dialog.close();state=null;await refresh();connect();return;}
    if(action==='page'){dialog.close();await go(eid);return;}
    if(action==='logout'){await api('/api/logout',{method:'POST',data:{}});signOutLocal();await showLogin();return;}
    if(action==='account'){modal('Votre compte',`<div class="row" style="margin-bottom:20px">${avatar(state.me)}<div><h3>${esc(state.me.name)}</h3><small>${esc(state.me.username)}</small></div></div><p class="help">${['manager','admin'].includes(state.me.role)?'Responsable : lecture des temps de toute l’équipe.':'Membre : vos entrées de temps restent personnelles.'}</p>${button('page','Mon profil','settings','','settings')}${state.demo?`<div class="section-title">Changer de profil de démonstration</div>${state.users.filter(u=>u.id.startsWith('demo-')&&u.id!==state.me.id).map(u=>`<button class="demo-account" data-action="demo-login" data-id="${u.id}">${avatar(u)}<div><strong>${esc(u.name)}</strong><small>${u.role==='admin'?'Administrateur':u.role==='manager'?'Responsable':'Membre'}</small></div>${icon('arrow')}</button>`).join('')}`:''}`,button('logout','Se déconnecter','logout'));return;}
    if(action==='journal-open'){await journalDialog();return;}
    if(action==='balance-info'){balanceInfo();return;}
    if(action==='timer-pick'){picker();return;}
    if(action==='pick-task'){timerDraft.task_id=eid;timerDraft.project_id=get('tasks',eid)?.project_id||'';dialog.close();render();return;}
    if(action==='timer-start'){await startTimer(timerDraft);return;}
    if(action==='timer-stop'){if(timerBusy)return;const e=running();if(!e)return;timerBusy=true;render();try{await write('/api/timer/stop','POST',{id:e.id,version:e.version},{close:false,message:'Temps enregistré.'});}finally{timerBusy=false;render();}return;}
    if(action==='entry-new'){editEntry();return;}
    if(action==='entry-edit'){editEntry(eid);return;}
    if(action==='timer-correct'){editEntry(eid,{correctEnd:true});return;}
    if(action==='entry-history'){await entryHistory(eid);return;}
    if(action==='entry-continue'){const e=state.entries.find(x=>x.id===eid);await startTimer({description:e.description,task_id:e.task_id,project_id:e.project_id});return;}
    if(action==='entry-delete'){const entry=state.entries.find(e=>e.id===eid);modal('Supprimer cette entrée ?',`<p class="help">${esc(entry.description||'Sans description')} · ${duration(elapsed(entry),true)}<br>Elle sera retirée des rapports. Son historique sera conservé.</p>`,saveFooter('Supprimer'),async()=>{await write('/api/entries/'+eid,'DELETE',{version:entry.version},{message:'Entrée supprimée.'});modal('Entrée supprimée','<p class="help">Vous pouvez encore rétablir cette entrée.</p>',`${button('entry-restore','Rétablir l’entrée','history','',eid)}<div class="right">${button('modal-close','Fermer')}</div>`);});return;}
    if(action==='entry-restore'){await write('/api/entries/'+eid+'/restore','POST',{}, {message:'Entrée restaurée.'});return;}
    if(action==='week-prev'||action==='week-next'||action==='week-today'){weekOffset=action==='week-today'?0:weekOffset+(action==='week-prev'?-1:1);render();return;}
    if(action==='report-chart'){
      if(reportChartBusy||!REPORT_CHARTS.some(([id])=>id===eid)||state.me.preferences.reportChart===eid)return;
      reportChartBusy=true;
      $$('[data-action="report-chart"]').forEach(b=>b.disabled=true);
      try{await write('/api/preferences','PATCH',{reportChart:eid},{close:false,message:''});}
      finally{reportChartBusy=false;$$('[data-action="report-chart"]').forEach(b=>b.disabled=false);if(page==='reports'&&document.activeElement===document.body&&!dialog.open)document.getElementById('report-chart-'+eid)?.focus({preventScroll:true});}
      return;
    }
    if(action==='timer-view'){timerView=eid;render();await preference({timerView});return;}
    if(action==='calendar-days'){await saveCalendarPreference({calendarDays:Number(eid)});return;}
    if(action==='calendar-range'){await saveCalendarPreference({calendarRange:eid});return;}
    if(action==='calendar-fit'){await saveCalendarPreference({calendarFit:true});return;}
    if(action==='calendar-zoom'){const scale=calendarFit()?(fittedCalendarScale??calendarZoom()):calendarZoom();const zoom=Number(eid)>0?(CALENDAR_ZOOMS.find(z=>z>scale)??CALENDAR_ZOOMS.at(-1)):([...CALENDAR_ZOOMS].reverse().find(z=>z<scale)??CALENDAR_ZOOMS[0]);await saveCalendarPreference({calendarFit:false,calendarZoom:zoom});return;}
    if(action==='task-scope'){taskScope=eid;render();await preference({taskScope});return;}
    if(action==='catalog-reset'&&['tasks','projects'].includes(page)){catalogFilters[page]=defaultCatalogFilters(page);render();$('#catalog-search')?.focus({preventScroll:true});return;}
    if(action==='task-new'){taskForm();return;}
    if(['task-delete','project-delete','client-delete'].includes(action)){target.disabled=true;try{await confirmCatalogDeletion(action.split('-')[0],eid);}finally{target.disabled=false;}return;}
    if(action==='task-edit'){taskForm(eid);return;}
    if(action==='task-project-new'){taskForm('',eid);return;}
    if(action==='task-start'){const t=get('tasks',eid);await startTimer({description:'',task_id:t.id,project_id:t.project_id});await go('timer');return;}
    if(action==='project-new'){projectForm();return;}
    if(action==='project-detail'){projectDetail(eid);return;}
    if(action==='client-new'){clientForm();return;}
    if(action==='user-new'){userForm();return;}
    if(action==='project-report'||action==='client-report'){dialog.close();const days=week();filters={from:days[0],to:days[6],group:'task',person:'',task:'',project:action==='project-report'?eid:'',client:action==='client-report'?eid:'',search:''};reportData=null;await go('reports');return;}
  }catch(error){toast(error.message);target.disabled=false;}
});
updateTimerFavicon();
try{await refresh();connect();}catch(e){if(e.status===401)await showLogin();else{$('#app').innerHTML=empty('Le serveur ne répond pas.',e.message);}}
