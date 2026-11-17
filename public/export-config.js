export const EXPORT_COLUMNS = [
  {key:'person',label:'Collaborateur',width:115}, {key:'client',label:'Client',width:105},
  {key:'project',label:'Projet',width:120}, {key:'task',label:'Tâche',width:140},
  {key:'day',label:'Date',width:75}, {key:'week',label:'Semaine du',width:80}, {key:'month',label:'Mois',width:65},
  {key:'start',label:'Début retenu',width:120,detail:true}, {key:'end',label:'Fin retenue',width:120,detail:true},
  {key:'description',label:'Description',width:210,detail:true},
  {key:'duration',label:'Durée',width:80,metric:true}, {key:'decimal',label:'Heures décimales',width:85,metric:true},
  {key:'count',label:'Entrées',width:60,metric:true},
  {key:'status',label:'Statut de la tâche',width:100,detail:true}, {key:'timer',label:'Chrono',width:90,detail:true}
];
export const EXPORT_GROUPS = ['client','project','task','person','day','week','month'];
export const EXPORT_PERIODS = [['custom','Dates libres'],['week','Cette semaine'],['lastWeek','Semaine précédente'],['month','Ce mois'],['lastMonth','Mois précédent']];
export const exportColumn = key => EXPORT_COLUMNS.find(c=>c.key===key);
export const exportDuration = seconds => `${Math.floor(seconds/3600)}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(Math.floor(seconds)%60).padStart(2,'0')}`;
export function defaultExportConfig(from,to) {
  return {version:1,mode:'detail',period:{preset:'custom',from,to},filters:{people:null,clients:null,projects:null,tasks:null,query:'',classification:'all',timers:'stopped'},
    columns:['day','person','project','task','description','duration'].map(key=>({key,label:exportColumn(key).label})),groups:['client','project','person'],
    sort:{key:'start',direction:'asc'},subtotals:true,total:true,excluded:[],
    document:{title:'Relevé de prestations',company:'Domteknika',reference:'',note:'',orientation:'auto'}};
}
export function availableExportColumns(config) {
  return EXPORT_COLUMNS.filter(c=>config.mode==='detail'||c.metric||config.groups.includes(c.key));
}
export function taskPersonExportConfig(config) {
  return {...structuredClone(config),mode:'summary',groups:['client','project','task','person'],
    columns:['client','project','task','person','duration'].map(key=>({key,label:exportColumn(key).label})),
    sort:{key:'task',direction:'asc'},subtotals:false};
}
export function displayExportCell(key,value) {
  if(value===null||value===undefined)return '';
  if(key==='duration')return exportDuration(Number(value));
  if(key==='decimal')return Number(value).toLocaleString('fr-CH',{minimumFractionDigits:2,maximumFractionDigits:4});
  if(['day','week'].includes(key)&&/^\d{4}-\d{2}-\d{2}$/.test(value))return value.split('-').reverse().join('.');
  if(key==='month'&&/^\d{4}-\d{2}$/.test(value))return value.slice(5)+'.'+value.slice(0,4);
  return String(value);
}
