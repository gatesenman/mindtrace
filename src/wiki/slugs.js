/**
 * Canonical Wiki slugs + migration of pre-2.5 unprefixed slugs
 * (e.g. kind=person slug="张三" → "person-张三") so upsert does not create a duplicate page.
 */
function prefixFor(kind, hint) {
  if (kind === 'project') return 'proj';
  if (kind === 'document') return 'doc';
  if (kind === 'person') return 'person';
  if (kind === 'topic') return hint || 'page';
  if (kind === 'time') return null;
  return 'page';
}

function slugify(prefix, name) {
  const s = String(name || '').replace(/[\\/:*?"<>|#\s]+/g, '-').replace(/\.+$/, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  if (!prefix) return s || 'untitled';
  return `${prefix}-${s || 'untitled'}`;
}

function canonicalSlug(kind, title, proposed, hint) {
  if (kind === 'time') return proposed || title || 'untitled';
  const prefix = prefixFor(kind, hint);
  const p = String(proposed || '').trim();
  if (p && prefix && (p === prefix + '-' || p.startsWith(prefix + '-'))) return p;
  if (p && !prefix) return p;
  return slugify(prefix, title || proposed);
}

function aliasSlugs(kind, title, slug, hint) {
  const out = [];
  const seen = new Set();
  const add = (s) => {
    const v = String(s || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  const prefix = prefixFor(kind, hint);
  add(slug);
  add(title);
  add(canonicalSlug(kind, title, slug, hint));
  add(slugify(prefix, title || slug));
  if (prefix && slug && String(slug).startsWith(prefix + '-')) add(String(slug).slice(prefix.length + 1));
  if (prefix && title) add(String(title));
  return out;
}

function findExisting(store, kind, title, slug, hint) {
  const all = findAllExisting(store, kind, title, slug, hint);
  if (!all.length) return null;
  const canon = canonicalSlug(kind, title, slug, hint);
  return all.find(r => r.slug === canon) || all[0];
}

function findAllExisting(store, kind, title, slug, hint) {
  const out = [];
  const seen = new Set();
  if (!store || typeof store.get !== 'function') return out;
  const add = (row) => {
    if (row && row.id && !seen.has(row.id)) { seen.add(row.id); out.push(row); }
  };
  for (const s of aliasSlugs(kind, title, slug, hint)) {
    add(store.get(`SELECT * FROM wiki_pages WHERE kind=? AND slug=?`, [kind, s]));
  }
  if (title) add(store.get(`SELECT * FROM wiki_pages WHERE kind=? AND title=?`, [kind, title]));
  return out;
}

function mergeBody(existing, next) {
  const a = String((existing && existing.body_md) || existing || '');
  const b = String(next || '');
  if (!a) return b;
  if (!b || a.includes(b.trim())) return a;
  const mark = b.split('\n').find(l => l.startsWith('> ') || l.startsWith('关联会话') || l.startsWith('活动：') || l.startsWith('活动:'));
  if (mark && a.includes(mark.slice(0, Math.min(24, mark.length)))) return a;
  return a.trim() + '\n\n## 证据\n\n' + b.trim();
}

/**
 * Look up an existing page under canonical or legacy slugs, migrate slug if needed,
 * and return { id, slug, body_md, created } for the caller to upsert.
 */
function resolveForUpsert(store, page) {
  const kind = page.kind;
  const title = page.title;
  const hint = page.slugHint || (page.source && page.source.kind === 'chat' ? 'chat' : undefined);
  const canon = canonicalSlug(kind, title, page.slug, hint);
  const all = findAllExisting(store, kind, title, page.slug || canon, hint);
  if (!all.length) return { id: page.id || null, slug: canon, body_md: page.body_md, created: true, migrated: false };
  const existing = all.find(r => r.slug === canon) || all[0];
  let body = existing.body_md;
  for (const row of all) body = mergeBody({ body_md: body }, row.body_md);
  body = mergeBody({ body_md: body }, page.body_md);
  const others = all.filter(r => r.id !== existing.id);
  if (others.length && store.run) {
    for (const row of others) {
      try { store.run(`DELETE FROM page_revisions WHERE page_id=?`, [row.id]); } catch (_) {}
      try { store.run(`DELETE FROM wiki_pages WHERE id=?`, [row.id]); } catch (_) {}
    }
  }
  let migrated = others.length > 0 || existing.slug !== canon;
  if (existing.slug !== canon && store.run) {
    try {
      store.run(`UPDATE wiki_pages SET slug=? WHERE id=?`, [canon, existing.id]);
    } catch (_) { migrated = others.length > 0; }
  }
  return {
    id: existing.id, slug: (existing.slug === canon || migrated) ? canon : existing.slug,
    body_md: body, created: false, migrated, mergedFrom: others.map(r => r.id)
  };
}

module.exports = { prefixFor, slugify, canonicalSlug, aliasSlugs, findExisting, findAllExisting, mergeBody, resolveForUpsert };
