import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import { calendarDayTotals, layoutCalendarEntries } from '../public/calendar-utils.js';
import { midnight } from '../server/domain.mjs';

test('Calendrier en direct : redimensionne aussi les voisins sans remplacer la grille',async()=>{
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const {document}=parseHTML('<html><body></body></html>');
  const day='2026-11-10',start=midnight(day),hour=3600000;
  const entries=[{id:'live',description:'Travail en cours',start:start+10*hour,end:null},{id:'next',description:'Travail saisi',start:start+11*hour,end:start+12*hour}];
  const $=(selector,root=document)=>root.querySelector(selector),$$=(selector,root=document)=>[...root.querySelectorAll(selector)];
  const context={document,$,$$,calendarDrag:null,calendarDayTotals,layoutCalendarEntries,
    now:()=>start+10.1*hour,dateKey:()=>day,calendarDays:()=>[day],calendarZoom:()=>200,calendarRange:()=> 'full',calendarFit:()=>false,fittedCalendarScale:null,
    zoneInstant:value=>midnight(value.slice(0,10)),shiftDate:(value,n)=>new Date(Date.parse(value+'T12:00:00Z')+n*86400000).toISOString().slice(0,10),
    refs:()=>({project:{name:'Projet',color:'#729fd0'}}),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),duration:seconds=>String(seconds),time:value=>String(value),prettyDate:value=>value,targetHours:value=>String(value),
    own:()=>entries,running:()=>entries[0]
  };
  runInNewContext(source.slice(source.indexOf('const calendarTime ='),source.indexOf('async function saveCalendarPreference(')),context);
  document.body.innerHTML=context.calendarGrid(context.calendarModel(entries,[day]));
  const grid=$('.calendar'),live=$('[data-id="live"]'),next=$('[data-id="next"]');
  assert.equal(live.style.width,'calc(100% - 8px)');assert.equal(next.style.width,'calc(100% - 8px)');
  assert.equal($('.cal-entry-label strong',live).textContent,'Travail en cours');
  context.updateCalendar(start+11.2*hour);
  assert.ok($('.calendar')===grid);assert.ok($('[data-id="next"]')===next);
  assert.equal(live.style.width,'calc(50% - 8px)');assert.equal(next.style.width,'calc(50% - 8px)');
  assert.notEqual(live.style.left,next.style.left);assert.ok(parseFloat(live.style.height)>40);
  assert.match($('small',live).textContent,/En cours/);assert.match(live.title,/Travail en cours/);
  assert.equal(live.style.getPropertyValue('--entry-color'),'#729fd0');
  context.calendarRange=()=> 'workday';
  const model=context.calendarModel(entries,[day]);
  document.body.innerHTML=context.calendarGrid(model);
  assert.equal($('.calendar').dataset.minHour,'7');assert.equal($('.calendar').dataset.maxHour,'18');
  assert.equal($('[data-id="live"]').style.top,'600px');
  assert.equal($$('.cal-hours span').length,22);
  assert.equal($('.cal-hours span').textContent,'7:00');
  assert.equal($('.cal-hours .half-hour').textContent,'7:30');
  assert.equal($('[data-id="live"]').dataset.size,'compact');
  context.updateCalendar(start+10.5*hour);
  assert.equal($('[data-id="live"]').dataset.size,'large');
  assert.match($('.cal-entry-context',$('[data-id="live"]')).textContent,/Projet/);
});
