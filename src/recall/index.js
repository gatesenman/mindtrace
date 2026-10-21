// 2.4 回忆框：一句模糊的话 → 直达原件
// 借鉴：Rewind「像搜索引擎一样回到过去」的全局快捷键唤起（Rewind 已于 2025-12-19 停服，见 https://rewind.ai/what-happened-to-rewind/）；
//       Khoj 两段式检索（召回 → 重排，https://docs.khoj.dev/features/search）；按对象聚合（第 2 轮 objects 表）。
const zh = require('../calendar/zhtime');
const FILLER = /(写的|写过|看过的?|看到的?|看的|说的|说过|讲的|里面|里|在|那个|那篇|那份|那张|那条|那段|那次|我的|我们|我|看过的?|看到的?|打开过?的?|找一下|找找|帮我|之前|上次|好像|大概|一下|关于|有关|的|了|吗|呢|在哪|哪里|是什么)/g;
const KIND_HINTS = [
  { re: /(链接|网页|网站|文章|页面|帖子|博客|url)/i, kind: 'web' },
  { re: /(文件|文档|pdf|docx?|xlsx?|pptx?|表格|幻灯片|演示|压缩包|zip|安装包|exe)/i, kind: 'file' },
  { re: /(聊天|微信|群里|群聊|说过|聊过|消息|飞书|钉钉|企微|企业微信)/i, kind: 'conversation' },
  { re: /(代码|提交|commit|仓库|项目|分支)/i, kind: 'code' }
];
const EXT = /\b(pdf|docx?|xlsx?|pptx?|zip|exe|md|txt|csv|png|jpe?g)\b/i;

function parseQuery(q, now = Date.now()) {
  let text = String(q || '').trim();
  let window = null, timeText = '';
  try {
    const hits = zh.parse(text, now) || [];
    const h = hits[0];
    if (h && h.start) {
      timeText = h.text;
      const part = /上午|早上|中午|下午|傍晚|晚上|凌晨|\d+\s*[点:时]/.test(h.text);
      if (/上周|这周|本周/.test(h.text)) { window = [h.start, h.start + 7 * 86400000]; }
      else if (part) {
        const d = new Date(h.start); d.setHours(0, 0, 0, 0); const D = d.getTime(), hr = 3600000;
        const SEG = [[/凌晨/, 0, 6], [/早上|上午/, 6, 12], [/中午/, 11, 14], [/下午/, 12, 18.5], [/傍晚/, 17, 19.5], [/晚上/, 18, 24]];
        const seg = !/\d+\s*[点:时]/.test(h.text) && SEG.find(([re]) => re.test(h.text));
        window = seg ? [D + seg[1] * hr, D + seg[2] * hr] : [h.start - 1.5 * hr, h.start + 1.5 * hr];
      }
      else { const d = new Date(h.start); d.setHours(0, 0, 0, 0); window = [d.getTime(), d.getTime() + 86400000]; }
      text = text.replace(h.text, ' ');
    }
  } catch (_) {}
  if (!window) {
    const d0 = new Date(now); d0.setHours(0, 0, 0, 0); const D = d0.getTime(); const dow = (d0.getDay() + 6) % 7;
    const W = [[/上上周/, [D - (dow + 14) * 864e5, D - (dow + 7) * 864e5]], [/上周|上个?星期|上礼拜/, [D - (dow + 7) * 864e5, D - dow * 864e5]], [/这周|本周|这个?星期/, [D - dow * 864e5, D + 864e5]], [/上个月|上月/, [new Date(d0.getFullYear(), d0.getMonth() - 1, 1).getTime(), new Date(d0.getFullYear(), d0.getMonth(), 1).getTime()]], [/这个月|本月/, [new Date(d0.getFullYear(), d0.getMonth(), 1).getTime(), D + 864e5]]];
    for (const [re, w] of W) { const m = text.match(re); if (m) { window = w; timeText = m[0]; text = text.replace(m[0], ' '); break; } }
  }
  if (!window) { const m = text.match(/(最近|这几天|前几天)/); if (m) { window = [now - 3 * 86400000, now]; text = text.replace(m[0], ' '); timeText = m[0]; } }
  let kind = null; for (const k of KIND_HINTS) if (k.re.test(text)) { kind = k.kind; break; }
  const ext = (text.match(EXT) || [])[1]?.toLowerCase() || null;
  let terms = text.replace(FILLER, ' ');
  for (const k of KIND_HINTS) terms = terms.replace(k.re, ' ');
  terms = terms.replace(/[，。,.!?？！、"'“”‘’()（）]/g, ' ').replace(/\s+/g, ' ').trim();
  return { raw: q, terms, window, timeText, kind, ext };
}
function kindOf(row, meta) {
  if (row.url) return 'web';
  if (row.path && row.type !== 'screenshot') return 'file';
  if (meta.layer === 'communication') return 'conversation';
  if (row.type === 'ide') return 'code';
  return 'activity';
}
function snippet(content, terms) {
  const s = String(content || '').replace(/\s+/g, ' '); if (!s) return '';
  const t = (terms || '').split(' ').filter(Boolean)[0]; const i = t ? s.toLowerCase().indexOf(t.toLowerCase()) : -1;
  const a = Math.max(0, (i < 0 ? 0 : i) - 30); return (a > 0 ? '…' : '') + s.slice(a, a + 110) + (s.length > a + 110 ? '…' : '');
}
/** store 需提供 searchFts(q, n) 与 all(sql, params) */
function recall(store, q, { now = Date.now(), limit = 8 } = {}) {
  const P = parseQuery(q, now);
  const cand = new Map();
  const add = (row, base) => { if (!row || !row.id) return; const c = cand.get(row.id); if (!c || c.base < base) cand.set(row.id, { row, base }); };
  if (P.terms) {
    const all = store.searchFts(P.terms, 120); all.forEach((r, i) => add(r, 1 - i / 160));
    // 多词且命中少：逐词召回再按命中词比例打分（宽松召回 → 重排，参考 Khoj 两段式）
    const words = P.terms.split(' ').filter(w => w.length > 1);
    if (words.length > 1 && all.length < 8) {
      const cnt = new Map();
      for (const w of words) for (const r of store.searchFts(w, 60)) { const c = cnt.get(r.id) || { r, n: 0 }; c.n++; cnt.set(r.id, c); }
      for (const { r, n } of cnt.values()) add(r, 0.35 + 0.5 * n / words.length);
    }
  }
  const cols = `id, window_title AS title, content, url, file_path AS path, app_name AS app, type, started_at, meta`;
  if (P.window) {
    const params = [P.window[0], P.window[1]]; let extra = '';
    if (P.ext) { extra = ` AND (file_path LIKE ? OR url LIKE ? OR window_title LIKE ?)`; params.push(`%.${P.ext}%`, `%.${P.ext}%`, `%.${P.ext}%`); }
    else if (P.kind === 'web') extra = ` AND url IS NOT NULL`;
    else if (P.kind === 'file') extra = ` AND file_path IS NOT NULL AND type!='screenshot'`;
    store.all(`SELECT ${cols} FROM activities WHERE started_at>=? AND started_at<?${extra} ORDER BY started_at DESC LIMIT 200`, params).forEach(r => add(r, P.terms ? 0.15 : 0.5));
  } else if (!P.terms && (P.ext || P.kind)) {
    const extra = P.ext ? `(file_path LIKE '%.${P.ext}%' OR url LIKE '%.${P.ext}%')` : P.kind === 'web' ? 'url IS NOT NULL' : P.kind === 'file' ? `file_path IS NOT NULL AND type!='screenshot'` : '1=1';
    store.all(`SELECT ${cols} FROM activities WHERE ${extra} ORDER BY started_at DESC LIMIT 100`, []).forEach(r => add(r, 0.4));
  }
  const ids = [...cand.keys()];
  const metaById = new Map();
  if (ids.length) for (let i = 0; i < ids.length; i += 400) { const ch = ids.slice(i, i + 400); store.all(`SELECT id, meta FROM activities WHERE id IN (${ch.map(() => '?').join(',')})`, ch).forEach(r => metaById.set(r.id, r.meta)); }
  const groups = new Map(); const tl = P.terms.toLowerCase().split(' ').filter(Boolean);
  for (const { row, base } of cand.values()) {
    let meta = {}; try { meta = JSON.parse(row.meta || metaById.get(row.id) || '{}') || {}; } catch (_) {}
    const kind = kindOf(row, meta);
    let s = base;
    const ts = row.started_at || 0;
    if (P.window) s += ts >= P.window[0] && ts < P.window[1] ? 0.6 : -0.8;
    if (P.kind && (kind === P.kind || (P.kind === 'conversation' && meta.layer === 'communication'))) s += 0.5; else if (P.kind && kind !== 'activity') s -= 0.2;
    if (P.ext && `${row.path || ''}${row.url || ''}${row.title || ''}`.toLowerCase().includes('.' + P.ext)) s += 0.6;
    const title = String(row.title || '').toLowerCase();
    s += tl.filter(t => title.includes(t)).length * 0.25;
    if (row.url || (row.path && row.type !== 'screenshot')) s += 0.15; // 可直接打开的原件优先
    s += Math.max(0, 0.2 - (now - ts) / (30 * 86400000) * 0.2); // 轻微新近性
    if (row.type === 'window' && !row.url) s -= 0.1;
    const key = meta.obj || row.url || row.path || row.id;
    const g = groups.get(key);
    if (!g) groups.set(key, { key, kind, score: s, hits: 1, row, last: ts, sources: new Set([row.type]) });
    else { g.hits++; g.sources.add(row.type); if (s > g.score) { g.score = s; g.row = row; } g.last = Math.max(g.last, ts); }
  }
  const out = [...groups.values()].map(g => ({ ...g, score: g.score + Math.min(0.3, Math.log2(1 + g.hits) * 0.1) })).sort((a, b) => b.score - a.score).slice(0, limit);
  return {
    query: P,
    results: out.map(g => ({
      key: g.key, kind: g.kind, score: Math.round(g.score * 100) / 100,
      title: g.row.title || g.row.path?.split(/[\\/]/).pop() || g.row.url || g.row.app || '（无标题）',
      app: g.row.app || null, url: g.row.url || null, path: g.row.type !== 'screenshot' ? (g.row.path || null) : null,
      shot: g.row.type === 'screenshot' ? g.row.path : null,
      when: g.last, hits: g.hits, sources: [...g.sources], activityId: g.row.id, snippet: snippet(g.row.content, P.terms)
    }))
  };
}
module.exports = { recall, parseQuery };
