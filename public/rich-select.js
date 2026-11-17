const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr');
const controls=new WeakMap();
let active=null;

// Keep the native control for form data and constraint validation. Only its presentation changes.
export function enhanceSelects(root,describe){
  const resume=active&&!active.select.isConnected?{id:active.trigger.id,query:active.search?.value||'',scroll:active.list.scrollTop}:null;
  if(resume)active.close();
  root.querySelectorAll('select').forEach(select=>{
    if(controls.has(select))return;
    const config=describe(select),label=select.closest('label');
    const labelText=config.label||[...(label?.childNodes||[])].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(' ')||'Sélection';
    const key=select.id||`${select.form?.id||'page'}-${select.name}`;
    const wrapper=document.createElement('div');wrapper.className=`rich-select${config.compact?' is-compact':''}`;
    const trigger=document.createElement('button');trigger.type='button';trigger.className='rich-select-trigger';trigger.id='rich-'+key;
    trigger.setAttribute('aria-label',labelText);trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',trigger.id+'-list');
    if(select.required)trigger.setAttribute('aria-describedby',trigger.id+'-error');
    const error=document.createElement('span');error.id=trigger.id+'-error';error.className='rich-select-error';error.setAttribute('role','alert');
    const popup=document.createElement('div');popup.className=`rich-select-popup${config.kind==='color'?' is-palette':''}`;popup.setAttribute('popover','manual');
    popup.innerHTML=`<div class="rich-select-heading"><strong>${esc(config.heading||labelText)}</strong><span class="rich-select-count"></span><button type="button" class="icon-button" aria-label="Fermer la liste ${esc(labelText)}">${config.icon('close')}</button></div>${config.searchable?`<div class="rich-select-search">${config.icon('search')}<input type="search" autocomplete="off" placeholder="${esc(config.placeholder||'Rechercher…')}" aria-label="Rechercher dans ${esc(labelText)}"></div>`:''}<div class="rich-select-list" id="${trigger.id}-list" role="listbox" aria-label="${esc(labelText)}" tabindex="-1"></div><div class="rich-select-empty" hidden>${config.icon('search')}<strong>Aucun résultat</strong><span>Essayez un autre nom.</span></div>`;
    const list=popup.querySelector('.rich-select-list'),search=popup.querySelector('input');
    select.before(wrapper);wrapper.append(select,trigger,error,popup);
    select.hidden=true;select.tabIndex=-1;
    if(label)label.htmlFor=trigger.id;
    let visible=[],cursor=-1;
    const symbol=meta=>`<span class="rich-select-symbol ${meta.initials?'is-avatar':''} ${config.kind==='color'?'is-color':''}" style="--option-color:${esc(meta.color||'#a18bb9')}">${meta.initials?esc(meta.initials):config.kind==='color'?'':config.icon(meta.icon||config.kind||'list')}</span>`;
    const metaFor=option=>({label:option.textContent,...config.option(option.value,option.textContent)});
    const disabled=()=>select.matches(':disabled');
    function refresh(){
      const meta=metaFor(select.selectedOptions[0]||{value:'',textContent:'Sélectionner…'});
      trigger.innerHTML=`${symbol(meta)}<span class="rich-select-copy"><strong>${esc(meta.label)}</strong>${meta.subtitle?`<small>${esc(meta.subtitle)}</small>`:''}</span>${config.icon('down')}`;
      trigger.title=[labelText,meta.label,meta.subtitle].filter(Boolean).join(' · ');trigger.disabled=disabled();
    }
    function place(){
      if(active?.select!==select)return;
      if(!trigger.isConnected||disabled()){close();return;}
      const rect=trigger.getBoundingClientRect(),viewport=window.visualViewport;
      const top=viewport?.offsetTop||0,left=viewport?.offsetLeft||0,vw=viewport?.width||innerWidth,vh=viewport?.height||innerHeight;
      if(rect.bottom<top||rect.top>top+vh){close();return;}
      const below=top+vh-rect.bottom-14,above=rect.top-top-14,up=below<Math.min(360,popup.scrollHeight)&&above>below;
      const width=Math.min(Math.max(rect.width,config.kind==='color'?300:320),vw-24),height=Math.max(80,Math.min(410,up?above:below));
      popup.style.width=width+'px';popup.style.maxHeight=height+'px';popup.style.left=Math.max(left+12,Math.min(rect.left,left+vw-width-12))+'px';
      popup.style.top=(up?Math.max(top+8,rect.top-Math.min(popup.scrollHeight,height)-8):rect.bottom+8)+'px';
    }
    function draw(){
      const query=normalize(search?.value.trim()||'');
      visible=[...select.options].filter(o=>!o.hidden&&!(select.required&&!o.value)).map(o=>({option:o,meta:metaFor(o)})).filter(({option,meta})=>(!option.disabled)&&normalize([meta.label,meta.subtitle,option.textContent].join(' ')).includes(query));
      list.innerHTML=visible.map(({option,meta},i)=>`<button type="button" role="option" tabindex="-1" aria-selected="${option.selected}" class="rich-select-option ${option.selected?'is-selected':''}" data-index="${i}">${symbol(meta)}<span class="rich-select-copy"><strong>${esc(meta.label)}</strong>${meta.subtitle?`<small>${esc(meta.subtitle)}</small>`:''}</span>${meta.swatches?.length?`<span class="rich-select-swatches" aria-hidden="true">${meta.swatches.map(color=>`<i style="background:${esc(color)}"></i>`).join('')}</span>`:''}<span class="rich-select-check" aria-hidden="true">${option.selected?config.icon('check'):''}</span></button>`).join('');
      popup.querySelector('.rich-select-count').textContent=`${visible.length} choix`;
      popup.querySelector('.rich-select-empty').hidden=!!visible.length;
      cursor=-1;place();
    }
    function close(focus=false){
      if(active?.select===select)active=null;
      if(popup.matches(':popover-open'))popup.hidePopover();
      trigger.setAttribute('aria-expanded','false');
      if(focus&&trigger.isConnected)trigger.focus({preventScroll:true});
    }
    function focusOption(index){
      if(!visible.length)return;
      cursor=Math.max(0,Math.min(index,visible.length-1));
      const row=list.children[cursor];row.focus({preventScroll:true});row.scrollIntoView({block:'nearest'});
    }
    function open(query=''){
      if(disabled())return;
      active?.close();active=control;
      if(search)search.value=query;
      trigger.setAttribute('aria-expanded','true');popup.style.maxHeight='';popup.showPopover();draw();place();
      if(search)search.focus({preventScroll:true});else focusOption(Math.max(0,visible.findIndex(v=>v.option.selected)));
    }
    function choose(index){
      const row=visible[index];if(!row||disabled())return;
      const changed=select.value!==row.option.value;
      select.value=row.option.value;error.textContent='';trigger.removeAttribute('aria-invalid');close();refresh();
      if(changed){select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}
      // A change can synchronously replace the report form.
      document.getElementById(trigger.id)?.focus({preventScroll:true});
    }
    const control={select,trigger,popup,list,search,open,close,place};controls.set(select,control);
    trigger.addEventListener('click',()=>active===control?close(true):open());
    trigger.addEventListener('keydown',event=>{
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();open();if(event.key==='End'||event.key==='ArrowUp')focusOption(visible.length-1);}
    });
    popup.querySelector('.rich-select-heading button').addEventListener('click',()=>close(true));
    search?.addEventListener('input',draw);
    list.addEventListener('click',event=>{const row=event.target.closest('[data-index]');if(row)choose(Number(row.dataset.index));});
    popup.addEventListener('keydown',event=>{
      const onSearch=event.target===search,onOption=event.target.closest('[data-index]');
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();event.stopPropagation();
        const index=onSearch?(event.key==='ArrowDown'?0:visible.length-1):Number(event.target.closest('[data-index]')?.dataset.index??cursor)+(event.key==='ArrowDown'?1:-1);
        focusOption(index);
      } else if(event.key==='Enter'&&(onSearch||onOption)){
        event.preventDefault();event.stopPropagation();choose(onSearch?0:Number(event.target.closest('[data-index]')?.dataset.index??-1));
      } else if(!onSearch&&['Home','End'].includes(event.key)){
        event.preventDefault();event.stopPropagation();focusOption(event.key==='Home'?0:visible.length-1);
      } else if(onOption&&search&&event.key.length===1&&event.key!==' '&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
        event.preventDefault();event.stopPropagation();search.value=event.key;search.focus();draw();
      }
    });
    select.addEventListener('change',refresh);
    select.addEventListener('invalid',event=>{
      event.preventDefault();error.textContent='Choisissez une option pour continuer.';trigger.setAttribute('aria-invalid','true');
      const first=[...(select.form?.elements||[select])].find(el=>el.willValidate&&!el.validity.valid);
      if(first===select)open();
    });
    refresh();
  });
  if(resume){const trigger=document.getElementById(resume.id),select=trigger?.parentElement.querySelector('select'),control=controls.get(select);if(control){control.open(resume.query);control.list.scrollTop=resume.scroll;}}
}

// One shared listener per event; detached form controls are reclaimed with their DOM.
document.addEventListener('pointerdown',event=>{if(active&&!active.popup.contains(event.target)&&!active.trigger.contains(event.target))active.close();},true);
document.addEventListener('keydown',event=>{
  if(!active)return;
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();active.close(true);}
  else if(event.key==='Tab'&&active.popup.contains(event.target))active.close(true);
},true);
document.addEventListener('focusin',event=>{if(active&&!active.popup.contains(event.target)&&event.target!==active.trigger)active.close();});
document.addEventListener('close',()=>active?.close(),true);
window.addEventListener('resize',()=>active?.place());
window.visualViewport?.addEventListener('resize',()=>active?.place());
document.addEventListener('scroll',event=>{if(active&&!active.popup.contains(event.target))active.place();},true);
