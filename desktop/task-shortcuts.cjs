const fs=require('node:fs/promises');
const {randomUUID}=require('node:crypto');
function validSlots(slots){return Array.isArray(slots)&&slots.length===5&&slots.every(id=>id===null||typeof id==='string'&&id.length>0&&id.length<=100);}
function availableTasks(state){
  return (state.tasks||[]).filter(t=>!t.archived&&t.assignees?.includes(state.me.id)).flatMap(t=>{
    const p=state.projects?.find(p=>p.id===t.project_id);if(!p||p.archived)return [];
    return [{id:t.id,name:t.name,project:p.name,client:state.clients?.find(c=>c.id===p.client_id)?.name||'',color:/^#[a-f\d]{6}$/i.test(p.color)?p.color:'#c65b65'}];
  }).sort((a,b)=>a.project.localeCompare(b.project,'fr')||a.name.localeCompare(b.name,'fr'));
}
class TaskShortcuts {
  constructor(file){this.file=file;this.accounts=new Map();this.writing=false;}
  async load(){
    try{const data=JSON.parse(await fs.readFile(this.file,'utf8'));if(data.version!==1||!Array.isArray(data.accounts))return;
      for(const row of data.accounts)if(typeof row?.userId==='string'&&validSlots(row.slots))this.accounts.set(row.userId,{slots:row.slots,revision:row.revision||''});
    }catch(error){if(error.code!=='ENOENT')throw Error('Le fichier de raccourcis est illisible.');}
  }
  get(userId){return this.accounts.get(userId)||{slots:Array(5).fill(null),revision:''};}
  async save(state,slots,revision){
    if(this.writing)throw Error('Un enregistrement est déjà en cours.');
    if(!validSlots(slots))throw Error('Choisissez exactement cinq emplacements de tâches.');
    const current=this.get(state.me.id);if(current.revision!==revision)throw Error('Les raccourcis ont changé. Rechargez la configuration.');
    const allowed=new Set(availableTasks(state).map(t=>t.id));
    if(slots.some((id,i)=>id&&!allowed.has(id)&&id!==current.slots[i]))throw Error('Une tâche choisie n’est plus disponible. Actualisez la liste.');
    this.writing=true;
    try{
      const next=new Map(this.accounts);next.set(state.me.id,{slots:[...slots],revision:randomUUID()});
      const data={version:1,accounts:[...next].map(([userId,value])=>({userId,...value}))};
      await fs.writeFile(this.file+'.tmp',JSON.stringify(data,null,2));await fs.rename(this.file+'.tmp',this.file);this.accounts=next;
      return this.get(state.me.id);
    }finally{this.writing=false;}
  }
}
module.exports={TaskShortcuts,availableTasks,validSlots};
