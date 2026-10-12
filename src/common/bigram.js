/**
 * 中文 bigram 预分词：SQLite unicode61 不切中文，入库与查询都把 CJK 串切成二元组。
 * "知迹发布计划 v2.3" → "知迹 迹发 发布 布计 计划 v2 3"
 */
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
const RUN = /([\u3400-\u9fff\uf900-\ufaff]+)|([A-Za-z0-9_]+)/g;

function cjkBigrams(s) {
  if (s.length === 1) return [s];
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** text → space separated tokens for FTS index */
function toIndexText(text) {
  const s = String(text || '').normalize('NFKC').toLowerCase();
  const out = [];
  let m; RUN.lastIndex = 0;
  while ((m = RUN.exec(s))) {
    if (m[1]) out.push(...cjkBigrams(m[1]));
    else out.push(m[2]);
  }
  return out.join(' ');
}

/** user query → FTS MATCH expression (AND of terms; single CJK char / short words use prefix) */
function toMatchQuery(q) {
  const s = String(q || '').normalize('NFKC').toLowerCase();
  const terms = [];
  let m; RUN.lastIndex = 0;
  while ((m = RUN.exec(s))) {
    if (m[1]) {
      if (m[1].length === 1) terms.push(`${m[1]}*`);
      else terms.push(...cjkBigrams(m[1]).map(t => `"${t}"`));
    } else terms.push(`${m[2].replace(/"/g, '')}*`);
  }
  return [...new Set(terms)].join(' ');
}

/** bigram set + Jaccard for fuzzy compare (dedupe / calendar merge) */
function bigramSet(text) { return new Set(toIndexText(text).split(' ').filter(Boolean)); }
function jaccard(a, b) {
  const A = a instanceof Set ? a : bigramSet(a), B = b instanceof Set ? b : bigramSet(b);
  if (!A.size && !B.size) return 1;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n / (A.size + B.size - n || 1);
}

module.exports = { toIndexText, toMatchQuery, bigramSet, jaccard, CJK };
