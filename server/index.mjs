import http from 'node:http';
import { initializeAdministrator } from './admin-role.mjs';
import { existsSync } from 'node:fs';
import { serveReact } from './react-static.mjs';
import { loginName, secret, accessConfig } from './auth.mjs';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { openStore, seedDemo, passwordHash, passwordMatches } from './store.mjs';
import { AppError, fail, id, text, instant, report, midnight } from './domain.mjs';
import { buildExport, validateExportConfig } from './exports.mjs';
import { csvExport, xlsxExport, pdfExport, exportFilename } from './export-files.mjs';
import { previewCatalogDeletion, deleteCatalogItem } from './catalog-delete.mjs';
import { PROJECT_COLORS } from '../public/project-colors.js';
import { APP_VERSION } from '../public/release.js';
import { requestContext } from './journal.mjs';

const diagnosticPaths = new Set(['/health','/api/info','/api/setup','/api/login','/api/demo-login','/api/state','/api/events','/api/logout','/api/reports','/api/exports/preview','/api/exports/download','/api/export-templates','/api/account/password','/api/clients','/api/projects','/api/tasks','/api/timer/start','/api/timer/stop','/api/entries','/api/preferences','/api/users','/api/journal','/api/journal/verify']);
function diagnosticRoute(path) {
  if (diagnosticPaths.has(path)) return path;
  const match = path.match(/^\/api\/(users|clients|projects|tasks|entries|export-templates)\/[^/]+(\/(?:history|restore|password|username|role|deletion-preview))?$/);
  return match ? `/api/${match[1]}/:id${match[2] ?? ''}` : '/unknown';
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sessionHash = token => createHash('sha256').update(token).digest('hex');
const colors = PROJECT_COLORS.map(c=>c.value);
const localRequest = req => ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host ?? '') && !req.headers['x-forwarded-host'];

export function createApplication({ dbPath = join(root,'data','teknika.sqlite'), demo = false, secureCookies = false, publicOrigin = '', setupToken = '', frontendDir = null, initialAdminUsername = '' } = {}) {
  const store = openStore(dbPath);
  if (demo) seedDemo(store);
  try { initializeAdministrator(store,initialAdminUsername); } catch(error) { store.db.close(); throw error; }
  const streams = new Set(), attempts = new Map();
  const { db, one, all, run } = store;
  function authenticated(req) {
    const token = (req.headers.cookie ?? '').split(';').map(x=>x.trim()).find(x=>x.startsWith('teknika_session='))?.split('=')[1];
    const session = token && one('SELECT * FROM sessions WHERE token=? AND expires>?',sessionHash(token),Date.now());
    const user = session && one('SELECT * FROM users WHERE id=? AND active=1', session.user_id);
    if (!user) fail(401,'Connectez-vous pour continuer.','unauthorized');
    return { user:{...user,role:store.effectiveRole(user)}, session };
  }
  function headers(res) {
    res.setHeader('Cache-Control','no-store, max-age=0');
    res.setHeader('Pragma','no-cache');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    if (secureCookies) res.setHeader('Strict-Transport-Security','max-age=31536000');
  }
  const json = (res, code, data) => { res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); };
  function origin(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') fail(403,'Origine de la requête refusée.');
    if (req.headers.origin && req.headers.origin !== (publicOrigin || `${secureCookies ? 'https' : 'http'}://${req.headers.host}`)) fail(403,'Origine de la requête refusée.');
  }
  async function body(req) {
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) fail(415,'Une requête JSON est attendue.');
    let size = 0, chunks=[];
    for await (const chunk of req) { size+=chunk.length; if (size>65536) fail(413,'Requête trop volumineuse.'); chunks.push(chunk); }
    try { const result=JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error(); return result; } catch { fail(400,'JSON invalide.'); }
  }
  function sessionFor(res, user) {
    const context=requestContext.getStore(); if(context)context.actor=user.id;
    const token=randomBytes(32).toString('hex'), csrf=randomBytes(32).toString('hex');
    run('DELETE FROM sessions WHERE expires<?',Date.now());
    run('INSERT INTO sessions VALUES (?,?,?,?)',sessionHash(token),user.id,csrf,Date.now()+7*86400000);
    res.setHeader('Set-Cookie',`teknika_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secureCookies ? '; Secure' : ''}`);
    return { me:store.userPublic(user),csrf };
  }
  function publish() {
    for (const stream of streams) {
      const session=one('SELECT s.token FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.active=1',stream.token,Date.now());
      if (!session) { stream.res.write('event: auth\ndata: {}\n\n'); stream.res.end(); streams.delete(stream); }
      else stream.res.write(`event: change\ndata: ${JSON.stringify({revision:store.revision()})}\n\n`);
    }
  }
  function mutate(req, user, data, operation) {
    const key=req.headers['idempotency-key'];
    if (typeof key!=='string' || !/^[\w-]{10,100}$/.test(key)) fail(400,'Identifiant de requête requis.');
    const fingerprint=sessionHash(`${req.method}:${req.url}:${JSON.stringify(data)}`);
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous=one('SELECT * FROM requests WHERE user_id=? AND key=?',user.id,key);
      if(previous) { if(previous.fingerprint!==fingerprint) fail(409,'Cette requête a déjà été utilisée avec un autre contenu.'); requestContext.getStore().replayed=true; db.exec('COMMIT'); return JSON.parse(previous.result); }
      const result=operation();
      run("UPDATE meta SET value=value+1 WHERE key='revision'");
      const output={...result,revision:store.revision()};
      run('INSERT INTO requests VALUES (?,?,?,?,?)',user.id,key,fingerprint,JSON.stringify(output),Date.now());
      store.log({category:'request',action:'mutation-committed',details:{route:requestContext.getStore().route,method:req.method,revision:output.revision}});
      db.exec('COMMIT'); publish(); return output;
    } catch(error) { if(db.isTransaction) db.exec('ROLLBACK'); throw error; }
  }
  function exists(table, value) { const item=one(`SELECT * FROM ${table} WHERE id=?`,value); if(!item) fail(404,'Élément introuvable.'); return item; }
  function version(item, data) { if(item.version!==data.version) fail(409,'Cet élément a été modifié. Rechargez avant d’enregistrer.','version_conflict'); }
  function entryData(user, data, previous=null) {
    const classification=store.classification(user,data.task_id,data.project_id,previous);
    const start=instant(data.start,'Début'), end=data.end===null ? null : instant(data.end,'Fin');
    if(start>Date.now()+60000) fail(400,'Le début ne peut pas être dans le futur.');
    if(end!==null && (end<start || end===start && !(previous?.start===start && previous?.end===end) || end>Date.now()+60000)) fail(400,'La fin doit suivre le début et ne peut pas être dans le futur.');
    const description=text(data.description ?? '', 'Description',2000,false);
    const overlaps=store.overlaps(user,start,end??Date.now(),previous?.id);
    if(overlaps.length && !data.confirmOverlap) fail(409,'Ce créneau chevauche une autre de vos entrées. Vérifiez les horaires ou confirmez le chevauchement.','overlap',{count:overlaps.length});
    return {...classification,description,start,end};
  }
  function saveEntry(user, values, previous=null) {
    const now=Date.now(), eid=previous?.id??id();
    if(previous) run('UPDATE entries SET task_id=?,project_id=?,description=?,start=?,end=?,version=version+1,updated_at=? WHERE id=?',values.task_id,values.project_id,values.description,values.start,values.end,now,eid);
    else run('INSERT INTO entries(id,user_id,task_id,project_id,description,start,end,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',eid,user.id,values.task_id,values.project_id,values.description,values.start,values.end,now,now);
    const entry=one('SELECT * FROM entries WHERE id=?',eid);
    store.audit(user,'entry',eid,previous?'update':'create',previous,entry,user.id);
    return entry;
  }
  store.log({category:'system',action:'server-start',details:{version:APP_VERSION}});
  const server=http.createServer((req,res)=>requestContext.run({requestId:id(),actor:null,route:'/unknown'},async()=>{
    const context=requestContext.getStore(),started=performance.now();
    res.setHeader('X-Request-ID',context.requestId);
    let recorded=false;
    const recordRequest=aborted=>{
      if(recorded)return;recorded=true;
      const status=context.errorStatus??res.statusCode;
      if(!aborted && status<400 && (req.method==='GET'||req.method==='HEAD'||['/api/reports','/api/exports/preview'].includes(context.route)))return;
      try {
        requestContext.run(context,()=>store.log({category:'request',action:aborted?'request-aborted':'request-completed',level:status>=500?'error':status>=400||aborted?'warning':'info',details:{
          method:['GET','HEAD','POST','PATCH','PUT','DELETE','OPTIONS'].includes(req.method)?req.method:'OTHER',route:context.route,status,
          durationMs:Math.round(performance.now()-started),replayed:!!context.replayed,...(context.error?{error:context.error}:{}),...(context.locations?{locations:context.locations}:{})
        }}));
      } catch { console.error(JSON.stringify({event:'journal-write-failed',requestId:context.requestId})); }
    };
    res.once('finish',()=>recordRequest(false));
    res.once('close',()=>recordRequest(!res.writableFinished));
    headers(res);
    try {
      const url=new URL(req.url,'http://localhost'), path=url.pathname, method=req.method;
      context.route=diagnosticRoute(path);
      if(path==='/health' && method==='GET') { one('SELECT 1'); return json(res,200,{status:'ok',version:APP_VERSION}); }
      if(!path.startsWith('/api/')) {
        if(frontendDir) { if(await serveReact(frontendDir,path,method,res)) return; fail(404,'Page introuvable.'); }
        if(method!=='GET' && method!=='HEAD') fail(405,'Méthode non autorisée.');
        const files={'/':'index.html','/app.js':'app.js','/calendar-utils.js':'calendar-utils.js','/report-charts.js':'report-charts.js','/rich-select.js':'rich-select.js','/task-projects.js':'task-projects.js','/export-config.js':'export-config.js','/export-builder.js':'export-builder.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg','/project-colors.js':'project-colors.js','/release.js':'release.js'};
        const file=files[path]; if(!file) fail(404,'Page introuvable.');
        const buffer=await readFile(join(root,'public',file));
        const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html';
        res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`}); return res.end(method==='HEAD'?undefined:buffer);
      }
      origin(req);
      if(path==='/api/info' && method==='GET') return json(res,200,{setup:!one('SELECT 1 FROM users LIMIT 1'),demo:demo&&localRequest(req),demoUsers:demo&&localRequest(req)?all("SELECT u.id,u.name,CASE WHEN a.user_id IS NOT NULL THEN 'admin' ELSE u.role END role,u.color FROM users u LEFT JOIN user_admins a ON a.user_id=u.id WHERE u.active=1 AND u.id LIKE ?",'demo-%'):[]});
      if(path==='/api/setup' && method==='POST') {
        const data=await body(req);
        if(one('SELECT 1 FROM users LIMIT 1')) fail(409,'L’espace est déjà configuré.');
        if((setupToken && data.setupToken!==setupToken) || (!setupToken && !localRequest(req))) fail(403,'La configuration distante nécessite le jeton SETUP_TOKEN du serveur.');
        const name=text(data.name,'Nom',100), username=loginName(data,true), password=secret(data.password,true);
        const uid=id(); db.exec('BEGIN IMMEDIATE');
        try {
          run('INSERT INTO users(id,name,username,password,role,color) VALUES (?,?,?,?,?,?)',uid,name,username,passwordHash(password),'manager',colors[0]);
          run('INSERT INTO user_admins(user_id) VALUES (?)',uid);
          db.exec('COMMIT');
        } catch(error) { if(db.isTransaction)db.exec('ROLLBACK'); throw error; }
        return json(res,201,sessionFor(res,one('SELECT * FROM users WHERE id=?',uid)));
      }
      if(path==='/api/login' && method==='POST') {
        const data=await body(req), ip=req.socket.remoteAddress, now=Date.now();
        const attempt=attempts.get(ip);
        if(attempt && attempt.until>now && attempt.count>=10) fail(429,'Trop de tentatives. Réessayez dans 15 minutes.');
        if(!attempt || attempt.until<now) attempts.set(ip,{count:0,until:now+900000});
        attempts.get(ip).count++;
        const username=loginName(data), password=secret(data.password);
        const user=one('SELECT * FROM users WHERE username=? AND active=1',username);
        if(!user || !passwordMatches(password,user.password)) fail(401,'Identifiant ou mot de passe incorrect.');
        attempts.delete(ip); return json(res,200,sessionFor(res,user));
      }
      if(path==='/api/demo-login' && method==='POST') {
        if(!demo || !localRequest(req)) fail(404,'Route indisponible.');
        const data=await body(req), user=one('SELECT * FROM users WHERE id=? AND active=1',data.user_id??'');
        if(!user || !user.id.startsWith('demo-')) fail(404,'Compte de démonstration introuvable.');
        return json(res,200,sessionFor(res,user));
      }
      const {user,session}=authenticated(req);
      context.actor=user.id;
      if(method!=='GET' && req.headers['x-csrf-token']!==session.csrf) fail(403,'Session de formulaire expirée. Rechargez la page.','csrf');
      if((path==='/api/journal'||path==='/api/journal/verify') && method==='GET') {
        if(!['manager','admin'].includes(user.role))fail(403,'Le journal est réservé aux responsables.');
        if(path.endsWith('/verify'))return json(res,200,store.verifyJournal());
        const before=url.searchParams.get('before'),level=url.searchParams.get('level'),category=url.searchParams.get('category'),requestId=url.searchParams.get('requestId');
        if(before!==null && (!/^[1-9]\d*$/.test(before)||!Number.isSafeInteger(Number(before))))fail(400,'Curseur invalide.');
        if(level && !['info','warning','error'].includes(level))fail(400,'Niveau invalide.');
        if(category && !['audit','request','system'].includes(category))fail(400,'Catégorie invalide.');
        if(requestId && !/^[a-f0-9-]{36}$/.test(requestId))fail(400,'Identifiant de requête invalide.');
        const clauses=[],params=[];
        for(const [column,value] of [['seq',before],['level',level],['category',category],['request_id',requestId]])if(value){clauses.push(`${column}${column==='seq'?'<':'='}?`);params.push(column==='seq'?Number(value):value);}
        const rows=all(`SELECT * FROM event_log ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY seq DESC LIMIT 101`,...params);
        const items=rows.slice(0,100).map(({details_json,...row})=>({...row,details:JSON.parse(details_json)}));
        const last=one('SELECT seq,hash FROM event_log ORDER BY seq DESC LIMIT 1');
        return json(res,200,{items,nextBefore:rows.length>100?items.at(-1).seq:null,checkpoint:{count:last.seq,hash:last.hash}});
      }
      if(path==='/api/state' && method==='GET') return json(res,200,{...store.snapshot(user),csrf:session.csrf,demo:demo&&localRequest(req),access:['manager','admin'].includes(user.role)?{url:publicOrigin,secure:secureCookies,demo}:undefined});
      if(path==='/api/events' && method==='GET') {
        res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});
        res.write(`retry: 1500\nevent: connected\ndata: {"revision":${store.revision()}}\n\n`);
        const stream={res,token:session.token}; streams.add(stream);
        req.on('close',()=>streams.delete(stream)); return;
      }
      if(path==='/api/logout' && method==='POST') {
        run('DELETE FROM sessions WHERE token=?',session.token); publish();
        res.setHeader('Set-Cookie',`teknika_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookies?'; Secure':''}`); return json(res,200,{ok:true});
      }
      if(path==='/api/reports' && method==='POST') {
        const filters=await body(req);
        if(filters.search!==undefined) filters.search=text(filters.search,'Recherche',200,false);
        return json(res,200,{...report(store.visibleEntries(user),filters,store.lookups()),revision:store.revision()});
      }
      if((path==='/api/exports/preview'||path==='/api/exports/download')&&method==='POST'){
        const data=await body(req),model=buildExport(store.visibleEntries(user),store.lookups(),data.config,user);
        if(path.endsWith('/preview'))return json(res,200,{...model,rows:model.rows.slice(0,200),rowCount:model.rows.length,revision:store.revision()});
        const format=data.format;if(!['csv','xlsx','pdf'].includes(format))fail(400,'Format d’export invalide.');
        const buffer=await ({csv:csvExport,xlsx:xlsxExport,pdf:pdfExport}[format])(model);
        const type={csv:'text/csv; charset=utf-8',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pdf:'application/pdf'}[format];
        res.writeHead(200,{'Content-Type':type,'Content-Disposition':`attachment; filename="${exportFilename(model,format)}"`,'Content-Length':buffer.length,'X-Export-As-Of':String(model.asOf)});return res.end(buffer);
      }
      if(path==='/api/export-templates'&&method==='POST'){
        const data=await body(req),name=text(data.name,'Nom du modèle',100),config=validateExportConfig(data.config,user);
        config.excluded=[];config.document.reference='';
        return json(res,200,mutate(req,user,data,()=>{
          if(one('SELECT COUNT(*) n FROM export_templates WHERE user_id=?',user.id).n>=50)fail(400,'Vous pouvez conserver jusqu’à 50 modèles.');
          const tid=id(),at=Date.now();run('INSERT INTO export_templates VALUES (?,?,?,?,?,?,?)',tid,user.id,name,JSON.stringify(config),1,at,at);return {template:{id:tid,name,config,version:1}};
        }));
      }
      if(path.startsWith('/api/export-templates/')&&['PATCH','DELETE'].includes(method)){
        const data=await body(req),tid=path.split('/')[3];
        return json(res,200,mutate(req,user,data,()=>{
          const template=one('SELECT * FROM export_templates WHERE id=? AND user_id=?',tid,user.id);if(!template)fail(404,'Modèle introuvable.');version(template,data);
          if(method==='DELETE'){run('DELETE FROM export_templates WHERE id=? AND user_id=?',tid,user.id);return {deleted:true};}
          const name=text(data.name,'Nom du modèle',100),config=validateExportConfig(data.config,user);config.excluded=[];config.document.reference='';
          run('UPDATE export_templates SET name=?,config=?,version=version+1,updated_at=? WHERE id=? AND user_id=?',name,JSON.stringify(config),Date.now(),tid,user.id);
          return {template:{id:tid,name,config,version:template.version+1}};
        }));
      }
      if(path.startsWith('/api/entries/') && path.endsWith('/history') && method==='GET') {
        const eid=path.split('/')[3], entry=exists('entries',eid);
        if(entry.user_id!==user.id && !['manager','admin'].includes(user.role)) fail(404,'Entrée introuvable.');
        return json(res,200,{items:all('SELECT a.*,u.name actor_name FROM audit a JOIN users u ON u.id=a.actor WHERE a.entity=? AND a.entity_id=? ORDER BY a.at DESC','entry',eid).map(a=>({...a,before:a.before_json?JSON.parse(a.before_json):null,after:a.after_json?JSON.parse(a.after_json):null,before_json:undefined,after_json:undefined}))});
      }
      if(/^\/api\/(tasks|projects|clients)\/[^/]+\/deletion-preview$/.test(path)&&method==='GET'){
        const [, ,kind,id]=path.split('/');
        return json(res,200,previewCatalogDeletion(store,user,kind,id));
      }
      if(method==='GET') fail(404,'Route inconnue.');
      const data=await body(req);
      const output=mutate(req,user,data,()=>{
        if(/^\/api\/(tasks|projects|clients)\/[^/]+$/.test(path)&&method==='DELETE'){
          const [, ,kind,id]=path.split('/');
          return deleteCatalogItem(store,user,kind,id,data.confirmation);
        }
        if(path==='/api/account/password' && method==='POST') {
          if(!passwordMatches(secret(data.currentPassword),user.password)) fail(400,'Le mot de passe actuel est incorrect.');
          const password=secret(data.password,true);
          run('UPDATE users SET password=? WHERE id=?',passwordHash(password),user.id);
          run('DELETE FROM sessions WHERE user_id=? AND token!=?',user.id,session.token);
          store.audit(user,'user',user.id,'password-change',null,{sessionsRevoked:true});
          return {ok:true};
        }
        if(/^\/api\/users\/[^/]+\/password$/.test(path) && method==='POST') {
          if(user.role!=='admin') fail(403,'Seul un administrateur peut réinitialiser un mot de passe.');
          const target=exists('users',path.split('/')[3]);
          if(target.id===user.id) fail(400,'Utilisez le changement de votre propre mot de passe.');
          run('UPDATE users SET password=? WHERE id=?',passwordHash(secret(data.password,true)),target.id);
          run('DELETE FROM sessions WHERE user_id=?',target.id);
          store.audit(user,'user',target.id,'password-reset',null,{sessionsRevoked:true});
          return {ok:true};
        }
        if(path==='/api/clients' && method==='POST') {
          const cid=id(), name=text(data.name,'Nom du client',100);
          run('INSERT INTO clients(id,name,created_by) VALUES (?,?,?)',cid,name,user.id);
          const client=exists('clients',cid); store.audit(user,'client',cid,'create',null,client); return {client};
        }
        if(path==='/api/projects' && method==='POST') {
          if(data.color!==undefined&&!colors.includes(data.color))fail(400,'Choisissez une couleur de la palette.');
          exists('clients',data.client_id??''); const pid=id(), name=text(data.name,'Nom du projet',150), color=colors.includes(data.color)?data.color:colors[0];
          run('INSERT INTO projects(id,name,client_id,color,description,created_by) VALUES (?,?,?,?,?,?)',pid,name,data.client_id,color,text(data.description??'','Description',2000,false),user.id);
          const project=exists('projects',pid); store.audit(user,'project',pid,'create',null,project); return {project};
        }
        if(/^\/api\/projects\/[^/]+$/.test(path) && method==='PATCH') {
          const pid=path.split('/')[3], old=exists('projects',pid); version(old,data);
          const archived=data.archived===undefined?old.archived:+!!data.archived;
          if(archived && one('SELECT 1 FROM entries WHERE project_id=? AND end IS NULL AND deleted=0',pid)) fail(409,'Un chrono est encore actif sur ce projet. Son auteur doit l’arrêter.');
          const name=data.name===undefined?old.name:text(data.name,'Nom du projet',150);
          const color=data.color===undefined?old.color:data.color;
          if(color!==old.color&&!colors.includes(color))fail(400,'Choisissez une couleur de la palette.');
          run('UPDATE projects SET name=?,color=?,archived=?,version=version+1 WHERE id=?',name,color,archived,pid);
          const project=exists('projects',pid); store.audit(user,'project',pid,'update',old,project); return {project};
        }
        if(path==='/api/tasks' && method==='POST' || /^\/api\/tasks\/[^/]+$/.test(path) && method==='PATCH') {
          const old=method==='PATCH'?exists('tasks',path.split('/')[3]):null;
          if(old) { version(old,data); old.assignees=all('SELECT user_id FROM assignments WHERE task_id=?',old.id).map(x=>x.user_id); }
          const tid=old?.id??id(), project=exists('projects',data.project_id??old?.project_id??'');
          if(project.archived) fail(400,'Réactivez le projet avant de modifier ses tâches.');
          if(old && project.id!==old.project_id && one('SELECT 1 FROM entries WHERE task_id=?',tid)) fail(409,'Cette tâche a déjà des temps : créez une nouvelle tâche dans le projet souhaité pour préserver l’historique.');
          const name=text(data.name??old?.name,'Nom de la tâche',200), description=text(data.description??old?.description??'','Description',2000,false);
          const status=data.status??old?.status??'todo'; if(!['todo','doing','done'].includes(status)) fail(400,'Statut invalide.');
          const assignees=data.assignees??all('SELECT user_id FROM assignments WHERE task_id=?',tid).map(x=>x.user_id);
          if(!Array.isArray(assignees) || !assignees.length || assignees.length>100 || new Set(assignees).size!==assignees.length) fail(400,'Affectez au moins une personne, sans doublon.');
          for(const uid of assignees) if(!one('SELECT 1 FROM users WHERE id=? AND active=1',uid) && !(old?.assignees.includes(uid) && one('SELECT 1 FROM users WHERE id=?',uid))) fail(400,'Une personne affectée est inactive ou introuvable.');
          const archived=data.archived===undefined?(old?.archived??0):+!!data.archived;
          if(archived && one('SELECT 1 FROM entries WHERE task_id=? AND end IS NULL AND deleted=0',tid)) fail(409,'Un chrono est encore actif sur cette tâche.');
          if(old) run('UPDATE tasks SET name=?,description=?,project_id=?,status=?,archived=?,version=version+1 WHERE id=?',name,description,project.id,status,archived,tid);
          else run('INSERT INTO tasks(id,name,project_id,description,status,archived,created_by) VALUES (?,?,?,?,?,?,?)',tid,name,project.id,description,status,archived,user.id);
          run('DELETE FROM assignments WHERE task_id=?',tid);
          for(const uid of assignees) run('INSERT INTO assignments VALUES (?,?)',tid,uid);
          const task={...exists('tasks',tid),assignees}; store.audit(user,'task',tid,old?'update':'create',old,task); return {task};
        }
        if(path==='/api/timer/start' && method==='POST') {
          const current=one('SELECT * FROM entries WHERE user_id=? AND end IS NULL AND deleted=0',user.id);
          if((current?.id??null)!==(data.expectedRunningId??null) || current && current.version!==data.expectedVersion) fail(409,'Votre chrono a changé sur un autre appareil. Son état a été actualisé.','timer_conflict');
          const classification=store.classification(user,data.task_id,data.project_id), description=text(data.description??'','Description',2000,false);
          const now=Math.floor(Date.now()/1000)*1000;
          if(current) saveEntry(user,{...current,end:Math.max(now,current.start)},current);
          return {entry:saveEntry(user,{...classification,description,start:now,end:null})};
        }
        if(path==='/api/timer/stop' && method==='POST') {
          const entry=store.ownedEntry(user,data.id,data.version);
          if(entry.end!==null) fail(409,'Ce chrono est déjà arrêté.','timer_conflict');
          return {entry:saveEntry(user,{...entry,end:Math.max(entry.start,Math.floor(Date.now()/1000)*1000)},entry)};
        }
        if(path==='/api/entries' && method==='POST') {
          if(data.end===null) fail(400,'Utilisez le chrono pour démarrer une entrée en cours.');
          return {entry:saveEntry(user,entryData(user,data))};
        }
        if(/^\/api\/entries\/[^/]+$/.test(path) && method==='PATCH') {
          const entry=store.ownedEntry(user,path.split('/')[3],data.version);
          if(entry.end!==null && data.end===null) fail(400,'Utilisez Continuer pour reprendre cette activité.');
          return {entry:saveEntry(user,entryData(user,data,entry),entry)};
        }
        if(/^\/api\/entries\/[^/]+$/.test(path) && method==='DELETE') {
          const entry=store.ownedEntry(user,path.split('/')[3],data.version);
          if(entry.end===null) fail(400,'Arrêtez ce chrono avant de supprimer son entrée.');
          run('UPDATE entries SET deleted=1,version=version+1,updated_at=? WHERE id=?',Date.now(),entry.id);
          store.audit(user,'entry',entry.id,'delete',entry,exists('entries',entry.id),user.id); return {ok:true,id:entry.id};
        }
        if(/^\/api\/entries\/[^/]+\/restore$/.test(path) && method==='POST') {
          const eid=path.split('/')[3], entry=exists('entries',eid);
          if(entry.user_id!==user.id) fail(403,'Seul l’auteur peut restaurer cette entrée.');
          if(!entry.deleted) fail(409,'Cette entrée est déjà restaurée.');
          run('UPDATE entries SET deleted=0,version=version+1,updated_at=? WHERE id=?',Date.now(),eid);
          store.audit(user,'entry',eid,'restore',entry,exists('entries',eid),user.id); return {entry:exists('entries',eid)};
        }
        if(path==='/api/preferences' && method==='PATCH') {
          const previous=JSON.parse(one('SELECT preferences FROM users WHERE id=?',user.id).preferences), allowed={};
          if(data.taskProject!==undefined) {
            const change=data.taskProject;
            if(!change||typeof change!=='object'||Array.isArray(change)||typeof change.projectId!=='string'||
              !['pinned','collapsed'].some(key=>Object.hasOwn(change,key))||
              Object.keys(change).some(key=>!['projectId','pinned','collapsed'].includes(key))||
              ['pinned','collapsed'].some(key=>Object.hasOwn(change,key)&&typeof change[key]!=='boolean')) fail(400,'Préférence de projet invalide.');
            exists('projects',change.projectId);
            const settings={...previous.taskProjects}, flags={pinned:false,collapsed:false,...settings[change.projectId]};
            for(const key of ['pinned','collapsed'])if(Object.hasOwn(change,key))flags[key]=change[key];
            if(flags.pinned||flags.collapsed)settings[change.projectId]=flags;else delete settings[change.projectId];
            allowed.taskProjects=settings;
          }
          if(['timer','tasks','projects','clients','reports','settings','unclassified'].includes(data.page)) allowed.page=data.page;
          if(['list','calendar'].includes(data.timerView)) allowed.timerView=data.timerView;
          if(['mine','all'].includes(data.taskScope)) allowed.taskScope=data.taskScope;
          if(data.reportChart!==undefined) { if(!['columns','line','pie','bars'].includes(data.reportChart)) fail(400,'Type de graphique invalide.'); allowed.reportChart=data.reportChart; }
          if(data.calendarDays!==undefined) { if(![5,7].includes(data.calendarDays)) fail(400,'Choisissez 5 ou 7 jours.'); allowed.calendarDays=data.calendarDays; }
          if(data.calendarZoom!==undefined) { if(![50,75,100,125,150,200].includes(data.calendarZoom)) fail(400,'Niveau de zoom invalide.'); allowed.calendarZoom=data.calendarZoom; }
          if(data.calendarRange!==undefined) { if(!['full','workday','extended'].includes(data.calendarRange)) fail(400,'Plage horaire invalide.'); allowed.calendarRange=data.calendarRange; }
          if(data.calendarFit!==undefined) { if(typeof data.calendarFit!=='boolean')fail(400,'Ajustement du calendrier invalide.');allowed.calendarFit=data.calendarFit; }
          if(data.weeklyTargetMinutes!==undefined) { if(data.weeklyTargetMinutes!==null&&(!Number.isInteger(data.weeklyTargetMinutes)||data.weeklyTargetMinutes<0||data.weeklyTargetMinutes>10080)) fail(400,'L’objectif hebdomadaire doit être compris entre 0 et 168 heures.'); allowed.weeklyTargetMinutes=data.weeklyTargetMinutes; }
          if(data.balanceStartDate!==undefined) {
            if(typeof data.balanceStartDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(data.balanceStartDate)||data.balanceStartDate<'2000-01-01'||data.balanceStartDate>='2100-01-01') fail(400,'Date de début du suivi invalide.');
            midnight(data.balanceStartDate);
            if(new Date(data.balanceStartDate+'T12:00:00Z').getUTCDay()!==1) fail(400,'Choisissez le lundi de la première semaine à compter.');
            allowed.balanceStartDate=data.balanceStartDate;
          }
          if(data.reminderHour!==undefined) { if(!Number.isInteger(data.reminderHour)||data.reminderHour<0||data.reminderHour>23) fail(400,'Heure invalide.'); allowed.reminderHour=data.reminderHour; }
          run('UPDATE users SET preferences=? WHERE id=?',JSON.stringify({...previous,...allowed}),user.id); return {ok:true};
        }
        if(/^\/api\/users\/[^/]+\/username$/.test(path) && method==='PATCH') {
          if(user.role!=='admin') fail(403,'Seul un administrateur peut modifier les identifiants.');
          const target=exists('users',path.split('/')[3]);
          if(!target.active) fail(409,'Ce compte a été retiré de l’équipe.','inactive_user');
          const previousUsername=text(data.previousUsername,'Identifiant actuel',200);
          if(previousUsername!==target.username) fail(409,'Cet identifiant a changé. Fermez cette fenêtre puis rouvrez le compte actualisé.','version_conflict');
          const username=loginName({username:data.username},true);
          if(one('SELECT id FROM users WHERE username=? AND id!=?',username,target.id)) fail(409,'Cet identifiant est déjà utilisé par un autre compte.','username_taken');
          if(username!==target.username) {
            run('UPDATE users SET username=? WHERE id=?',username,target.id);
            store.audit(user,'user',target.id,'username-change',{id:target.id,username:target.username},{id:target.id,username});
          }
          return {ok:true,username};
        }
        if(/^\/api\/users\/[^/]+$/.test(path) && method==='DELETE') {
          if(user.role!=='admin') fail(403,'Seul un administrateur peut supprimer un utilisateur.');
          const target=exists('users',path.split('/')[3]);
          if(target.id===user.id) fail(400,'Vous ne pouvez pas supprimer votre propre compte.','own_account');
          if(text(data.confirmUsername,'Identifiant de confirmation',200)!==target.username) fail(409,'L’identifiant de confirmation ne correspond pas. Vérifiez le compte actualisé.','confirmation_mismatch');
          if(!target.active) return {ok:true,removed:true};
          if(store.effectiveRole(target)==='admin'&&one('SELECT COUNT(*) n FROM user_admins a JOIN users u ON u.id=a.user_id WHERE u.active=1').n<=1)fail(409,'Il faut conserver au moins un administrateur actif.','last_admin');
          if(one('SELECT 1 FROM entries WHERE user_id=? AND end IS NULL AND deleted=0',target.id)) fail(409,'Cette personne a un chrono en cours. Elle doit l’arrêter avant le retrait de son accès.','running_timer');
          run('UPDATE users SET active=0 WHERE id=?',target.id);
          run('DELETE FROM sessions WHERE user_id=?',target.id);
          store.audit(user,'user',target.id,'user-remove',{id:target.id,username:target.username,active:1},{id:target.id,username:target.username,active:0,sessionsRevoked:true});
          return {ok:true,removed:true};
        }
        if(/^\/api\/users\/[^/]+\/role$/.test(path) && method==='PATCH') {
          if(user.role!=='admin') fail(403,'Seul un administrateur peut modifier les rôles.');
          const target=exists('users',path.split('/')[3]),previousRole=store.effectiveRole(target);
          if(!target.active) fail(409,'Ce compte a été retiré de l’équipe.','inactive_user');
          if(data.previousRole!==previousRole) fail(409,'Le rôle a changé. Fermez cette fenêtre puis rouvrez le compte actualisé.','version_conflict');
          if(!['member','manager','admin'].includes(data.role))fail(400,'Rôle invalide.');
          if(data.role===previousRole)return {ok:true,role:previousRole};
          if(previousRole==='admin'&&data.role!=='admin'&&one('SELECT COUNT(*) n FROM user_admins a JOIN users u ON u.id=a.user_id WHERE u.active=1').n<=1)fail(409,'Il faut conserver au moins un administrateur actif.','last_admin');
          run('UPDATE users SET role=? WHERE id=?',data.role==='admin'?'manager':data.role,target.id);
          if(data.role==='admin')run('INSERT OR IGNORE INTO user_admins(user_id) VALUES (?)',target.id);
          else run('DELETE FROM user_admins WHERE user_id=?',target.id);
          run('DELETE FROM sessions WHERE user_id=?',target.id);
          store.audit(user,'user',target.id,'role-change',{id:target.id,role:previousRole},{id:target.id,role:data.role,sessionsRevoked:true});
          return {ok:true,role:data.role};
        }
        if(path==='/api/users' && method==='POST') {
          if(user.role!=='admin') fail(403,'Seul un administrateur peut gérer les comptes.');
          const name=text(data.name,'Nom',100),username=loginName(data,true),password=secret(data.password,true);
            const uid=id(),role=data.role??'member';
          if(!['member','manager','admin'].includes(role))fail(400,'Rôle invalide.');
          run('INSERT INTO users(id,name,username,password,role,color) VALUES (?,?,?,?,?,?)',uid,name,username,passwordHash(password),role==='admin'?'manager':role,colors[all('SELECT id FROM users').length%colors.length]);
          if(role==='admin')run('INSERT INTO user_admins(user_id) VALUES (?)',uid);
          store.audit(user,'user',uid,'create',null,{id:uid,name,username,role}); return {ok:true};
        }
        fail(404,'Route inconnue.');
      });
      return json(res,200,output);
    } catch(error) {
      const duplicate=error.message?.includes('UNIQUE constraint failed');
      context.errorStatus=duplicate?409:error instanceof AppError?error.status:500;
      context.error=duplicate?'duplicate':error instanceof AppError?error.code:'internal';
      if(context.errorStatus>=500)context.locations=[...new Set(error.stack?.match(/server[/\\][\w.-]+:\d+:\d+/g)??[])].slice(0,8);
      if(res.headersSent) { res.end(); return; }
      if(duplicate) return json(res,409,{error:'duplicate',message:'Cet élément existe déjà. Choisissez un autre nom ou actualisez la page.',requestId:context.requestId});
      if(!(error instanceof AppError)) console.error(JSON.stringify({event:'request-failed',requestId:context.requestId,locations:context.locations}));
      json(res,context.errorStatus,{error:context.error,message:error instanceof AppError?error.message:'Une erreur est survenue sur le serveur. Réessayez.',details:error instanceof AppError?error.details:undefined,requestId:context.requestId});
    }
  }));
  server.requestTimeout=30000;
  const heartbeat=setInterval(()=>{
    for(const stream of streams) {
      if(!one('SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.active=1',stream.token,Date.now())) { stream.res.write('event: auth\ndata: {}\n\n'); stream.res.end(); streams.delete(stream); }
      else stream.res.write(': heartbeat\n\n');
    }
    for(const [key,value] of attempts) if(value.until<Date.now()) attempts.delete(key);
  },15000); heartbeat.unref();
  async function close() { clearInterval(heartbeat); for(const s of streams) s.res.end(); streams.clear(); await new Promise(resolve=>server.close(resolve)); try { store.log({category:'system',action:'server-stop'}); } finally { db.close(); } }
  return {server,store,close};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const demo=process.argv.includes('--demo')||process.env.DEMO_MODE==='1';
  const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||4310);
  if(demo && host!=='127.0.0.1' && host!=='localhost') throw Error('Le mode démo doit écouter uniquement sur localhost.');
  const frontendDir=process.env.FRONTEND_DIR?resolve(process.env.FRONTEND_DIR):!process.argv.includes('--legacy')&&existsSync(join(root,'dist/web/index.html'))?join(root,'dist/web'):null;
  const app=createApplication({frontendDir,initialAdminUsername:process.env.INITIAL_ADMIN_USERNAME||'',dbPath:process.env.DATA_DIR?join(resolve(process.env.DATA_DIR),demo?'demo.sqlite':'teknika.sqlite'):join(root,'data',demo?'demo.sqlite':'teknika.sqlite'),demo,...accessConfig(process.env),setupToken:process.env.SETUP_TOKEN||''});
  app.server.listen(port,host,()=>console.log(`TimeTeknika ${demo?'(démo locale)':''} : http://${host}:${port}`));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await app.close(); process.exit(0);});
}
