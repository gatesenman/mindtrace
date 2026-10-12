const crypto = require('crypto');
const store = require('../main/store');
const { pinyin } = require('pinyin-pro');
const uid = () => crypto.randomUUID();
const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
function kvGet(k, d = null) { const r = store.get(`SELECT v FROM kv WHERE k=?`, [k]); return r ? JSON.parse(r.v) : d; }
function kvSet(k, v) { store.run(`INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`, [k, JSON.stringify(v)]); }
/** 名称归一：去括号注释、空白、标点，小写 */
function normName(n) { return String(n || '').replace(/[（(][^）)]*[）)]/g, '').replace(/[\s·・.\-_'"“”「」《》]/g, '').toLowerCase(); }
/** 拼音键：中文转拼音，拉丁保留，去分隔 */
function pinyinKey(n) {
  const s = String(n || '').replace(/[（(][^）)]*[）)]/g, '');
  const p = /[\u4e00-\u9fa5]/.test(s) ? pinyin(s, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('') : s;
  return p.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const dayOf = (ts) => { const d = new Date(ts + 8 * 3600000); return d.toISOString().slice(0, 10); }; // Asia/Shanghai 日
const fmtTs = (ts) => new Date(ts + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
const estTokens = (s) => { s = String(s || ''); const c = (s.match(/[\u4e00-\u9fff]/g) || []).length; return Math.ceil(c * 0.7 + (s.length - c) / 4); };
function tombstoned(key) { return !!store.get(`SELECT 1 FROM tombstones WHERE key=?`, [key]); }
function tombstone(key, ownerType, pattern = null) { store.run(`INSERT OR IGNORE INTO tombstones (key,owner_type,pattern,created_at) VALUES (?,?,?,?)`, [key, ownerType, pattern, Date.now()]); }
function audit(kind, action, target, detail) { try { require('../pro').audit(kind, action, target, detail); } catch (_) {} }
module.exports = { uid, sha1, kvGet, kvSet, normName, pinyinKey, editDistance, dayOf, fmtTs, estTokens, tombstoned, tombstone, audit };
