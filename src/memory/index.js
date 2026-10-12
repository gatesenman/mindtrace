/**
 * MEMORY：以用户为中心的记忆（类型/置信度/衰减/强化/证据/矛盾/审核）+ 情景（episodes）
 */
const store = require('../main/store');
const decay = require('../common/decay');
const evidence = require('../common/evidence');
const bigram = require('../common/bigram');
const U = require('../common/util');
const { SENSITIVE } = require('../pipeline/rules');

const TYPES = ['preference', 'habit', 'skill', 'relationship', 'fact_self', 'decision', 'project', 'episodic'];
const TYPE_LABEL = { preference: '偏好', habit: '习惯', skill: '技能', relationship: '关系', fact_self: '个人事实', decision: '决策', project: '项目', episodic: '情景', note: '笔记' };
const SINGLE = new Set(['主力语言', '职业', '所在城市', '常用编辑器', '在学']);
let threshold = 0.6;
function setThreshold(t) { threshold = t; }

function spoKey(s, p, o) { return U.sha1(`${s}|${p}|${String(o).toLowerCase().replace(/\s+/g, '')}`).slice(0, 16); }
function spKey(s, p) { return 'memsp:' + U.sha1(`${s}|${p}`).slice(0, 16); }
function logEv(memoryId, op, before, after, actor = 'ai') {
  store.run(`INSERT INTO memory_events (id,memory_id,op,before,after,actor,ts) VALUES (?,?,?,?,?,?,?)`, [U.uid(), memoryId, op, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, actor, Date.now()]);
}
function indexMem(id) {
  try {
    if (!store.get(`SELECT 1 FROM sqlite_master WHERE name='memories_fts'`)) return;
    const m = store.get(`SELECT rowid, text, kind, predicate, object FROM memories WHERE id=?`, [id]); if (!m) return;
    store.run(`DELETE FROM memories_fts WHERE rowid=?`, [m.rowid]);
    store.run(`INSERT INTO memories_fts (rowid,text,extra) VALUES (?,?,?)`, [m.rowid, bigram.toIndexText(m.text), bigram.toIndexText(`${TYPE_LABEL[m.kind] || ''} ${m.predicate || ''} ${m.object || ''}`)]);
  } catch (e) { console.error('[memory] fts', e.message); }
}

/**
 * 摄入候选。ctx: { chunkId, eventIds, ts, source:'auto'|'mcp'|'user', validChunks:Set }
 * 返回 { op: 'ADD'|'NOOP'|'SUPERSEDE'|'CONFLICT'|'SKIP', id, reason }
 */
function ingest(cand, ctx = {}) {
  const source = ctx.source || 'auto';
  const ts = ctx.ts || Date.now();
  if (!cand || !cand.text) return { op: 'SKIP', reason: 'empty' };
  if (source === 'auto') {
    if (!ctx.chunkId || (ctx.validChunks && !ctx.validChunks.has(ctx.chunkId))) return { op: 'SKIP', reason: 'no-evidence' };
  }
  if (cand.sensitive || SENSITIVE.test(cand.text) || SENSITIVE.test(cand.quote || '')) { U.audit('memory', 'blocked-sensitive', cand.type, { len: cand.text.length }); return { op: 'SKIP', reason: 'sensitive' }; }
  const type = TYPES.includes(cand.type) ? cand.type : 'fact_self';
  const s = cand.subject || 'user', p = cand.predicate || TYPE_LABEL[type], o = cand.object || cand.text;
  const key = spoKey(s, p, o);
  if (U.tombstoned('mem:' + key) || U.tombstoned(spKey(s, p) + ':' + key)) return { op: 'SKIP', reason: 'tombstone' };
  const addEv = (id) => { for (const ev of (ctx.eventIds || []).slice(0, 3)) evidence.add('memory', id, { chunkId: ctx.chunkId, eventId: ev, ts, quote: cand.quote }); if (!(ctx.eventIds || []).length) evidence.add('memory', id, { chunkId: ctx.chunkId || null, ts, quote: cand.quote || cand.text }); store.run(`UPDATE memories SET evidence_count=(SELECT COUNT(*) FROM evidence WHERE owner_type='memory' AND owner_id=? AND polarity=1) WHERE id=?`, [id, id]); };

  // 1) 完全相同 → NOOP + 强化
  const same = store.get(`SELECT * FROM memories WHERE dedupe_key=? AND status IN ('active','pending')`, [key]);
  if (same) {
    const conf = decay.reinforce(same.confidence || 0.5, cand.confidence || 0.6);
    store.run(`UPDATE memories SET confidence=?, last_seen_at=?, strength=1, updated_at=? WHERE id=?`, [conf, ts, Date.now(), same.id]);
    addEv(same.id); logEv(same.id, 'reinforce', { confidence: same.confidence }, { confidence: conf });
    if (same.status === 'pending' && conf >= 0.85 && !['relationship'].includes(same.kind) && same.source !== 'mcp') store.run(`UPDATE memories SET status='active' WHERE id=?`, [same.id]);
    return { op: 'NOOP', id: same.id };
  }
  // 2) 同主体同谓词（单值）不同对象 → SUPERSEDE / CONFLICT
  let op = 'ADD'; let old = null;
  if (SINGLE.has(p) || type === 'relationship') {
    old = store.get(`SELECT * FROM memories WHERE IFNULL(subject_entity_id,'user')=? AND predicate=? AND status IN ('active','pending') ORDER BY updated_at DESC LIMIT 1`, [s, p]);
    if (old) op = (!old.locked && (cand.confidence || 0) >= 0.8) ? 'SUPERSEDE' : 'CONFLICT';
  }
  const conf = cand.confidence ?? 0.7;
  let status = 'active';
  if (source === 'mcp') status = 'pending';
  else if (source === 'user') status = 'active';
  else if (conf < threshold || type === 'relationship' || (type === 'fact_self' && !old) || op === 'CONFLICT') status = 'pending';
  if (op === 'SUPERSEDE' && old?.status === 'active' && source !== 'mcp') status = 'active';
  const id = U.uid(); const now = Date.now();
  store.run(`INSERT INTO memories (id,kind,text,confidence,evidence,status,dedupe_key,created_at,updated_at,subject_entity_id,predicate,object,importance,strength,last_seen_at,valid_from,source,sensitivity,conflict_with) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, type, cand.text.slice(0, 300), conf, null, status, key, now, now, s === 'user' ? null : s, p, String(o).slice(0, 120), cand.importance ?? (type === 'decision' ? 0.8 : 0.5), 1, ts, ts, source, cand.private ? 'private' : 'normal', op === 'CONFLICT' ? old.id : null]);
  addEv(id); indexMem(id);
  logEv(id, op === 'ADD' ? 'add' : op.toLowerCase(), old ? { id: old.id, text: old.text } : null, { text: cand.text, status }, source);
  if (op === 'SUPERSEDE') {
    store.run(`UPDATE memories SET status='superseded', superseded_by=?, valid_to=?, updated_at=? WHERE id=?`, [id, ts, now, old.id]);
    logEv(old.id, 'superseded', null, { by: id });
  }
  return { op, id, status };
}

function get(id) { const m = store.get(`SELECT * FROM memories WHERE id=?`, [id]); if (m) m.evidence_list = evidence.list('memory', id); return m; }
function list({ status = 'active', kind, q, limit = 300 } = {}) {
  const w = []; const p = [];
  if (status && status !== 'all') { w.push(`status=?`); p.push(status); }
  if (kind) { w.push(`kind=?`); p.push(kind); }
  if (q) { w.push(`text LIKE ?`); p.push('%' + q + '%'); }
  const now = Date.now();
  return store.all(`SELECT * FROM memories ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY pinned DESC, updated_at DESC LIMIT ?`, [...p, limit])
    .map(m => ({ ...m, strength_now: m.pinned ? 1 : decay.strength(m.last_seen_at || m.updated_at, m.kind, now) }));
}
/** 用户编辑 → 锁定（人工编辑优先） */
function edit(id, patch = {}) {
  const m = store.get(`SELECT * FROM memories WHERE id=?`, [id]); if (!m) return false;
  const text = patch.text ?? m.text;
  store.run(`UPDATE memories SET text=?, kind=?, object=?, locked=1, source='user', status=CASE WHEN status='pending' THEN 'active' ELSE status END, confidence=MAX(confidence,0.95), updated_at=? WHERE id=?`, [text, patch.kind || m.kind, patch.object ?? m.object, Date.now(), id]);
  logEv(id, 'edit', { text: m.text }, { text }, 'user'); indexMem(id);
  return true;
}
function approve(id) { store.run(`UPDATE memories SET status='active', updated_at=? WHERE id=?`, [Date.now(), id]); logEv(id, 'approve', null, null, 'user'); return true; }
function reject(id, { never = false } = {}) {
  const m = store.get(`SELECT * FROM memories WHERE id=?`, [id]); if (!m) return false;
  store.run(`UPDATE memories SET status='rejected', updated_at=? WHERE id=?`, [Date.now(), id]);
  if (never) U.tombstone('mem:' + m.dedupe_key, 'memory', m.text);
  logEv(id, never ? 'reject-never' : 'reject', null, null, 'user');
  return true;
}
function pin(id, on = true) { store.run(`UPDATE memories SET pinned=?, updated_at=? WHERE id=?`, [on ? 1 : 0, Date.now(), id]); return true; }
function remove(id) { store.run(`DELETE FROM memories WHERE id=?`, [id]); evidence.removeOwner('memory', id); logEv(id, 'delete', null, null, 'user'); return true; }

/** 衰减：强度×置信 < 0.15 → 归档；置顶/决策不受影响 */
function runDecay(now = Date.now()) {
  let archived = 0;
  for (const m of store.all(`SELECT * FROM memories WHERE status='active' AND IFNULL(pinned,0)=0 AND IFNULL(locked,0)=0`)) {
    const st = decay.strength(m.last_seen_at || m.updated_at, m.kind, now);
    store.run(`UPDATE memories SET strength=? WHERE id=?`, [st, m.id]);
    if (st * (m.confidence || 0.5) < 0.15) { store.run(`UPDATE memories SET status='archived', updated_at=? WHERE id=?`, [now, m.id]); logEv(m.id, 'archive', null, { strength: st }); archived++; }
  }
  return archived;
}

/* ───────── 检索 ───────── */
function searchIds(q, limit = 30) {
  q = String(q || '').trim(); if (!q) return [];
  try {
    if (store.get(`SELECT 1 FROM sqlite_master WHERE name='memories_fts'`)) {
      const r = store.all(`SELECT m.id FROM memories_fts f JOIN memories m ON m.rowid=f.rowid WHERE memories_fts MATCH ? LIMIT ?`, [bigram.toMatchQuery(q), limit]);
      if (r.length) return r.map(x => x.id);
    }
  } catch (_) {}
  return store.all(`SELECT id FROM memories WHERE text LIKE ? OR predicate LIKE ? OR object LIKE ? LIMIT ?`, ['%' + q + '%', '%' + q + '%', '%' + q + '%', limit]).map(x => x.id);
}
function score(m, now) { return (m.importance || 0.5) * (m.confidence || 0.5) * (m.pinned ? 1 : decay.strength(m.last_seen_at || m.updated_at, m.kind, now)) + (m.pinned ? 1 : 0); }
const fmtMem = (m) => `[${TYPE_LABEL[m.kind] || m.kind}] ${m.text}`;

function getProfile({ budget = 1200, scope = 'mcp' } = {}) {
  const now = Date.now();
  const rows = store.all(`SELECT * FROM memories WHERE status='active' AND kind IN ('preference','habit','skill','fact_self','relationship','decision') ${scope === 'mcp' ? "AND IFNULL(sensitivity,'normal')<>'private'" : ''} ORDER BY pinned DESC, importance DESC, confidence DESC LIMIT 300`)
    .sort((a, b) => score(b, now) - score(a, now));
  const out = {}; let used = 0;
  for (const m of rows) { const t = U.estTokens(fmtMem(m)); if (used + t > budget) break; used += t; (out[TYPE_LABEL[m.kind]] ||= []).push(m.text); }
  let commitments = [];
  try { commitments = require('../calendar').openCommitments({ limit: 8 }).map(e => `${e.title}${e.start_at ? '（' + U.fmtTs(e.start_at) + '）' : ''}`); } catch (_) {}
  return { profile: out, commitments, tokens: used };
}

/** recall：按 token 预算组装（档案 ≤40%），返回记忆 + 情景 + 承诺 */
function recall(query, { budget = 2000, scope = 'mcp', includeHistory = false } = {}) {
  const now = Date.now();
  const profBudget = Math.floor(budget * 0.4);
  const profile = getProfile({ budget: profBudget, scope });
  let used = profile.tokens;
  const ids = searchIds(query, 60);
  const statusSet = includeHistory ? ['active', 'superseded', 'archived'] : ['active'];
  const rows = ids.length ? store.all(`SELECT * FROM memories WHERE id IN (${ids.map(() => '?').join(',')})`, ids) : [];
  const mems = rows.filter(m => statusSet.includes(m.status) && (scope !== 'mcp' || m.sensitivity !== 'private')).sort((a, b) => score(b, now) - score(a, now));
  const memories = [];
  for (const m of mems) { const t = U.estTokens(fmtMem(m)) + 4; if (used + t > budget) break; used += t; memories.push({ id: m.id, type: m.kind, text: m.text, status: m.status, confidence: +(m.confidence || 0).toFixed(2), valid_from: m.valid_from, valid_to: m.valid_to }); }
  if (memories.length) store.run(`UPDATE memories SET last_used_at=? WHERE id IN (${memories.map(() => '?').join(',')})`, [now, ...memories.map(m => m.id)]);
  const episodes = [];
  for (const e of store.all(`SELECT * FROM episodes WHERE title LIKE ? OR summary LIKE ? ORDER BY start_at DESC LIMIT 10`, ['%' + query + '%', '%' + query + '%'])) {
    const t = U.estTokens(e.title + e.summary); if (used + t > budget) break; used += t; episodes.push({ title: e.title, summary: e.summary, start: U.fmtTs(e.start_at), end: U.fmtTs(e.end_at) });
  }
  return { query, profile: profile.profile, commitments: profile.commitments, memories, episodes, tokens: used, budget };
}

/** MCP remember → 待审核 */
function remember(text, { type, scope } = {}) {
  const { extractMemories } = require('../pipeline/rules');
  const c = extractMemories(String(text))[0] || { type: type || 'fact_self', subject: 'user', predicate: '备注', object: text, text, confidence: 0.7 };
  if (type) c.type = type;
  c.private = scope === 'private';
  return ingest({ ...c, text: String(text).slice(0, 300) }, { source: 'mcp' });
}

function exportJson() {
  return { version: '2.3', exported_at: Date.now(), memories: store.all(`SELECT * FROM memories WHERE status NOT IN ('rejected')`), evidence: store.all(`SELECT * FROM evidence WHERE owner_type='memory'`), tombstones: store.all(`SELECT * FROM tombstones WHERE owner_type='memory'`) };
}
function importJson(data) {
  let n = 0;
  store.transaction(() => {
    for (const m of data.memories || []) {
      if (store.get(`SELECT 1 FROM memories WHERE id=?`, [m.id])) continue;
      const cols = Object.keys(m).filter(k => /^[a-z_]+$/.test(k));
      try { store.run(`INSERT INTO memories (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map(k => m[k])); indexMem(m.id); n++; } catch (_) {}
    }
    for (const e of data.evidence || []) store.run(`INSERT OR IGNORE INTO evidence (id,owner_type,owner_id,chunk_id,event_id,ts,quote,polarity) VALUES (?,?,?,?,?,?,?,?)`, [e.id, e.owner_type, e.owner_id, e.chunk_id, e.event_id, e.ts, e.quote, e.polarity]);
    for (const t of data.tombstones || []) U.tombstone(t.key, t.owner_type, t.pattern);
  });
  return n;
}
function history(id) { return store.all(`SELECT * FROM memory_events WHERE memory_id=? ORDER BY ts`, [id]); }
function stats() { return store.all(`SELECT status, COUNT(*) c FROM memories GROUP BY status`).reduce((o, r) => (o[r.status] = r.c, o), {}); }

module.exports = { TYPES, TYPE_LABEL, ingest, get, list, edit, approve, reject, pin, remove, runDecay, recall, getProfile, remember, exportJson, importJson, history, stats, setThreshold, indexMem, searchIds };
