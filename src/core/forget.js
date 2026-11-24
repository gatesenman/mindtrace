/** forgetSubject：跨 KB / MEMORY / CALENDAR 级联遗忘 + 墓碑 + 审计；以及时间段删除级联 */
const U = require('../common/util');
function defaultStore() { return require('../main/store'); }

function forgetSubject(target, { purgeRaw = false, store: st } = {}) {
  const store = st || defaultStore();
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
      forgetWikiByTerms(store, T, n);
    }
  });
  require('../kb').log(`forget | ${ent?.name || target} | ${JSON.stringify(n)}`);
  U.audit('privacy', 'forget-subject', ent?.name || target, n);
  return { subject: ent?.name || target, terms: T, ...n };
}

/** 时间段删除后的级联：范围内证据、悬空 event_id 引用、无证据产物、Wiki 回链一并清理 */
function cascadeRange(from, to, opts = {}) {
  const st = opts.store || defaultStore();
  const citations = require('../content/citations');
  const n = { evidence: 0, danglingEvidence: 0, memories: 0, claims: 0, calendar: 0, chunks: 0, wikiPruned: 0, wikiDeleted: 0 };
  const body = () => {
    const evN = st.get(`SELECT COUNT(*) c FROM evidence WHERE ts>=? AND ts<?`, [from, to]);
    n.evidence = evN && evN.c || 0;
    st.run(`DELETE FROM evidence WHERE ts>=? AND ts<?`, [from, to]);
    n.danglingEvidence = citations.deleteDanglingEvidence(st);
    try {
      for (const c of st.all(`SELECT id, rowid FROM chunks WHERE observed_at>=? AND observed_at<?`, [from, to]) || []) {
        try { st.run(`DELETE FROM chunks_fts WHERE rowid=?`, [c.rowid]); } catch (_) {}
        try { st.run(`DELETE FROM mentions WHERE chunk_id=?`, [c.id]); } catch (_) {}
        st.run(`DELETE FROM chunks WHERE id=?`, [c.id]); n.chunks++;
      }
    } catch (_) {}
    for (const [tbl, ot, extra] of [['memories', 'memory', "AND IFNULL(source,'auto')='auto' AND IFNULL(locked,0)=0"], ['claims', 'claim', 'AND IFNULL(locked,0)=0'], ['calendar_events', 'calendar', "AND created_by='ai'"]]) {
      try {
        const orphans = st.all(`SELECT id FROM ${tbl} t WHERE NOT EXISTS (SELECT 1 FROM evidence e WHERE e.owner_type=? AND e.owner_id=t.id) ${extra}`, [ot]) || [];
        for (const o of orphans) st.run(`DELETE FROM ${tbl} WHERE id=?`, [o.id]);
        n[tbl === 'calendar_events' ? 'calendar' : tbl] = orphans.length;
      } catch (_) {}
    }
    try { st.run(`DELETE FROM episodes WHERE start_at>=? AND start_at<?`, [from, to]); } catch (_) {}
    const w = citations.applyWikiPrune(st);
    n.wikiPruned = w.pruned; n.wikiDeleted = w.deleted;
  };
  if (typeof st.transaction === 'function' && !opts.alreadyInTransaction) {
    st.transaction(body);
  } else {
    body();
  }
  return n;
}

/** 按标题 / slug 删除未挂 entity_id 的文档/人物 Wiki 页（2.5 落地页常常没有 entity_id） */
function forgetWikiByTerms(st, terms, n) {
  const T = (terms || []).filter(t => t && String(t).length >= 2);
  if (!T.length || !st.all) return;
  const like = T.map(() => `title LIKE ? OR slug LIKE ?`).join(' OR ');
  const params = T.flatMap(t => ['%' + t + '%', '%' + t + '%']);
  let pages = [];
  try { pages = st.all(`SELECT id, kind, slug, title, entity_id FROM wiki_pages WHERE ${like}`, params) || []; } catch (_) { return; }
  for (const p of pages) {
    if (p.kind === 'time') continue; // 时间卷只在 cascade 里剪回链，避免误删整天
    try { st.run(`DELETE FROM page_revisions WHERE page_id=?`, [p.id]); } catch (_) {}
    try { st.run(`DELETE FROM wiki_pages WHERE id=?`, [p.id]); n.pages++; } catch (_) {}
  }
}

/**
 * 按时间段删除活动并级联派生数据，放在同一事务里，避免 wipe 成功、cascade 中途失败留下残缺引用。
 */
function wipeRangeCascade(from, to, opts = {}) {
  const st = opts.store || defaultStore();
  const n = { activities: 0, screenshots: 0, ok: true, error: null };
  const body = () => {
    try {
      n.activities = (st.get(`SELECT COUNT(*) c FROM activities WHERE started_at>=? AND started_at<?`, [from, to]) || {}).c || 0;
    } catch (_) { n.activities = 0; }
    try {
      n.screenshots = (st.get(`SELECT COUNT(*) c FROM screenshots WHERE taken_at>=? AND taken_at<?`, [from, to]) || {}).c || 0;
    } catch (_) { n.screenshots = 0; }
    try { if (typeof st.deleteActivitiesFts === 'function') st.deleteActivitiesFts('started_at>=? AND started_at<?', [from, to]); } catch (e) { n.ftsError = e.message; }
    st.run(`DELETE FROM activities WHERE started_at>=? AND started_at<?`, [from, to]);
    try { st.run(`DELETE FROM screenshots WHERE taken_at>=? AND taken_at<?`, [from, to]); } catch (_) {}
    const c = cascadeRange(from, to, { store: st, alreadyInTransaction: true });
    Object.assign(n, { derived: c, ...c });
  };
  try {
    if (typeof st.transaction === 'function') st.transaction(body);
    else body();
    try { if (typeof st.persist === 'function') st.persist(true); } catch (_) {}
  } catch (e) {
    n.ok = false;
    n.error = e && e.message ? e.message : String(e);
  }
  return n;
}

module.exports = { forgetSubject, cascadeRange, wipeRangeCascade, forgetWikiByTerms };
