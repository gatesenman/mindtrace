// 2.4 统一出网闸门：所有对外 HTTP 请求必须经过这里。
// 借鉴：Microsoft Recall「快照不出设备」+ Screenpipe 本地优先。仅本地模式下，非回环地址一律拦截并计数。
const LOCAL = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
let stats = null;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
function ensure() { if (!stats || stats.day !== today()) stats = { day: today(), allowed: 0, blocked: 0, local: 0, byPurpose: {}, last: [] }; return stats; }
function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ''; } }
function isLocal(url) { const h = hostOf(url); return LOCAL.has(h) || /^127\./.test(h); }
let auditFn = null;
function setAudit(fn) { auditFn = fn; }
/** 返回 {ok, reason}；不抛异常，方便 UI 预检 */
function check(url, cfg = {}, purpose = 'other') {
  if (isLocal(url)) return { ok: true, local: true };
  if (cfg.privacy?.localOnly) return { ok: false, reason: `已开启「仅本地模式」，已拦截对 ${hostOf(url) || url} 的外发请求（${purpose}）` };
  if (purpose === 'favicon' && cfg.privacy?.fetchFavicons === false) return { ok: false, reason: '已关闭网站图标下载' };
  return { ok: true, local: false };
}
function record(url, purpose, verdict) {
  const s = ensure();
  if (!verdict.ok) s.blocked++; else if (verdict.local) s.local++; else s.allowed++;
  const p = s.byPurpose[purpose] || (s.byPurpose[purpose] = { allowed: 0, blocked: 0 });
  verdict.ok ? (verdict.local || p.allowed++) : p.blocked++;
  s.last.unshift({ t: Date.now(), host: hostOf(url), purpose, ok: verdict.ok, local: !!verdict.local });
  s.last.length = Math.min(s.last.length, 30);
  if (!verdict.ok && auditFn) try { auditFn('net', 'blocked', hostOf(url), { purpose }); } catch (_) {}
}
class BlockedError extends Error { constructor(m) { super(m); this.blocked = true; this.code = 'LOCAL_ONLY'; } }
/** fetch 的唯一出口 */
async function gatedFetch(url, opts = {}, { cfg = {}, purpose = 'other', fetchImpl } = {}) {
  const v = check(url, cfg, purpose);
  record(url, purpose, v);
  if (!v.ok) throw new BlockedError(v.reason);
  return (fetchImpl || globalThis.fetch)(url, opts);
}
function getStats() { const s = ensure(); return { ...s, external: s.allowed, last: s.last.slice(0, 10) }; }
function _reset() { stats = null; }
module.exports = { gatedFetch, check, isLocal, getStats, setAudit, BlockedError, _reset };
