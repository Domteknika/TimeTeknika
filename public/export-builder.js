import { EXPORT_COLUMNS, EXPORT_GROUPS, EXPORT_PERIODS, exportColumn, defaultExportConfig, taskPersonExportConfig, availableExportColumns, displayExportCell, exportDuration } from './export-config.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>structuredClone(value);
let config=null,preview=null,previewSignature='',ticket=0,debounce,refreshInterval,context=null,account=null,busy=false,templateId='',templateVersion=null,templateName='',sourcePage=0,sourceQuery='',error='';
const openSections=new Set();
export function startExportBuilder(state,filters) {
  if(context?.root.isConnected)rememberSections(context.root);
  clearTimeout(debounce);clearInterval(refreshInterval);++ticket;context=null;
  if(account!==state.me.id){config=null;templateId='';templateVersion=null;templateName='';account=state.me.id;preview=null;previewSignature='';openSections.clear();}
  if(!config){config=taskPersonExportConfig(defaultExportConfig(filters.from,filters.to));for(const [key,value] of [['people',filters.person],['clients',filters.client],['projects',filters.project],['tasks',filters.task]])if(value)config.filters[key]=[value];config.filters.query=filters.search||'';if(filters.unclassified)config.filters.classification='unclassified';}
  if(state.me.role!=='manager')config.filters.people=null;
  if(templateId&&!state.exportTemplates?.some(t=>t.id===templateId)){templateId='';templateVersion=null;}
}
export function stopExportBuilder(clear=false){if(context?.root.isConnected)rememberSections(context.root);clearInterval(refreshInterval);clearTimeout(debounce);++ticket;context=null;if(clear){config=null;preview=null;previewSignature='';account=null;templateId='';templateVersion=null;templateName='';error='';sourceQuery='';sourcePage=0;openSections.clear();}}
function itemsFor(kind,state){
  const selected=(list,id)=>list===null||list.includes(id??'__none__');
  if(kind==='people')return state.users.map(u=>({id:u.id,name:u.name,subtitle:u.active?'':'Ancien collaborateur',color:u.color}));
  if(kind==='clients')return [{id:'__none__',name:'Sans client'},...state.clients.map(c=>({id:c.id,name:c.name}))];
  const projects=state.projects.filter(p=>selected(config.filters.clients,p.client_id));
  if(kind==='projects')return [...(selected(config.filters.clients,null)?[{id:'__none__',name:'Sans projet'}]:[]),...projects.map(p=>({id:p.id,name:p.name,subtitle:[state.clients.find(c=>c.id===p.client_id)?.name,p.archived?'Archivé':''].filter(Boolean).join(' · '),color:p.color}))];
  return [{id:'__none__',name:'À classer'},...state.tasks.filter(t=>projects.some(p=>p.id===t.project_id)&&selected(config.filters.projects,t.project_id)).map(t=>{const p=projects.find(p=>p.id===t.project_id);return {id:t.id,name:t.name,subtitle:[p.name,t.archived?'Archivée':''].filter(Boolean).join(' · '),color:p.color};})];
}
function pruneSelections(state){for(const key of ['projects','tasks'])if(config.filters[key]!==null){const allowed=new Set(itemsFor(key,state).map(i=>i.id));config.filters[key]=config.filters[key].filter(id=>allowed.has(id));}}
const select=(id,value,choices,extra='')=>`<select id="${id}" data-select-kind="export" ${extra}>${choices.map(([key,label])=>`<option value="${esc(key)}"${key===value?' selected':''}>${esc(label)}</option>`).join('')}</select>`;
function multi(kind,label,state,icon){
  const values=config.filters[kind],items=itemsFor(kind,state),names=values?.map(id=>items.find(i=>i.id===id)?.name||'Sélection indisponible')||[];
  return `<details class="export-multi" data-section="filter-${kind}" ${openSections.has('filter-'+kind)?'open':''}><summary>${icon(kind==='people'||kind==='clients'?'people':kind==='projects'?'folder':'task')}<span>${label}<strong>${values===null?'Tous':values.length===0?'Aucun':values.length===1?esc(names[0]):values.length+' sélectionnés'}</strong></span>${icon('down')}</summary><div class="export-options"><label class="export-option-search">${icon('search')}<input type="search" data-multi-search placeholder="Rechercher…" aria-label="Rechercher dans ${label}"></label><div class="export-options-actions"><button type="button" data-export-command="multi-all" data-kind="${kind}">Tous</button><button type="button" data-export-command="multi-none" data-kind="${kind}">Aucun</button></div><div class="export-options-list">${items.map(item=>`<label class="export-option" data-search-text="${esc((item.name+' '+(item.subtitle||'')).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase())}"><input type="checkbox" data-multi="${kind}" value="${esc(item.id)}" ${values===null||values.includes(item.id)?'checked':''}><i class="dot" style="color:${esc(item.color||'#b28c99')}"></i><span>${esc(item.name)}${item.subtitle?`<small>${esc(item.subtitle)}</small>`:''}</span></label>`).join('')||'<p class="help">Aucun choix pour les filtres actuels.</p>'}</div><button type="button" class="export-options-done" data-export-command="multi-close">Terminé ${icon('check')}</button></div></details>`;
}
function selectionChips(state){return ['people','clients','projects','tasks'].map(kind=>config.filters[kind]?.map(id=>{const item=itemsFor(kind,state).find(v=>v.id===id);return `<button type="button" class="export-chip" data-export-command="remove-selection" data-kind="${kind}" data-id="${esc(id)}" title="Retirer ce choix">${esc(item?.name||'Choix indisponible')} ×</button>`;}).join('')).filter(Boolean).join('');}
function rememberSections(root){root.querySelectorAll('details[data-section]').forEach(d=>{if(d.open)openSections.add(d.dataset.section);else openSections.delete(d.dataset.section);});}
const button=(command,label,extra='')=>`<button type="button" class="btn" data-export-command="${command}" ${extra}>${label}</button>`;
function columnEditor(){
  const allowed=availableExportColumns(config),selected=config.columns.map(c=>({...exportColumn(c.key),...c})),others=allowed.filter(c=>!config.columns.some(v=>v.key===c.key));
  return `<div class="export-columns">${selected.map((c,i)=>`<div class="export-column"><input type="checkbox" checked data-column="${c.key}" aria-label="Afficher ${esc(exportColumn(c.key).label)}"><label class="visually-hidden" for="export-label-${c.key}">Titre de ${esc(exportColumn(c.key).label)}</label><input id="export-label-${c.key}" class="export-column-name" value="${esc(c.label)}" maxlength="80" data-column-label="${c.key}"><button type="button" data-export-command="column-up" data-id="${c.key}" aria-label="Monter ${esc(c.label)}" ${i===0?'disabled':''}>↑</button><button type="button" data-export-command="column-down" data-id="${c.key}" aria-label="Descendre ${esc(c.label)}" ${i===selected.length-1?'disabled':''}>↓</button></div>`).join('')}</div><details class="export-more-columns" data-section="more-columns" ${openSections.has('more-columns')?'open':''}><summary>Ajouter des colonnes · ${others.length}</summary>${others.map(c=>`<label class="export-column-add"><input type="checkbox" data-column="${c.key}">${esc(c.label)}</label>`).join('')}</details>`;
}
export function renderExportBuilder(state,icon){
  if(!config)return '';
  const templates=state.exportTemplates||[],selected=templates.find(t=>t.id===templateId),changed=selected&&selected.version!==templateVersion;
  return `<div class="export-builder"><div class="export-models"><label>Mon modèle${select('export-template',templateId,[['','Configuration libre'],...templates.map(t=>[t.id,t.name])])}</label><label>Nom du modèle<input id="export-template-name" value="${esc(templateName)}" placeholder="Ex. Relevé mensuel Softcar" maxlength="100"></label><div class="export-model-actions">${button('save-template',templateId?'Mettre à jour':'Enregistrer le modèle')}${templateId?button('copy-template','Enregistrer une copie')+button('delete-template','Supprimer'):''}</div>${changed?'<p class="export-model-conflict">Ce modèle a changé dans une autre session. Rechargez-le avant de le remplacer. <button type="button" data-export-command="reload-template">Recharger le modèle</button></p>':''}</div>
  <section class="export-panel"><div class="export-panel-title"><span>1</span><h2>Choisir les temps</h2><button type="button" data-export-command="reset-filters" class="btn text">Réinitialiser les filtres</button></div><div class="export-period"><label>Période${select('export-period',config.period.preset,EXPORT_PERIODS)}</label><label>Du<input type="date" id="export-from" value="${esc(config.period.preset==='custom'?config.period.from:preview?.period.from||config.period.from)}" ${config.period.preset!=='custom'?'disabled':''}></label><label>Au<input type="date" id="export-to" value="${esc(config.period.preset==='custom'?config.period.to:preview?.period.to||config.period.to)}" ${config.period.preset!=='custom'?'disabled':''}></label><label>Description<input type="search" id="export-query" value="${esc(config.filters.query)}" maxlength="200" placeholder="Rechercher dans les descriptions…"></label></div>
  <div class="export-multis">${state.me.role==='manager'?multi('people','Collaborateurs',state,icon):'<div class="export-own-scope">Vos propres heures uniquement</div>'}${multi('clients','Clients',state,icon)}${multi('projects','Projets',state,icon)}${multi('tasks','Tâches',state,icon)}</div><div class="export-chips">${selectionChips(state)}</div><div class="export-secondary-filters"><label>Classement${select('export-classification',config.filters.classification,[['all','Toutes les entrées'],['classified','Entrées classées'],['unclassified','À classer uniquement']])}</label><label>Chronos${select('export-timers',config.filters.timers,[['stopped','Arrêtés uniquement'],['all','Inclure les chronos en cours'],['running','En cours uniquement']])}</label><small>Les projets et tâches archivés restent disponibles pour vos relevés historiques.</small></div></section>
  <div class="export-workspace"><aside class="export-panel export-composition"><div class="export-panel-title"><span>2</span><h2>Composer le fichier</h2></div><button type="button" class="btn" data-export-command="task-person-summary">Par tâche et collaborateur</button><p class="export-hint">Une ligne par tâche et collaborateur, avec toutes ses saisies cumulées sur la période. Choisissez ce préréglage pour ne pas séparer les jours.</p><label class="field">Présentation${select('export-mode',config.mode,[['detail','Détail des entrées'],['summary','Synthèse regroupée']])}</label>
  ${config.mode==='summary'?`<div class="export-group-editor"><p>Regrouper dans cet ordre</p>${config.groups.map((key,i)=>`<div class="export-group"><strong>${i+1}</strong><span>${exportColumn(key).label}</span><button type="button" data-export-command="group-up" data-id="${key}" aria-label="Monter ${exportColumn(key).label}" ${i===0?'disabled':''}>↑</button><button type="button" data-export-command="group-down" data-id="${key}" aria-label="Descendre ${exportColumn(key).label}" ${i===config.groups.length-1?'disabled':''}>↓</button><button type="button" data-export-command="group-remove" data-id="${key}" aria-label="Retirer ${exportColumn(key).label}">×</button></div>`).join('')}<label>Ajouter un regroupement${select('export-add-group','',[['','Choisir…'],...EXPORT_GROUPS.filter(g=>!config.groups.includes(g)).map(g=>[g,exportColumn(g).label])])}</label></div>`:''}
  <div class="export-column-heading"><h3>Colonnes du fichier</h3><small>Cochez, renommez et réordonnez.</small></div>${columnEditor()}
  <div class="export-sort"><label>Trier par${select('export-sort',config.sort.key,(config.mode==='detail'?EXPORT_COLUMNS:availableExportColumns(config)).map(c=>[c.key,c.label]))}</label><label>Sens${select('export-direction',config.sort.direction,[['asc','Croissant'],['desc','Décroissant']])}</label></div>${config.mode==='summary'?'<p class="export-hint">Les groupes suivent l’ordre choisi ; le tri par durée s’applique au dernier niveau.</p>':''}
  <label class="export-toggle"><input type="checkbox" id="export-total" ${config.total?'checked':''}>Afficher le total général</label>${config.mode==='summary'?`<label class="export-toggle"><input type="checkbox" id="export-subtotals" ${config.subtotals?'checked':''}>Afficher les sous-totaux</label>`:''}
  <details class="export-document" data-section="document" ${openSections.has('document')?'open':''}><summary>En-tête et présentation PDF / Excel</summary><label class="field">Titre<input id="export-doc-title" value="${esc(config.document.title)}" maxlength="120"></label><label class="field">Émetteur<input id="export-doc-company" value="${esc(config.document.company)}" maxlength="120"></label><label class="field">Référence de facture (facultative)<input id="export-doc-reference" value="${esc(config.document.reference)}" maxlength="100" placeholder="Ex. FAC-2026-042"></label><label class="field">Note en fin de document<textarea id="export-doc-note" maxlength="1000" placeholder="Informations utiles au destinataire…">${esc(config.document.note)}</textarea></label><label class="field">Orientation PDF${select('export-doc-orientation',config.document.orientation,[['auto','Automatique'],['portrait','Portrait'],['landscape','Paysage']])}</label><p class="export-hint">Le PDF conserve une taille lisible. Une sélection très large continue sur plusieurs volets de colonnes.</p></details></aside>
  <section class="export-panel export-preview"><div class="export-panel-title"><span>3</span><h2>Aperçu des données</h2><span class="export-preview-status" id="export-preview-status" role="status"></span></div><div id="export-error" role="alert" class="form-error">${esc(error)}</div><div id="export-preview-body"></div><details class="export-exclusions" data-section="exclusions" ${openSections.has('exclusions')?'open':''}><summary>Choisir les entrées · <span id="export-excluded-count">${config.excluded.length}</span> exclues</summary><div class="export-source-tools"><input type="search" id="export-source-query" value="${esc(sourceQuery)}" placeholder="Rechercher une entrée…" aria-label="Rechercher une entrée à exclure">${button('include-all','Tout réinclure')}</div><div id="export-source-list"></div></details><div class="export-download"><small id="export-download-note">Les fichiers contiennent toutes les lignes retenues.</small><div>${button('download','CSV','data-format="csv" disabled')}${button('download','Excel','data-format="xlsx" disabled')}${button('download','PDF','data-format="pdf" disabled')}</div></div></section></div></div>`;
}
function paintPreview(){
  if(!context)return;const root=context.root,body=root.querySelector('#export-preview-body');if(!body)return;
  root.querySelector('#export-error').textContent=error;
  root.querySelectorAll('[data-export-command="download"]').forEach(b=>b.disabled=busy||!preview||!!error||previewSignature!==JSON.stringify(config));
  if(!preview){body.innerHTML='<div class="empty"><strong>Préparation de votre aperçu…</strong></div>';return;}
  const columns=preview.config.columns;
  body.innerHTML=`<div class="export-preview-metrics"><strong>${preview.entryCount} entrées${preview.config.total?' · '+esc(exportDuration(preview.totalSeconds)):''}</strong><small>${preview.rowCount} lignes · ${esc(preview.period.from)} → ${esc(preview.period.to)}</small></div><div class="export-preview-table"><table><thead><tr>${columns.map(c=>`<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${preview.rows.map(row=>`<tr class="export-row-${row.type}">${columns.map(c=>{const value=row.caption&&c===columns.find(v=>!exportColumn(v.key).metric)?row.caption:row[c.key];return `<td class="${exportColumn(c.key).metric?'export-number':''}">${esc(displayExportCell(c.key,value))}</td>`;}).join('')}</tr>`).join('')||`<tr><td colspan="${columns.length}">Aucune entrée pour cette sélection.</td></tr>`}</tbody></table></div><p class="export-hint">${preview.rowCount>preview.rows.length?`Aperçu des ${preview.rows.length} premières lignes. Le fichier contiendra les ${preview.rowCount} lignes. `:''}Durées exactes, limitées à la période choisie. Fuseau Europe/Zurich.${preview.runningCount?' Les chronos en cours sont figés au moment du téléchargement.':''}</p>`;
  if(config.period.preset!=='custom'){root.querySelector('#export-from').value=preview.period.from;root.querySelector('#export-to').value=preview.period.to;}
  paintSource();
}
function paintSource(){
  if(!context||!preview)return;const root=context.root,q=sourceQuery.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const items=preview.source.filter(r=>[r.person,r.project,r.task,r.description,r.day].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(q)),pages=Math.max(1,Math.ceil(items.length/30));sourcePage=Math.min(sourcePage,pages-1);
  root.querySelector('#export-excluded-count').textContent=preview.excludedCount;
  root.querySelector('#export-source-list').innerHTML=items.slice(sourcePage*30,(sourcePage+1)*30).map(row=>`<label class="export-source-row"><input type="checkbox" data-export-entry="${esc(row.id)}" ${config.excluded.includes(row.id)?'':'checked'}><span><b>${esc(row.person)} · ${esc(displayExportCell('day',row.day))}</b><small>${esc(row.project)} / ${esc(row.task)}</small><small>${esc(row.description||'Sans description')}</small></span><strong>${esc(exportDuration(row.seconds))}</strong></label>`).join('')+`<div class="export-source-pages">${button('source-prev','←','aria-label="Entrées précédentes" '+(sourcePage===0?'disabled':''))}<span>${sourcePage+1} / ${pages} · ${items.length} entrées</span>${button('source-next','→','aria-label="Entrées suivantes" '+(sourcePage===pages-1?'disabled':''))}</div>`;
}
async function requestPreview(){
  if(!context)return;const ctx=context,current=++ticket,signature=JSON.stringify(config);error='';ctx.root.querySelector('#export-preview-status').textContent='Actualisation…';
  try{const result=await ctx.api('/api/exports/preview',{method:'POST',data:{config:clone(config)}});if(current!==ticket||ctx!==context)return;preview=result;previewSignature=signature;ctx.root.querySelector('#export-preview-status').textContent='À jour';}
  catch(e){if(current!==ticket||ctx!==context)return;error=e.message;preview=null;previewSignature='';ctx.root.querySelector('#export-preview-status').textContent='À vérifier';}
  paintPreview();
}
function schedule(){++ticket;clearTimeout(debounce);if(context){context.root.querySelectorAll('[data-export-command="download"]').forEach(b=>b.disabled=true);context.root.querySelector('#export-preview-status').textContent='Actualisation…';}debounce=setTimeout(requestPreview,250);}
function cleanColumns(){const allowed=new Set(availableExportColumns(config).map(c=>c.key));config.columns=config.columns.filter(c=>allowed.has(c.key));if(!config.columns.length)config.columns=[{key:'duration',label:'Durée'}];if(!allowed.has(config.sort.key)&&config.mode==='summary')config.sort.key=config.groups[0]||'duration';}
function redraw(){if(!context)return;rememberSections(context.root);context.render();}
function move(array,key,delta,getKey=v=>v){const i=array.findIndex(v=>getKey(v)===key),next=i+delta;if(i>=0&&next>=0&&next<array.length)[array[i],array[next]]=[array[next],array[i]];}
export function bindExportBuilder(ctx){
  context=ctx;clearInterval(refreshInterval);paintPreview();schedule();refreshInterval=setInterval(()=>{if(context&&!document.hidden&&!busy)requestPreview();},15000);
  const root=ctx.root;
  root.addEventListener('input',event=>{
    const el=event.target;
    if(el.matches('[data-multi-search]')){const q=el.value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();el.closest('.export-options').querySelectorAll('[data-search-text]').forEach(row=>row.hidden=!row.dataset.searchText.includes(q));return;}
    if(el.id==='export-source-query'){sourceQuery=el.value;sourcePage=0;paintSource();return;}
    if(el.id==='export-template-name'){templateName=el.value;return;}
    if(el.dataset.columnLabel){config.columns.find(c=>c.key===el.dataset.columnLabel).label=el.value;schedule();return;}
    const edits={'export-query':()=>config.filters.query=el.value,'export-from':()=>config.period.from=el.value,'export-to':()=>config.period.to=el.value};
    if(edits[el.id]){edits[el.id]();schedule();return;}
    if(el.id.startsWith('export-doc-')&&el.tagName!=='SELECT'){config.document[el.id.slice(11)]=el.value;schedule();}
  });
  root.addEventListener('change',event=>{
    const el=event.target,state=ctx.state();
    if(el.dataset.multi){const kind=el.dataset.multi;if(config.filters[kind]===null)config.filters[kind]=itemsFor(kind,state).map(i=>i.id);config.filters[kind]=config.filters[kind].filter(id=>id!==el.value);if(el.checked)config.filters[kind].push(el.value);pruneSelections(state);redraw();return;}
    if(el.dataset.column){if(el.checked)config.columns.push({key:el.dataset.column,label:exportColumn(el.dataset.column).label});else config.columns=config.columns.filter(c=>c.key!==el.dataset.column);redraw();return;}
    if(el.dataset.exportEntry){config.excluded=config.excluded.filter(id=>id!==el.dataset.exportEntry);if(!el.checked)config.excluded.push(el.dataset.exportEntry);schedule();return;}
    if(el.id==='export-template'){templateId=el.value;const t=state.exportTemplates.find(t=>t.id===templateId);if(t){config=clone(t.config);templateVersion=t.version;templateName=t.name;sourcePage=0;}else{templateVersion=null;templateName='';}redraw();return;}
    if(el.id==='export-period'){if(el.value==='custom'&&preview)Object.assign(config.period,preview.period);config.period.preset=el.value;redraw();return;}
    if(el.id==='export-mode'){config.mode=el.value;if(config.mode==='summary')config.columns=[...config.groups.map(key=>({key,label:exportColumn(key).label})),{key:'duration',label:'Durée'}];else config.columns=defaultExportConfig(config.period.from,config.period.to).columns;cleanColumns();redraw();return;}
    if(el.id==='export-add-group'&&el.value){config.groups.push(el.value);config.columns.unshift({key:el.value,label:exportColumn(el.value).label});cleanColumns();redraw();return;}
    const edits={'export-classification':()=>config.filters.classification=el.value,'export-timers':()=>config.filters.timers=el.value,'export-sort':()=>config.sort.key=el.value,'export-direction':()=>config.sort.direction=el.value,'export-total':()=>config.total=el.checked,'export-subtotals':()=>config.subtotals=el.checked,'export-doc-orientation':()=>config.document.orientation=el.value};
    if(edits[el.id]){edits[el.id]();schedule();}
  });
  root.addEventListener('click',async event=>{
    const target=event.target.closest('[data-export-command]');if(!target||target.disabled)return;const command=target.dataset.exportCommand,state=ctx.state();
    try{
      if(command==='task-person-summary'){config=taskPersonExportConfig(config);redraw();return;}
      if(command==='multi-close'){target.closest('details').open=false;rememberSections(root);return;}
      if(command==='multi-all'||command==='multi-none'){config.filters[target.dataset.kind]=command==='multi-all'?null:[];pruneSelections(state);redraw();return;}
      if(command==='remove-selection'){config.filters[target.dataset.kind]=config.filters[target.dataset.kind].filter(id=>id!==target.dataset.id);pruneSelections(state);redraw();return;}
      if(command==='reset-filters'){config.filters=defaultExportConfig('','').filters;config.excluded=[];sourcePage=0;redraw();return;}
      if(command.startsWith('column-')){move(config.columns,target.dataset.id,command==='column-up'?-1:1,c=>c.key);redraw();return;}
      if(command.startsWith('group-')){if(command==='group-remove')config.groups=config.groups.filter(g=>g!==target.dataset.id);else move(config.groups,target.dataset.id,command==='group-up'?-1:1);cleanColumns();redraw();return;}
      if(command==='include-all'){config.excluded=[];schedule();return;}
      if(command==='source-prev'||command==='source-next'){sourcePage+=command==='source-prev'?-1:1;paintSource();return;}
      if(command==='reload-template'){const t=state.exportTemplates.find(t=>t.id===templateId);if(t){config=clone(t.config);templateName=t.name;templateVersion=t.version;redraw();}return;}
      if(command==='save-template'||command==='copy-template'){
        if(!templateName.trim())throw Error('Donnez un nom à votre modèle.');target.disabled=true;
        const update=templateId&&command!=='copy-template',result=await ctx.api('/api/export-templates'+(update?'/'+templateId:''),{method:update?'PATCH':'POST',data:{name:templateName.trim(),config:clone(config),version:templateVersion}});
        templateId=result.template.id;templateVersion=result.template.version;templateName=result.template.name;await ctx.refresh();ctx.notify('Modèle enregistré sur le serveur.');return;
      }
      if(command==='delete-template'){
        if(target.dataset.confirm!=='yes'){target.dataset.confirm='yes';target.textContent='Confirmer la suppression';return;}
        target.disabled=true;await ctx.api('/api/export-templates/'+templateId,{method:'DELETE',data:{version:templateVersion}});templateId='';templateVersion=null;templateName='';await ctx.refresh();ctx.notify('Modèle supprimé.');return;
      }
      if(command==='download'){
        busy=true;paintPreview();await ctx.download(clone(config),target.dataset.format);ctx.notify('Export téléchargé. Les durées sont figées à l’heure de génération.');return;
      }
    }catch(e){ctx.notify(e.message);target.disabled=false;}
    finally{busy=false;if(context===ctx)paintPreview();}
  });
}
document.addEventListener('click',event=>{if(context&&!event.target.closest('.export-multi'))context.root.querySelectorAll('.export-multi[open]').forEach(d=>d.open=false);});
