/**
 * 2.4.8 / 2.5 · 按「文档/页面/会话」聚合一段时间内的活动，供日报、AI 日记、时间线、检索使用。
 */
const { parseTitle } = require('./titleParse');
const jmeta = (m) => { if (!m) return {}; if (typeof m === 'object') return m; try { return JSON.parse(m); } catch (_) { return {}; } };
const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
const KIND_CN = { office: '文档', wps: '文档', text: '文本', pdf: 'PDF', code: '代码', browser: '网页', chat: '会话', file: '文件', document: '文件' };
const SNIP_MAX = 240;
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function objectOf(a) {
  const m = jmeta(a.meta);
  let d = m.doc;
  if ((!d || !d.kind) && (a.type === 'window' || a.type === 'uia')) {
    const p = parseTitle({ process: a.process_name, app: a.app_name, title: a.window_title });
    if (p) d = { kind: p.kind, name: p.doc || p.chat, page: p.page, project: p.project };
  }
  if (a.type === 'document' || a.type === 'download' || a.type === 'file') {
    return { key: 'f:' + (a.file_path || a.window_title), name: base(a.file_path) || a.window_title, kind: 'document' };
  }
  if (a.type === 'browser') return a.window_title ? { key: 'u:' + (a.url || a.window_title), name: a.window_title, kind: 'browser', url: a.url } : (a.url ? { key: 'u:' + a.url, name: a.url, kind: 'browser', url: a.url } : null);
  if (!d) return null;
  if (d.kind === 'explorer') return null;
  if (d.kind === 'browser') { const n = d.name || d.page; return n ? { key: 'b:' + n, name: n, kind: 'browser', url: a.url } : null; }
  if (!d.name) return null;
  return { key: d.kind + ':' + (a.file_path || d.name), name: d.name, kind: d.kind, project: d.project };
}

function betterSnippet(prev, text) {
  const s = norm(text);
  if (s.length < 12) return prev || '';
  if (!prev || s.length > prev.length) return s.slice(0, SNIP_MAX);
  return prev;
}

function topicOf(d) {
  if (d.name) return String(d.name).replace(/\.[a-z0-9]{1,5}$/i, '').slice(0, 32);
  const s = norm(d.snippet);
  if (!s) return '';
  return s.split(/[。！？!?\n]/)[0].slice(0, 32);
}

function digest(rows, { limit = 20 } = {}) {
  const map = new Map();
  const pending = [];
  for (const a of rows) {
    if (a.type === 'clipboard' || a.type === 'screenshot' || a.type === 'ide') continue;
    if (a.type === 'uia') { pending.push(a); continue; }
    const o = objectOf(a); if (!o) continue;
    let e = map.get(o.key);
    if (!e) {
      e = { ...o, app: a.app_name || '', ms: 0, count: 0, path: a.file_path || '', snippet: '', first: a.started_at, last: a.started_at, ids: [] };
      map.set(o.key, e);
    }
    e.ms += Number(a.duration_ms || 0); e.count++;
    if (a.started_at != null) { if (e.first == null || a.started_at < e.first) e.first = a.started_at; if (e.last == null || a.started_at > e.last) e.last = a.started_at; }
    if (a.id && e.ids.length < 8) e.ids.push(a.id);
    if (!e.path && a.file_path && !/\.(png|jpe?g)$/i.test(a.file_path)) e.path = a.file_path;
    if (!e.url && a.url) e.url = a.url;
    if (a.content) e.snippet = betterSnippet(e.snippet, a.content);
    if (!e.app && a.app_name) e.app = a.app_name;
  }
  for (const a of pending) {
    const title = String(a.window_title || '');
    const app = a.app_name || '';
    let e = [...map.values()].find(o => (o.name && title && title.includes(o.name)) || (o.app && app && o.app === app && (o.kind === 'chat' || o.kind === 'browser' || o.kind === 'code')));
    if (!e) {
      const o = objectOf(a);
      if (o) {
        e = map.get(o.key) || { ...o, app, ms: 0, count: 0, path: a.file_path || '', snippet: '', first: a.started_at, last: a.started_at, ids: [] };
        map.set(o.key, e);
      }
    }
    if (!e) continue;
    const s = norm(a.content);
    if (s.length >= 24) e.snippet = betterSnippet(e.snippet, s);
    e.count++;
    if (a.id && e.ids.length < 8) e.ids.push(a.id);
    if (a.started_at != null) { if (e.first == null || a.started_at < e.first) e.first = a.started_at; if (e.last == null || a.started_at > e.last) e.last = a.started_at; }
  }
  const list = [...map.values()].sort((x, y) => (y.ms - x.ms) || (y.count - x.count)).slice(0, limit);
  for (const e of list) e.topic = topicOf(e);
  return list;
}

function fmtMin(ms) { const m = Math.round(ms / 60000); return m ? `${m}分钟` : ''; }

/** 给 LLM 的紧凑文档清单 */
function toPrompt(list) {
  return list.map(d => `- [${KIND_CN[d.kind] || d.kind}] ${d.name}${d.app ? ` (${d.app})` : ''}${fmtMin(d.ms) ? ` ${fmtMin(d.ms)}` : ''}${d.path ? ` ${d.path}` : d.url ? ` ${d.url}` : ''}${d.snippet ? `\n  内容：${d.snippet}` : ''}`).join('\n');
}
function toMarkdown(list) {
  return list.map(d => `- **${d.name}** · ${KIND_CN[d.kind] || d.kind}${d.app ? ` · ${d.app}` : ''}${fmtMin(d.ms) ? ` · ${fmtMin(d.ms)}` : ''}${d.snippet ? `\n  > ${d.snippet.slice(0, 120)}${d.snippet.length > 120 ? '…' : ''}` : ''}`);
}
module.exports = { digest, objectOf, toPrompt, toMarkdown, topicOf, KIND_CN, SNIP_MAX, fmtMin };
