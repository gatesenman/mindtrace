/**
 * KB：activities → documents → chunks → (统一抽取) → entities / claims → 实体页（模板编译、引用、我的笔记、修订、log）
 */
const store = require('../main/store');
const bigram = require('../common/bigram');
const decay = require('../common/decay');
const evidence = require('../common/evidence');
const U = require('../common/util');

const TEXT_MIN = 20;          // 正文不足视为 title-only
const CHUNK_MAX = 900;

/* ───────── 归一化 ───────── */
function canonicalUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|spm|fbclid|gclid|from|share|ref|_hsenc|mc_)/i.test(k)) x.searchParams.delete(k);
    x.hostname = x.hostname.replace(/^www\./, '');
    let s = x.toString(); if (s.endsWith('/') && x.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch (_) { return u; }
}
function docKeyOf(a) {
  if (a.url) return 'url:' + canonicalUrl(a.url);
  if (a.file_path) return 'file:' + String(a.file_path).toLowerCase();
  const title = String(a.window_title || '').replace(/\s*[-—|]\s*(Google Chrome|Microsoft Edge|Visual Studio Code|微信|WeChat)$/i, '').trim();
  return `${a.type === 'clipboard' ? 'clip' : 'win'}:${(a.app_name || '').toLowerCase()}:${title}`;
}
function kindOf(a) { return a.url ? 'web' : a.file_path ? 'file' : a.type === 'clipboard' ? 'clip' : /会议|meeting|zoom|wemeet|teams|飞书|钉钉/i.test(`${a.app_name} ${a.window_title}`) ? 'meeting' : /微信|wechat|qq|slack|飞书|钉钉|teams/i.test(a.app_name || '') ? 'chat' : a.type === 'screenshot' ? 'screen' : 'window'; }
const lineNorm = (l) => l.replace(/\s+/g, ' ').trim();

function normalizeActivities(rows) {
  const touched = new Set();
  for (const a of rows) {
    if (a.type === 'idle') continue;
    let meta = {}; try { meta = a.meta ? JSON.parse(a.meta) : {}; } catch (_) {}
    if (meta.sensitive || meta.privacy === 'excluded') continue;
    const key = docKeyOf(a);
    const text = String(a.content || '').trim();
    let doc = store.get(`SELECT * FROM documents WHERE doc_key=?`, [key]);
    const now = a.started_at;
    if (!doc) {
      const id = U.uid();
      store.run(`INSERT INTO documents (id,kind,title,uri,app,content_hash,text,first_seen,last_seen,dwell_ms,event_ids,privacy_level,status,doc_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, kindOf(a), a.window_title || a.file_path || a.url || '(无标题)', a.url ? canonicalUrl(a.url) : a.file_path || null, a.app_name, null, '', now, now, a.duration_ms || 0, '[]', 'title', 'new', key]);
      doc = store.get(`SELECT * FROM documents WHERE id=?`, [id]);
    }
    // 追加新行（OCR 多帧/重复剪贴近似去重：行级集合）
    const have = new Set(String(doc.text || '').split('\n').map(lineNorm).filter(Boolean));
    const fresh = text.split(/\n+/).map(lineNorm).filter(l => l && !have.has(l));
    const pend = doc._pending || [];
    const evIds = JSON.parse(doc.event_ids || '[]');
    if (evIds.length < 500) evIds.push(a.id);
    const newText = fresh.length ? (doc.text ? doc.text + '\n' : '') + fresh.join('\n') : doc.text;
    const privacy = newText.replace(/\s/g, '').length >= TEXT_MIN ? 'full' : 'title';
    store.run(`UPDATE documents SET text=?, last_seen=MAX(last_seen,?), first_seen=MIN(first_seen,?), dwell_ms=dwell_ms+?, event_ids=?, privacy_level=?, status=CASE WHEN ?>0 THEN 'dirty' ELSE status END, version=version+(CASE WHEN ?>0 THEN 1 ELSE 0 END), content_hash=? WHERE id=?`,
      [newText, now, now, a.duration_ms || 0, JSON.stringify(evIds), privacy, fresh.length, fresh.length, U.sha1(newText).slice(0, 16), doc.id]);
    if (fresh.length) {
      const pendKey = 'pend:' + doc.id;
      const p = U.kvGet(pendKey, []); p.push({ ev: a.id, ts: now, n: fresh.join('\n').length }); U.kvSet(pendKey, p.slice(-200));
      touched.add(doc.id);
    }
    void pend;
  }
  return [...touched];
}

/* ───────── 分块（增量：仅对新增尾部切块） ───────── */
function chunkDocument(docId) {
  const doc = store.get(`SELECT * FROM documents WHERE id=?`, [docId]);
  if (!doc) return [];
  if (doc.privacy_level !== 'full') return []; // title-only 不入块（KB-16）
  const done = store.get(`SELECT COALESCE(SUM(length(text)+1),0) n FROM chunks WHERE doc_id=?`, [docId]).n;
  let tail = String(doc.text || '').slice(Math.max(0, done - 1)).replace(/^\n/, '');
  if (!tail.trim()) return [];
  const pend = U.kvGet('pend:' + docId, []);
  U.kvSet('pend:' + docId, []);
  const evIds = pend.length ? pend.map(p => p.ev) : JSON.parse(doc.event_ids || '[]').slice(-5);
  const observed = pend.length ? Math.min(...pend.map(p => p.ts)) : doc.last_seen;
  const out = [];
  // 按段落合并到 ~CHUNK_MAX
  const paras = tail.split('\n'); let buf = '';
  const flush = () => {
    if (!buf.trim()) return;
    const sha = U.sha1(buf).slice(0, 20);
    if (!store.get(`SELECT 1 FROM chunks WHERE sha1=? AND doc_id=?`, [sha, docId])) {
      const id = U.uid();
      const ord = store.get(`SELECT COUNT(*) c FROM chunks WHERE doc_id=?`, [docId]).c;
      store.run(`INSERT INTO chunks (id,doc_id,ord,text,sha1,quality,event_ids,observed_at,anchor_source,privacy_level,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [id, docId, ord, buf, sha, Math.min(1, buf.length / 400), JSON.stringify(evIds), observed, 'capture', 'full', Date.now()]);
      indexChunk(id, buf, doc.title);
      out.push(id);
    }
    buf = '';
  };
  for (const p of paras) { if (buf.length + p.length > CHUNK_MAX) flush(); buf += (buf ? '\n' : '') + p; }
  flush();
  store.run(`UPDATE documents SET status='chunked' WHERE id=?`, [docId]);
  return out;
}
function indexChunk(id, text, title) {
  try {
    const r = store.get(`SELECT rowid FROM chunks WHERE id=?`, [id]);
    if (!r || !store.get(`SELECT 1 FROM sqlite_master WHERE name='chunks_fts'`)) return;
    store.run(`DELETE FROM chunks_fts WHERE rowid=?`, [r.rowid]);
    store.run(`INSERT INTO chunks_fts (rowid,text,extra) VALUES (?,?,?)`, [r.rowid, bigram.toIndexText(text), bigram.toIndexText(title || '')]);
  } catch (e) { console.error('[kb] chunk fts', e.message); }
}

/** 从活动游标增量处理：返回新 chunk ids */
function ingestNew({ limit = 20000 } = {}) {
  // 游标 = (created_at, rowid)：删除尾部行导致 rowid 复用时不会漏处理
  let cur = U.kvGet('kb_cursor2', null) || { c: 0, r: 0 };
  const rows = store.all(`SELECT rowid AS rid, * FROM activities WHERE created_at>? OR (created_at=? AND rowid>?) ORDER BY created_at, rowid LIMIT ?`, [cur.c, cur.c, cur.r, limit]);
  if (!rows.length) return { docs: 0, chunks: [] };
  let touched = [];
  const chunks = [];
  store.transaction(() => {
    touched = normalizeActivities(require('../core/noise').filter(rows, { hideLow: true }));
    for (const d of touched) chunks.push(...chunkDocument(d));
    const last = rows[rows.length - 1]; U.kvSet('kb_cursor2', { c: last.created_at, r: last.rid });
  });
  return { docs: touched.length, chunks, events: rows.length };
}

/* ───────── 实体解析 ───────── */
function resolveEntity(name, type = 'topic', { create = true } = {}) {
  name = String(name || '').trim().replace(/的$/, '');
  if (/^[\d.\s]+$/.test(name)) return null;
  const norm = U.normName(name); if (!norm || norm.length < 2 && !/[\u4e00-\u9fa5]/.test(norm)) return null;
  if (U.tombstoned('entity:' + norm)) return null;
  const follow = (id) => { let e = store.get(`SELECT * FROM entities WHERE id=?`, [id]); let n = 0; while (e && e.merged_into && n++ < 5) e = store.get(`SELECT * FROM entities WHERE id=?`, [e.merged_into]); return e; };
  const al = store.get(`SELECT entity_id FROM entity_aliases WHERE alias_norm=?`, [norm]);
  if (al) { const e = follow(al.entity_id); if (e) { addAlias(e.id, name, 'exact'); return e; } }
  const py = U.pinyinKey(name);
  let homophone = null;
  if (type === 'person' && py.length >= 4) {
    const e = store.get(`SELECT * FROM entities WHERE pinyin=? AND type='person' AND merged_into IS NULL`, [py]);
    // 跨文字（中文 ↔ 拼音/英文）同音 → 自动绑定；同为汉字的同音不同字 → 仅合并建议
    const cjk = (s) => /[\u4e00-\u9fa5]/.test(s);
    if (e && (cjk(e.name) !== cjk(name) || U.normName(e.name) === norm)) { addAlias(e.id, name, 'pinyin'); return e; }
    if (e) homophone = e;
  }
  // 编辑距离 ≤1 且长名 → 自动绑定；相似 → 合并建议
  const cands = store.all(`SELECT * FROM entities WHERE type=? AND merged_into IS NULL AND length(norm_name) BETWEEN ? AND ?`, [type, norm.length - 1, norm.length + 1]);
  for (const c of cands) {
    const d = U.editDistance(c.norm_name, norm);
    if (d <= 1 && norm.length >= 5) { addAlias(c.id, name, 'fuzzy'); return c; }
  }
  if (!create) return null;
  const id = U.uid(); const now = Date.now();
  store.run(`INSERT INTO entities (id,type,name,norm_name,pinyin,status,first_seen,last_seen) VALUES (?,?,?,?,?,?,?,?)`, [id, type, name.replace(/[（(][^）)]*[）)]/g, '') || name, norm, py, 'candidate', now, now]);
  addAlias(id, name, 'self');
  if (homophone) store.run(`INSERT INTO merge_suggestions (id,a,b,score,reason,status,created_at) VALUES (?,?,?,?,?,?,?)`, [U.uid(), homophone.id, id, 0.7, `同音（${homophone.name} ≈ ${name}）`, 'open', now]);
  for (const c of cands) {
    if (homophone && c.id === homophone.id) continue;
    const s = bigram.jaccard(bigram.bigramSet(c.norm_name), bigram.bigramSet(norm));
    const d1 = U.editDistance(c.norm_name, norm) <= 1;
    if ((s >= 0.5 || d1) && c.norm_name !== norm) store.run(`INSERT INTO merge_suggestions (id,a,b,score,reason,status,created_at) VALUES (?,?,?,?,?,?,?)`, [U.uid(), c.id, id, Math.max(s, d1 ? 0.6 : 0), `名称相似（${c.name} ≈ ${name}）`, 'open', now]);
  }
  return store.get(`SELECT * FROM entities WHERE id=?`, [id]);
}
function addAlias(entityId, alias, source) {
  const n = U.normName(alias); if (!n) return;
  store.run(`INSERT OR IGNORE INTO entity_aliases (alias_norm,entity_id,alias,source) VALUES (?,?,?,?)`, [n, entityId, alias, source]);
}
function addMention(entity, chunk, ts) {
  const day = U.dayOf(ts);
  if (store.get(`SELECT 1 FROM mentions WHERE entity_id=? AND chunk_id=?`, [entity.id, chunk.id])) return;
  store.run(`INSERT INTO mentions (id,chunk_id,doc_id,entity_id,ts,day) VALUES (?,?,?,?,?,?)`, [U.uid(), chunk.id, chunk.doc_id, entity.id, ts, day]);
  const s = store.get(`SELECT COUNT(*) m, COUNT(DISTINCT doc_id) d, COUNT(DISTINCT day) dd, MIN(ts) f, MAX(ts) l FROM mentions WHERE entity_id=?`, [entity.id]);
  store.run(`UPDATE entities SET mention_count=?, doc_count=?, day_count=?, first_seen=?, last_seen=?, salience=? WHERE id=?`, [s.m, s.d, s.dd, s.f, s.l, Math.log2(1 + s.m) + s.dd, entity.id]);
  maybePromote(entity.id);
  markDirty(entity.id);
}
/** 2 次目击门槛：≥2 份文档 或 ≥2 天 或 用户笔记 或 会议参与者 */
function maybePromote(entityId, reason) {
  const e = store.get(`SELECT * FROM entities WHERE id=?`, [entityId]);
  if (!e || e.status === 'active') return false;
  const why = reason || (e.doc_count >= 2 ? '≥2 份资料' : e.day_count >= 2 ? '≥2 天出现' : null);
  if (!why) return false;
  store.run(`UPDATE entities SET status='active', promoted_reason=? WHERE id=?`, [why, entityId]);
  log(`promote | ${e.name} | ${why}`);
  return true;
}
function markDirty(entityId) { store.run(`UPDATE wiki_pages SET dirty=1 WHERE entity_id=?`, [entityId]); U.kvSet('dirty:' + entityId, 1); }

/* ───────── 事实（claims） ───────── */
function upsertClaim(entity, c, ctx) {
  const now = ctx.ts || Date.now();
  const same = store.get(`SELECT * FROM claims WHERE entity_id=? AND predicate=? AND object=? AND status IN ('active','conflict')`, [entity.id, c.predicate, c.object]);
  if (same) {
    store.run(`UPDATE claims SET confidence=?, last_seen=MAX(last_seen,?) WHERE id=?`, [decay.reinforce(same.confidence, c.confidence || 0.7), now, same.id]);
    for (const ev of ctx.eventIds.slice(0, 3)) evidence.add('claim', same.id, { chunkId: ctx.chunkId, eventId: ev, ts: now, quote: c.quote });
    return same.id;
  }
  const id = U.uid();
  const others = store.all(`SELECT * FROM claims WHERE entity_id=? AND predicate=? AND status='active'`, [entity.id, c.predicate]);
  let status = 'active'; let conflictWith = null;
  if (others.length) { status = 'conflict'; conflictWith = others[0].id; for (const o of others) if (!o.locked) store.run(`UPDATE claims SET status='conflict', conflict_with=? WHERE id=?`, [id, o.id]); }
  store.run(`INSERT INTO claims (id,entity_id,predicate,object,text,confidence,status,first_seen,last_seen,conflict_with) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, entity.id, c.predicate, c.object, `${c.predicate}：${c.object}`, c.confidence || 0.7, status, now, now, conflictWith]);
  for (const ev of ctx.eventIds.slice(0, 3)) evidence.add('claim', id, { chunkId: ctx.chunkId, eventId: ev, ts: now, quote: c.quote });
  if (!ctx.eventIds.length) evidence.add('claim', id, { chunkId: ctx.chunkId, ts: now, quote: c.quote });
  if (status === 'conflict') log(`conflict | ${entity.name} | ${c.predicate}: ${others.map(o => o.object).join(' / ')} vs ${c.object}`);
  markDirty(entity.id);
  return id;
}
function resolveConflict(claimId, keep = true) {
  const c = store.get(`SELECT * FROM claims WHERE id=?`, [claimId]); if (!c) return false;
  const now = Date.now();
  if (keep) {
    store.run(`UPDATE claims SET status='superseded', superseded_by=? WHERE entity_id=? AND predicate=? AND id<>? AND status IN ('active','conflict')`, [claimId, c.entity_id, c.predicate, claimId]);
    store.run(`UPDATE claims SET status='active', conflict_with=NULL, locked=1, confidence=MAX(confidence,0.9), last_seen=? WHERE id=?`, [now, claimId]);
  } else {
    store.run(`UPDATE claims SET status='rejected' WHERE id=?`, [claimId]);
    const left = store.all(`SELECT id FROM claims WHERE entity_id=? AND predicate=? AND status='conflict'`, [c.entity_id, c.predicate]);
    if (left.length === 1) store.run(`UPDATE claims SET status='active', conflict_with=NULL WHERE id=?`, [left[0].id]);
  }
  markDirty(c.entity_id);
  return true;
}

/* ───────── 编译实体页（模板；LLM patch 编译 P1） ───────── */
const TYPE_LABEL = { person: '人物', project: '项目', topic: '主题', tool: '工具', org: '组织', source: '资料', concept: '概念' };
function compilePage(entityId, { author = 'ai', trigger = 'extract', now = Date.now() } = {}) {
  const e = store.get(`SELECT * FROM entities WHERE id=?`, [entityId]);
  if (!e || e.status !== 'active' || e.merged_into) return null;
  const aliases = store.all(`SELECT alias FROM entity_aliases WHERE entity_id=?`, [e.id]).map(a => a.alias).filter(a => a !== e.name);
  const claims = store.all(`SELECT * FROM claims WHERE entity_id=? AND status IN ('active','conflict') ORDER BY predicate, last_seen DESC`, [e.id]);
  const mentions = store.all(`SELECT m.day, m.ts, d.title, d.app, d.id doc_id, m.chunk_id FROM mentions m LEFT JOIN documents d ON d.id=m.doc_id WHERE m.entity_id=? ORDER BY m.ts DESC LIMIT 40`, [e.id]);
  const related = store.all(`SELECT e2.name, l.weight FROM links l JOIN entities e2 ON e2.id=l.dst WHERE l.src=? AND e2.status='active' ORDER BY l.weight DESC LIMIT 12`, [e.id]);
  const existing = store.get(`SELECT * FROM wiki_pages WHERE entity_id=?`, [e.id]) || store.get(`SELECT * FROM wiki_pages WHERE kind=? AND slug=?`, [e.type, e.name]);
  const notes = existing?.user_notes || '';
  const st = decay.staleness(e.last_seen, e.type, now);
  const stale = st >= 1.5;
  const foot = []; const cite = (ownerType, ownerId, fallbackQuote, ts) => {
    const ev = store.get(`SELECT e.*, a.app_name FROM evidence e LEFT JOIN activities a ON a.id=e.event_id WHERE owner_type=? AND owner_id=? ORDER BY ts DESC LIMIT 1`, [ownerType, ownerId]);
    const n = foot.length + 1;
    foot.push(`[^${n}]: ${(ev?.quote || fallbackQuote || '').replace(/\n/g, ' ').slice(0, 120)} — ${ev?.app_name || '采集'} · ${U.fmtTs(ev?.ts || ts || now)}${ev?.event_id ? ` · mt://event/${ev.event_id}` : ''}`);
    return `[^${n}]`;
  };
  const active = claims.filter(c => c.status === 'active');
  const conflicts = claims.filter(c => c.status === 'conflict');
  const days = [...new Set(mentions.map(m => m.day))];
  const summary = `${TYPE_LABEL[e.type] || '条目'} · 出现于 ${e.doc_count} 份资料、${e.day_count} 天 · 最近 ${U.fmtTs(e.last_seen).slice(0, 10)}`;
  const L = [];
  L.push('---', `type: ${e.type}`, `aliases: [${aliases.join(', ')}]`, `first_seen: ${U.fmtTs(e.first_seen)}`, `last_seen: ${U.fmtTs(e.last_seen)}`, `sources: ${e.doc_count}`, `stale: ${stale}`, `mt_id: ${e.id}`, '---', '');
  L.push(`# ${e.name}`, '', `> ${summary}${stale ? '（⚠ 可能过时：超过半衰期 1.5 倍未再出现）' : ''}`, '');
  L.push('## 关键事实', '');
  if (active.length) for (const c of active) L.push(`- **${c.predicate}**：${c.object}${c.locked ? ' 🔒' : ''} ${cite('claim', c.id, c.text, c.last_seen)}`);
  else L.push('- （暂无结构化事实）');
  L.push('');
  if (conflicts.length) {
    L.push('## 冲突与待确认', '');
    const byPred = {}; for (const c of conflicts) (byPred[c.predicate] ||= []).push(c);
    for (const [p, cs] of Object.entries(byPred)) L.push(`- **${p}**：${cs.map(c => `${c.object} ${cite('claim', c.id, c.text, c.last_seen)}`).join(' vs ')}（请在「待处理」中确认）`);
    L.push('');
  }
  L.push('## 时间线', '');
  const seenDoc = new Set();
  for (const m of mentions) { const k = m.day + m.doc_id; if (seenDoc.has(k)) continue; seenDoc.add(k); if (seenDoc.size > 15) break;
    const ch = store.get(`SELECT text FROM chunks WHERE id=?`, [m.chunk_id]);
    const n = foot.length + 1; foot.push(`[^${n}]: ${(ch?.text || '').replace(/\n/g, ' ').slice(0, 100)} — ${m.app || ''} · ${U.fmtTs(m.ts)}`);
    L.push(`- ${m.day} · ${m.title || '(资料)'} [^${n}]`); }
  L.push('');
  if (related.length) { L.push('## 相关', '', related.map(r => `[[${r.name}]]`).join(' · '), ''); }
  L.push('## 我的笔记', '', '<!-- 本节由你维护，AI 永不修改 -->', notes, '');
  if (foot.length) L.push('---', '', ...foot);
  const body = L.join('\n');
  if (existing && existing.body_md === body) { store.run(`UPDATE wiki_pages SET dirty=0, staleness=? WHERE id=?`, [st, existing.id]); return existing.id; }
  const pid = existing?.id || U.uid();
  if (existing) store.run(`UPDATE wiki_pages SET body_md=?, title=?, kind=?, slug=?, entity_id=?, summary=?, staleness=?, confidence=?, dirty=0, updated_at=? WHERE id=?`, [body, e.name, e.type, e.name, e.id, summary, st, 1, now, pid]);
  else store.run(`INSERT INTO wiki_pages (id,kind,slug,title,body_md,backlinks,updated_at,created_at,entity_id,summary,user_notes,staleness,dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`, [pid, e.type, e.name, e.name, body, null, now, now, e.id, summary, '', st]);
  store.run(`INSERT INTO page_revisions (id,page_id,ts,author,before,after,trigger,tokens) VALUES (?,?,?,?,?,?,?,0)`, [U.uid(), pid, now, author, existing?.body_md || null, body, trigger]);
  log(`${existing ? 'update' : 'create'} | ${e.name} | 事实 ${active.length} · 冲突 ${conflicts.length} · 引用 ${foot.length}`, now);
  U.kvSet('dirty:' + e.id, 0);
  return pid;
}
function compileDirty() {
  const ids = store.all(`SELECT k FROM kv WHERE k LIKE 'dirty:%' AND v='1'`).map(r => r.k.slice(6));
  let n = 0; for (const id of ids) if (compilePage(id)) n++; else U.kvSet('dirty:' + id, 0);
  return n;
}
/** 用户编辑「我的笔记」——只写 user_notes，人工编辑优先 */
function setUserNotes(pageId, notes) {
  const p = store.get(`SELECT * FROM wiki_pages WHERE id=?`, [pageId]); if (!p) return false;
  store.run(`UPDATE wiki_pages SET user_notes=? WHERE id=?`, [String(notes || ''), pageId]);
  if (p.entity_id) { maybePromote(p.entity_id, '用户笔记'); compilePage(p.entity_id, { author: 'user', trigger: 'user_notes' }); }
  store.run(`INSERT INTO page_revisions (id,page_id,ts,author,before,after,trigger) VALUES (?,?,?,?,?,?,?)`, [U.uid(), pageId, Date.now(), 'user', p.user_notes || '', String(notes || ''), 'user_notes']);
  return true;
}
function revisions(pageId) { return store.all(`SELECT id,ts,author,trigger,length(after) len FROM page_revisions WHERE page_id=? ORDER BY ts DESC LIMIT 50`, [pageId]); }
function revision(id) { return store.get(`SELECT * FROM page_revisions WHERE id=?`, [id]); }
function refreshStaleness(now = Date.now()) {
  let n = 0;
  for (const p of store.all(`SELECT w.id, e.last_seen, e.type, e.id eid, w.staleness FROM wiki_pages w JOIN entities e ON e.id=w.entity_id`)) {
    const st = decay.staleness(p.last_seen, p.type, now);
    if ((p.staleness || 0) < 1.5 && st >= 1.5) { compilePage(p.eid, { now, trigger: 'stale' }); n++; }
    else store.run(`UPDATE wiki_pages SET staleness=? WHERE id=?`, [st, p.id]);
  }
  return n;
}

/* ───────── 合并 / 撤销 ───────── */
function mergeEntities(keepId, dropId) {
  const k = store.get(`SELECT * FROM entities WHERE id=?`, [keepId]); const d = store.get(`SELECT * FROM entities WHERE id=?`, [dropId]);
  if (!k || !d) return null;
  const snap = { mentions: store.all(`SELECT id FROM mentions WHERE entity_id=?`, [dropId]).map(r => r.id), claims: store.all(`SELECT id FROM claims WHERE entity_id=?`, [dropId]).map(r => r.id), aliases: store.all(`SELECT alias_norm FROM entity_aliases WHERE entity_id=?`, [dropId]).map(r => r.alias_norm), status: d.status };
  store.run(`UPDATE mentions SET entity_id=? WHERE entity_id=?`, [keepId, dropId]);
  store.run(`UPDATE claims SET entity_id=? WHERE entity_id=?`, [keepId, dropId]);
  store.run(`UPDATE OR IGNORE entity_aliases SET entity_id=? WHERE entity_id=?`, [keepId, dropId]);
  store.run(`UPDATE entities SET merged_into=?, status='merged' WHERE id=?`, [keepId, dropId]);
  store.run(`UPDATE merge_suggestions SET status='accepted' WHERE (a=? AND b=?) OR (a=? AND b=?)`, [keepId, dropId, dropId, keepId]);
  const opId = U.uid(); U.kvSet('merge:' + opId, { keepId, dropId, snap });
  const s = store.get(`SELECT COUNT(*) m, COUNT(DISTINCT doc_id) d, COUNT(DISTINCT day) dd FROM mentions WHERE entity_id=?`, [keepId]);
  store.run(`UPDATE entities SET mention_count=?, doc_count=?, day_count=? WHERE id=?`, [s.m, s.d, s.dd, keepId]);
  maybePromote(keepId); compilePage(keepId, { trigger: 'merge' });
  log(`merge | ${d.name} → ${k.name}`);
  return opId;
}
function undoMerge(opId) {
  const op = U.kvGet('merge:' + opId); if (!op) return false;
  const { keepId, dropId, snap } = op;
  const q = (a) => a.map(() => '?').join(',') || "''";
  if (snap.mentions.length) store.run(`UPDATE mentions SET entity_id=? WHERE id IN (${q(snap.mentions)})`, [dropId, ...snap.mentions]);
  if (snap.claims.length) store.run(`UPDATE claims SET entity_id=? WHERE id IN (${q(snap.claims)})`, [dropId, ...snap.claims]);
  if (snap.aliases.length) store.run(`UPDATE entity_aliases SET entity_id=? WHERE alias_norm IN (${q(snap.aliases)}) AND entity_id=?`, [dropId, ...snap.aliases, keepId]);
  store.run(`UPDATE entities SET merged_into=NULL, status=? WHERE id=?`, [snap.status, dropId]);
  for (const id of [keepId, dropId]) { const s = store.get(`SELECT COUNT(*) m, COUNT(DISTINCT doc_id) d, COUNT(DISTINCT day) dd FROM mentions WHERE entity_id=?`, [id]); store.run(`UPDATE entities SET mention_count=?, doc_count=?, day_count=? WHERE id=?`, [s.m, s.d, s.dd, id]); compilePage(id, { trigger: 'undo-merge' }); }
  U.kvSet('merge:' + opId, null);
  log(`undo-merge | ${dropId.slice(0, 8)}`);
  return true;
}

/* ───────── log.md ───────── */
function log(line, ts = Date.now()) { store.run(`INSERT INTO kb_log (id,ts,line) VALUES (?,?,?)`, [U.uid(), ts, line]); }
function logMarkdown(limit = 500) {
  const rows = store.all(`SELECT ts,line FROM kb_log ORDER BY ts DESC LIMIT ?`, [limit]);
  return ['# 知识库变更日志', '', ...rows.map(r => `## [${U.fmtTs(r.ts)}] ${r.line}`)].join('\n');
}

/* ───────── 检索（分块） ───────── */
function searchChunks(q, limit = 20) {
  q = String(q || '').trim(); if (!q) return [];
  let rows = [];
  try {
    if (store.get(`SELECT 1 FROM sqlite_master WHERE name='chunks_fts'`)) {
      const mode = store.ftsStatus().mode;
      const order = mode === 'fts5' ? 'ORDER BY bm25(chunks_fts)' : '';
      rows = store.all(`SELECT c.id, c.doc_id, c.text, c.observed_at, d.title, d.app FROM chunks_fts f JOIN chunks c ON c.rowid=f.rowid LEFT JOIN documents d ON d.id=c.doc_id WHERE chunks_fts MATCH ? ${order} LIMIT ?`, [bigram.toMatchQuery(q), limit]);
    }
  } catch (_) { rows = []; }
  if (!rows.length) rows = store.all(`SELECT c.id, c.doc_id, c.text, c.observed_at, d.title, d.app FROM chunks c LEFT JOIN documents d ON d.id=c.doc_id WHERE c.text LIKE ? ORDER BY c.observed_at DESC LIMIT ?`, ['%' + q + '%', limit]);
  return rows;
}

function entityDetail(idOrName) {
  let e = store.get(`SELECT * FROM entities WHERE id=?`, [idOrName]);
  if (!e) { const al = store.get(`SELECT entity_id FROM entity_aliases WHERE alias_norm=?`, [U.normName(idOrName)]); if (al) e = store.get(`SELECT * FROM entities WHERE id=?`, [al.entity_id]); }
  if (!e) return null;
  const page = store.get(`SELECT * FROM wiki_pages WHERE entity_id=?`, [e.id]);
  return { entity: e, aliases: store.all(`SELECT alias,source FROM entity_aliases WHERE entity_id=?`, [e.id]), claims: store.all(`SELECT * FROM claims WHERE entity_id=? ORDER BY status, last_seen DESC`, [e.id]), page, revisions: page ? revisions(page.id) : [] };
}
function stats() {
  const g = (sql) => store.get(sql)?.c || 0;
  return { documents: g(`SELECT COUNT(*) c FROM documents`), chunks: g(`SELECT COUNT(*) c FROM chunks`), entities: g(`SELECT COUNT(*) c FROM entities WHERE status='active'`), candidates: g(`SELECT COUNT(*) c FROM entities WHERE status='candidate'`), claims: g(`SELECT COUNT(*) c FROM claims WHERE status='active'`), conflicts: g(`SELECT COUNT(*) c FROM claims WHERE status='conflict'`), pages: g(`SELECT COUNT(*) c FROM wiki_pages WHERE entity_id IS NOT NULL`) };
}

module.exports = { canonicalUrl, docKeyOf, normalizeActivities, chunkDocument, ingestNew, resolveEntity, addAlias, addMention, maybePromote, upsertClaim, resolveConflict, compilePage, compileDirty, setUserNotes, revisions, revision, refreshStaleness, mergeEntities, undoMerge, log, logMarkdown, searchChunks, entityDetail, stats, markDirty };
