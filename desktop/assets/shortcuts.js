const $=selector=>document.querySelector(selector);
let model=null,draft=[],selectedSlot=0,busy=false,dirty=false;
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
function message(text,success=false){$('#message').textContent=text;$('#message').className=success?'success':'';}
function lock(value){busy=value;$('#save').disabled=value||!model;$('#refresh').disabled=value;document.querySelectorAll('.task-choice,.clear').forEach(b=>b.disabled=value);}
function dot(color){const node=el('i',undefined,'dot');if(/^#[a-f\d]{6}$/i.test(color))node.style.backgroundColor=color;return node;}
function renderRows(){
  $('#rows').replaceChildren();
  draft.forEach((id,index)=>{
    const task=model.tasks.find(t=>t.id===id),row=el('div',undefined,'slot'),keys=el('div',undefined,'keys');
    model.keys[index].split('+').forEach((key,i)=>{if(i)keys.append(' + ');keys.append(el('kbd',key.replace('Control','Ctrl').replace('Shift','Maj')));});
    const pick=el('button',undefined,'task-choice');pick.type='button';pick.setAttribute('aria-label',`Choisir la tâche du raccourci ${index+1}`);
    pick.append(dot(task?.color));const copy=el('span');copy.append(el('b',task?.name||(id?'Tâche indisponible':'Choisir une tâche')),el('small',task?[task.project,task.client].filter(Boolean).join(' · '):id?'Supprimée, archivée ou non affectée':'Raccourci non affecté'));pick.append(copy);
    pick.onclick=()=>{selectedSlot=index;$('#search').value='';renderChoices();$('#picker').showModal();$('#search').focus();};
    const clear=el('button','×','clear');clear.type='button';clear.setAttribute('aria-label',`Retirer la tâche du raccourci ${index+1}`);clear.onclick=()=>{draft[index]=null;dirty=true;message('Modifications à enregistrer.');renderRows();};
    row.append(keys,pick,clear);$('#rows').append(row);
  });lock(busy);
}
const normalize=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function renderChoices(){
  const query=normalize($('#search').value.trim()),tasks=model.tasks.filter(t=>normalize([t.name,t.project,t.client].join(' ')).includes(query));
  const choices=$('#choices');choices.replaceChildren();let group='';
  for(const task of tasks){
    const title=task.project+' · '+task.client;if(title!==group){choices.append(el('div',title,'group'));group=title;}
    const button=el('button',undefined,'option'+(draft[selectedSlot]===task.id?' selected':''));button.type='button';button.append(dot(task.color));const copy=el('span',task.name);button.append(copy);if(draft[selectedSlot]===task.id)button.append('✓');
    button.onclick=()=>{draft[selectedSlot]=task.id;dirty=true;$('#picker').close();message('Modifications à enregistrer.');renderRows();document.querySelectorAll('.task-choice')[selectedSlot].focus();};choices.append(button);
  }
  if(!tasks.length)choices.append(el('p','Aucune tâche disponible pour cette recherche.','empty'));
}
async function load(){
  if(busy)return;lock(true);message('Chargement…');
  try{const result=await window.taskShortcuts.read();if(!result.ok)throw Error(result.error);model=result.model;draft=[...model.slots];dirty=false;$('#account').textContent=model.userName;renderRows();message('');}
  catch(error){model=null;$('#rows').replaceChildren();$('#account').textContent='Connexion à vérifier';message(error.message);}
  finally{lock(false);}
}
$('#refresh').onclick=()=>{if(!dirty||confirm('Recharger les tâches et abandonner les modifications non enregistrées ?'))load();};
$('#close-picker').onclick=()=>$('#picker').close();$('#search').oninput=renderChoices;
$('#save').onclick=async()=>{
  if(busy||!model)return;lock(true);message('Enregistrement…');
  try{const result=await window.taskShortcuts.save({userId:model.userId,revision:model.revision,slots:draft});if(!result.ok)throw Error(result.error);model=result.model;draft=[...model.slots];dirty=false;renderRows();message('Vos cinq raccourcis sont enregistrés.',true);}
  catch(error){message(error.message);}finally{lock(false);}
};
window.taskShortcuts.onKeys(keys=>{if(model){model.keys=keys;renderRows();}});
load();
