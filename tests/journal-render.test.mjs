import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import * as calendarUtils from '../public/calendar-utils.js';
import * as taskUtils from '../public/task-projects.js';
import { projectColorOptions } from '../public/project-colors.js';
import { APP_VERSION } from '../public/release.js';
import { openStore, seedDemo } from '../server/store.mjs';

test('Journal UI : accès responsable, filtres, pagination, vérification et échappement',async t=>{
  const store=openStore(':memory:');seedDemo(store);t.after(()=>store.db.close());
  const fixture=store.snapshot(store.one("SELECT * FROM users WHERE id='demo-alex'"));
  const {document,window}=parseHTML('<html><body><div id="app"></div><div id="toast"></div><dialog id="dialog"></dialog></body></html>');
  const dialog=document.querySelector('dialog');dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
  const requests=[];
  const context=createContext({document,window,fixture,crypto,URLSearchParams,...calendarUtils,...taskUtils,projectColorOptions,APP_VERSION,
    enhanceSelects:()=>{},stopExportBuilder:()=>{},setInterval:()=>0,setTimeout:()=>0,clearTimeout:()=>{},cancelAnimationFrame:()=>{},requestAnimationFrame:()=>1,
    fetch:async path=>{
      requests.push(path);
      return {ok:true,json:async()=>path==='/api/journal/verify'?{ok:true,count:101,hash:'a'.repeat(64)}:{
        items:[{seq:101,at:Date.now(),level:'error',category:'request',action:'request-completed',actor:null,request_id:'abc',details:{method:'POST',route:'/api/clients',status:500,text:'<img src=x onerror=alert(1)>'}}],nextBefore:101,checkpoint:{count:101,hash:'a'.repeat(64)}
      }};
    }
  });
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  runInContext(source.slice(0,source.lastIndexOf('\nupdateTimerFavicon();')).replace(/^import .*;\r?\n/gm,''),context);
  runInContext("state=fixture;page='settings';render();",context);
  assert.ok(document.querySelector('[data-action="journal-open"]'));
  await runInContext("journalDialog({level:'error'})",context);
  assert.equal(requests.at(-1),'/api/journal?level=error');
  assert.equal(document.querySelector('.journal-details img'),null);
  assert.ok(document.querySelector('.journal-details').textContent.includes('<img'));
  assert.match(document.querySelector('summary').textContent,/Erreur.*Requête terminée/);
  assert.ok(document.querySelector('#journal-export'));
  document.querySelector('#journal-verify').click();await new Promise(resolve=>setImmediate(resolve));
  assert.match(document.querySelector('#journal-integrity').textContent,/Intégrité vérifiée : 101/);
  document.querySelector('#journal-next').click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.at(-1),'/api/journal?level=error&before=101');
  runInContext("dialog.close();state.me.role='member';render();",context);
  assert.equal(document.querySelector('[data-action="journal-open"]'),null);
  const count=requests.length;await runInContext('journalDialog()',context);assert.equal(requests.length,count);
});
