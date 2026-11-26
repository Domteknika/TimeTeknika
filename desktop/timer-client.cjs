const {randomUUID}=require('node:crypto');

class ApiError extends Error {
  constructor(message,status=0){super(message);this.status=status;}
}

// All state stays in RAM. A lost write response retains its idempotency key,
// so a second shortcut verifies/replays that action instead of toggling twice.
class TimerClient {
  constructor({origin,request,onState=()=>{},onSnapshot=()=>{}}){
    this.origin=origin;this.request=request;this.onState=onState;this.onSnapshot=onSnapshot;
    this.busy=false;this.pending=null;
  }
  async call(path,{data,csrf,key}={}){
    let response;
    try{
      response=await this.request(this.origin+path,{
        method:data===undefined?'GET':'POST',credentials:'include',cache:'no-store',redirect:'error',
        headers:{Accept:'application/json',Origin:this.origin,...(data===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':key})},
        body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(12000)
      });
    }catch{throw new ApiError('Serveur injoignable. Vérifiez votre connexion puis réessayez.');}
    let result;try{result=await response.json();}catch{throw new ApiError('Réponse du serveur illisible. Ouvrez TimeTeknika pour vérifier la connexion.',response.ok?0:response.status);}
    if(!response.ok)throw new ApiError(response.status===401?'Connectez-vous à TimeTeknika pour utiliser le raccourci.':result.message||'Action refusée par le serveur.',response.status);
    return result;
  }
  async status(knownUser){
    try {
      const result=await this.call('/api/timer/status');
      if(result.userId!==knownUser)return this.state();
      this.onState(result.active?'active':'idle');
    } catch(error) {
      if(error.status===404)return this.state();
      throw error;
    }
  }
  async state(){
    const state=await this.call('/api/state');
    if(!state.me?.id||!Array.isArray(state.entries)||!state.csrf)throw new ApiError('Version du serveur incompatible.');
    const active=state.entries.find(e=>e.user_id===state.me.id&&!e.deleted&&e.end===null)||null;
    this.onSnapshot(state);this.onState(active?'active':'idle');return {state,active};
  }
  async toggle(){return this.command();}
  async startTask(resolveTask){return this.command(resolveTask);}
  async command(resolveTask){
    if(this.busy)return {ignored:true};
    this.busy=true;
    try{
      const {state,active}=await this.state();
      if(this.pending&&this.pending.userId!==state.me.id)this.pending=null;
      if(!this.pending&&resolveTask){
        const taskId=resolveTask(state),task=state.tasks?.find(t=>t.id===taskId),project=state.projects?.find(p=>p.id===task?.project_id);
        if(!taskId)throw new ApiError('Aucune tâche associée à ce raccourci. Ouvrez « Configurer les 5 tâches ».',400);
        if(!task||task.archived||!project||project.archived||!task.assignees?.includes(state.me.id))throw new ApiError('Cette tâche n’est plus disponible ou ne vous est plus affectée. Modifiez ce raccourci.',400);
        if(active?.task_id===task.id)return {action:'already-running',taskName:task.name};
        this.pending={userId:state.me.id,key:randomUUID(),path:'/api/timer/start',
          data:{description:'',task_id:task.id,project_id:project.id,expectedRunningId:active?.id??null,expectedVersion:active?.version},
          action:'task-started',taskName:task.name};
      }
      if(!this.pending)this.pending={userId:state.me.id,key:randomUUID(),
        path:active?'/api/timer/stop':'/api/timer/start',
        data:active?{id:active.id,version:active.version}:{description:'',task_id:null,project_id:null,expectedRunningId:null},
        action:active?'stopped':'started'};
      const job=this.pending;
      const result=await this.call(job.path,{data:job.data,csrf:state.csrf,key:job.key});
      if(!result.entry)throw new ApiError('Confirmation du serveur manquante. Réessayez pour vérifier cette action.');
      this.pending=null;
      this.onState(result.entry.end===null?'active':'idle');
      return {action:job.action,taskName:job.taskName};
    }catch(error){
      if(error.status&&error.status<500)this.pending=null;
      this.onState(error.status===401?'signed-out':'unknown');throw error;
    }finally{this.busy=false;}
  }
}
module.exports={TimerClient,ApiError};
