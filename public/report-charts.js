const escape = value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const palette=['#9676c4','#ba815d','#5b9289','#648bbb','#bc718b','#9c884e'];
const stableColor=id=>palette[[...String(id)].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0)%palette.length];
const time=seconds=>{const s=Math.max(0,Math.floor(seconds));return `${Math.floor(s/3600)} h ${String(Math.floor(s/60)%60).padStart(2,'0')}${s%60?` min ${String(s%60).padStart(2,'0')} s`:' min'}`;};
const number=value=>new Intl.NumberFormat('fr-CH',{maximumFractionDigits:1}).format(value);
const percent=value=>value>0&&value<.1?'< 0,1 %':`${number(value)} %`;
const date=(key,options={day:'numeric',month:'short'})=>new Intl.DateTimeFormat('fr-CH',{timeZone:'UTC',...options}).format(new Date(key+'T12:00:00Z'));
const groupLabels={project:'projet',task:'tâche',client:'client',person:'personne'};
export const REPORT_CHARTS=[['columns','Bâtons','M4 20V4M4 20h17M8 16v-5M13 16V6M18 16v-8'],['line','Courbe','M4 4v16h17M7 14l4-6 4 3 5-7'],['pie','Camembert','M12 3v9h9M20.7 14.3A9 9 0 1 1 9.7 3.3M15 3.5a9 9 0 0 1 5.5 5.5H15Z'],['bars','Barres','M4 4v16M8 6h13M8 12h9M8 18h5']];

// Rows already have their duration clipped and their visibility filtered by the server.
// Group by identity, never by name or by the individual-contribution table rows.
export function reportBreakdown(rows,group='project'){
  const field={project:'project_id',task:'task_id',client:'client_id',person:'user_id'}[group]||'project_id';
  const groups=new Map();
  for(const row of rows){
    if(!(row.seconds>0))continue;
    const id=row[field]??null;
    if(!groups.has(id))groups.set(id,{id,label:row[group]||'À classer',context:group==='task'&&id?row.project:group==='project'&&id?row.client:'',projectId:row.project_id,seconds:0,count:0});
    const item=groups.get(id);item.seconds+=row.seconds;item.count++;
  }
  const total=[...groups.values()].reduce((sum,g)=>sum+g.seconds,0);
  return [...groups.values()].sort((a,b)=>b.seconds-a.seconds||a.label.localeCompare(b.label,'fr')).map(g=>({...g,share:total?g.seconds/total*100:0}));
}

// Preserve every second on long periods, including partial first/last weeks or months.
export function reportSeries(days){
  const grain=days.length<=31?'day':days.length<=112?'week':'month',bins=new Map();
  for(const day of days){
    const d=new Date(day.date+'T12:00:00Z');
    if(grain==='week')d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));
    const key=grain==='day'?day.date:grain==='month'?day.date.slice(0,7):d.toISOString().slice(0,10);
    if(!bins.has(key))bins.set(key,{from:day.date,to:day.date,seconds:0});
    const bin=bins.get(key);bin.to=day.date;bin.seconds+=day.seconds;
  }
  return {grain,points:[...bins.values()]};
}

function timelineChart(report,mode){
  const {grain,points}=reportSeries(report.days),max=Math.max(1,...points.map(p=>p.seconds));
  const unit=max<3600?60:3600,raw=max/unit/4,power=10**Math.floor(Math.log10(raw)),step=([1,2,2.5,5,10].find(n=>n*power>=raw)||10)*power;
  const top=step*4*unit,left=60,width=776,bottom=206,height=172,slot=width/points.length;
  const x=i=>left+slot*(i+.5),y=s=>bottom-s/top*height;
  const labels=points.map(p=>grain==='month'?date(p.from,{month:'short',year:'2-digit'}):date(p.from,grain==='day'&&points.length<=7?{weekday:'short',day:'numeric'}:{day:'numeric',month:'numeric'}));
  const labelEvery=Math.max(1,Math.ceil(points.length/9));
  const coords=points.map((p,i)=>`${x(i)},${y(p.seconds)}`);
  const grid=Array.from({length:5},(_,i)=>`<line x1="${left}" x2="${left+width}" y1="${bottom-i*height/4}" y2="${bottom-i*height/4}" class="report-gridline"/><text x="${left-12}" y="${bottom-i*height/4+4}" text-anchor="end">${new Intl.NumberFormat('fr-CH',{maximumFractionDigits:step<.1?3:1}).format(i*step)}</text>`).join('');
  const plot=mode==='line'?`<path class="report-area" d="M${x(0)},${bottom} L${coords.join(' L')} L${x(points.length-1)},${bottom}Z"/><path class="report-line" d="M${coords.join(' L')}"/>`:'';
  const marks=points.map((p,i)=>{
    const range=p.from===p.to?date(p.from,{weekday:'long',day:'numeric',month:'long',year:'numeric'}):`${date(p.from)} – ${date(p.to,{day:'numeric',month:'short',year:'numeric'})}`;
    const detail=`${range} · ${time(p.seconds)}`;
    return `<g id="report-point-${i}" tabindex="0" role="img" aria-label="${escape(detail)}" data-report-detail="${escape(detail)}" class="report-point"><title>${escape(detail)}</title><rect class="report-hit" x="${left+slot*i}" y="20" width="${slot}" height="${bottom-20}"/>${mode==='line'?`<line class="report-guide" x1="${x(i)}" x2="${x(i)}" y1="20" y2="${bottom}"/><circle class="report-point-dot" cx="${x(i)}" cy="${y(p.seconds)}" r="4"/>`:`<rect class="report-column" x="${x(i)-Math.min(38,slot*.6)/2}" y="${y(p.seconds)}" width="${Math.min(38,slot*.6)}" height="${p.seconds/top*height}" rx="3"/>`}${points.length<=7&&p.seconds>0?`<text class="report-value" x="${x(i)}" y="${y(p.seconds)-11}" text-anchor="middle">${number(p.seconds/unit)}</text>`:''}</g>${i%labelEvery===0?`<text x="${x(i)}" y="233" text-anchor="middle">${escape(labels[i])}</text>`:''}`;
  }).join('');
  return `<div class="report-chart-meta"><span>${unit===60?'Minutes':'Heures'} par ${{day:'jour',week:'semaine',month:'mois'}[grain]}</span><span>Europe/Zurich${grain!=='day'?' · Bornes de la période respectées':''}</span></div><div class="report-timeline-scroll"><svg class="report-timeline" viewBox="0 0 860 250" role="group" aria-label="${mode==='line'?'Courbe':'Diagramme en bâtons'} des heures par ${{day:'jour',week:'semaine',month:'mois'}[grain]}">${grid}${plot}${marks}</svg></div>`;
}

function distributionChart(report,mode,group,projects,users){
  const items=reportBreakdown(report.rows,group).map(item=>({...item,color:item.id===null?'#b1a8ba':group==='project'?projects.find(p=>p.id===item.id)?.color||stableColor(item.id):group==='task'?projects.find(p=>p.id===item.projectId)?.color||stableColor(item.id):group==='person'?users.find(u=>u.id===item.id)?.color||stableColor(item.id):stableColor(item.id)}));
  let angle=-Math.PI/2;
  const pie=mode==='pie'?`<svg class="report-pie" viewBox="0 0 280 280" role="group" aria-label="Camembert de la répartition par ${groupLabels[group]}">${items.map((g,i)=>{
    const start=angle;angle+=g.share/100*Math.PI*2;
    const detail=`${g.label}${g.context?' · '+g.context:''} : ${time(g.seconds)} · ${percent(g.share)}`;
    const shape=items.length===1?'<circle cx="140" cy="140" r="120"/>':`<path d="M140 140 L${140+Math.cos(start)*120} ${140+Math.sin(start)*120} A120 120 0 ${angle-start>Math.PI?1:0} 1 ${140+Math.cos(angle)*120} ${140+Math.sin(angle)*120} Z"/>`;
    return `<g id="report-slice-${i}" class="report-slice" tabindex="0" role="img" aria-label="${escape(detail)}" data-report-detail="${escape(detail)}" data-report-index="${i}" style="--slice-color:${escape(g.color)}"><title>${escape(detail)}</title>${shape}</g>`;
  }).join('')}</svg>`:'';
  const max=Math.max(...items.map(g=>g.seconds));
  const legend=`<ol class="report-legend ${mode==='bars'?'report-comparison':''}">${items.map((g,i)=>{
    const detail=`${g.label}${g.context?' · '+g.context:''} : ${time(g.seconds)} · ${percent(g.share)}`;
    return `<li id="report-legend-${i}" tabindex="0" data-report-index="${i}" data-report-detail="${escape(detail)}" style="--slice-color:${escape(g.color)}"><span class="report-swatch" aria-hidden="true"></span><div class="report-legend-name"><strong>${escape(g.label)}</strong>${g.context?`<small>${escape(g.context)}</small>`:''}</div><div class="report-legend-time"><b>${time(g.seconds)}</b><span>${escape(percent(g.share))}</span></div>${mode==='bars'?`<div class="report-comparison-track" aria-hidden="true"><i style="width:${g.seconds/max*100}%"></i></div>`:''}</li>`;
  }).join('')}</ol>`;
  return `<div class="report-chart-meta"><span>Répartition par ${groupLabels[group]} · ${items.length} catégorie${items.length>1?'s':''}</span><span>Durée · Part du total</span></div><div class="report-distribution ${mode==='pie'?'with-pie':''}">${pie}${legend}</div>`;
}

export function renderReportChart(report,{mode='columns',group='project',projects=[],users=[]}={}){
  const distribution=mode==='pie'||mode==='bars';
  const title=distribution?`Le temps par ${groupLabels[group]}`:'Le rythme de la période';
  const hint=distribution?'Le regroupement choisi en haut du rapport définit les catégories.':'Survolez un point ou un bâton, ou utilisez la touche Tab, pour voir sa durée.';
  return `<section class="chart-panel report-chart" aria-label="Visualisation du rapport"><header class="report-chart-header"><div><h2>${title}</h2><p>${date(report.days[0].date)} – ${date(report.days.at(-1).date,{day:'numeric',month:'short',year:'numeric'})}</p></div><div class="segmented report-chart-picker" role="group" aria-label="Type de graphique">${REPORT_CHARTS.map(([id,label,path])=>`<button id="report-chart-${id}" data-action="report-chart" data-id="${id}" aria-pressed="${mode===id}" class="${mode===id?'active':''}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>${label}</button>`).join('')}</div></header>${report.total>0?(distribution?distributionChart(report,mode,group,projects,users):timelineChart(report,mode)):'<div class="report-chart-empty"><strong>Aucune heure à représenter</strong><p>Changez la période ou les filtres pour retrouver vos temps.</p></div>'}<footer class="report-chart-footer"><p class="report-chart-inspect" data-hint="${escape(hint)}">${hint}</p><small>Actualisé à ${new Intl.DateTimeFormat('fr-CH',{timeZone:'Europe/Zurich',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(report.asOf)}</small></footer></section>`;
}
