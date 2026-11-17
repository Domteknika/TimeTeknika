import test from 'node:test';
import assert from 'node:assert/strict';
import { reportBreakdown, reportSeries, renderReportChart, REPORT_CHARTS } from '../public/report-charts.js';

test('Graphiques : addition par identité, contributions partagées et temps déjà limité à la période',()=>{
  const rows=[
    {project_id:'p1',project:'Projet homonyme',client_id:'c1',client:'Client A',task_id:'t1',task:'Plans',user_id:'u1',person:'Emma',seconds:1800,start:0,end:999999999},
    {project_id:'p1',project:'Projet homonyme',client_id:'c1',client:'Client A',task_id:'t1',task:'Plans',user_id:'u2',person:'Alex',seconds:3600},
    {project_id:'p2',project:'Projet homonyme',client_id:'c2',client:'Client B',task_id:'t2',task:'Plans',user_id:'u2',person:'Alex',seconds:900},
    {project_id:null,project:'Sans projet',client_id:null,client:'Sans client',task_id:null,task:'À classer',user_id:'u2',person:'Alex',seconds:900}
  ];
  const projects=reportBreakdown(rows,'project');
  assert.equal(projects.length,3);assert.equal(projects[0].seconds,5400);assert.equal(projects[0].share,75);assert.equal(projects[0].count,2);
  assert.equal(reportBreakdown(rows,'task').length,3);
  assert.equal(reportBreakdown(rows,'person')[0].seconds,5400);
  for(const group of ['project','client','task','person']){
    const items=reportBreakdown(rows,group);
    assert.equal(items.reduce((sum,g)=>sum+g.seconds,0),7200);
    assert.equal(items.reduce((sum,g)=>sum+g.share,0),100);
  }
  assert.equal(reportBreakdown(rows.slice(0,1),'person').length,1);
  assert.deepEqual(reportBreakdown([{seconds:0,project_id:'empty'}]),[]);
});

test('Graphiques : les périodes longues conservent tous les jours, même aux bornes et au changement d’heure',()=>{
  const days=Array.from({length:370},(_,i)=>({date:new Date(Date.UTC(2026,9,28)+i*86400000).toISOString().slice(0,10),seconds:i%3?3600:0}));
  for(const length of [1,7,31,32,112,113,370]){
    const source=days.slice(0,length),series=reportSeries(source);
    assert.equal(series.grain,length<=31?'day':length<=112?'week':'month');
    assert.equal(series.points[0].from,source[0].date);
    assert.equal(series.points.at(-1).to,source.at(-1).date);
    assert.equal(series.points.reduce((sum,p)=>sum+p.seconds,0),source.reduce((sum,d)=>sum+d.seconds,0));
    assert.ok(series.points.length<=31);
  }
  const weeks=reportSeries(days.slice(0,32));
  assert.equal(weeks.points[0].from,'2026-10-28');assert.equal(weeks.points[0].to,'2026-11-01');
});

test('Graphiques : zéro, catégorie unique, textes échappés et valeurs finies dans les quatre vues',()=>{
  const empty={days:[{date:'2026-10-28',seconds:0}],rows:[],total:0,asOf:Date.UTC(2026,9,28)};
  for(const [mode] of REPORT_CHARTS){
    assert.match(renderReportChart(empty,{mode}),/Aucune heure à représenter/);
    assert.doesNotMatch(renderReportChart(empty,{mode}),/NaN|Infinity/);
    const report={...empty,days:[{date:'2026-10-28',seconds:3600}],rows:[{project_id:'p1',project:'<script> & "nom"',seconds:3600}],total:3600};
    const html=renderReportChart(report,{mode});
    assert.doesNotMatch(html,/NaN|Infinity|<script>/);
    if(mode==='pie'){assert.match(html,/<circle cx="140" cy="140" r="120"/);assert.match(html,/100 %/);}
    if(mode==='pie'||mode==='bars')assert.match(html,/&lt;script&gt; &amp; &quot;nom&quot;/);
  }
});
