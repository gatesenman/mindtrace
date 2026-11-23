const dbAdapter = require('./db');
const { toIndexText, toMatchQuery } = require('../common/bigram');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isSelfApp, friendlyAppName } = require('./appNames');
const { redactText } = require('../privacy/redact');
const { app } = require('electron');

let ftsMode = 'none'; // fts5 | fts4 | none
const ftsErrors = { count: 0, last: null };
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
CREATE INDEX IF NOT EXISTS idx_act_type_started ON activities(type, started_at);
CREATE INDEX IF NOT EXISTS idx_act_url ON activities(url);

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
CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at);

CREATE TABLE IF NOT EXISTS wiki_pages (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT,
  backlinks TEXT,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(kind, slug)
);
CREATE INDEX IF NOT EXISTS idx_wiki_kind ON wiki_pages(kind);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  confidence REAL DEFAULT 0.8,
  evidence TEXT,
  status TEXT DEFAULT 'active',
  dedupe_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mem_dedupe ON memories(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_mem_kind ON memories(kind);

CREATE TABLE IF NOT EXISTS rollups (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  period_key TEXT NOT NULL,
  title TEXT,
  summary_md TEXT,
  stats TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(level, period_key)
);

`;

async function initStore(opts = {}) {
  _objReady = false; _dedup = null;
  dbPath = opts.dbPath || path.join(app.getPath('userData'), 'mindtrace.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = await dbAdapter.open(dbPath, opts);
  db.exec(SCHEMA);
  initFts();
  dirty = true;
  persist(true);
  return db;
}

/** FTS5 → FTS4 → none（bigram LIKE），并在 fts 为空时重建索引 */
function initFts() {
  const cols = 'id UNINDEXED, title, content, url, path, app, type UNINDEXED';
  const tries = [
    ['fts5', `CREATE VIRTUAL TABLE IF NOT EXISTS fts_events USING fts5(${cols}, tokenize='unicode61')`],
    ['fts4', `CREATE VIRTUAL TABLE IF NOT EXISTS fts_events USING fts4(id, title, content, url, path, app, type, notindexed=id, notindexed=type, tokenize=unicode61)`]
  ];
  const existing = get(`SELECT sql FROM sqlite_master WHERE name='fts_events'`);
  if (existing) {
    ftsMode = /fts5/i.test(existing.sql) ? 'fts5' : /fts4/i.test(existing.sql) ? 'fts4' : 'none';
    try { get(`SELECT count(*) c FROM fts_events`); } catch (e) { try { db.exec('DROP TABLE fts_events'); } catch (_) {} ftsMode = 'none'; }
  }
  if (ftsMode === 'none') {
    for (const [mode, sql] of tries) {
      try { db.exec(sql); ftsMode = mode; break; } catch (e) { ftsErrors.last = `${mode}: ${e.message}`; }
    }
  }
  if (ftsMode !== 'none') {
    const n = get(`SELECT count(*) c FROM fts_events`)?.c || 0;
    const m = get(`SELECT count(*) c FROM activities`)?.c || 0;
    if (n === 0 && m > 0) reindexFts();
  }
  console.log(`[store] engine=${db.engine} fts=${ftsMode}`);
}
function reindexFts() {
  if (ftsMode === 'none') return 0;
  run(`DELETE FROM fts_events`);
  const rows = all(`SELECT id, window_title, content, url, file_path, app_name, type FROM activities`);
  transaction(() => rows.forEach(r => indexActivityFts(r)));
  return rows.length;
}
/** 删除活动前调用：按 rowid 清 FTS（避免按 id 全表扫描） */
function deleteActivitiesFts(whereSql, params) {
  if (ftsMode === 'none') return;
  try { run(`DELETE FROM fts_events WHERE rowid IN (SELECT rowid FROM activities WHERE ${whereSql})`, params); } catch (e) { ftsErrors.count++; ftsErrors.last = e.message; }
}
function ftsStatus() { return { engine: db?.engine, mode: ftsMode, errors: ftsErrors.count, lastError: ftsErrors.last }; }
function transaction(fn) { const r = db.transaction(fn); schedulePersist(); return r; }

let dirty = false;
let lastPersistAt = 0;
let forceTimer = null;
const PERSIST_DEBOUNCE_MS = 4000;
const PERSIST_MAX_WAIT_MS = 20000;

function persist(force = false) {
  if (!db || !dbPath) return;
  if (!dirty && !force) return;
  try {
    db.persist();
    dirty = false;
    lastPersistAt = Date.now();
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (forceTimer) { clearTimeout(forceTimer); forceTimer = null; }
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

/**
 * sql.js keeps the whole DB in memory; prune keeps growth bounded.
 * Architectural limit: very large histories still require loading full file on startup.
 */
function pruneOldData(opts = {}) {
  if (!db) return { ok: false };
  const activityDays = Math.max(7, opts.activityRetainDays || 90);
  const screenshotDays = Math.max(1, opts.screenshotRetainDays || 14);
  const chatMax = Math.max(50, opts.chatMax || 500);
  const now = Date.now();
  const cutoffAct = now - activityDays * 86400000;
  const cutoffSs = now - screenshotDays * 86400000;
  let deleted = { activities: 0, screenshots: 0, chat: 0 };
  try {
    const beforeA = get(`SELECT COUNT(*) as c FROM activities WHERE started_at<?`, [cutoffAct]);
    deleteActivitiesFts('started_at<?', [cutoffAct]);
    run(`DELETE FROM activities WHERE started_at<?`, [cutoffAct]);
    deleted.activities = beforeA?.c || 0;
    const beforeS = get(`SELECT COUNT(*) as c FROM screenshots WHERE taken_at<?`, [cutoffSs]);
    run(`DELETE FROM screenshots WHERE taken_at<?`, [cutoffSs]);
    deleted.screenshots = beforeS?.c || 0;
    const chatCnt = get(`SELECT COUNT(*) as c FROM chat_messages`);
    if (chatCnt && chatCnt.c > chatMax) {
      const keep = all(`SELECT id FROM chat_messages ORDER BY created_at DESC LIMIT ?`, [chatMax]).map(r => r.id);
      if (keep.length) {
        const placeholders = keep.map(() => '?').join(',');
        const beforeC = chatCnt.c;
        // delete outside keep set
        db.run(`DELETE FROM chat_messages WHERE id NOT IN (${placeholders})`, keep);
        schedulePersist();
        deleted.chat = Math.max(0, beforeC - keep.length);
      }
    }
    if (deleted.activities || deleted.screenshots || deleted.chat) persist(true);
  } catch (e) {
    console.error('pruneOldData', e.message);
    return { ok: false, error: e.message, deleted };
  }
  return { ok: true, deleted, activityDays, screenshotDays, chatMax };
}

function run(sql, params = []) {
  const r = db.run(sql, params);
  schedulePersist();
  return r;
}

function all(sql, params = []) {
  return db.all(sql, params);
}

function get(sql, params = []) {
  const rows = all(sql, params);
  return rows[0] || null;
}

let insertPolicy = null;
let activityHook = null;
function setActivityHook(fn) { activityHook = typeof fn === 'function' ? fn : null; }
let memoryThreshold = 0.75;
function setInsertPolicy(fn) { insertPolicy = typeof fn === 'function' ? fn : null; }
function setMemoryThreshold(v) { if (typeof v === 'number') memoryThreshold = v; }

let _dedup = null, _objReady = false;
function objDeduper() { if (!_dedup) { const { ObjectDeduper } = require('../core/signal'); _dedup = new ObjectDeduper(); } return _dedup; }
function ensureObjects() { if (_objReady) return; for (const q of require('../core/signal').OBJECTS_SQL.split(';').map(x => x.trim()).filter(Boolean)) run(q); _objReady = true; }
function signalStats() { return objDeduper().stats; }
function dedupContent(row) { try { const sig = require('../core/signal'); return objDeduper().check(row, sig.envelope(row)); } catch (_) { return { drop: false }; } }
function insertActivity(row) {
  try {
    const noise = require('../core/noise');
    const m = row.meta && typeof row.meta === 'object' ? row.meta : {};
    if (!m.isDemo && !m.demo) {
      if (noise.classify(row).drop) return null;
      if (noise.seenRecently(row, row.started_at || Date.now())) return null;
    }
  } catch (_) {}
  if (insertPolicy) {
    try { row = insertPolicy(row); } catch (_) {}
    if (!row) return null;
  }
  const id = row.id || crypto.randomUUID();
  // 2.4：统一事件信封 + 对象级去重（六层信号）
  let env = null;
  try {
    const sig = require('../core/signal');
    const m0 = row.meta && typeof row.meta === 'object' ? row.meta : null;
    if (!(m0 && (m0.isDemo || m0.demo))) {
      env = sig.envelope(row);
      const d = objDeduper().check({ ...row, id }, env);
      if (d.drop) return null;
      let ctxTags = [];
      try { ctxTags = require('../collectors/context').tags() || []; } catch (_) {}
      if (m0 || row.meta == null) row = { ...row, meta: { ...(m0 || {}), layer: env.layer, obj: env.object?.hash || null, conf: env.confidence, ctx: ctxTags.length ? ctxTags : undefined } };
    }
  } catch (_) { env = null; }
  const now = Date.now();
  const content = row.content != null ? redactText(String(row.content)) : null;
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
      content,
      row.meta ? JSON.stringify(row.meta) : null,
      now
    ]
  );
  indexActivityFts({ ...row, id, content });
  if (env && env.object) { try { ensureObjects(); require('../core/signal').upsertObject({ get, run }, env, id); } catch (_) {} }
  if (activityHook) { try { activityHook({ ...row, id, content }); } catch (_) {} }
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
  const desc = description != null ? redactText(String(description)) : null;
  const ocr = ocrText != null ? redactText(String(ocrText)) : null;
  run(`UPDATE screenshots SET description=?, ocr_text=COALESCE(?, ocr_text) WHERE id=?`, [
    desc,
    ocr,
    id
  ]);
  // also mirror into related activity content for retrieval
  run(`UPDATE activities SET content=? WHERE type='screenshot' AND meta LIKE ?`, [
    desc,
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
  params.push(Math.max(limit * 3, limit)); // over-fetch then filter self
  const rows = all(sql, params).filter(a => !isSelfApp({ app: a.app_name, process: a.process_name, title: a.window_title }));
  return rows.slice(0, limit).map(a => ({
    ...a,
    app_name: friendlyAppName(a.app_name, a.process_name, a.window_title)
  }));
}

function getTodayStats() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const from = start.getTime();
  const yStart = new Date(start); yStart.setDate(yStart.getDate() - 1);
  const yFrom = yStart.getTime();
  const yTo = from;

  const raw = all(
    `SELECT type, app_name, process_name, window_title, duration_ms, started_at, ended_at, content FROM activities WHERE started_at>=?`,
    [from]
  );
  const byApp = new Map();
  let focusMs = 0;
  const hourly = new Array(24).fill(0);
  let activityCount = 0;
  let browserCount = 0;
  const noise = require('../core/noise');
  for (const row of raw) {
    if (isSelfApp({ app: row.app_name, process: row.process_name, title: row.window_title })) continue;
    { const c = noise.classify(row); if (c.drop || c.low) continue; }
    activityCount += 1;
    if (row.type === 'browser') browserCount += 1;
    const name = friendlyAppName(row.app_name, row.process_name, row.window_title);
    const dur = row.duration_ms || 0;
    // Rank apps by duration across window/browser/document/ide etc.
    if (dur > 0 || ['window', 'browser', 'document', 'ide'].includes(row.type)) {
      const cur = byApp.get(name) || { app_name: name, total_ms: 0, cnt: 0 };
      cur.total_ms += dur || (row.type === 'browser' ? 3 * 60000 : 0);
      cur.cnt += 1;
      byApp.set(name, cur);
      if (row.type === 'window' || row.type === 'ide') focusMs += dur;
      else if (dur) focusMs += dur;
    }
    try {
      const h = new Date(row.started_at).getHours();
      if (h >= 0 && h < 24) hourly[h] += 1;
    } catch (_) {}
  }
  // If focus still 0 but we have app totals, use sum of ranked apps
  if (!focusMs) {
    focusMs = [...byApp.values()].reduce((s, a) => s + (a.total_ms || 0), 0);
  }
  const acts = [...byApp.values()].sort((a, b) => b.total_ms - a.total_ms);
  const cards = get(`SELECT COUNT(*) as c FROM knowledge_cards WHERE created_at>=?`, [from]);
  const shots = get(`SELECT COUNT(*) as c FROM screenshots WHERE taken_at>=?`, [from]);
  const cardsToday = cards?.c || 0;

  // Yesterday comparisons
  const yRaw = all(
    `SELECT type, app_name, process_name, window_title, duration_ms FROM activities WHERE started_at>=? AND started_at<?`,
    [yFrom, yTo]
  );
  let yFocus = 0, yActs = 0, yBrowse = 0;
  for (const row of yRaw) {
    if (isSelfApp({ app: row.app_name, process: row.process_name, title: row.window_title })) continue;
    yActs += 1;
    if (row.type === 'browser') yBrowse += 1;
    yFocus += row.duration_ms || 0;
  }
  const yCards = get(`SELECT COUNT(*) as c FROM knowledge_cards WHERE created_at>=? AND created_at<?`, [yFrom, yTo]);
  const yCardsN = yCards?.c || 0;

  // Week trend: activity counts for last 7 calendar days (oldest → today)
  const weekTrend = [];
  for (let d = 6; d >= 0; d--) {
    const day = new Date(start);
    day.setDate(day.getDate() - d);
    const a = day.getTime();
    const bDate = new Date(day); bDate.setDate(bDate.getDate() + 1);
    const b = bDate.getTime();
    const rows = all(`SELECT app_name, process_name, window_title FROM activities WHERE started_at>=? AND started_at<?`, [a, b]);
    weekTrend.push(rows.filter(r => !isSelfApp({ app: r.app_name, process: r.process_name, title: r.window_title })).length);
  }

  function pctDelta(today, yesterday) {
    if (!yesterday && !today) return { pct: 0, label: '较昨日 —', dir: 'flat' };
    if (!yesterday) return { pct: 100, label: '较昨日 +100%', dir: 'up' };
    const pct = Math.round(((today - yesterday) / yesterday) * 100);
    if (pct > 0) return { pct, label: `较昨日 +${pct}%`, dir: 'up' };
    if (pct < 0) return { pct, label: `较昨日 ${pct}%`, dir: 'down' };
    return { pct: 0, label: '较昨日 持平', dir: 'flat' };
  }

  return {
    appBreakdown: acts,
    activityCount,
    totalMs: focusMs,
    cardsToday,
    screenshotsToday: shots?.c || 0,
    browserCount,
    hourly,
    weekTrend,
    deltas: {
      time: pctDelta(focusMs, yFocus),
      acts: pctDelta(activityCount, yActs),
      browse: pctDelta(browserCount, yBrowse),
      cards: pctDelta(cardsToday, yCardsN)
    },
    yesterday: { totalMs: yFocus, activityCount: yActs, browserCount: yBrowse, cards: yCardsN }
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
      if (m && m.isDemo) { deleteActivitiesFts('id=?', [a.id]); run(`DELETE FROM activities WHERE id=?`, [a.id]); }
    } catch (_) {}
  }
  run(`DELETE FROM knowledge_cards WHERE tags LIKE '%"示例"%' OR title LIKE '【示例】%'`);
  run(`DELETE FROM journals WHERE title LIKE '示例%' OR title LIKE '【示例】%'`);
  run(`DELETE FROM topics WHERE name LIKE '【示例】%' OR summary LIKE '%示例主题%'`);
  // Demo chat thread is always sample content — clear when leaving demo mode
  try { run(`DELETE FROM chat_messages`); } catch (_) {}
  for (const sql of [`DELETE FROM audit_log WHERE id LIKE 'demo-%'`, `DELETE FROM llm_usage WHERE id LIKE 'demo-%'`, `DELETE FROM jobs WHERE id LIKE 'demo-%'`, `DELETE FROM memories WHERE text LIKE '【示例】%'`, `DELETE FROM wiki_pages WHERE slug LIKE 'demo-%'`, `DELETE FROM rollups WHERE title LIKE '【示例】%'`]) { try { run(sql); } catch (_) {} }
}


function upsertWikiPage(page) {
  const now = Date.now();
  const slug = page.slug || String(page.title || '').slice(0, 80);
  const existing = get(`SELECT id FROM wiki_pages WHERE kind=? AND slug=?`, [page.kind, slug]);
  if (existing) {
    run(`UPDATE wiki_pages SET title=?, body_md=?, backlinks=?, updated_at=? WHERE id=?`, [
      page.title, page.body_md || '', page.backlinks ? JSON.stringify(page.backlinks) : null, now, existing.id
    ]);
    return existing.id;
  }
  const id = page.id || crypto.randomUUID();
  run(`INSERT INTO wiki_pages (id,kind,slug,title,body_md,backlinks,updated_at,created_at) VALUES (?,?,?,?,?,?,?,?)`, [
    id, page.kind, slug, page.title, page.body_md || '', page.backlinks ? JSON.stringify(page.backlinks) : null, now, now
  ]);
  return id;
}

function upsertMemory(mem) {
  const now = Date.now();
  // v2.3：待办归日历所有（D2）；旧 kind 映射
  if (mem.kind === 'todo') {
    try {
      const key = crypto.createHash('sha1').update('todo|' + String(mem.text || '').trim()).digest('hex').slice(0, 16);
      if (!get(`SELECT 1 FROM calendar_events WHERE dedupe_key=?`, [key]) && !get(`SELECT 1 FROM tombstones WHERE key=?`, ['cal:' + key])) {
        run(`INSERT INTO calendar_events (id,layer,kind,title,status,confidence,created_by,dedupe_key,time_certainty,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [crypto.randomUUID(), 'plan', 'todo', String(mem.text).slice(0, 80), 'proposed', mem.confidence ?? 0.6, 'ai', key, 'none', '来自日卷/摘要', now, now]);
      }
      return null;
    } catch (_) { /* 旧库无 calendar_events 时回落为记忆 */ }
  }
  if (mem.kind === 'fact') mem = { ...mem, kind: 'fact_self' };
  const key = mem.dedupe_key || crypto.createHash('sha1').update(String(mem.text || '').trim().toLowerCase()).digest('hex').slice(0, 16);
  const existing = get(`SELECT id, confidence FROM memories WHERE dedupe_key=? AND status IN ('active','pending')`, [key]);
  if (existing) {
    run(`UPDATE memories SET text=?, confidence=?, evidence=?, updated_at=? WHERE id=?`, [
      mem.text, Math.max(existing.confidence || 0, mem.confidence || 0.8),
      mem.evidence ? JSON.stringify(mem.evidence) : null, now, existing.id
    ]);
    return existing.id;
  }
  const id = mem.id || crypto.randomUUID();
  run(`INSERT INTO memories (id,kind,text,confidence,evidence,status,dedupe_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`, [
    id, mem.kind || 'fact', mem.text, mem.confidence ?? 0.8,
    mem.evidence ? JSON.stringify(mem.evidence) : null, mem.status || ((mem.confidence ?? 0.8) < memoryThreshold ? 'pending' : 'active'), key, now, now
  ]);
  return id;
}

function upsertRollup(r) {
  const now = Date.now();
  const existing = get(`SELECT id FROM rollups WHERE level=? AND period_key=?`, [r.level, r.period_key]);
  if (existing) {
    run(`UPDATE rollups SET title=?, summary_md=?, stats=?, updated_at=? WHERE id=?`, [
      r.title || null, r.summary_md || '', r.stats ? JSON.stringify(r.stats) : null, now, existing.id
    ]);
    return existing.id;
  }
  const id = crypto.randomUUID();
  run(`INSERT INTO rollups (id,level,period_key,title,summary_md,stats,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, [
    id, r.level, r.period_key, r.title || null, r.summary_md || '', r.stats ? JSON.stringify(r.stats) : null, now, now
  ]);
  return id;
}

function indexActivityFts(row) {
  if (ftsMode === 'none' || !row || !row.id) return;
  try {
    const rid = get(`SELECT rowid AS r FROM activities WHERE id=?`, [row.id])?.r;
    if (rid == null) return;
    run(`DELETE FROM fts_events WHERE rowid=?`, [rid]);
    run(`INSERT INTO fts_events (rowid,id,title,content,url,path,app,type) VALUES (?,?,?,?,?,?,?,?)`, [
      rid, row.id, toIndexText(row.window_title || row.title || ''), toIndexText(String(row.content || '').slice(0, 20000)),
      toIndexText(row.url || ''), toIndexText(row.file_path || row.path || ''), toIndexText(row.app_name || row.app || ''), row.type || ''
    ]);
  } catch (e) {
    ftsErrors.count++; ftsErrors.last = e.message;
    if (ftsErrors.count <= 3) console.error('[store] FTS write failed:', e.message);
  }
}

/** 全文检索：FTS(bigram) 命中 → 回表取原文；无 FTS 时退化为 bigram LIKE */
function searchFts(q, limit = 50) {
  if (!q || !String(q).trim()) return [];
  const cols = `a.id, a.window_title AS title, a.content, a.url, a.file_path AS path, a.app_name AS app, a.type, a.started_at`;
  if (ftsMode !== 'none') {
    const mq = toMatchQuery(q);
    if (mq) {
      try {
        const order = ftsMode === 'fts5' ? 'ORDER BY bm25(fts_events)' : '';
        const rids = all(`SELECT rowid AS r FROM fts_events WHERE fts_events MATCH ? ${order} LIMIT ?`, [mq, limit]).map(r => r.r);
        if (!rids.length) return [];
        const rows = all(`SELECT a.rowid AS _r, ${cols} FROM activities a WHERE a.rowid IN (${rids.map(() => '?').join(',')})`, rids);
        const pos = new Map(rids.map((id, i) => [id, i]));
        return rows.sort((x, y) => pos.get(x._r) - pos.get(y._r));
      } catch (e) { ftsErrors.count++; ftsErrors.last = e.message; }
    }
  }
  const terms = toIndexText(q).split(' ').filter(Boolean).slice(0, 8);
  if (!terms.length) return [];
  const where = terms.map(() => `(a.window_title LIKE ? OR a.content LIKE ? OR a.url LIKE ? OR a.file_path LIKE ? OR a.app_name LIKE ?)`).join(' AND ');
  const params = terms.flatMap(t => Array(5).fill(`%${t}%`));
  return all(`SELECT ${cols} FROM activities a WHERE ${where} ORDER BY a.started_at DESC LIMIT ?`, [...params, limit]);
}

function getRollups(level, fromKey, toKey) {
  let sql = `SELECT * FROM rollups WHERE level=?`;
  const params = [level];
  if (fromKey) { sql += ` AND period_key>=?`; params.push(fromKey); }
  if (toKey) { sql += ` AND period_key<=?`; params.push(toKey); }
  sql += ` ORDER BY period_key DESC LIMIT 200`;
  return all(sql, params);
}

function listWiki(kind) {
  if (kind) return all(`SELECT * FROM wiki_pages WHERE kind=? ORDER BY updated_at DESC LIMIT 200`, [kind]);
  return all(`SELECT * FROM wiki_pages ORDER BY updated_at DESC LIMIT 300`);
}

function listMemories(kind) {
  if (kind) return all(`SELECT * FROM memories WHERE kind=? AND status='active' ORDER BY updated_at DESC LIMIT 200`, [kind]);
  return all(`SELECT * FROM memories WHERE status='active' ORDER BY updated_at DESC LIMIT 300`);
}

function insertActivityBatch(events) {
  return transaction(() => insertActivityBatchInner(events));
}
function insertActivityBatchInner(events) {
  const ids = [];
  for (const ev of events || []) {
    const id = insertActivity({
      type: ev.type,
      started_at: ev.ts_start || ev.started_at || Date.now(),
      ended_at: ev.ts_end || ev.ended_at || null,
      duration_ms: ev.duration_ms || 0,
      app_name: ev.app || ev.app_name || null,
      process_name: ev.process || ev.process_name || null,
      window_title: ev.title || ev.window_title || null,
      url: ev.url || null,
      file_path: ev.path || ev.file_path || null,
      content: ev.content || null,
      meta: ev.meta || { source: ev.source }
    });
    if (!id) continue;
    ids.push(id);
  }
  return ids;
}


function getDbPath() { return dbPath; }
function closeStore() { if (db) { persist(true); db.close(); db = null; ftsMode = 'none'; } }
function getDb() { return db; }

module.exports = {
  initStore, persist, closeStore, getDbPath, pruneOldData, ftsStatus, reindexFts, deleteActivitiesFts, transaction, getDb,
  run, all, get,
  insertActivity, signalStats, dedupContent, ensureObjects, updateActivityEnd, insertScreenshot, updateScreenshotDescription,
  upsertKnowledgeCard, upsertJournal, addChatMessage,
  searchActivities, getTodayStats, getActivityById, getCardById, getJournalById, upsertTopic, clearDemoData,
  setInsertPolicy, setActivityHook, setMemoryThreshold, upsertWikiPage, upsertMemory, upsertRollup, searchFts, getRollups, listWiki, listMemories, insertActivityBatch, indexActivityFts
};
