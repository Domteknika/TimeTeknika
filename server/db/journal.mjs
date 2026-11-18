import { createHash } from 'node:crypto';
import { auditFields, requestContext } from '../journal.mjs';
import { id, midnight } from '../domain.mjs';

const genesis = '0'.repeat(64);
const fields = ['seq', 'at', 'level', 'category', 'action', 'actor', 'entity', 'entity_id', 'request_id', 'details_json', 'previous_hash'];
const digest = row => createHash('sha256').update(JSON.stringify(fields.map(key => row[key]))).digest('hex');
const auditValue = row => JSON.stringify(auditFields.map(key => row[key]));

export function createPostgresJournal(store) {
  async function log(event) {
    return store.transaction(async () => {
      const last = await store.one('SELECT seq,hash FROM event_log ORDER BY seq DESC LIMIT 1');
      const context = requestContext.getStore();
      const row = {
        seq: (last?.seq ?? 0) + 1, at: event.at ?? Date.now(), level: event.level ?? 'info',
        category: event.category, action: event.action, actor: event.actor ?? context?.actor ?? null,
        entity: event.entity ?? null, entity_id: event.entity_id ?? null,
        request_id: context?.requestId ?? null, details_json: JSON.stringify(event.details ?? {}),
        previous_hash: last?.hash ?? genesis,
      };
      if (!Number.isSafeInteger(row.seq) || !Number.isSafeInteger(row.at)) throw new Error('Numéro ou date de journal hors limites.');
      row.hash = digest(row);
      await store.run(`INSERT INTO event_log (${[...fields, 'hash'].join(',')}) VALUES (${Array(12).fill('?').join(',')})`, ...fields.map(key => row[key]), row.hash);
      return row;
    });
  }

  async function audit(user, entity, entityId, action, before, after, owner = null) {
    return store.transaction(async () => {
      const aid = id();
      await store.run('INSERT INTO audit (id,actor,entity,entity_id,owner,action,before_json,after_json,at) VALUES (?,?,?,?,?,?,?,?,?)',
        aid, user.id, entity, entityId, owner, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, Date.now());
      const record = await store.one('SELECT * FROM audit WHERE id=?', aid);
      await log({ category: 'audit', action, actor: user.id, entity, entity_id: entityId, details: { audit: record } });
      return record;
    });
  }

  async function verifySnapshot(checkpoint) {
    let count = 0, hash = genesis, auditCount = 0, checkpointSeen = !checkpoint, enabled = false, firstPage = true;
    const auditIds = new Set();
    const failure = (reason, seq) => ({ ok: false, reason, seq, count, hash });
    for (;;) {
      const rows = firstPage
        ? await store.all('SELECT * FROM event_log ORDER BY seq LIMIT 1000')
        : await store.all('SELECT * FROM event_log WHERE seq>? ORDER BY seq LIMIT 1000', count);
      firstPage = false;
      if (!rows.length) break;
      for (const row of rows) {
        if (row.seq !== count + 1 || row.previous_hash !== hash || row.hash !== digest(row)) return failure('Chaîne du journal altérée', row.seq);
        if (row.category === 'audit') {
          let record;
          try { record = JSON.parse(row.details_json).audit; } catch { return failure('Historique illisible', row.seq); }
          const original = record && await store.one('SELECT * FROM audit WHERE id=?', record.id);
          if (!original || auditIds.has(record.id) || auditValue(original) !== auditValue(record)) return failure('Historique différent du journal', row.seq);
          auditIds.add(record.id); auditCount++;
        }
        count = row.seq; hash = row.hash;
        if (row.category === 'system' && row.action === 'journal-enabled') enabled = true;
        if (checkpoint?.count === count) {
          if (checkpoint.hash !== hash) return failure('Empreinte différente du point de contrôle', row.seq);
          checkpointSeen = true;
        }
      }
    }
    if (auditCount !== (await store.one('SELECT COUNT(*) n FROM audit')).n) return failure('Historique absent du journal', count);
    if (!enabled) return failure('Activation du journal absente', count);
    if (checkpoint?.count === 0 && checkpoint.hash === genesis) checkpointSeen = true;
    if (!checkpointSeen) return failure('Point de contrôle absent : journal tronqué ou remplacé', count);
    return { ok: true, count, hash, auditCount };
  }

  const verifyJournal = (checkpoint = null) => store.readTransaction(() => verifySnapshot(checkpoint));

  async function initializeJournal() {
    return store.transaction(async () => {
      const marker = await store.one("SELECT value FROM meta WHERE key='journal_version'");
      if (!marker) {
        // Only a pristine, migrated database can be initialized. A partial import
        // or a missing marker must never cause existing history to be re-sealed.
        for (const table of ['meta', 'users', 'user_admins', 'sessions', 'clients', 'projects', 'tasks', 'assignments', 'entries', 'audit', 'requests', 'export_templates', 'event_log']) {
          if (await store.one(`SELECT 1 FROM ${table} LIMIT 1`))
            throw new Error('Journal PostgreSQL non initialisé dans une base non vide. Terminer ou vérifier l’import sans réécrire l’historique.');
        }
        await store.run('INSERT INTO meta (key,value) VALUES (?,?)', 'revision', 0);
        await store.run('INSERT INTO meta (key,value) VALUES (?,?)', 'balance_start', midnight('2026-10-26'));
        await log({ category: 'system', action: 'journal-enabled', details: { version: 1 } });
        await store.run('INSERT INTO meta (key,value) VALUES (?,?)', 'journal_version', 1);
      } else if (marker.value !== 1) {
        throw new Error('Version du journal PostgreSQL non prise en charge.');
      }
      const revision = await store.one("SELECT value FROM meta WHERE key='revision'");
      const balance = await store.one("SELECT value FROM meta WHERE key='balance_start'");
      if (!revision || revision.value < 0 || !balance) throw new Error('Métadonnées PostgreSQL incomplètes. Restaurer une base vérifiée.');
      const integrity = await verifyJournal();
      if (!integrity.ok) throw new Error(`Journal invalide : ${integrity.reason} (#${integrity.seq}). Restaurer une sauvegarde vérifiée.`);
      return integrity;
    });
  }

  return { initializeJournal, log, audit, verifyJournal };
}
