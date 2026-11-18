import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildExport, exportPeriod } from '../server/exports.mjs';
import { csvExport, xlsxExport, pdfExport } from '../server/export-files.mjs';
import { defaultExportConfig, taskPersonExportConfig, EXPORT_COLUMNS } from '../public/export-config.js';
import { midnight } from '../server/domain.mjs';
import { createApplication } from '../server/index.mjs';

const manager={id:'alice',role:'manager'},member={id:'alice',role:'member'};
const lookups={users:[{id:'alice',name:'Alex Martin'},{id:'bob',name:'Emma Laurent'}],clients:[{id:'c1',name:'Softcar'},{id:'c2',name:'Métallover'}],projects:[{id:'p1',name:'REX',client_id:'c1'},{id:'p2',name:'REX',client_id:'c2',archived:1}],tasks:[{id:'t1',name:'Siège Alu',project_id:'p1',status:'doing'},{id:'t2',name:'Siège Alu',project_id:'p2',status:'done',archived:1}]};
const ms=Date.parse,at=ms('2026-10-29T12:00:00Z');
const entry=(id,user_id,task_id,project_id,start,end,description='',extra={})=>({id,user_id,task_id,project_id,start:ms(start),end:end===null?null:ms(end),description,...extra});
const entries=[
  entry('e1','alice','t1','p1','2026-10-26T07:00:00Z','2026-10-26T08:30:00Z','Étude des pièces'),
  entry('e2','bob','t1','p1','2026-10-26T09:00:00Z','2026-10-26T11:00:00Z','Montage'),
  entry('e3','alice','t2','p2','2026-10-27T07:00:00Z','2026-10-27T08:00:00Z','=HYPERLINK("x")'),
  entry('e4','alice',null,null,'2026-10-28T22:30:00Z','2026-10-29T00:30:00Z','À cheval sur minuit'),
  entry('e5','bob','t1','p1','2026-10-29T11:00:00Z',null,'Chrono actif'),
  entry('e6','alice','t1','p1','2026-10-26T12:00:00Z','2026-10-26T13:00:00Z','Supprimée',{deleted:1})
];
const config=()=>defaultExportConfig('2026-10-26','2026-10-29');

test('Exports : sélection multiple, droits, exclusions, archives et entrées non classées',()=>{
  const c=config();let result=buildExport(entries,lookups,c,manager,at);
  assert.equal(result.entryCount,4);assert.equal(result.totalSeconds,23400);assert.equal(result.runningCount,0);
  assert.equal(buildExport(entries,lookups,c,member,at).totalSeconds,16200);
  c.filters.people=['bob'];assert.throws(()=>buildExport(entries,lookups,c,member,at),e=>e.status===403);
  c.filters.people=['alice','bob'];c.filters.clients=['c1'];c.filters.projects=['p1'];c.filters.tasks=['t1'];
  assert.equal(buildExport(entries,lookups,c,manager,at).totalSeconds,12600);
  c.excluded=['e1'];assert.equal(buildExport(entries,lookups,c,manager,at).totalSeconds,7200);
  c.filters.people=[];assert.equal(buildExport(entries,lookups,c,manager,at).entryCount,0);
  const q=config();q.filters.query='etude';assert.equal(buildExport(entries,lookups,q,manager,at).entryCount,1);
  q.filters.query='';q.filters.classification='unclassified';assert.equal(buildExport(entries,lookups,q,manager,at).totalSeconds,7200);
  q.filters.classification='all';q.filters.clients=['c2'];assert.equal(buildExport(entries,lookups,q,manager,at).entryCount,1);
});

test('Exports : période suisse, découpage, chronos figés et regroupements par identité',()=>{
  const c=config();c.filters.timers='all';let result=buildExport(entries,lookups,c,manager,at);
  assert.equal(result.totalSeconds,27000);assert.equal(result.runningCount,1);
  c.period.from='2026-10-29';result=buildExport(entries,lookups,c,manager,at);assert.equal(result.totalSeconds,9000);
  assert.equal(result.rows.find(r=>r.id==='e4').start,'29.10.2026 00:00:00');
  const s=config();s.mode='summary';s.groups=['project','task'];s.columns=[{key:'project',label:'Projet'},{key:'task',label:'Tâche'},{key:'duration',label:'Durée'}];
  result=buildExport(entries,lookups,s,manager,at);
  assert.equal(result.rows.filter(r=>r.type==='summary'&&r.project==='REX').length,2);
  assert.equal(result.rows.filter(r=>r.type==='summary').reduce((sum,r)=>sum+r.seconds,0),result.totalSeconds);
  s.groups=['person','day'];s.columns=[{key:'person',label:'Personne'},{key:'day',label:'Jour'},{key:'duration',label:'Durée'},{key:'count',label:'Entrées'}];
  result=buildExport(entries,lookups,s,manager,at);
  assert.equal(result.rows.find(r=>r.type==='summary'&&r.person==='Alex Martin'&&r.day==='2026-10-28').seconds,1800);
  assert.equal(result.rows.find(r=>r.type==='summary'&&r.person==='Alex Martin'&&r.day==='2026-10-29').seconds,5400);
  assert.equal(result.rows.at(-1).count,4);
  const boundary=[entry('dst','alice','t1','p1','2026-10-24T22:00:00Z','2026-10-25T23:00:00Z')];
  s.period.from='2026-10-25';s.period.to='2026-10-25';result=buildExport(boundary,lookups,s,manager,at);assert.equal(result.totalSeconds,25*3600);
  assert.deepEqual(exportPeriod({preset:'lastMonth'},at),{from:'2026-09-01',to:'2026-09-30',begin:midnight('2026-09-01'),end:midnight('2026-10-01')});
  assert.equal(exportPeriod({preset:'lastWeek'},at).from,'2026-10-19');
});

test('Exports : validation stricte et total cohérent dans CSV, Excel et PDF',async()=>{
  const c=config();c.columns=[{key:'description',label:'Prestation'},{key:'duration',label:'Temps'},{key:'decimal',label:'Heures'}];
  assert.throws(()=>buildExport(entries,lookups,{...c,columns:[]},manager,at),e=>e.status===400);
  assert.throws(()=>buildExport(entries,lookups,{...c,mode:'summary'},manager,at),e=>e.status===400);
  assert.throws(()=>buildExport(entries,lookups,{...c,groups:['evil']},manager,at),e=>e.status===400);
  const model=buildExport(entries,lookups,c,manager,at),csv=csvExport(model).toString('utf8');
  assert.ok(csv.startsWith('\uFEFF"Prestation";"Temps";"Heures"'));assert.ok(csv.includes('"\'=HYPERLINK'));assert.ok(csv.includes('6:30:00'));
  const xlsx=await xlsxExport(model),wb=new ExcelJS.Workbook();await wb.xlsx.load(xlsx);const sheet=wb.getWorksheet(1);
  assert.equal(sheet.getCell('A6').value,'Prestation');assert.equal(sheet.getCell('B7').numFmt,'[h]:mm:ss');
  const result=sheet.getCell('B11').value.result;
  assert.equal(result instanceof Date?(result.getTime()-Date.UTC(1899,11,30))/86400000:result,23400/86400);assert.ok(sheet.getCell('B11').value.formula.startsWith('SUM('));
  assert.equal(sheet.getCell('A9').value,'=HYPERLINK("x")');assert.equal(sheet.getCell('A9').type,ExcelJS.ValueType.String);
  const pdf=await pdfExport(model);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>5000);assert.equal([...pdf.toString('latin1').matchAll(/\/Type \/Page\b/g)].length,1);
});

test('Exports HTTP : fichiers privés, CSRF, modèles versionnés et données synchronisées',async t=>{
  const app=await createApplication({dbPath:':memory:',demo:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  async function login(id){const res=await fetch(base+'/api/demo-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:id})});const json=await res.json();return {Cookie:res.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':json.csrf,'Content-Type':'application/json'};}
  const alice=await login('demo-alex'),emma=await login('demo-emma'),same=await login('demo-alex');
  const req=(headers,path,method='POST',data={},key=crypto.randomUUID())=>fetch(base+path,{method,headers:{...headers,'Idempotency-Key':key},body:method==='GET'?undefined:JSON.stringify(data)});
  const c=config(),key=crypto.randomUUID();c.excluded=['test'];c.document.reference='FAC-001';
  let response=await req(alice,'/api/export-templates','POST',{name:'Relevé mensuel',config:c},key);assert.equal(response.status,200);const saved=(await response.json()).template;
  assert.deepEqual(saved.config.excluded,[]);assert.equal(saved.config.document.reference,'');
  response=await req(alice,'/api/export-templates','POST',{name:'Relevé mensuel',config:c},key);assert.equal((await response.json()).template.id,saved.id);
  assert.equal((await (await req(same,'/api/state','GET')).json()).exportTemplates.length,1);
  assert.equal((await (await req(emma,'/api/state','GET')).json()).exportTemplates.length,0);
  assert.equal((await req(emma,'/api/export-templates/'+saved.id,'DELETE',{version:1})).status,404);
  assert.equal((await req(alice,'/api/export-templates/'+saved.id,'PATCH',{name:'Nouveau nom',config:c,version:1})).status,200);
  assert.equal((await req(alice,'/api/export-templates/'+saved.id,'PATCH',{name:'Ancien',config:c,version:1})).status,409);
  assert.equal((await req({...alice,'X-CSRF-Token':'bad'},'/api/exports/download','POST',{config:c,format:'csv'})).status,403);
  assert.equal((await req({},'/api/exports/preview','POST',{config:c})).status,401);
  c.filters.people=['demo-alex'];assert.equal((await req(emma,'/api/exports/download','POST',{config:c,format:'pdf'})).status,403);
  c.filters.people=null;for(const format of ['csv','xlsx','pdf']){response=await req(emma,'/api/exports/download','POST',{config:c,format});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.match(response.headers.get('content-disposition'),new RegExp('\\.'+format));assert.ok((await response.arrayBuffer()).byteLength>0);}
  assert.equal((await req(alice,'/api/export-templates/'+saved.id,'DELETE',{version:2})).status,200);
  assert.equal((await (await req(same,'/api/state','GET')).json()).exportTemplates.length,0);
});

test('Synthèse tâche/personne : plusieurs jours cumulés, personnes et tâches homonymes séparées dans les fichiers',async()=>{
  const extra=[
    entry('repeat','alice','t1','p1','2026-10-28T07:00:00Z','2026-10-28T07:45:00Z','Autre description'),
    entry('bob-repeat','bob','t1','p1','2026-10-27T07:00:00Z','2026-10-27T07:30:00Z'),
    entry('no-task','alice',null,'p1','2026-10-28T10:00:00Z','2026-10-28T10:15:00Z')
  ];
  const c=taskPersonExportConfig(config()),model=buildExport([...entries,...extra],lookups,c,manager,at);
  const rows=model.rows.filter(r=>r.type==='summary');
  assert.equal(rows.length,5);assert.ok(!model.rows.some(r=>r.type==='subtotal'));
  const alex=rows.find(r=>r.client==='Softcar'&&r.task==='Siège Alu'&&r.person==='Alex Martin');
  assert.equal(alex.seconds,8100);assert.equal(alex.count,2);
  const emma=rows.find(r=>r.task==='Siège Alu'&&r.person==='Emma Laurent');assert.equal(emma.seconds,9000);assert.equal(emma.count,2);
  assert.equal(rows.filter(r=>r.task==='À classer').length,2);
  assert.equal(rows.reduce((sum,r)=>sum+r.seconds,0),model.totalSeconds);
  const homonyms=structuredClone(lookups);homonyms.users[1].name='Alex Martin';
  assert.equal(buildExport([...entries,...extra],homonyms,c,manager,at).rows.filter(r=>r.type==='summary').length,5);
  c.excluded=['repeat'];assert.equal(buildExport([...entries,...extra],lookups,c,manager,at).rows.find(r=>r.type==='summary'&&r.client==='Softcar'&&r.task==='Siège Alu'&&r.person==='Alex Martin').seconds,5400);
  const csv=csvExport(model).toString('utf8');assert.ok(csv.includes('2:15:00'));assert.ok(csv.includes('2:30:00'));
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(await xlsxExport(model));const sheet=wb.getWorksheet(1);
  const data=[];sheet.eachRow(row=>{if(row.getCell(4).value==='Alex Martin'&&row.getCell(3).value==='Siège Alu'&&row.getCell(1).value==='Softcar')data.push(row);});
  assert.equal(data.length,1);assert.equal(data[0].getCell(5).numFmt,'[h]:mm:ss');
  const pdf=await pdfExport(model);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
});
