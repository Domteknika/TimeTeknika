import test from 'node:test';
import assert from 'node:assert/strict';
import { isoWeek, CALENDAR_ZOOMS, layoutCalendarEntries, calendarSelection, calendarWallTime, calendarDayTotals, weeklyProgress, longRunningEntry } from '../public/calendar-utils.js';
import { midnight } from '../server/domain.mjs';

const slot=(key,start,end,live=false)=>({key,topHour:start,endHour:end,live});
function assertNoOverlap(items){
  for(const a of items)for(const b of items){
    if(a===b)continue;
    const vertical=a.top<b.top+b.height&&b.top<a.top+a.height;
    const horizontal=a.column/a.columns<(b.column+b.span)/b.columns&&b.column/b.columns<(a.column+a.span)/a.columns;
    assert.ok(!(vertical&&horizontal),`${a.key} recouvre ${b.key}`);
  }
}

test('Calendrier : un chrono de 20 secondes et les saisies courtes précédentes restent lisibles',()=>{
  const entries=[slot('admin',13,13.5),slot('outil',13.5,13.7),slot('chrono',13.7,13.7+20/3600,true)];
  const items=layoutCalendarEntries(entries,62.5);
  assertNoOverlap(items);
  assert.ok(items.every(e=>e.height>=2));assert.ok(items.every(e=>e.columns===1));
  const live=items.find(e=>e.live);assert.ok(live.durationHeight<1);assert.equal(live.height,2);
  assert.equal(entries[0].height,undefined);
});

test('Calendrier : une entrée de 8 minutes laisse visibles les 30 minutes de pause',()=>{
  for(const zoom of CALENDAR_ZOOMS){
    const scale=100*zoom/100;
    const items=layoutCalendarEntries([slot('short',12,12+8/60),slot('admin',12+38/60,13+9/60)],scale);
    const [short,admin]=items;
    assert.ok(short.height<=8/60*scale);
    assert.ok(admin.top-(short.top+short.height)>=scale/2);
    assert.ok(items.every(e=>e.columns===1&&e.span===1));assertNoOverlap(items);
  }
});

test('Calendrier : un bloc reprend les colonnes libres sans recouvrir les voisins',()=>{
  const items=layoutCalendarEntries([slot('a',8,12),slot('b',8.5,9),slot('c',8.6,9.2),slot('d',10,11)],100);
  assertNoOverlap(items);
  assert.equal(items.find(e=>e.key==='d').span,2);
});

test('Calendrier : intersections réelles, groupes indépendants et disposition stable',()=>{
  const entries=[slot('long',8,11),slot('court1',8,9),slot('court2',9,10),slot('apres',14,15)];
  const items=layoutCalendarEntries(entries,100);assertNoOverlap(items);
  assert.equal(items.find(e=>e.key==='court1').column,items.find(e=>e.key==='court2').column);
  assert.equal(items.find(e=>e.key==='apres').columns,1);
  assert.deepEqual(items,layoutCalendarEntries([...entries].reverse(),100));
});

test('Calendrier : le chrono grandit et redistribue les colonnes au prochain chevauchement',()=>{
  const before=layoutCalendarEntries([slot('live',10,10.1,true),slot('next',11,12)],100);
  assert.ok(before.every(e=>e.columns===1));
  const after=layoutCalendarEntries([slot('live',10,11.2,true),slot('next',11,12)],100);
  assertNoOverlap(after);assert.ok(after.every(e=>e.columns===2));
  assert.ok(after.find(e=>e.live).height>before.find(e=>e.live).height);
  assert.ok(after.find(e=>e.live).durationHeight>before.find(e=>e.live).durationHeight);
});

test('Calendrier : tous les zooms, journées denses et bornes de minuit sans recouvrement',()=>{
  const entries=Array.from({length:80},(_,i)=>slot(String(i),i*.3,Math.min(24,i*.3+(i%5)/10)));
  entries.push(slot('minuit',23.99,24,true));
  for(const zoom of CALENDAR_ZOOMS){
    const scale=50*zoom/100,items=layoutCalendarEntries(entries,scale);
    assertNoOverlap(items);
    assert.ok(items.every(e=>e.top>=0&&e.top+e.height<=24*scale&&e.column<e.columns));
  }
  assert.deepEqual(layoutCalendarEntries([],50),[]);
});

test('Vue 7 h–18 h : coupe les blocs aux limites et conserve les heures de glisser-déposer',()=>{
  const entries=[slot('early',5,6),slot('morning',6,8),slot('day',12,13),slot('evening',17,20),slot('late',20,21)];
  const items=layoutCalendarEntries(entries,50,7,18);
  assert.deepEqual(items.map(e=>e.key),['morning','day','evening']);
  assert.equal(items[0].top,0);assert.equal(items[1].top,250);
  assert.ok(items.every(e=>e.top+e.height<=550));assertNoOverlap(items);
  assert.deepEqual(calendarSelection(7*60,8*60,7*60,18*60),{start:420,end:480});
  assert.deepEqual(calendarSelection(17*60,20*60,7*60,18*60),{start:1020,end:1080});
});

test('Sélection du calendrier : deux sens, pas de 15 minutes et limites de journée',()=>{
  assert.deepEqual(calendarSelection(9*60,10.5*60),{start:540,end:630});
  assert.deepEqual(calendarSelection(10.5*60,9*60),{start:540,end:630});
  assert.deepEqual(calendarSelection(543,547),{start:540,end:555});
  assert.deepEqual(calendarSelection(10,-30),{start:0,end:15});
  assert.deepEqual(calendarSelection(1440,1600),{start:1425,end:1440});
  assert.equal(calendarWallTime('2026-10-31',1440),'2026-11-01T00:00');
  assert.equal(calendarWallTime('2026-03-29',180),'2026-03-29T03:00');
});

test('Totaux du calendrier : chaque journée, entrées sans tâche, minuit et chrono en direct',()=>{
  const hour=3600000,mon=midnight('2026-10-26'),tue=midnight('2026-10-27'),wed=midnight('2026-10-28'),thu=midnight('2026-10-29');
  const ranges=[{day:'2026-10-26',from:mon,to:tue},{day:'2026-10-27',from:tue,to:wed},{day:'2026-10-28',from:wed,to:thu},{day:'2026-10-29',from:thu,to:midnight('2026-10-30')}];
  const entries=[
    {start:mon+8*hour,end:mon+10*hour,task_id:'task'},
    {start:mon+10.5*hour,end:mon+11*hour,task_id:null},
    {start:tue-.5*hour,end:tue+hour},
    {start:wed-hour,end:null},
    {start:mon,end:tue,deleted:1},
    {start:mon-hour,end:mon}
  ];
  const totals=calendarDayTotals(entries,ranges,wed+hour);
  assert.deepEqual(totals,ranges.map((r,i)=>({day:r.day,seconds:[3,2,1,0][i]*3600})));
  assert.deepEqual(calendarDayTotals(entries,ranges,wed+1.5*hour).map(r=>r.seconds),[3,2,1.5,0].map(n=>n*3600));
  assert.deepEqual(calendarDayTotals(entries,ranges.slice(1,3),wed+hour),totals.slice(1,3));
  assert.equal(calendarDayTotals(entries,ranges,wed)[2].seconds,0);
});

test('Totaux du calendrier : durée réelle des journées de 23 et 25 heures en Suisse',()=>{
  for(const [day,next,expected] of [['2026-03-29','2026-03-30',23],['2026-10-25','2026-10-26',25]]) {
    const from=midnight(day),to=midnight(next),ranges=[{day,from,to}];
    assert.equal(calendarDayTotals([{start:from,end:to}],ranges,to)[0].seconds,expected*3600);
    assert.equal(calendarDayTotals([{start:from,end:null}],ranges,to+3600000)[0].seconds,expected*3600);
  }
});

test('Objectif hebdomadaire : bornes, week-end, chrono actif et dépassement',()=>{
  const from=midnight('2026-10-19'),to=midnight('2026-10-26'),now=to-3600000;
  const entries=[
    {start:from-3600000,end:from+3600000},
    {start:Date.parse('2026-10-24T08:00:00Z'),end:Date.parse('2026-10-24T10:00:00Z')},
    {start:now-3600000,end:null},
    {start:to+3600000,end:to+7200000}
  ];
  const p=weeklyProgress(entries,from,to,300,now);
  assert.equal(p.seconds,14400);assert.equal(p.remaining,3600);assert.equal(p.percent,80);
  assert.equal(weeklyProgress(entries,from,to,300,now+90000).remaining,3510);
  assert.equal(weeklyProgress(entries,from,to,180,now).excess,3600);
  assert.equal(weeklyProgress(entries,from,to,180,now).remaining,0);
  assert.equal(weeklyProgress(entries,from,to,null,now).target,null);
  assert.equal(weeklyProgress([],from,to,0,now).percent,100);
  assert.equal(weeklyProgress([{start:to-3600000,end:to+3600000}],from,to,120,now).seconds,3600);
});

test('Solde sur 7 jours : pas de retard quotidien, déficit seulement après dimanche, rattrapage et surplus',()=>{
  const from=midnight('2026-10-19'),to=midnight('2026-10-26');
  const entries=Array.from({length:7},(_,i)=>({
    start:Date.parse(`2026-10-${19+i}T08:00:00+02:00`),
    end:Date.parse(`2026-10-${19+i}T13:00:00+02:00`)
  }));
  // The week containing the winter clock change lasts 169 hours, but still has one weekly target.
  assert.equal((to-from)/3600000,169);
  let p=weeklyProgress(entries.slice(0,5),from,to,35*60,to-1);
  assert.equal(p.status,'remaining');assert.equal(p.balance,-10*3600);
  p=weeklyProgress(entries.slice(0,5),from,to,35*60,to);
  assert.equal(p.status,'deficit');assert.equal(p.remaining,10*3600);
  p=weeklyProgress(entries,from,to,35*60,to);
  assert.equal(p.status,'reached');assert.equal(p.balance,0);
  p=weeklyProgress(entries,from,to,34*60,to);
  assert.equal(p.status,'exceeded');assert.equal(p.excess,3600);
  assert.equal(weeklyProgress(entries,from,to,null,to).status,'unset');
  assert.equal(weeklyProgress(entries,from,to,null,to).balance,null);
  assert.equal(weeklyProgress([],from,to,0,to).status,'reached');
  const springFrom=midnight('2026-03-23'),springTo=midnight('2026-03-30');
  assert.equal((springTo-springFrom)/3600000,167);
  assert.equal(weeklyProgress([],springFrom,springTo,2400,springTo).remaining,40*3600);
});

test('Alerte : seul son chrono continu dépasse 6 h, jamais un cumul de tâche ou les temps des collègues',()=>{
  const start=Date.parse('2026-10-28T16:00:00+01:00'),limit=start+6*3600000;
  const active={id:'own',user_id:'emma',start,end:null};
  const others=[
    {id:'colleague',user_id:'lucas',start:start-8*3600000,end:null},
    {id:'finished',user_id:'emma',start:start-8*3600000,end:start},
    {id:'deleted',user_id:'emma',start:start-8*3600000,end:null,deleted:1}
  ];
  assert.equal(longRunningEntry([...others,active],'emma',limit-1),null);
  assert.equal(longRunningEntry([...others,active],'emma',limit),null);
  assert.equal(longRunningEntry([...others,active],'emma',limit+1),active);
  assert.equal(longRunningEntry([...others,active],'emma',start+20*3600000),active);
  assert.equal(longRunningEntry([{...active,end:limit}],'emma',limit+3600000),null);
  assert.equal(longRunningEntry([{...active,start:limit}],'emma',limit+3600000),null);
  assert.equal(longRunningEntry(others,'manager',limit+1),null);
});

test('Numéro de semaine ISO : semaine affichée et changement d’année',()=>{
  for(const [day,year,number] of [['2026-11-09',2026,46],['2026-11-15',2026,46],['2026-11-16',2026,47],['2027-01-01',2026,53],['2027-01-04',2027,1],['2024-12-30',2025,1]])assert.deepEqual(isoWeek(day),{year,number});
});
