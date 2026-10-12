/** 统一「待处理」中心：记忆待审核 / 日程建议与改期 / 实体合并建议 / 事实冲突 */
const store = require('../main/store');
const memory = require('../memory');
const calendar = require('../calendar');
const kb = require('../kb');
const evidence = require('../common/evidence');
const U = require('../common/util');

function list() {
  const items = [];
  for (const m of store.all(`SELECT * FROM memories WHERE status='pending' ORDER BY updated_at DESC LIMIT 200`)) {
    const old = m.conflict_with ? store.get(`SELECT text FROM memories WHERE id=?`, [m.conflict_with]) : null;
    items.push({ id: m.id, type: 'memory', title: m.text, subtitle: `${memory.TYPE_LABEL[m.kind] || m.kind} · 置信 ${(m.confidence || 0).toFixed(2)}${m.source === 'mcp' ? ' · 来自 MCP' : ''}`, conflict: old?.text || null, ts: m.updated_at, confidence: m.confidence, evidence: evidence.list('memory', m.id).slice(0, 2) });
  }
  for (const e of calendar.proposals()) {
    items.push({ id: e.id, type: e.change_of ? 'calendar_change' : 'calendar', title: e.title, subtitle: `${e.kind_label}${e.start_at ? ' · ' + U.fmtTs(e.start_at) : ''}${e.original ? ' · 原定 ' + U.fmtTs(e.original.start_at) : ''}`, ts: e.created_at, confidence: e.confidence, evidence: e.evidence });
  }
  for (const s of store.all(`SELECT s.*, a.name an, b.name bn, a.type at FROM merge_suggestions s JOIN entities a ON a.id=s.a JOIN entities b ON b.id=s.b WHERE s.status='open' ORDER BY s.created_at DESC LIMIT 100`)) {
    items.push({ id: s.id, type: 'merge', title: `合并「${s.bn}」到「${s.an}」？`, subtitle: s.reason, ts: s.created_at, confidence: s.score, a: s.a, b: s.b });
  }
  const seen = new Set();
  for (const c of store.all(`SELECT c.*, e.name en FROM claims c JOIN entities e ON e.id=c.entity_id WHERE c.status='conflict' ORDER BY c.last_seen DESC`)) {
    const k = c.entity_id + c.predicate; if (seen.has(k)) continue; seen.add(k);
    const opts = store.all(`SELECT id, object, confidence, last_seen FROM claims WHERE entity_id=? AND predicate=? AND status='conflict' ORDER BY last_seen DESC`, [c.entity_id, c.predicate]);
    items.push({ id: c.id, type: 'conflict', title: `${c.en} · ${c.predicate} 存在冲突`, subtitle: opts.map(o => o.object).join(' vs '), options: opts, ts: c.last_seen });
  }
  return items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
}
function counts() {
  const g = (s) => store.get(s)?.c || 0;
  const r = { memory: g(`SELECT COUNT(*) c FROM memories WHERE status='pending'`), calendar: g(`SELECT COUNT(*) c FROM calendar_events WHERE status='proposed'`), merge: g(`SELECT COUNT(*) c FROM merge_suggestions WHERE status='open'`), conflict: g(`SELECT COUNT(DISTINCT entity_id||predicate) c FROM claims WHERE status='conflict'`) };
  r.total = r.memory + r.calendar + r.merge + r.conflict;
  return r;
}
/** action: accept | reject | never | keep(claim) */
function act(type, id, action, extra = {}) {
  switch (type) {
    case 'memory': return action === 'accept' ? memory.approve(id) : memory.reject(id, { never: action === 'never' });
    case 'calendar': case 'calendar_change': return action === 'accept' ? !!calendar.accept(id) : calendar.dismiss(id);
    case 'merge': {
      const s = store.get(`SELECT * FROM merge_suggestions WHERE id=?`, [id]); if (!s) return false;
      if (action === 'accept') return !!kb.mergeEntities(s.a, s.b);
      store.run(`UPDATE merge_suggestions SET status='rejected' WHERE id=?`, [id]); return true;
    }
    case 'conflict': return kb.resolveConflict(extra.keep || id, action !== 'reject');
  }
  return false;
}
module.exports = { list, counts, act };
