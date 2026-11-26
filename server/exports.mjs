import { fail, midnight, nextDate, dateInZone, text, searchText } from './domain.mjs';
import { EXPORT_COLUMNS, EXPORT_GROUPS, EXPORT_PERIODS, availableExportColumns } from '../public/export-config.js';

const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const choice=(value,choices,label)=>{if(!choices.includes(value))fail(400,`${label} invalide.`);return value;};
const shift=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const monday=day=>shift(day,-((new Date(day+'T12:00:00Z').getUTCDay()+6)%7));
export function exportPeriod(period,timestamp=Date.now()) {
  const today=dateInZone(timestamp),startMonth=today.slice(0,7)+'-01';
  let from=period.from,to=period.to;
  if(period.preset==='week'||period.preset==='lastWeek'){from=shift(monday(today),period.preset==='lastWeek'?-7:0);to=shift(from,6);}
  if(period.preset==='month'||period.preset==='lastMonth'){
    from=period.preset==='lastMonth'?shift(startMonth,-1).slice(0,7)+'-01':startMonth;
    const month=new Date(from+'T12:00:00Z');month.setUTCMonth(month.getUTCMonth()+1);to=shift(month.toISOString().slice(0,10),-1);
  }
  const begin=midnight(from),end=midnight(nextDate(to));
  if(end<=begin||end-begin>370*86400000)fail(400,'Choisissez une période comprise entre 1 et 370 jours.');
  return {from,to,begin,end};
}
export function omitTaskStatus(config) {
  const changeColumns = Array.isArray(config?.columns) && config.columns.some(column => column?.key === 'status');
  const changeSort = config?.sort?.key === 'status';
  if (!changeColumns && !changeSort) return config;

  const columns = changeColumns ? config.columns.filter(column => column?.key !== 'status') : config.columns;
  return {
    ...config,
    columns: changeColumns && !columns.length ? [{ key: 'duration', label: 'Durée' }] : columns,
    sort: changeSort ? { ...config.sort, key: 'start' } : config.sort,
  };
}
export function validateExportConfig(input,user) {
  if(!object(input)||!object(input.filters)||!object(input.period)||!object(input.document)||!object(input.sort))fail(400,'Configuration d’export invalide.');
  const config=omitTaskStatus(structuredClone(input));
  config.version=1;config.mode=choice(config.mode,['detail','summary'],'Présentation');
  choice(config.period.preset,EXPORT_PERIODS.map(([v])=>v),'Période');
  if(config.period.preset==='custom'){midnight(config.period.from);midnight(config.period.to);}
  const ids=(value,label,limit=500)=>{if(!Array.isArray(value)||value.length>limit||value.some(v=>typeof v!=='string'||v.length>100))fail(400,`${label} invalide.`);return [...new Set(value)];};
  for(const key of ['people','clients','projects','tasks'])if(config.filters[key]!==null)config.filters[key]=ids(config.filters[key],key);
  if(!['manager','admin'].includes(user.role)&&config.filters.people?.some(value=>value!==user.id))fail(403,'Vous pouvez exporter uniquement vos propres heures.');
  config.filters.query=text(config.filters.query??'','Recherche',200,false);
  choice(config.filters.classification,['all','classified','unclassified'],'Classement');
  choice(config.filters.timers,['all','stopped','running'],'Chronos');
  config.groups=ids(config.groups,'Regroupements',7);
  if(config.groups.some(g=>!EXPORT_GROUPS.includes(g)))fail(400,'Regroupement invalide.');
  if(config.mode==='summary'&&!config.groups.length)fail(400,'Choisissez au moins un regroupement.');
  const allowed=new Set(availableExportColumns(config).map(c=>c.key));
  if(!Array.isArray(config.columns)||!config.columns.length||config.columns.length>EXPORT_COLUMNS.length)fail(400,'Choisissez au moins une colonne.');
  const used=new Set();config.columns=config.columns.map(c=>{
    if(!object(c)||!allowed.has(c.key)||used.has(c.key))fail(400,'Colonne incompatible ou répétée.');
    used.add(c.key);return {key:c.key,label:text(c.label,'Titre de colonne',80)};
  });
  choice(config.sort.key,EXPORT_COLUMNS.map(c=>c.key),'Tri');choice(config.sort.direction,['asc','desc'],'Sens du tri');
  if(typeof config.total!=='boolean'||typeof config.subtotals!=='boolean')fail(400,'Options de total invalides.');
  config.excluded=ids(config.excluded,'Entrées exclues',2000);
  config.document={title:text(config.document.title,'Titre',120),company:text(config.document.company??'','Émetteur',120,false),reference:text(config.document.reference??'','Référence',100,false),note:text(config.document.note??'','Note',1000,false),orientation:choice(config.document.orientation,['auto','portrait','landscape'],'Orientation')};
  return config;
}
const clock=value=>new Intl.DateTimeFormat('fr-CH',{timeZone:'Europe/Zurich',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(value);
const dateValues=day=>({day,week:monday(day),month:day.slice(0,7)});
const collator=new Intl.Collator('fr',{numeric:true,sensitivity:'base'});
const compare=(a,b,key)=>typeof a[key]==='number'?a[key]-b[key]:collator.compare(a[key]??'',b[key]??'');
export function buildExport(entries,lookups,input,user,timestamp=Date.now()) {
  const config=validateExportConfig(input,user),period=exportPeriod(config.period,timestamp),f=config.filters;
  const maps=Object.fromEntries(['projects','tasks','clients','users'].map(k=>[k,new Map(lookups[k].map(v=>[v.id,v]))]));
  const selected=(values,id)=>values===null||values.includes(id??'__none__');
  const excluded=new Set(config.excluded),source=[],kept=[];
  for(const entry of entries){
    if(entry.deleted||!['manager','admin'].includes(user.role)&&entry.user_id!==user.id)continue;
    const p=maps.projects.get(entry.project_id),t=maps.tasks.get(entry.task_id),c=maps.clients.get(p?.client_id);
    const start=Math.max(entry.start,period.begin),end=Math.min(entry.end??timestamp,period.end);
    if(end<start||end===start&&!(entry.start>=period.begin&&entry.start<period.end))continue;
    if(!selected(f.people,entry.user_id)||!selected(f.clients,c?.id)||!selected(f.projects,p?.id)||!selected(f.tasks,t?.id))continue;
    if(f.classification==='classified'&&!t||f.classification==='unclassified'&&t)continue;
    if(f.timers==='stopped'&&entry.end===null||f.timers==='running'&&entry.end!==null)continue;
    if(f.query&&!searchText(entry.description).includes(searchText(f.query)))continue;
    const seconds=Math.max(0,Math.floor((end-start)/1000));
    const row={id:entry.id,entry,startMs:start,endMs:end,seconds,person:maps.users.get(entry.user_id)?.name??'Ancien membre',client:c?.name??'Sans client',project:p?.name??'Sans projet',task:t?.name??'À classer',description:entry.description,
      ...dateValues(dateInZone(start)),start:clock(start),end:clock(end),duration:seconds,decimal:seconds/3600,count:1,timer:entry.end===null?'En cours':'Arrêté',
      identities:{person:entry.user_id,client:c?.id??null,project:p?.id??null,task:t?.id??null}};
    source.push({id:row.id,person:row.person,day:row.day,project:row.project,task:row.task,description:row.description,seconds,excluded:excluded.has(row.id)});
    if(!excluded.has(row.id))kept.push(row);
    if(source.length>20000)fail(413,'Plus de 20 000 entrées : réduisez la période de l’export.');
  }
  const sum=rows=>rows.reduce((n,r)=>n+r.seconds,0),totalSeconds=sum(kept),rows=[];
  if(config.mode==='detail'){
    kept.sort((a,b)=>(config.sort.key==='start'?a.startMs-b.startMs:config.sort.key==='end'?a.endMs-b.endMs:compare(a,b,config.sort.key))*(config.sort.direction==='desc'?-1:1)||a.id.localeCompare(b.id));
    rows.push(...kept.map(({entry,identities,startMs,endMs,...r})=>({...r,type:'detail'})));
  }else{
    const root={children:new Map(),seconds:0,ids:new Set(),values:{},path:[]};let segments=0;
    for(const entry of kept){
      const split=config.groups.some(g=>['day','week','month'].includes(g));let start=entry.startMs;
      do {
        const day=dateInZone(start),end=split?Math.min(entry.endMs,midnight(nextDate(day))):entry.endMs;
        const sec=Math.max(0,Math.floor((end-start)/1000)),values={...entry,...dateValues(day)};
        let node=root;node.seconds+=sec;node.ids.add(entry.id);
        for(const key of config.groups){
          const identity=key in entry.identities?entry.identities[key]:values[key];
          if(!node.children.has(identity))node.children.set(identity,{children:new Map(),seconds:0,ids:new Set(),values:{...node.values,[key]:values[key]},path:[...node.path,values[key]],identity:String(identity??'')});
          node=node.children.get(identity);node.seconds+=sec;node.ids.add(entry.id);
        }
        start=end;if(++segments>100000)fail(413,'Trop de lignes : réduisez la période ou les regroupements.');
      }while(split&&start<entry.endMs);
    }
    const emit=node=>{
      if(!node.children.size){rows.push({...node.values,type:'summary',seconds:node.seconds,duration:node.seconds,decimal:node.seconds/3600,count:node.ids.size});return;}
      const children=[...node.children.values()],level=node.path.length,key=config.groups[level];
      children.sort((a,b)=>{
        const numeric=['duration','decimal','count'].includes(config.sort.key)&&level===config.groups.length-1;
        const order=numeric?(config.sort.key==='count'?a.ids.size-b.ids.size:a.seconds-b.seconds):collator.compare(a.values[key],b.values[key]);
        return order*(config.sort.direction==='desc'?-1:1)||a.identity.localeCompare(b.identity);
      });
      for(const child of children)emit(child);
      if(config.subtotals&&node.path.length)rows.push({...node.values,type:'subtotal',caption:'Sous-total · '+node.path.join(' / '),seconds:node.seconds,duration:node.seconds,decimal:node.seconds/3600,count:node.ids.size});
    };
    if(root.children.size)emit(root);
  }
  if(config.total)rows.push({type:'total',caption:'Total général',seconds:totalSeconds,duration:totalSeconds,decimal:totalSeconds/3600,count:kept.length});
  return {config,period:{from:period.from,to:period.to},asOf:timestamp,rows,source,totalSeconds,entryCount:kept.length,excludedCount:source.length-kept.length,runningCount:kept.filter(r=>r.entry.end===null).length,timezone:'Europe/Zurich'};
}
