/**
 * 2.4.8 · 按"文档/页面/会话"聚合一段时间内的活动，供日报、AI 日记、时间线摘要使用。
 */
const { parseTitle } = require('./titleParse');
const jmeta = (m) => { if (!m) return {}; if (typeof m === 'object') return m; try { return JSON.parse(m); } catch (_) { return {}; } };
const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
const KIND_CN = { office: '文档', wps: '文档', text: '文本', pdf: 'PDF', code: '代码', browser: '网页', chat: '会话', file: '文件', document: '文件' };

function objectOf(a) {
  const m = jmeta(a.meta);
  let d = m.doc;
  if ((!d || !d.kind) && a.type === 'window') { const p = parseTitle({ process: a.process_name, app: a.app_name, title: a.window_title }); if (p) d = { kind: p.kind, name: p.doc || p.chat, page: p.page, project: p.project }; }
  if (a.type === 'document' || a.type === 'download') return { key: 'f:' + (a.file_path || a.window_title), name: base(a.file_path) || a.window_title, kind: 'document' };
  if (a.type === 'browser') return a.window_title ? { key: 'u:' + a.url, name: a.window_title, kind: 'browser', url: a.url } : null;
  if (!d) return null;
  if (d.kind === 'explorer') return null;
  if (d.kind === 'browser') { const n = d.name || d.page; return n ? { key: 'b:' + n, name: n, kind: 'browser', url: a.url } : null; }
  if (!d.name) return null;
  return { key: d.kind + ':' + (a.file_path || d.name), name: d.name, kind: d.kind, project: d.project };
}

function digest(rows, { limit = 20 } = {}) {
  const map = new Map();
  for (const a of rows) {
    if (a.type === 'clipboard' || a.type === 'screenshot' || a.type === 'uia' || a.type === 'ide') continue;
    const o = objectOf(a); if (!o) continue;
    let e = map.get(o.key);
    if (!e) { e = { ...o, app: a.app_name || '', ms: 0, count: 0, path: a.file_path || '', snippet: '', first: a.started_at }; map.set(o.key, e); }
    e.ms += Number(a.duration_ms || 0); e.count++;
    if (!e.path && a.file_path && !/\.(png|jpe?g)$/i.test(a.file_path)) e.path = a.file_path;
    if (!e.url && a.url) e.url = a.url;
    if (!e.snippet && a.content) e.snippet = String(a.content).replace(/\s+/g, ' ').trim().slice(0, 200);
  }
  return [...map.values()].sort((x, y) => (y.ms - x.ms) || (y.count - x.count)).slice(0, limit);
}

function fmtMin(ms) { const m = Math.round(ms / 60000); return m ? `${m}分钟` : ''; }
/** 给 LLM 的紧凑文档清单 */
function toPrompt(list) {
  return list.map(d => `- [${KIND_CN[d.kind] || d.kind}] ${d.name}${d.app ? ` (${d.app})` : ''}${fmtMin(d.ms) ? ` ${fmtMin(d.ms)}` : ''}${d.path ? ` ${d.path}` : d.url ? ` ${d.url}` : ''}${d.snippet ? `\n  内容：${d.snippet}` : ''}`).join('\n');
}
function toMarkdown(list) {
  return list.map(d => `- **${d.name}** · ${KIND_CN[d.kind] || d.kind}${d.app ? ` · ${d.app}` : ''}${fmtMin(d.ms) ? ` · ${fmtMin(d.ms)}` : ''}${d.snippet ? `\n  > ${d.snippet.slice(0, 120)}${d.snippet.length > 120 ? '…' : ''}` : ''}`);
}
module.exports = { digest, objectOf, toPrompt, toMarkdown };
