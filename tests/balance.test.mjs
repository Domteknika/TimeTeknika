import test from 'node:test';
import assert from 'node:assert/strict';
import { cumulativeProgress } from '../public/calendar-utils.js';
import { midnight } from '../server/domain.mjs';

const hour=3600000;
const entry=(date,hours)=>({start:midnight(date)+8*hour,end:midnight(date)+(8+hours)*hour});

test('Solde global depuis le 26 octobre : compensation des semaines, semaines vides et corrections rétroactives',()=>{
  const from=midnight('2026-10-26'),to=midnight('2026-11-09'),now=midnight('2026-11-05');
  const entries=[entry('2026-10-27',35),entry('2026-11-02',40),entry('2026-10-19',20)];
  let p=cumulativeProgress(entries,from,to,2400,now);
  assert.equal(p.weeks,2);assert.equal(p.target,80*3600);assert.equal(p.seconds,75*3600);
  assert.equal(p.balance,-5*3600);assert.equal(p.status,'deficit');
  p=cumulativeProgress([...entries,entry('2026-11-04',8)],from,to,2400,now);
  assert.equal(p.balance,3*3600);assert.equal(p.status,'exceeded');
  p=cumulativeProgress([...entries,entry('2026-11-04',5)],from,to,2400,now);
  assert.equal(p.balance,0);assert.equal(p.status,'reached');
  // The next Monday adds the full next target, even with no entries in that week.
  p=cumulativeProgress(entries,from,midnight('2026-11-16'),2400,to);
  assert.equal(p.weeks,3);assert.equal(p.target,120*3600);assert.equal(p.balance,-45*3600);
  // Deleting/restoring an old entry changes hours, never the start date or number of weeks.
  p=cumulativeProgress([{...entries[0],deleted:1},entries[1]],from,to,2400,now);
  assert.equal(p.weeks,2);assert.equal(p.balance,-40*3600);
  p=cumulativeProgress([{...entries[0],end:entries[0].end+6*hour},entries[1]],from,to,2400,now);
  assert.equal(p.balance,3600);
});

test('Solde global : premier lundi, chrono chevauchant le départ, dates futures, objectifs et changement d’heure',()=>{
  const from=midnight('2026-10-26'),to=midnight('2026-11-02');
  let p=cumulativeProgress([],from,to,2400,from);
  assert.equal(p.weeks,1);assert.equal(p.balance,-40*3600);
  const entries=[{start:from-hour,end:null},entry('2026-10-30',8)];
  p=cumulativeProgress(entries,from,to,2400,from+hour);
  assert.equal(p.seconds,3600);assert.equal(p.balance,-39*3600);
  assert.equal(cumulativeProgress(entries,from,to,2400,from+2*hour).seconds,7200);
  assert.equal(cumulativeProgress(entries,from,to,null,from+hour).status,'unset');
  assert.equal(cumulativeProgress(entries,from,to,null,from+hour).balance,null);
  assert.equal(cumulativeProgress(entries,from,to,0,from+hour).balance,3600);
  assert.equal(cumulativeProgress([],from,to,0,from).status,'reached');
  p=cumulativeProgress([],midnight('2026-11-09'),to,2400,from);
  assert.equal(p.weeks,0);assert.equal(p.target,0);assert.equal(p.status,'waiting');
  for(const [start,end] of [['2026-10-19','2026-11-02'],['2026-03-23','2026-04-06'],['2026-12-28','2027-01-11']]) {
    p=cumulativeProgress([],midnight(start),midnight(end),2550,midnight(end)-1);
    assert.equal(p.weeks,2);assert.equal(p.target,85*3600);
  }
});

test('Semaines précédentes : report au lundi, compensation cumulée et exclusion des heures de la nouvelle semaine',()=>{
  const from=midnight('2026-10-26'),monday=midnight('2026-11-09'),nextMonday=midnight('2026-11-16');
  const history=[entry('2026-10-27',35),entry('2026-11-02',40)];
  let previous=cumulativeProgress(history,from,monday,2400,monday);
  assert.equal(previous.weeks,2);assert.equal(previous.balance,-5*3600);
  assert.equal(cumulativeProgress(history,from,nextMonday,2400,monday).balance,-45*3600);
  const withCurrent=[...history,entry('2026-11-09',3)];
  previous=cumulativeProgress(withCurrent,from,monday,2400,monday+12*hour);
  assert.equal(previous.seconds,75*3600);assert.equal(previous.balance,-5*3600);
  // Prior weeks compensate one another, and an old correction is reflected immediately.
  const corrected=[{...history[0],end:history[0].end+8*hour},...withCurrent.slice(1)];
  previous=cumulativeProgress(corrected,from,monday,2400,monday+12*hour);
  assert.equal(previous.balance,3*3600);assert.equal(previous.status,'exceeded');
  // When the following Monday arrives, the newly closed week joins the carry-over.
  previous=cumulativeProgress(withCurrent,from,nextMonday,2400,nextMonday);
  assert.equal(previous.weeks,3);assert.equal(previous.balance,-42*3600);
});

test('Semaines précédentes : première semaine vide et chrono de dimanche limité à lundi minuit',()=>{
  const from=midnight('2026-10-26'),monday=midnight('2026-11-02');
  const first=cumulativeProgress([entry('2026-10-27',8)],from,from,2400,midnight('2026-10-29'));
  assert.equal(first.weeks,0);assert.equal(first.seconds,0);assert.equal(first.balance,0);
  const running={start:monday-hour,end:null};
  const before=cumulativeProgress([running],from,monday,2400,monday+hour);
  const after=cumulativeProgress([running],from,monday,2400,monday+2*hour);
  assert.equal(before.seconds,3600);assert.equal(before.balance,-39*3600);
  assert.equal(after.balance,before.balance);
  assert.equal(cumulativeProgress([entry('2026-11-02',8)],from,monday,2400,monday+20*hour).balance,-40*3600);
  assert.equal(cumulativeProgress([],from,monday,null,monday).balance,null);
  assert.equal(cumulativeProgress([],from,monday,0,monday).balance,0);
});
