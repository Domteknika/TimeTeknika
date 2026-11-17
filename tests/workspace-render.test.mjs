import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInContext, createContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import * as calendarUtils from '../public/calendar-utils.js';
import * as taskUtils from '../public/task-projects.js';
import { projectColorOptions } from '../public/project-colors.js';
import { APP_VERSION } from '../public/release.js';
import { openStore, seedDemo } from '../server/store.mjs';

test('Vue sobre complète : chrono, compteurs, calendrier ajusté, zoom manuel et palette',async t=>{
  const store=openStore(':memory:');seedDemo(store);t.after(()=>store.db.close());
  const fixture=store.snapshot(store.one('SELECT * FROM users WHERE id=?','demo-alex'));
  fixture.me.preferences={...fixture.me.preferences,calendarDays:5,calendarRange:'workday',calendarFit:true};
  const {document,window}=parseHTML('<html><head><link rel="icon"></head><body><div id="app"></div><div id="toast"></div><dialog id="dialog"></dialog></body></html>');
  let height=800;
  Object.defineProperty(window.HTMLElement.prototype,'clientHeight',{get(){return this.classList.contains('calendar-wrap')?height:0;},configurable:true});
  Object.defineProperty(window.HTMLElement.prototype,'offsetHeight',{get(){return this.classList.contains('cal-head')?48:0;},configurable:true});
  const dialog=document.querySelector('dialog');dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
  const observers=[];
  const context=createContext({document,window,fixture,crypto,...calendarUtils,...taskUtils,projectColorOptions,APP_VERSION,
    enhanceSelects:()=>{},stopExportBuilder:()=>{},setInterval:()=>0,setTimeout:()=>0,clearTimeout:()=>{},cancelAnimationFrame:()=>{},requestAnimationFrame:()=>1,
    ResizeObserver:class{constructor(fn){observers.push(fn);}observe(){}disconnect(){}}
  });
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  runInContext(source.slice(0,source.lastIndexOf('\nupdateTimerFavicon();')).replace(/^import .*;\r?\n/gm,''),context);
  runInContext("state=fixture;page='timer';timerView='calendar';render();",context);
  const $=selector=>document.querySelector(selector);
  assert.match($('.week-number').textContent,/^S\d{1,2}$/);
  assert.ok($('.timer-workspace.calendar-workspace'));assert.ok($('.time-work-header #timer-clock'));
  assert.ok($('.time-work-header [data-action="entry-new"]'));assert.ok($('.sidebar-bottom #live'));
  assert.equal(document.querySelectorAll('.calendar-controls').length,1);
  assert.equal($('[data-action="calendar-fit"]').getAttribute('aria-pressed'),'true');
  const fits=()=>Number($('.calendar').dataset.scale)*11+48<=height;
  assert.ok(fits());assert.ok($('#summary-today').textContent.includes('h'));
  height=530;runInContext('fitCalendarToSpace()',context);assert.ok(fits());
  assert.equal($('.calendar-wrap').scrollTop,0);
  runInContext('state.me.preferences.calendarFit=false;state.me.preferences.calendarZoom=150;render();',context);
  assert.equal($('.calendar').dataset.scale,'150');
  runInContext("projectDetail('project-cedres')",context);
  assert.equal(document.querySelectorAll('#modal-form select[name="color"] option').length,15);
  runInContext("dialog.close();page='settings';render();",context);
  assert.ok($('.app-version').textContent.includes(APP_VERSION));
});
