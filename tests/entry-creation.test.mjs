import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import { normalizeTaskSearch, compareTaskProjects } from '../public/task-projects.js';
import { projectColorOptions, PROJECT_COLORS } from '../public/project-colors.js';

const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const selectors=source.slice(source.indexOf('function entrySelectors('),source.indexOf('function editEntry('));
const favicon=source.slice(source.indexOf('function updateTimerFavicon('),source.indexOf('const get='));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(request){
  const {document,window}=parseHTML('<html><head><link rel="icon" href="/favicon.svg"></head><body><dialog open id="dialog"><form id="modal-form"><textarea name="description">Notes à conserver</textarea><input name="start" value="2026-11-10T08:00"><input name="end" value="2026-11-10T09:00"><div class="form-error"></div><button type="submit">Enregistrer</button></form></dialog></body></html>');
  const $=(s,root=document)=>root.querySelector(s),$$=(s,root=document)=>[...root.querySelectorAll(s)];
  const state={me:{id:'me'},users:[{id:'me',name:'Alex',active:1}],clients:[{id:'c',name:'Softcar'}],projects:[{id:'p',name:'REX',client_id:'c',color:'#729fd0'}],tasks:[{id:'t',name:'Siège',project_id:'p',assignees:['me']}],entries:[]};
  const dialog=$('#dialog');dialog.open=true;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let refreshes=0;const calls=[];
  const context={document,state,dialog,$,$$,esc,crypto,normalizeTaskSearch,compareTaskProjects,projectColorOptions,
    get:(list,id)=>state[list].find(x=>x.id===id),icon:()=>'<svg></svg>',initials:name=>name[0],avatar:()=>'',avatars:()=>'',
    field:(label,html)=>`<label>${label}${html}</label>`,
    options:(items,selected)=>`<option value="">Choisir…</option>`+items.map(x=>`<option value="${x.id}" ${x.id===selected?'selected':''}>${esc(x.name)}</option>`).join(''),
    decorateSelects:()=>{},bindTaskProjectControls:()=>groups=>groups,groupedTasks:()=>[],taskGroupsHTML:()=>'',taskProjectPreferences:()=>({}),replaceTaskChoices:(el,html)=>{el.innerHTML=html;},toast:()=>{},
    refresh:async()=>{refreshes++;},running:()=>state.entries.find(e=>e.user_id===state.me.id&&e.end===null),
    api:async(path,options)=>{calls.push(structuredClone({path,...options}));return request?request(path,options,calls.length):{[path.endsWith('projects')?'project':'task']:{id:'new',...options.data}};}
  };
  runInNewContext(selectors+'\n'+favicon,context);
  $('#modal-form').insertAdjacentHTML('afterbegin',context.entrySelectors({task_id:'t',project_id:'p'}));
  context.bindEntrySelectors({task_id:'t',project_id:'p'});
  const click=selector=>{assert.ok($(selector),selector);$(selector).dispatchEvent(new window.Event('click',{bubbles:true}));};
  const fill=(selector,value)=>{const el=$(selector);if(el.tagName==='SELECT')Object.defineProperty(el,'value',{value,configurable:true});else el.value=value;};
  const validate=()=>$$('input,select').forEach(el=>{el.reportValidity=()=>!el.hasAttribute('required')||!!el.value;});
  const begin=(kind='project',query='Nouveau chantier')=>{click(`[data-entry-picker="${kind}"]`);fill('.entry-choice-search input',query);click('[data-entry-create]');validate();};
  return {$,$$,state,calls,context,click,fill,begin,window,refreshes:()=>refreshes};
}

test('Saisie : créer un projet sélectionne son client et conserve la description et les horaires',async()=>{
  const f=fixture();f.begin();
  assert.equal(f.$('#entry-new-project-name').value,'Nouveau chantier');
  assert.equal(f.$('#entry-new-project-client').value,'c');
  assert.equal(f.$$('#entry-new-project-color option').length,15);
  assert.equal(f.$('[type="submit"]').disabled,true);
  f.fill('#entry-new-project-description','Contexte du projet');f.fill('#entry-new-project-color','#729fd0');
  f.click('[data-entry-create-save]');await flush();
  assert.equal(f.calls[0].path,'/api/projects');assert.equal(f.calls[0].data.description,'Contexte du projet');
  assert.equal(f.calls[0].data.color,'#729fd0');assert.equal(f.calls[0].data.client_id,'c');
  assert.equal(f.$('[name="project_id"]').value,'new');assert.equal(f.$('[name="task_id"]').value,'');assert.equal(f.$('[name="client_id"]').value,'c');
  assert.equal(f.$('[name="description"]').value,'Notes à conserver');assert.equal(f.$('[name="start"]').value,'2026-11-10T08:00');assert.equal(f.$('[name="end"]').value,'2026-11-10T09:00');
  assert.equal(f.$('#entry-choice-panel').hidden,true);assert.equal(f.$('[type="submit"]').disabled,false);assert.equal(f.refreshes(),1);
});

test('Palette : 15 couleurs distinctes et conservation des couleurs historiques',()=>{
  assert.equal(PROJECT_COLORS.length,15);assert.equal(new Set(PROJECT_COLORS.map(c=>c.value)).size,15);
  const {document}=parseHTML(`<select>${projectColorOptions('#123456')}</select>`);
  assert.equal(document.querySelectorAll('option').length,16);
  assert.equal(document.querySelector('[selected]').value,'#123456');
  assert.equal(document.querySelector('[selected]').textContent,'Couleur actuelle');
  assert.ok(!projectColorOptions('" onclick="bad').includes('onclick'));
});

test('Saisie : annuler revient aux projets filtrés sans modifier le classement',()=>{
  const f=fixture();f.begin('project','Chantier');f.click('[data-entry-create-cancel]');
  assert.equal(f.$('.entry-choice-search input').value,'Chantier');assert.match(f.$('.entry-choice-heading').textContent,/Softcar/);
  assert.equal(f.$('[name="task_id"]').value,'t');assert.equal(f.$('[name="project_id"]').value,'p');assert.equal(f.calls.length,0);
  assert.equal(f.$('[type="submit"]').disabled,false);
});

test('Saisie : une réponse perdue réutilise la même clé et bloque les créations concurrentes',async()=>{
  let release;const f=fixture(async(path,{data},attempt)=>{
    if(attempt===1){await new Promise(resolve=>{release=resolve;});throw Object.assign(Error('Hors ligne'),{network:true});}
    return {project:{id:'new',...data}};
  });
  f.begin();f.fill('#entry-new-project-color','#729fd0');f.click('[data-entry-create-save]');f.click('[data-entry-create-save]');
  assert.equal(f.calls.length,1);release();await flush();
  assert.match(f.$('.entry-task-create-error').textContent,/sans doublon/);assert.equal(f.$('.entry-task-create-fields').disabled,true);
  f.click('[data-entry-create-save]');await flush();
  assert.equal(f.calls.length,2);assert.equal(f.calls[0].key,f.calls[1].key);assert.deepEqual(f.calls[0].data,f.calls[1].data);
  assert.equal(f.state.projects.filter(p=>p.id==='new').length,1);
});

test('Saisie : validation et erreur serveur laissent le projet modifiable',async()=>{
  const f=fixture(async()=>{throw Error('Client indisponible');});f.begin();f.fill('#entry-new-project-name','   ');f.click('[data-entry-create-save]');await flush();assert.equal(f.calls.length,0);
  f.fill('#entry-new-project-name','Chantier');f.click('[data-entry-create-save]');await flush();
  assert.equal(f.$('.entry-task-create-error').textContent,'Client indisponible');assert.equal(f.$('.entry-task-create-fields').disabled,false);assert.equal(f.$('[name="project_id"]').value,'p');
});

test('Saisie : création de tâche existante toujours disponible',async()=>{
  const f=fixture();f.begin('task','Plans');f.fill('#entry-new-task-project','p');f.click('[data-entry-create-save]');await flush();
  assert.equal(f.calls[0].path,'/api/tasks');assert.deepEqual(f.calls[0].data.assignees,['me']);
  assert.equal(f.$('[name="task_id"]').value,'new');assert.equal(f.$('[name="project_id"]').value,'p');
});

test('Logo : suit uniquement le chrono personnel et revient au repos à la déconnexion',()=>{
  const f=fixture(),link=f.$('link[rel="icon"]');f.context.updateTimerFavicon();const idle=link.href;assert.equal(link.dataset.timerStatus,'idle');
  f.state.entries.push({user_id:'other',end:null});f.context.updateTimerFavicon();assert.equal(link.href,idle);
  f.state.entries.push({user_id:'me',end:null});f.context.updateTimerFavicon();assert.equal(link.dataset.timerStatus,'active');assert.notEqual(link.href,idle);
  const active=link.href;f.context.updateTimerFavicon();assert.equal(link.href,active);
  f.state.entries[1].end=123;f.context.updateTimerFavicon();assert.equal(link.href,idle);
  f.state.entries[1].end=null;f.context.updateTimerFavicon();f.context.state=null;f.context.updateTimerFavicon();assert.equal(link.href,idle);
});

test('Suppression : confirmation détaillée, nom échappé et envoi du jeton vérifié',async()=>{
  const {document}=parseHTML('<html><body><dialog></dialog></body></html>');
  const dialog=document.querySelector('dialog');let submit,mutation;
  const context={state:{me:{role:'manager'}},dialog,
    $:(selector,root=document)=>root.querySelector(selector),
    esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    button:(action,label,icon,cls,id)=>`<button data-action="${action}" data-id="${id}">${label}</button>`,
    saveFooter:()=>'<button type="submit">Supprimer définitivement</button>',
    modal:(title,body,footer,callback)=>{dialog.innerHTML=body+footer;submit=callback;},
    api:async()=>({item:{name:'<script>Client</script>'},counts:{clients:1,projects:1,tasks:1,entries:4,running:1},projects:[{name:'Projet'}],tasks:[{name:'Tâche'}],confirmation:'confirmed-plan'}),
    write:async(...args)=>{mutation=args;}
  };
  runInNewContext(source.slice(source.indexOf('function catalogDeleteButton('),source.indexOf('function clientForm(')),context);
  assert.match(context.catalogDeleteButton('task','t'),/task-delete/);
  context.state.me.role='member';assert.equal(context.catalogDeleteButton('task','t'),'');
  context.state.me.role='manager';await context.confirmCatalogDeletion('client','c');
  assert.equal(dialog.querySelector('script'),null);assert.ok(dialog.querySelector('input[type="checkbox"][required]'));
  assert.match(dialog.textContent,/4 entrée\(s\) de temps conservée/);assert.match(dialog.textContent,/continueront de tourner/);
  await submit();assert.equal(mutation[0],'/api/clients/c');assert.equal(mutation[1],'DELETE');assert.equal(mutation[2].confirmation,'confirmed-plan');
});
