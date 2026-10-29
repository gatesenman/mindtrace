/**
 * 2.4.9 · 浏览器页面正文片段
 * 优先复用已挂上的 UIA/OCR；否则在非「仅本地」且出网闸门放行时拉取可读正文。
 * 有大小/超时上限、内存缓存、shouldDropCapture。
 */
const diag = require('./diag');

const MAX_BYTES = 200 * 1024;
const MAX_TEXT = 1500;
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 80;
const cache = new Map(); // url -> { text, at }

function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  const art = s.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    || s.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
    || s.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (art) s = art[1];
  s = s.replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|header|footer)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '· ')
    .replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number(n);
      return (c > 0 && c < 0x110000) ? String.fromCodePoint(c) : ' ';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const c = parseInt(h, 16);
      return (c > 0 && c < 0x110000) ? String.fromCodePoint(c) : ' ';
    });
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  return s.slice(0, MAX_TEXT * 2);
}

function cacheGet(url) {
  const hit = cache.get(url);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(url); return null; }
  return hit.text;
}
function cacheSet(url, text) {
  cache.set(url, { text, at: Date.now() });
  if (cache.size > CACHE_MAX) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
}

function allowUrl(url, cfg = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(u.hostname)) return false;
  } catch (_) { return false; }
  const sites = cfg.privacy?.blacklistSites || [];
  const keywords = cfg.privacy?.blacklistKeywords || [];
  const low = url.toLowerCase();
  for (const s of sites) if (s && low.includes(String(s).toLowerCase())) return false;
  for (const k of keywords) if (k && low.includes(String(k).toLowerCase())) return false;
  return true;
}

/**
 * @returns {Promise<string|null>}
 */
async function fetchPageSnippet(url, { cfg = {}, fetchImpl, maxBytes = MAX_BYTES, timeoutMs = TIMEOUT_MS } = {}) {
  if (!allowUrl(url, cfg)) return null;
  if (cfg.privacy?.localOnly) return null;
  const cached = cacheGet(url);
  if (cached != null) return cached;

  const gate = require('../net/gate');
  const verdict = gate.check(url, cfg, 'page-body');
  if (!verdict.ok) return null;

  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => { try { ctrl?.abort(); } catch (_) {} }, timeoutMs);
  try {
    const res = await gate.gatedFetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl?.signal,
      headers: {
        'User-Agent': 'MindTrace/2.4.9 (local knowledge; +https://localhost)',
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5'
      }
    }, { cfg, purpose: 'page-body', fetchImpl });
    if (!res || !res.ok) return null;
    const ctype = String(res.headers?.get?.('content-type') || '');
    if (ctype && !/text\/html|application\/xhtml|text\/plain/i.test(ctype)) return null;
    let buf;
    if (typeof res.arrayBuffer === 'function') {
      const ab = await res.arrayBuffer();
      buf = Buffer.from(ab.slice(0, maxBytes));
    } else {
      const t = await res.text();
      buf = Buffer.from(String(t).slice(0, maxBytes), 'utf8');
    }
    const text = htmlToText(buf.toString('utf8')).slice(0, MAX_TEXT);
    if (text.length < 40) return null;
    cacheSet(url, text);
    return text;
  } catch (e) {
    diag.err('pageBody', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把网页正文挂到窗口/浏览事件上（已有足够正文则跳过）
 */
async function attachPageBody(id, url, { cfg = {}, st, fetchImpl } = {}) {
  if (!id || !url) return false;
  const store = st || require('../main/store');
  const row = store.get(`SELECT id, app_name, process_name, window_title, url, file_path, content, meta FROM activities WHERE id=?`, [id]);
  if (!row) return false;
  if (row.content && String(row.content).length >= 120) return false;

  // 本地优先：已有 UIA/OCR 足够则不再拉网
  let text = null;
  try {
    text = await fetchPageSnippet(url, { cfg, fetchImpl });
  } catch (e) { diag.err('pageBody', e); text = null; }
  if (!text) return false;

  const enrich = require('./enrich');
  if (!enrich.contentAllowed({ ...row, url }, text, cfg)) {
    diag.inc('privacySkipped');
    return false;
  }
  const ok = enrich.attachText(id, text, 'page', { cfg, st: store });
  if (ok) diag.inc('browserBody');
  return ok;
}

function _resetCache() { cache.clear(); }

module.exports = { htmlToText, fetchPageSnippet, attachPageBody, allowUrl, _resetCache, MAX_TEXT, MAX_BYTES };
