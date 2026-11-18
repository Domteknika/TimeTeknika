import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrateDatabase, openPostgresDatabase } from '../server/db/postgres.mjs';
import { createPostgresJournal } from '../server/db/journal.mjs';

async function fixture(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  const orm = drizzle(pg);
  await migrateDatabase({ drizzle: orm });
  const store = await openPostgresDatabase({ drizzle: orm });
  t.after(() => store.close());
  return { pg, orm, store, journal: createPostgresJournal(store) };
}

test('Stockage PostgreSQL : paramètres, types, transactions et durée de vie', async t => {
  const { pg, store, journal } = await fixture(t);
  await journal.initializeJournal();

  await t.test('les paramètres restent des valeurs, y compris à côté de texte SQL cité', async () => {
    const attack = "'; DROP TABLE users; --";
    const row = await store.one(`SELECT ?::text AS value, '?' AS literal, 'it''s ?' AS quoted,
      $$dollar ?$$ AS dollar, $body$named ?$body$ AS named,
      ?::integer AS "question?" /* ? /* nested ? */ ? */ -- ?
    `, attack, 7);
    assert.deepEqual(row, { value: attack, literal: '?', quoted: "it's ?", dollar: 'dollar ?', named: 'named ?', 'question?': 7 });
    assert.deepEqual(await store.one('SELECT COUNT(*) n FROM users'), { n: 0 });
    const escaped = await store.one(String.raw`SELECT E'it\'s ?' AS value, ?::integer AS n`, 9);
    assert.deepEqual(escaped, { value: "it's ?", n: 9 });
    await assert.rejects(store.one('SELECT ?::integer'), /manquant/);
    await assert.rejects(store.one('SELECT 1', 3), /Trop de paramètres/);
    await assert.rejects(store.one("SELECT 'unterminated ?", 3), /non terminée/);
  });

  await t.test('les conversions restent compatibles avec les nombres et JSON du serveur', async () => {
    const row = await store.one(`SELECT ?::bigint AS at, ?::boolean AS active,
      ?::jsonb AS preferences, ?::text AS details_json`,
    1_794_903_600_123, false, '{"pinned":true,"days":5}', '{ "b": 2, "a": 1 }');
    assert.equal(row.at, 1_794_903_600_123);
    assert.equal(row.active, 0);
    assert.deepEqual(JSON.parse(row.preferences), { pinned: true, days: 5 });
    assert.equal(row.details_json, '{ "b": 2, "a": 1 }');
    await assert.rejects(store.one("SELECT '9007199254740993'::bigint AS value"), /plage sûre/);
  });

  await t.test('un instantané refuse une écriture et une transaction expirée ne réutilise pas sa connexion', async () => {
    await store.readTransaction(async () => {
      const isolation = await store.one('SHOW transaction_isolation');
      assert.equal(isolation.transaction_isolation, 'repeatable read');
      await assert.rejects(store.run("UPDATE meta SET value=10 WHERE key='revision'"), /lecture seule/);
      await assert.rejects(store.transaction(() => Promise.resolve()), /lecture seule/);
    });
    let release, continuation;
    const ready = new Promise(resolve => { release = resolve; });
    await store.transaction(async () => {
      continuation = ready.then(() => store.one('SELECT 1'));
    });
    release();
    await assert.rejects(continuation, /déjà terminée/);
    assert.equal((await store.one("SELECT value FROM meta WHERE key='revision'")).value, 0);
  });

  await t.test('une erreur annule les écritures et les savepoints permettent un traitement explicite', async () => {
    const checkpoint = await journal.verifyJournal();
    await assert.rejects(store.transaction(async () => {
      await store.run("UPDATE meta SET value=42 WHERE key='revision'");
      await journal.log({ category: 'system', action: 'rolled-back' });
      throw new Error('annuler');
    }), /annuler/);
    assert.equal((await store.one("SELECT value FROM meta WHERE key='revision'")).value, 0);
    assert.deepEqual(await journal.verifyJournal(), checkpoint);
    await store.transaction(async () => {
      await assert.rejects(store.transaction(async () => {
        await store.run("INSERT INTO meta (key,value) VALUES ('revision',2)");
      }));
      await store.run("UPDATE meta SET value=1 WHERE key='revision'");
    });
    assert.equal((await store.one("SELECT value FROM meta WHERE key='revision'")).value, 1);
    assert.equal((await pg.query("SELECT count(*)::integer n FROM event_log WHERE action='rolled-back'")).rows[0].n, 0);
  });
});

test('Démarrage PostgreSQL : migrations, protections et historique vérifiés sans réparation', async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  const orm = drizzle(pg);
  let closed = 0;
  await assert.rejects(openPostgresDatabase({ drizzle: orm, close: async () => { closed++; } }), /Schéma PostgreSQL incomplet/);
  assert.equal(closed, 1);
  assert.deepEqual(await migrateDatabase({ drizzle: orm }), { applied: 2, total: 2 });
  assert.deepEqual(await migrateDatabase({ drizzle: orm }), { applied: 0, total: 2 });

  const originalHash = (await pg.query('SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at LIMIT 1')).rows[0].hash;
  await pg.query("UPDATE drizzle.__drizzle_migrations SET hash='changed' WHERE id=1");
  await assert.rejects(openPostgresDatabase({ drizzle: orm }), /Version du schéma/);
  await assert.rejects(migrateDatabase({ drizzle: orm }), /Historique de migration/);
  await pg.query('UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE id=1', [originalHash]);
  await pg.exec('ALTER TABLE event_log DISABLE TRIGGER event_log_chain');
  await assert.rejects(openPostgresDatabase({ drizzle: orm }), /Protections du journal/);
  await pg.exec('ALTER TABLE event_log ENABLE TRIGGER event_log_chain');

  const store = await openPostgresDatabase({ drizzle: orm });
  t.after(() => store.close());
  const journal = createPostgresJournal(store);
  const checkpoint = await journal.initializeJournal();
  await store.run('INSERT INTO users (id,name,username,password,role,color) VALUES (?,?,?,?,?,?)', 'fixture', 'Fixture', 'fixture', 'fixture-hash', 'member', '#7658c5');
  await journal.audit({ id: 'fixture' }, 'user', 'fixture', 'create', null, { id: 'fixture', name: 'Fixture' });
  const intact = await journal.verifyJournal();
  assert.equal(intact.ok, true);
  assert.equal(intact.auditCount, 1);
  assert.deepEqual(await journal.initializeJournal(), intact);
  assert.equal((await journal.verifyJournal(checkpoint)).ok, true);
  assert.equal((await journal.verifyJournal({ count: intact.count, hash: 'f'.repeat(64) })).ok, false);
  assert.equal((await journal.verifyJournal({ count: intact.count + 1, hash: intact.hash })).ok, false);

  // A malicious/privileged edit is detected even after protections are re-enabled.
  await pg.exec('ALTER TABLE event_log DISABLE TRIGGER event_log_append_only');
  await pg.query("UPDATE event_log SET action='tampered' WHERE seq=1");
  await pg.exec('ALTER TABLE event_log ENABLE TRIGGER event_log_append_only');
  await assert.rejects(journal.initializeJournal(), /Journal invalide/);
  assert.equal((await pg.query('SELECT action FROM event_log WHERE seq=1')).rows[0].action, 'tampered');
  await pg.exec('ALTER TABLE event_log DISABLE TRIGGER event_log_append_only');
  await pg.query("UPDATE event_log SET action='journal-enabled' WHERE seq=1");
  await pg.exec('ALTER TABLE event_log ENABLE TRIGGER event_log_append_only');
  assert.deepEqual(await journal.verifyJournal(), intact);
  await pg.exec('ALTER TABLE event_log DISABLE TRIGGER event_log_chain');
  await pg.exec(`INSERT INTO event_log (seq,at,level,category,action,actor,entity,entity_id,request_id,details_json,previous_hash,hash)
    SELECT 0,at,level,category,action,actor,entity,entity_id,request_id,details_json,previous_hash,hash FROM event_log WHERE seq=1`);
  await pg.exec('ALTER TABLE event_log ENABLE TRIGGER event_log_chain');
  const zero = await journal.verifyJournal();
  assert.equal(zero.ok, false);
  assert.equal(zero.seq, 0); // The first page must not silently skip zero/negative sequence numbers.
});

test('Initialisation PostgreSQL : import partiel refusé et fermeture après opérations en cours', async t => {
  const { pg, orm, store, journal } = await fixture(t);
  await store.run('INSERT INTO meta (key,value) VALUES (?,?)', 'revision', 7);
  await assert.rejects(journal.initializeJournal(), /base non vide/);
  assert.equal((await store.one('SELECT COUNT(*) n FROM event_log')).n, 0);
  assert.equal((await store.one("SELECT value FROM meta WHERE key='revision'")).value, 7);
  await store.close();

  let disposed = 0, release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const reopened = await openPostgresDatabase({ drizzle: orm, close: async () => { disposed++; } });
  const writing = reopened.transaction(async () => {
    await reopened.run("UPDATE meta SET value=8 WHERE key='revision'");
    entered();
    await gate;
    await reopened.run("UPDATE meta SET value=9 WHERE key='revision'");
  });
  await ready;
  const closing = reopened.close();
  await assert.rejects(reopened.one('SELECT 1'), /fermé/);
  assert.equal(disposed, 0);
  release();
  await writing;
  await closing;
  await reopened.close();
  assert.equal(disposed, 1);
  assert.equal(Number((await pg.query("SELECT value FROM meta WHERE key='revision'")).rows[0].value), 9);
});
