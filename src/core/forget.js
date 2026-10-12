/** forgetSubject：跨 KB / MEMORY / CALENDAR 级联遗忘 + 墓碑 + 审计；以及时间段删除级联 */
const store = require('../main/store');
const U = require('../common/util');

function forgetSubject(target, { purgeRaw = false } = {}) {
  let ent = store.get(`SELECT * FROM entities WHERE id=?`, [target]);
  if (!ent) { const al = store.get(`SELECT entity_id FROM entity_aliases WHERE alias_norm=?`, [U.normName(target)]); if (al) ent = store.get(`SELECT * FROM entities WHERE id=?`, [al.entity_id]); }
  const ids = ent ? [ent.id, ...store.all(`SELECT id FROM entities WHERE merged_into=?`, [ent.id]).map(r => r.id)] : [];
  const terms = new Set([String(target)]);
  if (ent) { terms.add(ent.name); for (const id of ids) for (const a of store.all(`SELECT alias FROM entity_aliases WHERE entity_id=?`, [id])) terms.add(a.alias.replace(/[（(][^）)]*[）)]/g, '')); }
  const T = [...terms].filter(t => t && t.length >= 2 && !/^[0-9a-f-]{36}$/.test(t));
  const n = { entities: 0, claims: 0, pages: 0, memories: 0, calendar: 0, chunks: 0, activities: 0 };
  const likeAny = (col) => T.length ? '(' + T.map(() => `${col} LIKE ?`).join(' OR ') + ')' : '0';
  const likeP = T.map(t => '%' + t + '%');
  store.transaction(() => {
    for (const id of ids) {
      const claims = store.all(`SELECT id FROM claims WHERE entity_id=?`, [id]).map(r => r.id);
      for (const c of claims) store.run(`DELETE FROM evidence WHERE owner_type='claim' AND owner_id=?`, [c]);
      n.claims += claims.length;
      store.run(`DELETE FROM claims WHERE entity_id=?`, [id]);
      store.run(`DELETE FROM mentions WHERE entity_id=?`, [id]);
      store.run(`DELETE FROM links WHERE src=? OR dst=?`, [id, id]);
      store.run(`DELETE FROM merge_suggestions WHERE a=? OR b=?`, [id, id]);
      for (const p of store.all(`SELECT id FROM wiki_pages WHERE entity_id=?`, [id])) { store.run(`DELETE FROM page_revisions WHERE page_id=?`, [p.id]); store.run(`DELETE FROM wiki_pages WHERE id=?`, [p.id]); n.pages++; }
      for (const a of store.all(`SELECT alias_norm FROM entity_aliases WHERE entity_id=?`, [id])) U.tombstone('entity:' + a.alias_norm, 'entity', a.alias_norm);
      store.run(`DELETE FROM entity_aliases WHERE entity_id=?`, [id]);
      store.run(`DELETE FROM entities WHERE id=?`, [id]); n.entities++;
    }
    for (const t of T) U.tombstone('entity:' + U.normName(t), 'entity', t);
    if (T.length) {
      for (const m of store.all(`SELECT id, dedupe_key FROM memories WHERE ${likeAny('text')} ${ids.length ? `OR subject_entity_id IN (${ids.map(() => '?').join(',')})` : ''}`, [...likeP, ...ids])) {
        U.tombstone('mem:' + m.dedupe_key, 'memory', null); store.run(`DELETE FROM evidence WHERE owner_type='memory' AND owner_id=?`, [m.id]); store.run(`DELETE FROM memory_events WHERE memory_id=?`, [m.id]); store.run(`DELETE FROM memories WHERE id=?`, [m.id]); n.memories++;
      }
      for (const e of store.all(`SELECT id, dedupe_key FROM calendar_events WHERE ${likeAny('title')} OR ${likeAny('participants')} OR ${likeAny('notes')}`, [...likeP, ...likeP, ...likeP])) {
        U.tombstone('cal:' + e.dedupe_key, 'calendar', null); store.run(`DELETE FROM evidence WHERE owner_type='calendar' AND owner_id=?`, [e.id]); store.run(`DELETE FROM calendar_events WHERE id=?`, [e.id]); n.calendar++;
      }
      for (const c of store.all(`SELECT id, rowid FROM chunks WHERE ${likeAny('text')}`, likeP)) {
        try { store.run(`DELETE FROM chunks_fts WHERE rowid=?`, [c.rowid]); } catch (_) {}
        store.run(`DELETE FROM evidence WHERE chunk_id=?`, [c.id]); store.run(`DELETE FROM chunks WHERE id=?`, [c.id]); n.chunks++;
      }
      store.run(`DELETE FROM episodes WHERE ${likeAny('title')} OR ${likeAny('summary')}`, [...likeP, ...likeP]);
      if (purgeRaw) {
        const w = `${likeAny('window_title')} OR ${likeAny('content')}`;
        n.activities = store.get(`SELECT COUNT(*) c FROM activities WHERE ${w}`, [...likeP, ...likeP]).c;
        store.deleteActivitiesFts(w, [...likeP, ...likeP]);
        store.run(`DELETE FROM activities WHERE ${w}`, [...likeP, ...likeP]);
      }
    }
  });
  require('../kb').log(`forget | ${ent?.name || target} | ${JSON.stringify(n)}`);
  U.audit('privacy', 'forget-subject', ent?.name || target, n);
  return { subject: ent?.name || target, terms: T, ...n };
}

/** 时间段删除后的级联：证据全部落在被删范围内的 AI 产物一并删除 */
function cascadeRange(from, to) {
  const n = { evidence: 0, memories: 0, claims: 0, calendar: 0, chunks: 0 };
  store.transaction(() => {
    n.evidence = store.get(`SELECT COUNT(*) c FROM evidence WHERE ts>=? AND ts<?`, [from, to]).c;
    store.run(`DELETE FROM evidence WHERE ts>=? AND ts<?`, [from, to]);
    for (const c of store.all(`SELECT id, rowid FROM chunks WHERE observed_at>=? AND observed_at<?`, [from, to])) { try { store.run(`DELETE FROM chunks_fts WHERE rowid=?`, [c.rowid]); } catch (_) {} store.run(`DELETE FROM mentions WHERE chunk_id=?`, [c.id]); store.run(`DELETE FROM chunks WHERE id=?`, [c.id]); n.chunks++; }
    for (const [tbl, ot, extra] of [['memories', 'memory', "AND IFNULL(source,'auto')='auto' AND IFNULL(locked,0)=0"], ['claims', 'claim', 'AND IFNULL(locked,0)=0'], ['calendar_events', 'calendar', "AND created_by='ai'"]]) {
      const orphans = store.all(`SELECT id FROM ${tbl} t WHERE NOT EXISTS (SELECT 1 FROM evidence e WHERE e.owner_type=? AND e.owner_id=t.id) ${extra}`, [ot]);
      for (const o of orphans) store.run(`DELETE FROM ${tbl} WHERE id=?`, [o.id]);
      n[tbl === 'calendar_events' ? 'calendar' : tbl] = orphans.length;
    }
    store.run(`DELETE FROM episodes WHERE start_at>=? AND start_at<?`, [from, to]);
  });
  return n;
}
module.exports = { forgetSubject, cascadeRange };
