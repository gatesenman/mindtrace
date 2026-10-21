// 2.4 六层信号模型 + 统一事件信封 + 对象级去重
// 借鉴：ActivityWatch 的 bucket/event 统一模型与 heartbeat 合并（pulsetime）
//       https://docs.activitywatch.net/en/latest/buckets-and-events.html
//       Screenpipe「无障碍文本优先，OCR 兜底」：同一对象多路来源取最可信的一份
const crypto = require('crypto');
const LAYERS = {
  focus: { name: '注意力', desc: '前台窗口、应用切换、空闲 —— 时间轴骨架', collectors: ['window'] },
  content: { name: '内容', desc: '正在看什么：界面文字、文档正文、截图 OCR', collectors: ['uia', 'documents', 'screenshots'] },
  authoring: { name: '产出', desc: '自己写了什么：笔记、IDE / Git、复制内容', collectors: ['notes', 'ide', 'clipboard'] },
  artifact: { name: '资源', desc: '碰过哪些对象：网页、文件、下载', collectors: ['browser', 'files', 'downloads'] },
  communication: { name: '沟通', desc: '聊天/邮件/会议的可见文本，隐私等级最高', collectors: [] },
  context: { name: '上下文', desc: '空闲/电源/网络 —— 只打标签，不上时间轴', collectors: ['context'] }
};
const TYPE_LAYER = { window: 'focus', idle: 'focus', uia: 'content', screenshot: 'content', document: 'content', ocr: 'content', note: 'authoring', ide: 'authoring', git: 'authoring', clipboard: 'authoring', terminal: 'authoring', browser: 'artifact', web: 'artifact', file: 'artifact', download: 'artifact', calendar: 'context', context: 'context', afk: 'context', power: 'context', network: 'context' };
const CONFIDENCE = { window: 1, browser: 0.95, ide: 0.95, note: 1, document: 0.9, uia: 0.9, file: 0.9, download: 0.95, clipboard: 0.8, screenshot: 0.7, ocr: 0.7 };
const CHAT_APPS = /微信|wechat|企业微信|wxwork|飞书|lark|feishu|钉钉|dingtalk|\bqq\b|outlook|teams|slack|telegram|foxmail|邮件|mail/i;
const TRACK_PARAMS = /^(utm_\w+|spm|from|fbclid|gclid|yclid|_hsenc|_hsmi|mc_\w+|ref|ref_src|share_source|vd_source|si)$/i;

function normUrl(u) {
  try {
    const x = new URL(u); if (!/^https?:$/.test(x.protocol)) return null;
    x.hash = ''; x.hostname = x.hostname.toLowerCase().replace(/^www\./, '');
    for (const k of [...x.searchParams.keys()]) if (TRACK_PARAMS.test(k)) x.searchParams.delete(k);
    x.searchParams.sort();
    let s = `${x.hostname}${x.port ? ':' + x.port : ''}${x.pathname.replace(/\/+$/, '') || '/'}`;
    const q = x.searchParams.toString(); if (q) s += '?' + q; return s;
  } catch (_) { return null; }
}
function normPath(p) { let s = String(p || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/'); if (/^[a-z]:\//i.test(s) || /^\/[a-z]\//i.test(s)) s = s.toLowerCase(); return s || null; }
const BROWSER_SUFFIX = /\s+[-–—|]\s+(Microsoft\s*Edge|Google\s*Chrome|Chrome|Firefox|Mozilla Firefox|Brave|Opera|360安全浏览器|360极速浏览器|QQ浏览器|搜狗浏览器|Visual Studio Code|Cursor|WPS.*|Word|Excel|PowerPoint|记事本|Notepad)(\s+.*)?$/i;
function cleanTitle(t) { return String(t || '').replace(/^\(\d+\)\s*/, '').replace(/\s*[(（]\d+[)）]$/, '').replace(BROWSER_SUFFIX, '').replace(/\s+[-–—]\s+和另外\s*\d+\s*个页面.*$/, '').replace(/\s+/g, ' ').trim(); }
const h16 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

function layerOf(row) {
  const type = row.type;
  const hay = `${row.app_name || ''} ${row.process_name || ''}`;
  if (['uia', 'screenshot', 'clipboard', 'ocr'].includes(type) && CHAT_APPS.test(hay)) return 'communication';
  if (type === 'window' && CHAT_APPS.test(hay)) return 'communication';
  return TYPE_LAYER[type] || 'context';
}
function objectOf(row) {
  const u = row.url && normUrl(row.url);
  if (u) return { type: 'web', uri: u, title: cleanTitle(row.window_title) || u };
  const p = row.file_path && row.type !== 'screenshot' && normPath(row.file_path);
  if (p) return { type: 'file', uri: p, title: p.split('/').pop() };
  const app = String(row.app_name || row.process_name || '').trim();
  const title = cleanTitle(row.window_title);
  if (!app && !title) return null;
  const isChat = CHAT_APPS.test(`${app} ${row.process_name || ''}`);
  return { type: isChat ? 'conversation' : 'window', uri: `${app.toLowerCase()}::${title}`, title: title || app };
}
/** 统一事件信封 {layer, subject, action, object{type,uri,hash,title}, span, source, privacy_level, confidence} */
function envelope(row) {
  const layer = layerOf(row);
  const o = objectOf(row);
  const object = o ? { ...o, hash: h16(o.type + '|' + o.uri) } : null;
  const action = { window: 'focus', browser: 'visit', uia: 'read', screenshot: 'see', document: 'read', note: 'write', ide: 'edit', clipboard: 'copy', download: 'download', file: 'open' }[row.type] || row.type;
  return {
    layer, subject: 'me', action, object,
    span: { start: row.started_at || Date.now(), end: row.ended_at || null },
    source: { adapter: row.type, app: row.app_name || null },
    privacy_level: layer === 'communication' ? 'high' : (row.meta?.privacy || 'normal'),
    confidence: CONFIDENCE[row.type] ?? 0.6
  };
}

function shingles(t) { const s = String(t || '').replace(/\s+/g, ''); const set = new Set(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set; }
function sim(a, b) { const A = shingles(a), B = shingles(b); if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i); }

/** 对象级去重器：同一对象在窗口期内的内容层重复（来自任何适配器）只保留第一份，并累加触达次数 */
class ObjectDeduper {
  constructor({ windowMs = 10 * 60000, threshold = 0.85, visitPulseMs = 30 * 60000 } = {}) { Object.assign(this, { windowMs, threshold, visitPulseMs }); this.last = new Map(); this.stats = { seen: 0, dropped: 0, byLayer: {} }; }
  /** 内容层窗口对象 → 若标题与近期访问的网页一致，归并到该网页对象（同一网页无论来自历史、UIA 还是 OCR 都是一个对象） */
  resolve(env) {
    const o = env.object; if (!o) return env;
    this.titles = this.titles || new Map();
    if (o.type === 'web' && o.title) this.titles.set(o.title, { obj: o, t: env.span.start });
    else if (o.type === 'window' && o.title) { const w = this.titles.get(o.title); if (w && Math.abs(env.span.start - w.t) < this.visitPulseMs) env.object = { ...w.obj }; }
    if (this.titles.size > 2000) this.titles.clear();
    return env;
  }
  /** 返回 {drop, reason, dupOf} */
  check(row, env) {
    this.resolve(env);
    this.stats.seen++;
    const L = this.stats.byLayer[env.layer] || (this.stats.byLayer[env.layer] = { seen: 0, dropped: 0 }); L.seen++;
    if (!env.object || env.layer === 'authoring' || env.layer === 'focus') return { drop: false };
    const t = env.span.start, k = env.object.hash, prev = this.last.get(k);
    let res = { drop: false };
    if (prev) {
      const dt = t - prev.t;
      if (row.type === 'browser' && prev.type === 'browser' && dt >= 0 && dt < this.visitPulseMs) res = { drop: true, reason: 'visit-heartbeat', dupOf: prev.id };
      else if (row.content && prev.content && dt >= 0 && dt < this.windowMs) {
        const s = sim(row.content, prev.content);
        // 已有更可信来源（如 UIA 0.9）时，OCR（0.7）近似内容直接丢弃；反之新内容更可信则保留
        if (s >= this.threshold && env.confidence <= prev.conf) res = { drop: true, reason: `same-content(${prev.type}→${row.type},${Math.round(s * 100)}%)`, dupOf: prev.id };
      }
    }
    if (res.drop) { this.stats.dropped++; L.dropped++; return res; }
    this.last.set(k, { t, type: row.type, content: row.content ? String(row.content).slice(0, 4000) : (prev?.content || null), conf: Math.max(env.confidence, row.content ? 0 : (prev?.conf || 0)), id: row.id || null });
    if (this.last.size > 3000) { const cut = t - 3 * 3600000; for (const [kk, v] of this.last) if (v.t < cut) this.last.delete(kk); }
    return res;
  }
  remember(hash, id) { const v = this.last.get(hash); if (v && !v.id) v.id = id; }
}
const OBJECTS_SQL = `CREATE TABLE IF NOT EXISTS objects (
  hash TEXT PRIMARY KEY, type TEXT NOT NULL, uri TEXT NOT NULL, title TEXT,
  first_seen INTEGER, last_seen INTEGER, touches INTEGER DEFAULT 1, layers TEXT, adapters TEXT, last_activity_id TEXT
); CREATE INDEX IF NOT EXISTS idx_obj_last ON objects(last_seen);`;
function addCsv(csv, v) { const s = new Set(String(csv || '').split(',').filter(Boolean)); s.add(v); return [...s].join(','); }
function upsertObject(store, env, activityId) {
  const o = env.object; if (!o) return;
  const ex = store.get(`SELECT layers, adapters FROM objects WHERE hash=?`, [o.hash]);
  if (ex) store.run(`UPDATE objects SET last_seen=?, touches=touches+1, title=COALESCE(?,title), layers=?, adapters=?, last_activity_id=? WHERE hash=?`, [env.span.start, o.title || null, addCsv(ex.layers, env.layer), addCsv(ex.adapters, env.source.adapter), activityId, o.hash]);
  else store.run(`INSERT INTO objects (hash,type,uri,title,first_seen,last_seen,touches,layers,adapters,last_activity_id) VALUES (?,?,?,?,?,?,1,?,?,?)`, [o.hash, o.type, o.uri, o.title || null, env.span.start, env.span.start, env.layer, env.source.adapter, activityId]);
}
module.exports = { LAYERS, envelope, layerOf, objectOf, normUrl, normPath, cleanTitle, ObjectDeduper, upsertObject, OBJECTS_SQL, sim };
