/**
 * 2.4 R5 · 本地语义增强（无向量模型依赖）
 * 借鉴：sqlite-vec + FTS 的 Reciprocal Rank Fusion（Alex Garcia / Simon Willison）
 *   https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/
 *   https://simonwillison.net/2024/Oct/4/hybrid-full-text-search-and-vector-search-with-sqlite/
 * 以及 Khoj 两段式：宽召回 → 精排。本轮用「同义词扩展 + 字 bigram 余弦」代替嵌入模型，
 * 零外网、零原生扩展；有 FTS 时与其做 RRF 融合。
 */
const SYNONYMS = {
  '本地优先': ['local-first', '仅本地', '不上云', '本地存储', '离线'],
  '隐私': ['privacy', '保密', '敏感', '脱敏'],
  '知识库': ['wiki', 'kb', '知识页', '实体'],
  '日历': ['日程', '待办', '会议', '安排'],
  '记忆': ['偏好', '习惯', 'profile'],
  '截图': ['screenshot', 'ocr', '屏幕'],
  '时间线': ['timeline', '轨迹', '活动流'],
  '安装包': ['setup', 'installer', 'exe', 'nsis'],
  '定价': ['价格', '费用', 'price', 'cost', '资费'],
  '文档': ['docs', '手册', 'api 文档', '说明书'],
  '承诺': ['答应', '我来', '负责', '交付'],
  '日报': ['日总结', '今日回顾', 'daily'],
  '周报': ['周总结', '本周回顾', 'weekly', 'standup'],
  '微信': ['wechat', '企微', '企业微信'],
  '飞书': ['lark', 'feishu'],
  '浏览器': ['chrome', 'edge', 'firefox', '网页'],
  '代码': ['ide', 'vscode', 'cursor', 'commit', '仓库'],
  '下载': ['download', '安装包', '附件']
};

function expandTerms(q) {
  const raw = String(q || '').trim();
  const out = new Set();
  if (!raw) return [];
  out.add(raw);
  for (const [k, vs] of Object.entries(SYNONYMS)) {
    if (raw.includes(k) || vs.some(v => raw.toLowerCase().includes(String(v).toLowerCase()))) {
      out.add(k); vs.forEach(v => out.add(v));
    }
  }
  // 拆词
  raw.split(/[\s,，、]+/).filter(Boolean).forEach(w => out.add(w));
  return [...out].filter(Boolean);
}

function bigrams(text) {
  const s = String(text || '').toLowerCase().replace(/\s+/g, '');
  const m = new Map();
  if (s.length < 2) { if (s) m.set(s, 1); return m; }
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) || 0) + 1);
  }
  return m;
}

function cosine(a, b) {
  if (!a.size || !b.size) return 0;
  let dot = 0, na = 0, nb = 0;
  for (const [, v] of a) na += v * v;
  for (const [, v] of b) nb += v * v;
  const smaller = a.size < b.size ? a : b;
  const larger = a.size < b.size ? b : a;
  for (const [k, v] of smaller) if (larger.has(k)) dot += v * larger.get(k);
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

/** RRF: score = Σ 1/(k + rank) */
function rrf(rankLists, { k = 60, weights } = {}) {
  const scores = new Map();
  rankLists.forEach((list, li) => {
    const w = (weights && weights[li]) || 1;
    list.forEach((id, i) => {
      const s = w * (1 / (k + i + 1));
      scores.set(id, (scores.get(id) || 0) + s);
    });
  });
  return [...scores.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * 对候选行做语义打分。row 需有 id, title, content, url, path, app
 * 返回按语义分排序的 id 列表 + 分数字典
 */
function semanticRank(rows, query, { limit = 40 } = {}) {
  const terms = expandTerms(query);
  const qVec = bigrams(terms.join(''));
  const scored = [];
  for (const r of rows) {
    const hay = [r.title, r.content, r.url, r.path, r.app].filter(Boolean).join(' ');
    let s = cosine(qVec, bigrams(hay));
    // 同义词字面命中加分
    const low = hay.toLowerCase();
    for (const t of terms) if (t.length > 1 && low.includes(String(t).toLowerCase())) s += 0.08;
    if (s > 0.02) scored.push({ id: r.id, score: s, row: r });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * 混合召回：FTS 结果 + 语义结果 → RRF
 * ftsRows: 已按 FTS 相关度排序；pool: 更大的候选池（可含时间窗扫描）
 */
function hybrid(ftsRows, pool, query, { limit = 20, k = 60 } = {}) {
  const sem = semanticRank(pool.length ? pool : ftsRows, query, { limit: 80 });
  const ftsIds = ftsRows.map(r => r.id);
  const semIds = sem.map(s => s.id);
  const fused = rrf([ftsIds, semIds], { k, weights: [1.0, 0.9] });
  const byId = new Map();
  for (const r of [...ftsRows, ...pool, ...sem.map(s => s.row)]) if (r && r.id) byId.set(r.id, r);
  const semScore = new Map(sem.map(s => [s.id, s.score]));
  return fused.slice(0, limit).map(([id, score], i) => ({
    id, rrf: score, rank: i + 1, semantic: semScore.get(id) || 0, row: byId.get(id)
  })).filter(x => x.row);
}

module.exports = { expandTerms, bigrams, cosine, rrf, semanticRank, hybrid, SYNONYMS };
