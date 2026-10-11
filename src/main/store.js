const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

let SQL = null;
let db = null;
let dbPath = null;
let saveTimer = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  duration_ms INTEGER DEFAULT 0,
  app_name TEXT,
  process_name TEXT,
  window_title TEXT,
  url TEXT,
  file_path TEXT,
  content TEXT,
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_act_started ON activities(started_at);
CREATE INDEX IF NOT EXISTS idx_act_type ON activities(type);
CREATE INDEX IF NOT EXISTS idx_act_app ON activities(app_name);

CREATE TABLE IF NOT EXISTS screenshots (
  id TEXT PRIMARY KEY,
  taken_at INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  app_name TEXT,
  window_title TEXT,
  description TEXT,
  ocr_text TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ss_taken ON screenshots(taken_at);

CREATE TABLE IF NOT EXISTS knowledge_cards (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  content TEXT,
  tags TEXT,
  links TEXT,
  source_ids TEXT,
  importance INTEGER DEFAULT 3,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kc_kind ON knowledge_cards(kind);
CREATE INDEX IF NOT EXISTS idx_kc_title ON knowledge_cards(title);

CREATE TABLE IF NOT EXISTS journals (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL,
  period_key TEXT NOT NULL,
  title TEXT,
  content TEXT,
  highlights TEXT,
  stats TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(period, period_key)
);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  summary TEXT,
  card_ids TEXT,
  activity_count INTEGER DEFAULT 0,
  last_seen INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations TEXT,
  created_at INTEGER NOT NULL
);
`;

async function initStore() {
  SQL = await initSqlJs();
  dbPath = path.join(app.getPath('userData'), 'mindtrace.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  db.run(SCHEMA);
  dirty = true;
  persist(true);
  return db;
}

let dirty = false;
let lastPersistAt = 0;
let forceTimer = null;
const PERSIST_DEBOUNCE_MS = 4000;
const PERSIST_MAX_WAIT_MS = 20000;

function persist(force = false) {
  if (!db || !dbPath) return;
  if (!dirty && !force) return;
  try {
    const data = db.export();
    const tmp = dbPath + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(data));
    fs.renameSync(tmp, dbPath);
    dirty = false;
    lastPersistAt = Date.now();
  } catch (e) {
    console.error('persist', e.message);
  }
}

function schedulePersist() {
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist(false), PERSIST_DEBOUNCE_MS);
  if (!forceTimer) {
    forceTimer = setTimeout(() => {
      forceTimer = null;
      if (dirty) persist(true);
    }, PERSIST_MAX_WAIT_MS);
  }
}

function run(sql, params = []) {
  db.run(sql, params);
  schedulePersist();
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  const rows = all(sql, params);
  return rows[0] || null;
}

function insertActivity(row) {
  const id = row.id || crypto.randomUUID();
  const now = Date.now();
  run(
    `INSERT INTO activities (id,type,started_at,ended_at,duration_ms,app_name,process_name,window_title,url,file_path,content,meta,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      row.type,
      row.started_at || now,
      row.ended_at || null,
      row.duration_ms || 0,
      row.app_name || null,
      row.process_name || null,
      row.window_title || null,
      row.url || null,
      row.file_path || null,
      row.content || null,
      row.meta ? JSON.stringify(row.meta) : null,
      now
    ]
  );
  return id;
}

function updateActivityEnd(id, endedAt, durationMs) {
  run(`UPDATE activities SET ended_at=?, duration_ms=? WHERE id=?`, [endedAt, durationMs, id]);
}

function insertScreenshot(row) {
  const id = row.id || crypto.randomUUID();
  const now = Date.now();
  run(
    `INSERT INTO screenshots (id,taken_at,file_path,app_name,window_title,description,ocr_text,created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, row.taken_at || now, row.file_path, row.app_name || null, row.window_title || null, row.description || null, row.ocr_text || null, now]
  );
  return id;
}

function updateScreenshotDescription(id, description, ocrText) {
  run(`UPDATE screenshots SET description=?, ocr_text=COALESCE(?, ocr_text) WHERE id=?`, [
    description || null,
    ocrText || null,
    id
  ]);
  // also mirror into related activity content for retrieval
  run(`UPDATE activities SET content=? WHERE type='screenshot' AND meta LIKE ?`, [
    description || null,
    `%"screenshotId":"${id}"%`
  ]);
}

function upsertKnowledgeCard(card) {
  const now = Date.now();
  const existing = card.id ? get(`SELECT id FROM knowledge_cards WHERE id=?`, [card.id]) : get(`SELECT id FROM knowledge_cards WHERE kind=? AND title=?`, [card.kind, card.title]);
  if (existing) {
    run(
      `UPDATE knowledge_cards SET summary=?, content=?, tags=?, links=?, source_ids=?, importance=?, updated_at=? WHERE id=?`,
      [
        card.summary || null,
        card.content || null,
        card.tags ? JSON.stringify(card.tags) : null,
        card.links ? JSON.stringify(card.links) : null,
        card.source_ids ? JSON.stringify(card.source_ids) : null,
        card.importance || 3,
        now,
        existing.id
      ]
    );
    return existing.id;
  }
  const id = card.id || crypto.randomUUID();
  run(
    `INSERT INTO knowledge_cards (id,kind,title,summary,content,tags,links,source_ids,importance,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      card.kind,
      card.title,
      card.summary || null,
      card.content || null,
      card.tags ? JSON.stringify(card.tags) : null,
      card.links ? JSON.stringify(card.links) : null,
      card.source_ids ? JSON.stringify(card.source_ids) : null,
      card.importance || 3,
      now,
      now
    ]
  );
  return id;
}

function upsertJournal(j) {
  const now = Date.now();
  const existing = get(`SELECT id FROM journals WHERE period=? AND period_key=?`, [j.period, j.period_key]);
  if (existing) {
    run(`UPDATE journals SET title=?, content=?, highlights=?, stats=? WHERE id=?`, [
      j.title || null,
      j.content || null,
      j.highlights ? JSON.stringify(j.highlights) : null,
      j.stats ? JSON.stringify(j.stats) : null,
      existing.id
    ]);
    return existing.id;
  }
  const id = crypto.randomUUID();
  run(
    `INSERT INTO journals (id,period,period_key,title,content,highlights,stats,created_at) VALUES (?,?,?,?,?,?,?,?)`,
    [id, j.period, j.period_key, j.title || null, j.content || null, j.highlights ? JSON.stringify(j.highlights) : null, j.stats ? JSON.stringify(j.stats) : null, now]
  );
  return id;
}

function addChatMessage(role, content, citations) {
  const id = crypto.randomUUID();
  // migrate column if older DB
  try { db.run(`ALTER TABLE chat_messages ADD COLUMN citations TEXT`); } catch (_) {}
  run(`INSERT INTO chat_messages (id,role,content,citations,created_at) VALUES (?,?,?,?,?)`, [
    id, role, content, citations ? JSON.stringify(citations) : null, Date.now()
  ]);
  return id;
}

function searchActivities({ q, type, from, to, limit = 100 } = {}) {
  let sql = `SELECT * FROM activities WHERE 1=1`;
  const params = [];
  if (type) { sql += ` AND type=?`; params.push(type); }
  if (from) { sql += ` AND started_at>=?`; params.push(from); }
  if (to) { sql += ` AND started_at<=?`; params.push(to); }
  if (q) {
    sql += ` AND (window_title LIKE ? OR app_name LIKE ? OR content LIKE ? OR url LIKE ? OR file_path LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  sql += ` ORDER BY started_at DESC LIMIT ?`;
  params.push(limit);
  return all(sql, params);
}

function getTodayStats() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const from = start.getTime();
  const acts = all(`SELECT app_name, SUM(duration_ms) as total_ms, COUNT(*) as cnt FROM activities WHERE type='window' AND started_at>=? GROUP BY app_name ORDER BY total_ms DESC`, [from]);
  const totals = get(`SELECT COUNT(*) as c, COALESCE(SUM(duration_ms),0) as ms FROM activities WHERE started_at>=?`, [from]);
  const cards = get(`SELECT COUNT(*) as c FROM knowledge_cards WHERE created_at>=?`, [from]);
  const shots = get(`SELECT COUNT(*) as c FROM screenshots WHERE taken_at>=?`, [from]);
  const browser = get(`SELECT COUNT(*) as c FROM activities WHERE type='browser' AND started_at>=?`, [from]);
  const focus = get(`SELECT COALESCE(SUM(duration_ms),0) as ms FROM activities WHERE type='window' AND started_at>=?`, [from]);
  return {
    appBreakdown: acts,
    activityCount: totals?.c || 0,
    totalMs: focus?.ms || totals?.ms || 0,
    cardsToday: cards?.c || 0,
    screenshotsToday: shots?.c || 0,
    browserCount: browser?.c || 0
  };
}

function getActivityById(id) { return get(`SELECT * FROM activities WHERE id=?`, [id]); }
function getCardById(id) { return get(`SELECT * FROM knowledge_cards WHERE id=?`, [id]); }
function getJournalById(id) { return get(`SELECT * FROM journals WHERE id=?`, [id]); }

function upsertTopic(topic) {
  const now = Date.now();
  const existing = topic.id
    ? get(`SELECT id FROM topics WHERE id=?`, [topic.id])
    : get(`SELECT id FROM topics WHERE name=?`, [topic.name]);
  if (existing) {
    run(`UPDATE topics SET summary=?, card_ids=?, activity_count=?, last_seen=?, updated_at=? WHERE id=?`, [
      topic.summary || null,
      topic.card_ids ? JSON.stringify(topic.card_ids) : null,
      topic.activity_count || 0,
      topic.last_seen || now,
      now,
      existing.id
    ]);
    return existing.id;
  }
  const id = topic.id || crypto.randomUUID();
  run(`INSERT INTO topics (id,name,summary,card_ids,activity_count,last_seen,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [
    id, topic.name, topic.summary || null,
    topic.card_ids ? JSON.stringify(topic.card_ids) : null,
    topic.activity_count || 0, topic.last_seen || now, now, now
  ]);
  return id;
}

function clearDemoData() {
  // activities / screenshots with meta isDemo; cards/journals/topics tagged demo via tags or title prefix
  const acts = all(`SELECT id, meta FROM activities`);
  for (const a of acts) {
    try {
      const m = a.meta ? JSON.parse(a.meta) : null;
      if (m && m.isDemo) run(`DELETE FROM activities WHERE id=?`, [a.id]);
    } catch (_) {}
  }
  run(`DELETE FROM knowledge_cards WHERE tags LIKE '%"示例"%' OR title LIKE '【示例】%'`);
  run(`DELETE FROM journals WHERE title LIKE '示例%' OR title LIKE '【示例】%'`);
  run(`DELETE FROM topics WHERE name LIKE '【示例】%' OR summary LIKE '%示例主题%'`);
}

function getDbPath() { return dbPath; }
function closeStore() { if (db) { persist(true); db.close(); db = null; } }

module.exports = {
  initStore, persist, closeStore, getDbPath,
  run, all, get,
  insertActivity, updateActivityEnd, insertScreenshot, updateScreenshotDescription,
  upsertKnowledgeCard, upsertJournal, addChatMessage,
  searchActivities, getTodayStats, getActivityById, getCardById, getJournalById, upsertTopic, clearDemoData
};
