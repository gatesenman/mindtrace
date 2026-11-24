/**
 * 2.5 R6 · 知识闭环覆盖率（今日活动 → 对象 / 正文 → 摘要与检索可用）
 * 只扫描当日、上限 2000 条，避免给采集循环加压。
 */
const { digest, objectOf } = require('./docDigest');

function measure(rows) {
  const acts = rows || [];
  let withObject = 0, withSnippet = 0;
  for (const a of acts) {
    const o = objectOf(a);
    if (o && o.name) withObject++;
    const c = String(a.content || '').replace(/\s+/g, ' ').trim();
    if (c.length >= 12) withSnippet++;
  }
  const docs = digest(acts, { limit: 30 });
  const docsWithSnippet = docs.filter(d => d.snippet && d.snippet.length >= 12).length;
  return {
    activities: acts.length,
    withObject,
    withSnippet,
    docs: docs.length,
    docsWithSnippet,
    objectRate: acts.length ? withObject / acts.length : 0,
    snippetRate: acts.length ? withSnippet / acts.length : 0
  };
}

function todayRows(storeApi, now = Date.now()) {
  if (!storeApi || typeof storeApi.all !== 'function') return null;
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  try {
    return storeApi.all(
      `SELECT id,type,started_at,duration_ms,app_name,process_name,window_title,url,file_path,content,meta FROM activities WHERE started_at>=? AND started_at<=? ORDER BY started_at DESC LIMIT 2000`,
      [start.getTime(), now]
    ) || [];
  } catch (_) { return null; }
}

function lastReportDocs(storeApi) {
  if (!storeApi || typeof storeApi.get !== 'function') return null;
  try {
    const j = storeApi.get(`SELECT stats, content FROM journals WHERE period='daily' ORDER BY period_key DESC LIMIT 1`);
    if (!j) return null;
    let stats = j.stats; if (typeof stats === 'string') try { stats = JSON.parse(stats); } catch (_) { stats = {}; }
    const n = Array.isArray(stats?.docs) ? stats.docs.length : 0;
    return { docs: n, hasExcerpt: /(?:^|\n)\s*>\s+\S/.test(j.content || '') };
  } catch (_) { return null; }
}

function coverageStatus(cfg = {}, { store: st, now = Date.now(), rows } = {}) {
  let acts = rows;
  if (acts === undefined) {
    try { acts = todayRows(st || require('../main/store'), now); } catch (_) { acts = null; }
  }
  if (acts == null) {
    return { key: 'knowledge', name: '知识闭环', state: 'pending', label: '暂无统计', short0: '暂无统计', detail: '数据仓未打开时不计算覆盖率。', counts: null };
  }
  const m = measure(acts);
  const report = lastReportDocs(st);
  let state = 'ok', short;
  if (!m.activities) { state = 'pending'; short = '今日暂无活动'; }
  else if (!m.docs) { state = 'warn'; short = '未识别出文档'; }
  else if (!m.docsWithSnippet) { state = 'degraded'; short = `${m.docs} 个对象无正文`; }
  else short = `${m.docsWithSnippet} 段正文 · ${m.docs} 对象`;
  const detail = [
    `今日活动 ${m.activities} · 识别对象 ${m.withObject} · 含正文 ${m.withSnippet}`,
    `文档/页面 ${m.docs} · 其中有摘录 ${m.docsWithSnippet}（供摘要、检索、日报）`,
    report ? `最近日报文档 ${report.docs} 个${report.hasExcerpt ? ' · 含摘录' : ''}` : '尚无日报',
    '检索覆盖已入库的标题、正文、路径与 URL；出网闸门与隐私规则仍然生效。'
  ].join('\n');
  return { key: 'knowledge', name: '知识闭环', state, label: short, short0: short, detail, counts: m, report };
}

module.exports = { measure, todayRows, lastReportDocs, coverageStatus };
