import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { buildExport } from '../server/exports.mjs';

test('Constructeur : interactions des filtres, colonnes, regroupements, modèles et téléchargement',async t=>{
  const {document,window}=parseHTML('<html><body></body></html>');globalThis.document=document;
  const builder=await import('../public/export-builder.js');t.after(()=>{builder.stopExportBuilder(true);delete globalThis.document;});
  const state={me:{id:'a',role:'manager'},users:[{id:'a',name:'Alex',active:1},{id:'b',name:'Emma',active:1}],clients:[{id:'c',name:'Softcar'}],projects:[{id:'p',name:'REX',client_id:'c'}],tasks:[{id:'t',name:'Siège',project_id:'p',status:'doing'}],entries:[{id:'e',user_id:'a',task_id:'t',project_id:'p',description:'Test',start:Date.parse('2026-10-26T07:00:00Z'),end:Date.parse('2026-10-26T08:00:00Z')}],exportTemplates:[]};
  let lastConfig,download,notice;
  const wait=()=>new Promise(resolve=>setTimeout(resolve,310));
  const api=async(path,{data,method})=>{
    if(path==='/api/exports/preview'){lastConfig=structuredClone(data.config);const result=buildExport(state.entries,state,data.config,state.me,Date.parse('2026-10-29T12:00:00Z'));return {...result,rowCount:result.rows.length};}
    if(path==='/api/export-templates'&&method==='POST'){const template={id:'model',name:data.name,config:data.config,version:1};state.exportTemplates.push(template);return {template};}
    throw Error('Unexpected endpoint: '+path);
  };
  function render(){builder.startExportBuilder(state,{from:'2026-10-26',to:'2026-10-29'});document.body.innerHTML=builder.renderExportBuilder(state,()=>'<svg></svg>');builder.bindExportBuilder({root:document.querySelector('.export-builder'),state:()=>state,api,render,refresh:async()=>render(),notify:message=>notice=message,download:async(config,format)=>{download={config,format};}});}
  const dispatch=(el,type)=>el.dispatchEvent(new window.Event(type,{bubbles:true}));
  const command=(name,extra='')=>dispatch(document.querySelector(`[data-export-command="${name}"]${extra}`),'click');
  const input=(selector,value)=>{const el=document.querySelector(selector);el.value=value;dispatch(el,'input');};
  const change=(selector,value)=>{const el=document.querySelector(selector);if(el.tagName==='SELECT')Object.defineProperty(el,'value',{value,configurable:true});else el.checked=value;dispatch(el,'change');};
  render();await wait();assert.equal(lastConfig.mode,'summary');assert.deepEqual(lastConfig.groups,['client','project','task','person']);assert.equal(lastConfig.subtotals,false);assert.equal(document.querySelectorAll('#export-preview-body tbody tr').length,2);
  change('#export-mode','detail');await wait();assert.ok(lastConfig.columns.some(c=>c.key==='description'));
  command('multi-none','[data-kind="clients"]');await wait();assert.deepEqual(lastConfig.filters.clients,[]);assert.match(document.querySelector('.export-preview-metrics').textContent,/0 entrées/);
  change('[data-multi="clients"][value="c"]',true);await wait();assert.deepEqual(lastConfig.filters.clients,['c']);assert.match(document.querySelector('.export-preview-metrics').textContent,/1 entrées/);
  change('[data-column="description"]',false);input('#export-label-duration','Temps réalisé');await wait();assert.ok(!lastConfig.columns.some(c=>c.key==='description'));assert.equal(lastConfig.columns.find(c=>c.key==='duration').label,'Temps réalisé');
  command('column-up','[data-id="duration"]');await wait();assert.equal(lastConfig.columns.at(-2).key,'duration');
  change('#export-mode','summary');await wait();assert.equal(lastConfig.mode,'summary');assert.ok(lastConfig.columns.every(c=>!['description','start','end'].includes(c.key)));
  command('group-remove','[data-id="person"]');change('#export-add-group','day');input('#export-doc-reference','FAC-2026-042');await wait();assert.deepEqual(lastConfig.groups,['client','project','task','day']);assert.equal(lastConfig.document.reference,'FAC-2026-042');
  change('[data-export-entry="e"]',false);await wait();assert.deepEqual(lastConfig.excluded,['e']);command('include-all');await wait();assert.deepEqual(lastConfig.excluded,[]);
  input('#export-template-name','Mensuel Softcar');command('save-template');await wait();assert.equal(state.exportTemplates.length,1);assert.equal(notice,'Modèle enregistré sur le serveur.');
  command('download','[data-format="pdf"]');await wait();assert.equal(download.format,'pdf');assert.equal(download.config.document.reference,'FAC-2026-042');
  command('task-person-summary');await wait();assert.deepEqual(lastConfig.groups,['client','project','task','person']);assert.equal(lastConfig.subtotals,false);assert.equal(lastConfig.document.reference,'FAC-2026-042');assert.deepEqual(lastConfig.filters.clients,['c']);
  builder.stopExportBuilder(true);state.me={id:'b',role:'member'};render();await wait();assert.equal(document.querySelector('[data-multi="people"]'),null);assert.equal(lastConfig.filters.people,null);assert.match(document.querySelector('.export-preview-metrics').textContent,/0 entrées/);
});
