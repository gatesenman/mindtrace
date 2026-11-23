/**
 * 2.5 R4 · 统一检索：全文（文档正文 / 网页 / URL / 路径）+ 本地语义混合，带摘录与跳转。
 */
const semantic = require('../recall/semantic');

const EXCERPT_MAX = 140;
const KIND_CN = { file: '文档', page: '网页', chat: '会话', code: '代码', activity: '活动' };

function excerpt(text, query, { max = EXCERPT_MAX, around = 36 } = {}) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const terms = String(query || '').trim().split(/\s+/).filter(Boolean);
  const low = s.toLowerCase();
  let i = -1;
  for (const t of terms) {
    if (t.length < 1) continue;
    const p = low.indexOf(t.toLowerCase());
    if (p >= 0) { i = p; break; }
  }
  if (i < 0 && terms.length) {
    const t = terms.join('');
    if (t.length >= 2) i = low.indexOf(t.toLowerCase());
  }
  const a = Math.max(0, i < 0 ? 0 : i - around);
  return (a > 0 ? '…' : '') + s.slice(a, a + max) + (s.length > a + max ? '…' : '');
}

function parseMeta(m) {
  if (!m) return {};
  if (typeof m === 'object') return m;
  try { return JSON.parse(m); } catch (_) { return {}; }
}

function kindOf(row) {
  const path = row.path || row.file_path;
  const meta = parseMeta(row.meta);
  const doc = meta.doc || {};
  if (row.type === 'ide' || doc.kind === 'code') return 'code';
  if (doc.kind === 'chat' || (row.type === 'uia' && /微信|wechat|飞书|钉钉/i.test(row.app || row.app_name || ''))) return 'chat';
  if (row.url || row.type === 'browser' || doc.kind === 'browser') return 'page';
  if (path && row.type !== 'screenshot') return 'file';
  if (doc.kind && doc.kind !== 'explorer') return 'file';
  return 'activity';
}

function decorate(row, q) {
  const title = row.title || row.window_title || '';
  const path = row.path || row.file_path || '';
  const content = row.content || '';
  const hay = content || [title, path, row.url || ''].filter(Boolean).join(' ');
  const ex = excerpt(content, q) || excerpt(hay, q);
  const kind = kindOf(row);
  return {
    ...row,
    title, path,
    excerpt: ex,
    kind,
    kindLabel: KIND_CN[kind] || kind,
    jump: { activityId: row.id, started_at: row.started_at || null }
  };
}

function inRange(row, from, to) {
  const ts = Number(row.started_at || 0);
  if (from && ts && ts < from) return false;
  if (to && ts && ts > to) return false;
  return true;
}

function search(q, opts = {}) {
  q = String(q || '').trim();
  const { limit = 20, type, from, to, kind } = opts;
  const store = opts.store || require('../main/store');
  if (!q) return { q, activities: [], chunks: [], entities: [], memories: [], calendar: [], ms: 0 };
  const t0 = Date.now();
  const fetchN = Math.max(limit * 4, 40);
  let raw = [];
  try { raw = store.searchFts ? store.searchFts(q, fetchN) : []; } catch (_) { raw = []; }

  if (opts.pool && opts.pool.length) {
    try {
      const fused = semantic.hybrid(raw, opts.pool, q, { limit: fetchN });
      const seen = new Set();
      raw = fused.map(f => f.row).filter(r => r && r.id && (seen.has(r.id) ? false : seen.add(r.id)));
    } catch (_) {}
  } else if (raw.length) {
    try {
      const fused = semantic.hybrid(raw, raw, q, { limit: fetchN });
      const byId = new Map(raw.map(r => [r.id, r]));
      raw = fused.map(f => byId.get(f.id) || f.row).filter(Boolean);
    } catch (_) {}
  }

  let activities = raw.map(r => decorate(r, q)).filter(r => {
    if (type && r.type !== type) return false;
    if (kind && r.kind !== kind) return false;
    if (!inRange(r, from, to)) return false;
    return true;
  }).slice(0, limit);

  let chunks = [], entities = [], memories = [], calendar = [];
  if (!opts.store) {
    try {
      const kb = require('../kb');
      chunks = (kb.searchChunks(q, limit) || []).map(c => ({ ...c, text: String(c.text || '').slice(0, 200), excerpt: excerpt(c.text, q) }));
    } catch (_) {}
    try {
      entities = store.all(`SELECT DISTINCT e.id, e.name, e.type, e.status, w.id page_id FROM entity_aliases a JOIN entities e ON e.id=a.entity_id LEFT JOIN wiki_pages w ON w.entity_id=e.id WHERE (a.alias LIKE ? OR e.pinyin LIKE ?) AND e.merged_into IS NULL LIMIT ?`, ['%' + q + '%', '%' + q.toLowerCase().replace(/\s/g, '') + '%', limit]) || [];
    } catch (_) {}
    try {
      const memory = require('../memory');
      const mids = memory.searchIds(q, limit);
      memories = mids.length ? store.all(`SELECT id,kind,text,status,confidence FROM memories WHERE id IN (${mids.map(() => '?').join(',')}) AND status IN ('active','pending')`, mids) : [];
    } catch (_) {}
    try {
      calendar = store.all(`SELECT id,kind,title,start_at,status FROM calendar_events WHERE (title LIKE ? OR notes LIKE ?) AND status NOT IN ('dismissed','applied') ORDER BY start_at DESC LIMIT ?`, ['%' + q + '%', '%' + q + '%', limit]) || [];
    } catch (_) {}
  }
  return { q, ms: Date.now() - t0, activities, chunks, entities, memories, calendar, filters: { type: type || '', kind: kind || '', from: from || null, to: to || null } };
}

module.exports = { search, excerpt, kindOf, decorate, KIND_CN, EXCERPT_MAX };
