/** 统一检索服务：活动(FTS5) + 资料块 + 实体 + 记忆 + 日程 */
const store = require('../main/store');
const kb = require('../kb');
const memory = require('../memory');
function search(q, { limit = 20 } = {}) {
  q = String(q || '').trim(); if (!q) return { q, activities: [], chunks: [], entities: [], memories: [], calendar: [] };
  const t0 = Date.now();
  const activities = store.searchFts(q, limit);
  const chunks = kb.searchChunks(q, limit).map(c => ({ ...c, text: c.text.slice(0, 200) }));
  const entities = store.all(`SELECT DISTINCT e.id, e.name, e.type, e.status, w.id page_id FROM entity_aliases a JOIN entities e ON e.id=a.entity_id LEFT JOIN wiki_pages w ON w.entity_id=e.id WHERE (a.alias LIKE ? OR e.pinyin LIKE ?) AND e.merged_into IS NULL LIMIT ?`, ['%' + q + '%', '%' + q.toLowerCase().replace(/\s/g, '') + '%', limit]);
  const mids = memory.searchIds(q, limit);
  const memories = mids.length ? store.all(`SELECT id,kind,text,status,confidence FROM memories WHERE id IN (${mids.map(() => '?').join(',')}) AND status IN ('active','pending')`, mids) : [];
  const calendar = store.all(`SELECT id,kind,title,start_at,status FROM calendar_events WHERE (title LIKE ? OR notes LIKE ?) AND status NOT IN ('dismissed','applied') ORDER BY start_at DESC LIMIT ?`, ['%' + q + '%', '%' + q + '%', limit]);
  return { q, ms: Date.now() - t0, activities, chunks, entities, memories, calendar };
}
module.exports = { search };
