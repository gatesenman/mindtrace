/**
 * Keep Wiki / memory citations consistent after activities are deleted.
 * Pure helpers plus an apply() that talks to an injected store.
 */
function parseBacklinks(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return [];
    try {
      const j = JSON.parse(t);
      if (Array.isArray(j)) return j.map(String).filter(Boolean);
    } catch (_) {}
    return t.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function scrubActivityIds(body, deadIds) {
  const dead = new Set((deadIds || []).map(String));
  if (!dead.size) return String(body || '');
  return String(body || '').replace(/(活动[：:]\s*)([^\n]+)/g, (m, label, rest) => {
    const kept = rest.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean).filter(id => !dead.has(id));
    return kept.length ? label + kept.join(', ') : '';
  });
}

function pruneWikiPage(page, aliveSet) {
  const links = parseBacklinks(page && page.backlinks);
  const kept = links.filter(id => aliveSet.has(String(id)));
  const dead = links.filter(id => !aliveSet.has(String(id)));
  let body = String((page && page.body_md) || '');
  if (dead.length) body = scrubActivityIds(body, dead).replace(/\n{3,}/g, '\n\n').trim();
  const hasNotes = !!(page && String(page.user_notes || '').trim());
  const orphan = links.length > 0 && kept.length === 0 && !hasNotes;
  const changed = dead.length > 0 || body !== String((page && page.body_md) || '').trim();
  return {
    backlinks: kept,
    body_md: body,
    dead,
    kept,
    orphan,
    changed: changed || orphan
  };
}

function applyWikiPrune(store, { aliveIds } = {}) {
  const n = { pruned: 0, deleted: 0, pages: 0 };
  if (!store || typeof store.all !== 'function') return n;
  let alive;
  if (aliveIds) alive = new Set([...aliveIds].map(String));
  else {
    try { alive = new Set((store.all(`SELECT id FROM activities`) || []).map(r => String(r.id))); }
    catch (_) { return n; }
  }
  let pages = [];
  try { pages = store.all(`SELECT id, backlinks, body_md, user_notes FROM wiki_pages`) || []; }
  catch (_) {
    try { pages = store.all(`SELECT id, backlinks, body_md FROM wiki_pages`) || []; } catch (e) { return n; }
  }
  n.pages = pages.length;
  for (const p of pages) {
    const r = pruneWikiPage(p, alive);
    if (!r.changed) continue;
    if (r.orphan) {
      try { if (store.run) store.run(`DELETE FROM page_revisions WHERE page_id=?`, [p.id]); } catch (_) {}
      try { store.run(`DELETE FROM wiki_pages WHERE id=?`, [p.id]); n.deleted++; } catch (_) {}
      continue;
    }
    try {
      store.run(`UPDATE wiki_pages SET backlinks=?, body_md=?, updated_at=? WHERE id=?`, [
        JSON.stringify(r.backlinks), r.body_md, Date.now(), p.id
      ]);
      n.pruned++;
    } catch (_) {}
  }
  return n;
}

function deleteDanglingEvidence(store) {
  if (!store || typeof store.run !== 'function') return 0;
  try {
    const rows = store.all
      ? (store.all(`SELECT id FROM evidence WHERE event_id IS NOT NULL AND TRIM(event_id) != '' AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.id = evidence.event_id)`) || [])
      : [];
    for (const e of rows) store.run(`DELETE FROM evidence WHERE id=?`, [e.id]);
    return rows.length;
  } catch (_) {
    return 0;
  }
}

module.exports = { parseBacklinks, scrubActivityIds, pruneWikiPage, applyWikiPrune, deleteDanglingEvidence };
