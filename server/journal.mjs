import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext = new AsyncLocalStorage();
const genesis = '0'.repeat(64);
const fields = ['seq','at','level','category','action','actor','entity','entity_id','request_id','details_json','previous_hash'];
const digest = row => createHash('sha256').update(JSON.stringify(fields.map(key => row[key]))).digest('hex');
export const auditFields = ['id','actor','entity','entity_id','owner','action','before_json','after_json','at'];
const auditValue = row => JSON.stringify(auditFields.map(key => row[key]));

// Transactions can nest inside a business mutation; a failed log rolls it back too.
export function journalTransaction(db, operation) {
  db.exec('SAVEPOINT journal_write');
  try { const result = operation(); db.exec('RELEASE journal_write'); return result; }
  catch (error) { db.exec('ROLLBACK TO journal_write; RELEASE journal_write'); throw error; }
}

export function appendEvent(db, event) {
  return journalTransaction(db, () => {
    const last = db.prepare('SELECT seq,hash FROM event_log ORDER BY seq DESC LIMIT 1').get();
    const context = requestContext.getStore();
    const row = {
      seq: (last?.seq ?? 0) + 1, at: event.at ?? Date.now(), level: event.level ?? 'info',
      category: event.category, action: event.action, actor: event.actor ?? context?.actor ?? null,
      entity: event.entity ?? null, entity_id: event.entity_id ?? null,
      request_id: context?.requestId ?? null, details_json: JSON.stringify(event.details ?? {}),
      previous_hash: last?.hash ?? genesis
    };
    row.hash = digest(row);
    db.prepare(`INSERT INTO event_log (${[...fields,'hash'].join(',')}) VALUES (${Array(12).fill('?').join(',')})`).run(...fields.map(key => row[key]),row.hash);
    return row;
  });
}

// Read-only, also usable on a backup without running migrations.
export function verifyJournal(db, checkpoint = null) {
  return journalTransaction(db, () => verifySnapshot(db,checkpoint));
}

function verifySnapshot(db, checkpoint) {
  let count = 0, hash = genesis, auditCount = 0, checkpointSeen = !checkpoint;
  let enabled = false;
  const auditIds = new Set();
  const failure = (reason, seq) => ({ok:false,reason,seq,count,hash});
  const auditById = db.prepare('SELECT * FROM audit WHERE id=?');
  for (const row of db.prepare('SELECT * FROM event_log ORDER BY seq').iterate()) {
    if (row.seq !== count + 1 || row.previous_hash !== hash || row.hash !== digest(row)) return failure('Chaîne du journal altérée',row.seq);
    if (row.category === 'audit') {
      let record;
      try { record = JSON.parse(row.details_json).audit; } catch { return failure('Historique illisible',row.seq); }
      const original = record && auditById.get(record.id);
      if (!original || auditIds.has(record.id) || auditValue(original) !== auditValue(record)) return failure('Historique différent du journal',row.seq);
      auditIds.add(record.id); auditCount++;
    }
    count = row.seq; hash = row.hash;
    if(row.category==='system' && row.action==='journal-enabled')enabled=true;
    if (checkpoint?.count === count) {
      if (checkpoint.hash !== hash) return failure('Empreinte différente du point de contrôle',row.seq);
      checkpointSeen = true;
    }
  }
  if (auditCount !== db.prepare('SELECT COUNT(*) n FROM audit').get().n) return failure('Historique absent du journal',count);
  if (!enabled) return failure('Activation du journal absente',count);
  if (checkpoint?.count === 0 && checkpoint.hash === genesis) checkpointSeen = true;
  if (!checkpointSeen) return failure('Point de contrôle absent : journal tronqué ou remplacé',count);
  return {ok:true,count,hash,auditCount};
}

export function initializeJournal(db) {
  journalTransaction(db, () => {
    const initialized = db.prepare("SELECT 1 FROM meta WHERE key='journal_version'").get();
    if (initialized && !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='event_log'").get()) throw Error('Journal invalide : table absente. Restaurer une sauvegarde vérifiée.');
    db.exec(`CREATE TABLE IF NOT EXISTS event_log (
      seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, level TEXT NOT NULL CHECK(level IN ('info','warning','error')),
      category TEXT NOT NULL, action TEXT NOT NULL, actor TEXT, entity TEXT, entity_id TEXT, request_id TEXT,
      details_json TEXT NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS event_log_request ON event_log(request_id,seq);
      CREATE INDEX IF NOT EXISTS event_log_level ON event_log(level,seq);
      CREATE INDEX IF NOT EXISTS event_log_category ON event_log(category,seq);`);
    if (!initialized) {
      // Existing history is sealed now, not retroactively certified.
      for (const row of db.prepare('SELECT * FROM audit ORDER BY at,rowid').all()) {
        appendEvent(db,{category:'audit',action:row.action,actor:row.actor,entity:row.entity,entity_id:row.entity_id,details:{audit:row,legacy:true}});
      }
      appendEvent(db,{category:'system',action:'journal-enabled',details:{version:1}});
      db.prepare("INSERT INTO meta VALUES ('journal_version',1)").run();
    }
    for (const table of ['event_log','audit']) {
      for (const operation of ['UPDATE','DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Journal append-only'); END;`);
      const key = table === 'audit' ? 'id' : 'seq';
      // REPLACE can bypass DELETE triggers when recursive_triggers is off.
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_replace BEFORE INSERT ON ${table}
        WHEN EXISTS (SELECT 1 FROM ${table} WHERE ${key}=NEW.${key}) BEGIN SELECT RAISE(ABORT,'Journal append-only'); END;`);
    }
    db.exec(`CREATE TRIGGER IF NOT EXISTS event_log_chain BEFORE INSERT ON event_log
      WHEN NEW.seq != COALESCE((SELECT MAX(seq) FROM event_log),0)+1
        OR NEW.previous_hash != COALESCE((SELECT hash FROM event_log ORDER BY seq DESC LIMIT 1),'${genesis}')
      BEGIN SELECT RAISE(ABORT,'Invalid journal chain'); END;`);
    const integrity = verifyJournal(db);
    if (!integrity.ok) throw Error(`Journal invalide : ${integrity.reason} (#${integrity.seq}). Restaurer une sauvegarde vérifiée.`);
  });
}
