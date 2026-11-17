const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('taskShortcuts',{
  read:()=>ipcRenderer.invoke('task-shortcuts-read'),
  save:payload=>ipcRenderer.invoke('task-shortcuts-save',payload),
  onKeys:callback=>{ipcRenderer.on('task-shortcuts-keys',(_event,keys)=>callback(keys));}
});
