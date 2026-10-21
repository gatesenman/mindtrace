// OCR 文本规整与文本级去重（借鉴 Screenpipe #2285：像素去重之外再做文本去重）
const CJK = '[\\u3400-\\u9fff\\uf900-\\ufaff\\u3000-\\u303f\\uff00-\\uffef]';
const reCjkSpace = new RegExp(`(${CJK})\\s+(?=${CJK})`, 'g');
/** Windows OCR 会在每个汉字之间插空格：「会 议 纪 要」→「会议纪要」 */
function normalizeLine(s) { return String(s || '').replace(reCjkSpace, '$1').replace(/\s{2,}/g, ' ').trim(); }
function normalize(lines) {
  const out = []; const seen = new Set();
  for (const l of (Array.isArray(lines) ? lines : String(lines || '').split(/\n/))) {
    const n = normalizeLine(l); if (n.length < 2 || /^[\W_]+$/.test(n) || seen.has(n)) continue; seen.add(n); out.push(n);
  }
  return out;
}
function shingles(t) { const s = String(t || '').replace(/\s+/g, ''); const set = new Set(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set; }
function similarity(a, b) { const A = shingles(a), B = shingles(b); if (!A.size && !B.size) return 1; let inter = 0; for (const x of A) if (B.has(x)) inter++; return inter / (A.size + B.size - inter || 1); }
/** 只保留新出现的行（增量），用于「同一窗口持续阅读」时不重复入库 */
function delta(prevLines, lines) { const p = new Set(prevLines || []); return lines.filter(l => !p.has(l)); }
module.exports = { normalize, normalizeLine, similarity, delta };
