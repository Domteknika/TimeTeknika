import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../server/index.mjs';
import { openApplicationStore } from '../server/async-store.mjs';

test('Arrêt asynchrone : un abonnement SSE encore en authentification ne bloque pas la fermeture', { timeout: 15_000 }, async t => {
  const store = await openApplicationStore({ dbPath: ':memory:' });
  let release, entered, delayAuthentication = false;
  const waiting = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const delayedStore = {
    ...store,
    async one(query, ...args) {
      if (delayAuthentication && query.startsWith('SELECT * FROM sessions WHERE token=')) {
        delayAuthentication = false;
        entered();
        await gate;
      }
      return store.one(query, ...args);
    },
  };
  const app = await createApplication({ store: delayedStore, demo: true });
  t.after(async () => { release(); await app.close(); });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${base}/api/demo-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: 'demo-emma' }),
  });
  assert.equal(login.status, 200);
  await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  delayAuthentication = true;
  const responsePromise = fetch(`${base}/api/events`, { headers: { Cookie: cookie } });
  await waiting;
  const closing = app.close();
  release();
  const response = await responsePromise;
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'shutting_down');
  await closing;
  await app.close(); // A second close shares the completed shutdown.
});

test('Stockage SQLite asynchrone : fermeture ordonnée et callbacks hors transaction refusés', { timeout: 5_000 }, async t => {
  const store = await openApplicationStore({ dbPath: ':memory:' });
  let release;
  t.after(async () => { release?.(); await store.close(); });

  let trigger, escaped;
  await store.transaction(async () => {
    const signal = new Promise(resolve => { trigger = resolve; });
    // The callback inherits the transaction context, but executes after commit.
    escaped = signal.then(() => store.one('SELECT 1'));
  });
  trigger();
  await assert.rejects(escaped, /transaction SQLite est déjà terminée/);
  await store.readTransaction(async () => {
    await assert.rejects(store.log({ category: 'system', action: 'unexpected-write' }), /lecture seule/);
    assert.equal((await store.verifyJournal()).ok, true);
  });

  let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { entered = resolve; });
  const active = store.transaction(async () => {
    await store.run('INSERT INTO meta(key,value) VALUES (?,?)', 'shutdown_probe', 1);
    entered();
    await gate;
    // Already accepted work retains its connection until commit, even while closing.
    await store.run('UPDATE meta SET value=2 WHERE key=?', 'shutdown_probe');
    return store.one('SELECT value FROM meta WHERE key=?', 'shutdown_probe');
  });
  await waiting;
  const closing = store.close();
  assert.equal(store.close(), closing);
  await assert.rejects(store.one('SELECT 1'), /Stockage fermé/);
  let settled = false;
  void closing.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  release();
  assert.equal((await active).value, 2);
  await closing;
});
