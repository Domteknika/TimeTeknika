const {ipcRenderer}=require('electron');
// No Node, filesystem or general IPC API is exposed to the remote page.
// A DOM change is only a request to refresh the authenticated server state.
if(process.isMainFrame&&location.origin==='https://timeteknika.domteknika.ch'){
  window.addEventListener('DOMContentLoaded',()=>{
    let timer;
    const signal=()=>{clearTimeout(timer);timer=setTimeout(()=>ipcRenderer.send('timer-state-changed'),200);};
    const favicon=document.querySelector('link[rel="icon"]');
    if(favicon)new MutationObserver(signal).observe(favicon,{attributes:true});
    signal();
  });
}
