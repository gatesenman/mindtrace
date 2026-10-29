/**
 * 2.4.9 · 窗口事件 → 文档对象 + 路径 + 正文片段 + 浏览器 URL
 * 由 windowTracker 在新窗口入库后异步调用，不阻塞采集循环。
 */
const path = require('path');
const { parseTitle } = require('./titleParse');
const resolver = require('./docResolver');
const diag = require('./diag');

function store() { return require('../main/store'); }
const jmeta = (m) => { if (!m) return {}; if (typeof m === 'object') return m; try { return JSON.parse(m); } catch (_) { return {}; } };

/** 正文是否允许入库：敏感内容丢弃 + 隐私规则 title-only/none + 黑名单关键词 */
function contentAllowed(row, text, cfg = {}) {
  try {
    const { shouldDropCapture } = require('../privacy/redact');
    if (shouldDropCapture({ ...row, content: text }, cfg).drop) return false;
  } catch (_) {}
  try { const m = require('../pro').evaluatePolicy(row, cfg).mode; if (m === 'none' || m === 'title') return false; } catch (_) {}
  const hay = `${row.file_path || ''} ${row.window_title || ''}`.toLowerCase();
  for (const k of (cfg.privacy?.blacklistKeywords || [])) if (k && hay.includes(String(k).toLowerCase())) return false;
  return true;
}
const contentConsent = (cfg) => !!(cfg.collectors && (cfg.collectors.documents || cfg.collectors.uia));

async function enrichWindow(id, row, { cfg = {}, cmdline = '', resolveOpts = {}, st = store() } = {}) {
  diag.inc('windows');
  const parsed = parseTitle({ process: row.process_name, app: row.app_name, title: row.window_title });
  if (!parsed) return null;
  diag.inc('titleParsed');
  const docName = parsed.doc || parsed.chat || '';
  if (docName) diag.inc('docNamed');
  const meta = jmeta((st.get(`SELECT meta FROM activities WHERE id=?`, [id]) || {}).meta);
  meta.doc = { kind: parsed.kind, name: docName || undefined, project: parsed.project || undefined, site: parsed.site || undefined, page: parsed.page || undefined, cloud: parsed.cloudDoc || parsed.officeWeb || undefined };
  let filePath = null, content = null;
  try {
    const r = await resolver.resolvePath(parsed, { cmdline, ...resolveOpts });
    if (r) { filePath = r.path; meta.doc.via = r.via; diag.inc('pathResolved'); diag.via(r.via); }
  } catch (e) { diag.err('path', e); }
  if (filePath && !parsed.folder && contentConsent(cfg)) {
    const probe = { ...row, file_path: filePath };
    try {
      const snip = await resolver.extractSnippet(filePath);
      if (snip) {
        if (contentAllowed(probe, snip, cfg)) { content = require('../privacy/redact').redactText(snip); meta.doc.snippet = 'file'; diag.inc('snippet'); }
        else diag.inc('privacySkipped');
      }
    } catch (e) { diag.err('snippet', e); }
  }
  st.run(`UPDATE activities SET meta=?, file_path=COALESCE(file_path, ?), content=COALESCE(content, ?) WHERE id=?`, [JSON.stringify(meta), filePath, content, id]);
  return { parsed, filePath, content };
}

/** 浏览器：用历史库里同标题的访问记录给窗口事件补 URL（History 每 60s 拉一次，所以延后执行） */
function joinBrowser(id, { st = store(), windowMs = 15 * 60000, cfg = {}, fetchPage = true, fetchImpl } = {}) {
  const w = st.get(`SELECT id, started_at, ended_at, duration_ms, window_title, url, meta, process_name, content FROM activities WHERE id=?`, [id]);
  if (!w) return null;
  let url = w.url || null;
  if (!url) {
    const page = jmeta(w.meta).doc?.page || require('./titleParse').parseBrowser(w.window_title || '').page;
    if (!page) return null;
    const end = (w.ended_at || (w.started_at + (w.duration_ms || 0))) + 120000;
    const cands = st.all(`SELECT url, window_title, started_at FROM activities WHERE type='browser' AND started_at BETWEEN ? AND ? AND url IS NOT NULL ORDER BY started_at DESC LIMIT 60`, [w.started_at - windowMs, end]);
    const p = page.toLowerCase();
    const hit = cands.find(c => (c.window_title || '').toLowerCase() === p) || cands.find(c => { const t = (c.window_title || '').toLowerCase(); return t && (t.startsWith(p.slice(0, 24)) || p.startsWith(t.slice(0, 24))); });
    if (!hit) return null;
    url = hit.url;
    st.run(`UPDATE activities SET url=? WHERE id=? AND url IS NULL`, [url, id]);
    diag.inc('browserJoined');
  }
  // 2.4.9：补网页正文（异步，不阻塞；仅本地 / 闸门 / 隐私仍生效）
  if (fetchPage && url && contentConsent(cfg)) {
    try {
      const pb = require('./pageBody');
      Promise.resolve(pb.attachPageBody(id, url, { cfg, st, fetchImpl })).catch(e => diag.err('pageBody', e));
    } catch (e) { diag.err('pageBody', e); }
  }
  return url;
}

/** UIA/OCR 读到的正文挂到当前窗口事件上（没有本地文件的应用：微信会话、网页、在线文档） */
function attachText(id, text, source, { cfg = {}, st = store() } = {}) {
  if (!id || !text) return false;
  const w = st.get(`SELECT id, app_name, process_name, window_title, url, file_path, content, meta FROM activities WHERE id=?`, [id]);
  if (!w || (w.content && String(w.content).length >= 200)) return false;
  if (!contentAllowed(w, text, cfg)) { diag.inc('privacySkipped'); return false; }
  const meta = jmeta(w.meta); meta.doc = { ...(meta.doc || {}), snippet: source };
  const t = require('../privacy/redact').redactText(String(text).replace(w.window_title || '\u0000', '').trim()).slice(0, 1500);
  st.run(`UPDATE activities SET content=?, meta=? WHERE id=?`, [t, JSON.stringify(meta), id]);
  return true;
}

module.exports = { enrichWindow, joinBrowser, attachText, contentAllowed, contentConsent };
