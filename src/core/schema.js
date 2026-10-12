/** v2.3 统一 schema 迁移（幂等）。所有表以 IF NOT EXISTS / ALTER 容错。 */
const store = require('../main/store');

const SQL = `
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT, uri TEXT, app TEXT, content_hash TEXT, text TEXT,
  first_seen INTEGER, last_seen INTEGER, dwell_ms INTEGER DEFAULT 0, event_ids TEXT, version INTEGER DEFAULT 1,
  privacy_level TEXT DEFAULT 'full', status TEXT DEFAULT 'new', doc_key TEXT
);
CREATE INDEX IF NOT EXISTS idx_doc_key ON documents(doc_key);
CREATE INDEX IF NOT EXISTS idx_doc_status ON documents(status);
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, ord INTEGER, text TEXT, simhash TEXT, sha1 TEXT, quality REAL,
  event_ids TEXT, observed_at INTEGER, anchor_source TEXT DEFAULT 'capture', privacy_level TEXT DEFAULT 'full',
  tags TEXT, extracted_at INTEGER, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_chunk_doc ON chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_chunk_sha ON chunks(sha1);
CREATE INDEX IF NOT EXISTS idx_chunk_extract ON chunks(extracted_at);
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, norm_name TEXT, pinyin TEXT, status TEXT DEFAULT 'candidate',
  merged_into TEXT, salience REAL DEFAULT 0, mention_count INTEGER DEFAULT 0, doc_count INTEGER DEFAULT 0, day_count INTEGER DEFAULT 0,
  first_seen INTEGER, last_seen INTEGER, locked INTEGER DEFAULT 0, promoted_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_ent_norm ON entities(norm_name);
CREATE INDEX IF NOT EXISTS idx_ent_status ON entities(status);
CREATE TABLE IF NOT EXISTS entity_aliases (alias_norm TEXT NOT NULL, entity_id TEXT NOT NULL, alias TEXT, source TEXT, PRIMARY KEY(alias_norm, entity_id));
CREATE TABLE IF NOT EXISTS mentions (id TEXT PRIMARY KEY, chunk_id TEXT, doc_id TEXT, entity_id TEXT, ts INTEGER, day TEXT);
CREATE INDEX IF NOT EXISTS idx_mention_ent ON mentions(entity_id);
CREATE INDEX IF NOT EXISTS idx_mention_chunk ON mentions(chunk_id);
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, predicate TEXT, object TEXT, text TEXT, confidence REAL DEFAULT 0.7,
  status TEXT DEFAULT 'active', first_seen INTEGER, last_seen INTEGER, superseded_by TEXT, conflict_with TEXT, locked INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_claim_ent ON claims(entity_id, predicate);
CREATE TABLE IF NOT EXISTS links (src TEXT, dst TEXT, kind TEXT, weight REAL DEFAULT 1, PRIMARY KEY(src, dst, kind));
CREATE TABLE IF NOT EXISTS merge_suggestions (id TEXT PRIMARY KEY, a TEXT, b TEXT, score REAL, reason TEXT, status TEXT DEFAULT 'open', created_at INTEGER);
CREATE TABLE IF NOT EXISTS page_revisions (id TEXT PRIMARY KEY, page_id TEXT, ts INTEGER, author TEXT, before TEXT, after TEXT, trigger TEXT, tokens INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_rev_page ON page_revisions(page_id, ts);
CREATE TABLE IF NOT EXISTS kb_log (id TEXT PRIMARY KEY, ts INTEGER, line TEXT);
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, chunk_id TEXT, event_id TEXT, ts INTEGER, quote TEXT, polarity INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_ev_owner ON evidence(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_ev_chunk ON evidence(chunk_id);
CREATE INDEX IF NOT EXISTS idx_ev_event ON evidence(event_id);
CREATE TABLE IF NOT EXISTS tombstones (key TEXT PRIMARY KEY, owner_type TEXT, pattern TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS memory_events (id TEXT PRIMARY KEY, memory_id TEXT, op TEXT, before TEXT, after TEXT, actor TEXT, ts INTEGER);
CREATE INDEX IF NOT EXISTS idx_memev ON memory_events(memory_id);
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY, level TEXT, period_key TEXT, start_at INTEGER, end_at INTEGER, title TEXT, summary TEXT,
  block_ids TEXT, memory_ids TEXT, importance REAL DEFAULT 0.5, UNIQUE(level, period_key, start_at)
);
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY, layer TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, notes TEXT,
  start_at INTEGER, end_at INTEGER, all_day INTEGER DEFAULT 0, tz TEXT DEFAULT 'Asia/Shanghai', rrule TEXT, location TEXT,
  participants TEXT, status TEXT NOT NULL DEFAULT 'proposed', priority INTEGER DEFAULT 2, confidence REAL DEFAULT 0.5,
  time_certainty TEXT, direction TEXT, project_id TEXT, dedupe_key TEXT, source_app TEXT, reminders TEXT,
  created_by TEXT DEFAULT 'ai', locked_fields TEXT, change_of TEXT, linked_event TEXT, snooze_until INTEGER, reminded_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cal_start ON calendar_events(layer, start_at);
CREATE INDEX IF NOT EXISTS idx_cal_status ON calendar_events(status);
CREATE INDEX IF NOT EXISTS idx_cal_dedupe ON calendar_events(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_act_created ON activities(created_at);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS calendar_rules (id TEXT PRIMARY KEY, name TEXT, match TEXT, action TEXT, enabled INTEGER DEFAULT 1, created_at INTEGER);
CREATE TABLE IF NOT EXISTS daily_plans (day TEXT PRIMARY KEY, plan_md TEXT, review_md TEXT, top3 TEXT, stats TEXT, created_at INTEGER, updated_at INTEGER);
`;

const ALTERS = [
  ['wiki_pages', 'entity_id TEXT'], ['wiki_pages', 'summary TEXT'], ['wiki_pages', 'user_notes TEXT'],
  ['wiki_pages', 'staleness REAL'], ['wiki_pages', 'confidence REAL'], ['wiki_pages', 'dirty INTEGER DEFAULT 0'],
  ['memories', 'subject_entity_id TEXT'], ['memories', 'predicate TEXT'], ['memories', 'object TEXT'],
  ['memories', 'importance REAL DEFAULT 0.5'], ['memories', 'strength REAL DEFAULT 1.0'], ['memories', 'last_seen_at INTEGER'],
  ['memories', 'last_used_at INTEGER'], ['memories', 'valid_from INTEGER'], ['memories', 'valid_to INTEGER'],
  ['memories', 'superseded_by TEXT'], ['memories', "source TEXT DEFAULT 'auto'"], ['memories', "sensitivity TEXT DEFAULT 'normal'"],
  ['memories', 'pinned INTEGER DEFAULT 0'], ['memories', 'locked INTEGER DEFAULT 0'], ['memories', 'conflict_with TEXT'],
  ['memories', 'evidence_count INTEGER DEFAULT 0']
];

let done = false;
function migrate() {
  if (done) return;
  const db = store.getDb();
  db.exec(SQL);
  for (const [t, col] of ALTERS) { try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${col}`); } catch (_) { /* exists */ } }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_rank ON memories(status, pinned, importance, confidence)`); db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_sp ON memories(predicate, status)`); } catch (_) {}
  // FTS for chunks + memories (bigram), same engine selection as store
  const mode = store.ftsStatus().mode;
  for (const name of ['chunks_fts', 'memories_fts']) {
    if (store.get(`SELECT 1 FROM sqlite_master WHERE name=?`, [name])) continue;
    try {
      if (mode === 'fts5') db.exec(`CREATE VIRTUAL TABLE ${name} USING fts5(text, extra, tokenize='unicode61')`);
      else if (mode === 'fts4') db.exec(`CREATE VIRTUAL TABLE ${name} USING fts4(text, extra, tokenize=unicode61)`);
    } catch (e) { console.error('[schema] fts', name, e.message); }
  }
  // memories 迁移：旧 kind 映射；todo → 日历；默认值补齐
  try {
    store.run(`UPDATE memories SET kind='fact_self' WHERE kind='fact'`);
    store.run(`UPDATE memories SET last_seen_at=COALESCE(last_seen_at, updated_at), valid_from=COALESCE(valid_from, created_at) WHERE last_seen_at IS NULL OR valid_from IS NULL`);
    const todos = store.all(`SELECT * FROM memories WHERE kind='todo' AND status IN ('active','pending')`);
    const now = Date.now();
    for (const m of todos) {
      store.run(`INSERT OR IGNORE INTO calendar_events (id,layer,kind,title,status,confidence,created_by,created_at,updated_at,time_certainty) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ['mig-' + m.id, 'plan', 'todo', m.text.slice(0, 60), m.status === 'active' ? 'confirmed' : 'proposed', m.confidence || 0.6, 'import', now, now, 'none']);
      store.run(`UPDATE memories SET status='archived' WHERE id=?`, [m.id]);
    }
  } catch (e) { console.error('[schema] memory migrate', e.message); }
  done = true;
}
function reset() { done = false; }

module.exports = { migrate, reset };
