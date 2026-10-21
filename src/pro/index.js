/**
 * MindTrace 2.2 professional layer:
 * privacy policy engine + audit log, encrypted backup/restore, memory review,
 * LLM usage/budget + job queue, productivity analytics, diagnostics.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('../main/store');
const { shouldDropCapture, redactText } = require('../privacy/redact');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL,
  action TEXT, target TEXT, detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
CREATE TABLE IF NOT EXISTS llm_usage (
  id TEXT PRIMARY KEY, ts INTEGER NOT NULL, provider TEXT, model TEXT, purpose TEXT,
  prompt_tokens INTEGER DEFAULT 0, completion_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0, latency_ms INTEGER DEFAULT 0, ok INTEGER DEFAULT 1, error TEXT
);
CREATE INDEX IF NOT EXISTS idx_usage_ts ON llm_usage(ts);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, params TEXT,
  attempts INTEGER DEFAULT 0, error TEXT, result TEXT,
  created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
`;

let getConfig = () => ({});
function init(opts = {}) {
  if (opts.getConfig) getConfig = opts.getConfig;
  for (const stmt of SCHEMA.split(';').map(s => s.trim()).filter(Boolean)) {
    try { store.run(stmt); } catch (_) {}
  }
}

/* ───────────── Audit ───────────── */
function audit(kind, action, target, detail) {
  try {
    store.run(`INSERT INTO audit_log (id,ts,kind,action,target,detail) VALUES (?,?,?,?,?,?)`, [
      crypto.randomUUID(), Date.now(), kind, action || null,
      target ? String(target).slice(0, 300) : null,
      detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 2000)
    ]);
  } catch (_) {}
}
function listAudit({ kind, limit = 200 } = {}) {
  if (kind) return store.all(`SELECT * FROM audit_log WHERE kind=? ORDER BY ts DESC LIMIT ?`, [kind, limit]);
  return store.all(`SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?`, [limit]);
}

/* ───────────── Privacy policy ───────────── */
const SENSITIVE_APPS = /(1password|bitwarden|keepass|lastpass|dashlane|enpass|密码管理|网银|银行|alipay|支付宝|wallet|钱包|ukey|u盾|authy|microsoft authenticator)/i;
const SENSITIVE_TITLES = /(inprivate|incognito|无痕|隐身窗口|private browsing|登录|sign in|password|密码|验证码|网上银行|online banking|支付|checkout|wallet)/i;
const SENSITIVE_SITES = /(bank|banking|paypal|alipay|pay\.|\/login|\/signin|accounts\.google|passport\.|stripe\.com|checkout)/i;

/** @returns {{mode:'none'|'title'|'full', reason:string}} */
function evaluatePolicy(row, cfg = getConfig()) {
  const p = cfg.privacy || {};
  const app = `${row.app_name || ''} ${row.process_name || ''}`;
  const title = String(row.window_title || '');
  const url = String(row.url || '');
  const rules = Array.isArray(p.rules) ? p.rules : [];
  for (const r of rules) {
    if (!r || !r.match) continue;
    const m = String(r.match).toLowerCase();
    const scope = r.scope || 'app';
    const hay = scope === 'site' ? url.toLowerCase() : app.toLowerCase();
    if (hay.includes(m)) return { mode: r.mode || 'none', reason: `rule:${scope}:${r.match}` };
  }
  if (p.sensitiveDetection !== false) {
    if (SENSITIVE_APPS.test(app)) return { mode: 'none', reason: 'sensitive-app' };
    if (SENSITIVE_TITLES.test(title)) return { mode: 'none', reason: 'sensitive-window' };
    if (url && SENSITIVE_SITES.test(url)) return { mode: 'title', reason: 'sensitive-site' };
  }
  return { mode: 'full', reason: 'default' };
}

/** Applied by store.insertActivity before writing. Returns row or null (dropped). */
function applyPolicy(row) {
  let meta = row.meta;
  if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = null; } }
  if (meta && meta.isDemo) return row;
  // R5：Recall 风格敏感内容整条丢弃（密码/证件/卡号/验证码/无痕）
  try {
    const d = shouldDropCapture(row, getConfig());
    if (d.drop) {
      audit('capture', 'blocked', row.app_name || row.url || row.type, { reason: 'sensitive-content', hits: d.hits, type: row.type });
      return null;
    }
  } catch (_) {}
  const { mode, reason } = evaluatePolicy(row);
  if (mode === 'none') {
    audit('capture', 'blocked', row.app_name || row.url || row.type, { reason, type: row.type });
    return null;
  }
  if (mode === 'title') {
    audit('capture', 'title-only', row.app_name || row.type, { reason });
    let host = null;
    try { host = row.url ? new URL(row.url).host : null; } catch (_) {}
    return { ...row, content: null, url: host ? `https://${host}/` : null, file_path: null };
  }
  return row;
}

/** Wipe all captured data in [from, to). */
function wipeRange(from, to) {
  const a = store.get(`SELECT COUNT(*) c FROM activities WHERE started_at>=? AND started_at<?`, [from, to])?.c || 0;
  const s = store.get(`SELECT COUNT(*) c FROM screenshots WHERE taken_at>=? AND taken_at<?`, [from, to])?.c || 0;
  store.deleteActivitiesFts('started_at>=? AND started_at<?', [from, to]);
  store.run(`DELETE FROM activities WHERE started_at>=? AND started_at<?`, [from, to]);
  store.run(`DELETE FROM screenshots WHERE taken_at>=? AND taken_at<?`, [from, to]);
  audit('wipe', 'range', `${new Date(from).toISOString()}~${new Date(to).toISOString()}`, { activities: a, screenshots: s });
  store.persist(true);
  return { ok: true, activities: a, screenshots: s };
}

/** Local-only guard for LLM endpoints. */
function assertEndpointAllowed(baseUrl, cfg = getConfig()) {
  if (!cfg.privacy?.localOnly) return;
  let host = '';
  try { host = new URL(baseUrl).hostname; } catch (_) {}
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    audit('llm', 'blocked-local-only', baseUrl);
    throw new Error('已开启「仅本地模式」：只允许调用本机模型（如 Ollama 127.0.0.1）');
  }
}

/* ───────────── LLM usage & budget ───────────── */
// Approximate USD per 1M tokens (input, output). Unknown → 0.
const PRICES = {
  // DeepSeek 官方价（2026-09，非高峰，缓存未命中）；高峰时段翻倍
  'deepseek-flash': [0.15, 0.6], 'deepseek-v4-pro': [0.66, 1.98], 'deepseek-v4-flash': [0.15, 0.6],
  'deepseek-chat': [0.27, 1.1], 'deepseek-reasoner': [0.55, 2.19],
  'gpt-4o-mini': [0.15, 0.6], 'gpt-4o': [2.5, 10],
  'qwen-plus': [0.4, 1.2], 'moonshot-v1-8k': [1.7, 1.7]
};
function estimateTokens(text) {
  const s = String(text || '');
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  return Math.ceil(cjk * 0.7 + (s.length - cjk) / 4);
}
function monthStart(ts = Date.now()) { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
function monthSpend() {
  return store.get(`SELECT COALESCE(SUM(cost_usd),0) s, COALESCE(SUM(prompt_tokens+completion_tokens),0) t, COUNT(*) n FROM llm_usage WHERE ts>=?`, [monthStart()]) || { s: 0, t: 0, n: 0 };
}
function assertBudget(cfg = getConfig()) {
  const cap = Number(cfg.ai?.monthlyBudgetUsd || 0);
  if (!cap) return;
  const { s } = monthSpend();
  if (s >= cap) {
    audit('llm', 'blocked-budget', cfg.ai?.model, { spent: s, cap });
    throw new Error(`本月 AI 预算已用尽（$${s.toFixed(2)} / $${cap}），请在设置中调整预算`);
  }
}
function recordUsage({ provider, model, purpose, messages, content, raw, latency_ms, ok = true, error }) {
  const u = raw?.usage || {};
  const pt = u.prompt_tokens ?? estimateTokens((messages || []).map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n'));
  const ct = u.completion_tokens ?? estimateTokens(content);
  const price = PRICES[model] || [0, 0];
  const cost = (pt * price[0] + ct * price[1]) / 1e6;
  try {
    store.run(`INSERT INTO llm_usage (id,ts,provider,model,purpose,prompt_tokens,completion_tokens,cost_usd,latency_ms,ok,error) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [crypto.randomUUID(), Date.now(), provider || null, model || null, purpose || null, pt, ct, cost, latency_ms || 0, ok ? 1 : 0, error ? String(error).slice(0, 300) : null]);
  } catch (_) {}
  audit('llm', ok ? 'sent' : 'failed', model, { purpose, prompt_tokens: pt, completion_tokens: ct, chars: (messages || []).reduce((n, m) => n + String(typeof m.content === 'string' ? m.content : '').length, 0) });
  return { prompt_tokens: pt, completion_tokens: ct, cost_usd: cost };
}
function usageSummary() {
  const month = monthSpend();
  const byModel = store.all(`SELECT model, provider, COUNT(*) calls, SUM(prompt_tokens) pt, SUM(completion_tokens) ct, SUM(cost_usd) cost, SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) failed, CAST(AVG(latency_ms) AS INTEGER) avg_ms FROM llm_usage WHERE ts>=? GROUP BY model, provider ORDER BY cost DESC`, [monthStart()]);
  const recent = store.all(`SELECT * FROM llm_usage ORDER BY ts DESC LIMIT 30`);
  const cap = Number(getConfig().ai?.monthlyBudgetUsd || 0);
  return { month: { cost: month.s, tokens: month.t, calls: month.n }, cap, byModel, recent };
}

/* ───────────── Jobs ───────────── */
const runners = new Map();
function registerJob(kind, fn) { runners.set(kind, fn); }
async function runJob(kind, params = {}, existingId) {
  const id = existingId || crypto.randomUUID();
  if (!existingId) store.run(`INSERT INTO jobs (id,kind,status,params,attempts,created_at) VALUES (?,?,?,?,0,?)`, [id, kind, 'queued', JSON.stringify(params), Date.now()]);
  store.run(`UPDATE jobs SET status='running', started_at=?, attempts=attempts+1, error=NULL WHERE id=?`, [Date.now(), id]);
  const fn = runners.get(kind);
  try {
    if (!fn) throw new Error('未知任务类型: ' + kind);
    const result = await fn(params);
    store.run(`UPDATE jobs SET status='done', finished_at=?, result=? WHERE id=?`, [Date.now(), JSON.stringify(result ?? null).slice(0, 2000), id]);
    return { ok: true, id, result };
  } catch (e) {
    store.run(`UPDATE jobs SET status='failed', finished_at=?, error=? WHERE id=?`, [Date.now(), String(e.message || e).slice(0, 500), id]);
    return { ok: false, id, error: e.message };
  }
}
async function retryJob(id) {
  const j = store.get(`SELECT * FROM jobs WHERE id=?`, [id]);
  if (!j) return { ok: false, error: 'not found' };
  let params = {}; try { params = JSON.parse(j.params || '{}'); } catch (_) {}
  return runJob(j.kind, params, id);
}
function listJobs(limit = 50) { return store.all(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?`, [limit]); }

/* ───────────── Memory review ───────────── */
function reviewQueue(status = 'pending') {
  return store.all(`SELECT * FROM memories WHERE status=? ORDER BY confidence DESC, updated_at DESC LIMIT 300`, [status]);
}
function reviewMemory(id, action, text) {
  const m = store.get(`SELECT * FROM memories WHERE id=?`, [id]);
  if (!m) return { ok: false, error: 'not found' };
  const now = Date.now();
  if (action === 'approve') store.run(`UPDATE memories SET status='active', text=?, confidence=MAX(confidence,0.9), updated_at=? WHERE id=?`, [text || m.text, now, id]);
  else if (action === 'reject') store.run(`UPDATE memories SET status='rejected', updated_at=? WHERE id=?`, [now, id]);
  else if (action === 'edit') store.run(`UPDATE memories SET text=?, updated_at=? WHERE id=?`, [text || m.text, now, id]);
  else return { ok: false, error: 'bad action' };
  audit('memory', action, id, { before: m.text, after: text || m.text });
  return { ok: true };
}
function memoryCounts() {
  const rows = store.all(`SELECT status, COUNT(*) c FROM memories GROUP BY status`);
  const o = { pending: 0, active: 0, rejected: 0 };
  for (const r of rows) o[r.status] = r.c;
  return o;
}

/* ───────────── Backup / restore (AES-256-GCM) ───────────── */
const BACKUP_TABLES = ['activities', 'screenshots', 'knowledge_cards', 'journals', 'topics', 'chat_messages', 'wiki_pages', 'memories', 'rollups', 'llm_usage', 'jobs', 'audit_log',
  // v2.3
  'documents', 'chunks', 'entities', 'entity_aliases', 'mentions', 'claims', 'links', 'merge_suggestions', 'page_revisions', 'kb_log', 'evidence', 'tombstones', 'memory_events', 'episodes', 'calendar_events', 'calendar_rules', 'daily_plans', 'kv'];
function dumpAll() {
  const data = {};
  for (const t of BACKUP_TABLES) { try { data[t] = store.all(`SELECT * FROM ${t}`); } catch (_) { data[t] = []; } }
  return data;
}
function counts(data) { const o = {}; for (const k of Object.keys(data)) o[k] = data[k].length; return o; }
function encrypt(plain, pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(pass, salt, 32, { N: 16384, r: 8, p: 1 });
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from('MTBK2'), salt, iv, c.getAuthTag(), enc]);
}
function decrypt(buf, pass) {
  if (buf.slice(0, 5).toString() !== 'MTBK2') throw new Error('不是知迹备份文件');
  const salt = buf.slice(5, 21), iv = buf.slice(21, 33), tag = buf.slice(33, 49), enc = buf.slice(49);
  const key = crypto.scryptSync(pass, salt, 32, { N: 16384, r: 8, p: 1 });
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(enc), d.final()]); }
  catch (_) { throw new Error('口令错误或备份已损坏（完整性校验失败）'); }
}
function backup(filePath, passphrase) {
  const data = dumpAll();
  const payload = Buffer.from(JSON.stringify({ format: 'mindtrace-backup', version: 2, created_at: Date.now(), counts: counts(data), data }), 'utf8');
  const zlib = require('zlib');
  const packed = zlib.gzipSync(payload);
  const out = passphrase ? encrypt(packed, passphrase) : Buffer.concat([Buffer.from('MTBK0'), packed]);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, out);
  audit('backup', passphrase ? 'encrypted' : 'plain', filePath, counts(data));
  return { ok: true, path: filePath, bytes: out.length, encrypted: !!passphrase, counts: counts(data) };
}
function readBackup(filePath, passphrase) {
  const buf = fs.readFileSync(filePath);
  const zlib = require('zlib');
  const head = buf.slice(0, 5).toString();
  let packed;
  if (head === 'MTBK2') { if (!passphrase) throw new Error('该备份已加密，请输入口令'); packed = decrypt(buf, passphrase); }
  else if (head === 'MTBK0') packed = buf.slice(5);
  else throw new Error('不是知迹备份文件');
  const obj = JSON.parse(zlib.gunzipSync(packed).toString('utf8'));
  if (obj.format !== 'mindtrace-backup') throw new Error('备份格式无效');
  return obj;
}
function inspectBackup(filePath, passphrase) {
  const obj = readBackup(filePath, passphrase);
  return { ok: true, created_at: obj.created_at, counts: obj.counts };
}
function restore(filePath, passphrase, { mode = 'replace' } = {}) {
  const obj = readBackup(filePath, passphrase); // throws before touching DB
  for (const t of BACKUP_TABLES) {
    const rows = obj.data[t] || [];
    if (mode === 'replace') { try { store.run(`DELETE FROM ${t}`); } catch (_) {} }
    for (const r of rows) {
      const cols = Object.keys(r);
      if (!cols.length) continue;
      try { store.run(`INSERT OR REPLACE INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map(c => r[c])); } catch (_) {}
    }
  }
  try {
    store.reindexFts();
  } catch (_) {}
  try { require('../core/schema').reindex(); } catch (e) { console.error('[restore] v23 reindex', e.message); }
  store.persist(true);
  audit('restore', mode, filePath, obj.counts);
  return { ok: true, counts: obj.counts };
}

/* ───────────── Analytics ───────────── */
function analytics(from, to) {
  const rows = store.all(`SELECT type, app_name, process_name, window_title, started_at, duration_ms, url FROM activities WHERE started_at>=? AND started_at<? ORDER BY started_at ASC`, [from, to]).filter(r => !require('../core/noise').classify(r).drop);
  const { friendlyAppName } = require('../main/appNames');
  const SESSION_GAP = 5 * 60000, DEEP_MIN = 25 * 60000;
  let switches = 0, prev = null;
  const sessions = [];
  let cur = null;
  const byApp = {}, byProject = {};
  let totalMs = 0, afkMs = 0, lastEnd = null;
  for (const r of rows) {
    const app = friendlyAppName(r.app_name, r.process_name, r.window_title);
    const dur = r.duration_ms || 0;
    totalMs += dur;
    byApp[app] = (byApp[app] || 0) + dur;
    const pm = /([A-Za-z0-9_\-\u4e00-\u9fff]{2,32})\s*[—–-]\s*/.exec(r.window_title || '');
    const project = (/VS Code|Cursor|IDE/i.test(app) && pm) ? pm[1] : null;
    if (project) byProject[project] = (byProject[project] || 0) + dur;
    if (prev && prev !== app) switches += 1;
    prev = app;
    const end = r.started_at + dur;
    if (lastEnd != null && r.started_at - lastEnd > SESSION_GAP) afkMs += r.started_at - lastEnd;
    lastEnd = Math.max(lastEnd || 0, end);
    if (cur && r.started_at - cur.end <= SESSION_GAP && (cur.apps.size < 3 || cur.apps.has(app))) {
      cur.end = Math.max(cur.end, end); cur.apps.add(app); cur.events += 1;
    } else {
      if (cur) sessions.push(cur);
      cur = { start: r.started_at, end, apps: new Set([app]), events: 1 };
    }
  }
  if (cur) sessions.push(cur);
  const focus = sessions.map(s => ({ start: s.start, end: s.end, minutes: Math.round((s.end - s.start) / 60000), apps: [...s.apps], events: s.events }))
    .filter(s => s.minutes >= 25).sort((a, b) => b.minutes - a.minutes);
  const deepMs = focus.reduce((n, s) => n + s.minutes * 60000, 0);
  const hours = Math.max(1, totalMs / 3600000);
  const switchesPerHour = switches / hours;
  const score = Math.max(0, Math.min(100, Math.round((deepMs / Math.max(1, totalMs)) * 70 + Math.max(0, 30 - switchesPerHour * 2))));
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, ms]) => ({ name, minutes: Math.round(ms / 60000) }));
  return {
    from, to, events: rows.length, totalMinutes: Math.round(totalMs / 60000),
    contextSwitches: switches, switchesPerHour: Math.round(switchesPerHour * 10) / 10,
    focusSessions: focus.slice(0, 10), deepWorkMinutes: Math.round(deepMs / 60000), deepWorkScore: score,
    afkMinutes: Math.round(afkMs / 60000),
    apps: top(byApp), projects: top(byProject)
  };
}
function weeklyReview(ts = Date.now()) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // Monday=0
  const from = d.getTime() - dow * 86400000;
  const to = from + 7 * 86400000;
  const a = analytics(from, to);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const s = analytics(from + i * 86400000, from + (i + 1) * 86400000);
    days.push({ day: new Date(from + i * 86400000).toISOString().slice(0, 10), minutes: s.totalMinutes, deep: s.deepWorkMinutes, score: s.deepWorkScore, switches: s.contextSwitches });
  }
  return { ...a, days };
}

/* ───────────── Diagnostics ───────────── */
function diagnostics({ appVersion, collectorStatus, logPath } = {}) {
  const cfg = JSON.parse(JSON.stringify(getConfig() || {}));
  if (cfg.ai) cfg.ai.apiKey = cfg.ai.apiKey ? '***' : '';
  if (cfg.api) cfg.api.token = cfg.api.token ? '***' : '';
  const tableCounts = {};
  for (const t of BACKUP_TABLES) { try { tableCounts[t] = store.get(`SELECT COUNT(*) c FROM ${t}`)?.c || 0; } catch (_) {} }
  let logTail = '';
  try { if (logPath && fs.existsSync(logPath)) logTail = fs.readFileSync(logPath, 'utf8').split('\n').slice(-200).join('\n'); } catch (_) {}
  return {
    generated_at: new Date().toISOString(), appVersion, platform: process.platform, arch: process.arch,
    versions: process.versions, memory: process.memoryUsage(), config: cfg, tableCounts,
    collectors: collectorStatus || null, usage: usageSummary().month, memories: memoryCounts(),
    jobs: store.all(`SELECT status, COUNT(*) c FROM jobs GROUP BY status`),
    recentAudit: listAudit({ limit: 50 }).map(a => ({ ts: a.ts, kind: a.kind, action: a.action })), logTail,
    fts: store.ftsStatus(), v23: (() => { try { return { kb: require('../kb').stats(), pipeline: require('../core/pipeline').lastRun() }; } catch (_) { return null; } })()
  };
}

module.exports = {
  init, audit, listAudit, evaluatePolicy, applyPolicy, wipeRange, assertEndpointAllowed,
  estimateTokens, recordUsage, usageSummary, assertBudget,
  registerJob, runJob, retryJob, listJobs,
  reviewQueue, reviewMemory, memoryCounts,
  backup, restore, inspectBackup, dumpAll,
  analytics, weeklyReview, diagnostics
};
