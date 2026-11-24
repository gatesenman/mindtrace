require('./stub-electron');
// 2.5 加固 R1 · 证据链引用与删除一致性
const assert = require('assert');
const C = require('../src/content/citations');
const forget = require('../src/core/forget');

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + (e.stack || e.message)); } };

t('解析 backlinks：JSON 数组、逗号分隔、空值', () => {
  assert.deepStrictEqual(C.parseBacklinks('["w1","w2"]'), ['w1', 'w2']);
  assert.deepStrictEqual(C.parseBacklinks(['a', 'b']), ['a', 'b']);
  assert.deepStrictEqual(C.parseBacklinks('w1, w2，w3'), ['w1', 'w2', 'w3']);
  assert.deepStrictEqual(C.parseBacklinks(''), []);
  assert.deepStrictEqual(C.parseBacklinks(null), []);
});

t('剪掉正文里已删除的活动 id，保留仍存在的', () => {
  const body = '# 预算\n\n关联会话：09:00 Word\n活动：w1, w2, w3\n';
  const out = C.scrubActivityIds(body, ['w2']);
  assert.match(out, /活动：w1, w3/);
  assert.doesNotMatch(out, /w2/);
});

t('全部回链失效且无用户笔记 → 视为孤立页，应删除', () => {
  const r = C.pruneWikiPage({
    backlinks: JSON.stringify(['w1', 'w2']),
    body_md: '活动：w1, w2\n> 摘录',
    user_notes: ''
  }, new Set());
  assert.strictEqual(r.orphan, true);
  assert.deepStrictEqual(r.kept, []);
  assert.doesNotMatch(r.body_md, /活动：w1/);
});

t('部分回链失效：更新 backlinks，保留页面', () => {
  const r = C.pruneWikiPage({
    backlinks: ['w1', 'dead'],
    body_md: '活动：w1, dead',
    user_notes: ''
  }, new Set(['w1']));
  assert.strictEqual(r.orphan, false);
  assert.deepStrictEqual(r.backlinks, ['w1']);
  assert.match(r.body_md, /活动：w1/);
  assert.doesNotMatch(r.body_md, /dead/);
});

t('有用户笔记的页即使回链全失效也不当孤立删除', () => {
  const r = C.pruneWikiPage({
    backlinks: ['gone'],
    body_md: '活动：gone',
    user_notes: '我自己写的备注'
  }, new Set());
  assert.strictEqual(r.orphan, false);
});

function memStore(init) {
  const tables = Object.assign({
    activities: [], evidence: [], wiki_pages: [], memories: [], claims: [],
    calendar_events: [], chunks: [], episodes: [], page_revisions: [], screenshots: []
  }, init);
  const st = {
    tables,
    all(sql, params) {
      const src = sql;
      const pick = (name) => tables[name] || [];
      if (/FROM activities\b/i.test(src) && /SELECT id FROM activities/i.test(src) && !/WHERE/i.test(src)) return pick('activities').map(r => ({ id: r.id }));
      if (/FROM wiki_pages/i.test(src) && /SELECT id, backlinks/.test(src)) return pick('wiki_pages');
      if (/FROM wiki_pages/i.test(src) && /SELECT id, kind, slug, title/.test(src)) {
        const terms = (params || []).map(p => String(p).replace(/%/g, ''));
        return pick('wiki_pages').filter(p => terms.some(t => String(p.title || '').includes(t) || String(p.slug || '').includes(t)));
      }
      if (/FROM evidence WHERE event_id/i.test(src)) {
        const ids = new Set(pick('activities').map(a => a.id));
        return pick('evidence').filter(e => e.event_id && !ids.has(e.event_id)).map(e => ({ id: e.id }));
      }
      if (/FROM evidence WHERE ts>=/i.test(src)) return [];
      if (/FROM chunks WHERE observed_at/i.test(src)) return pick('chunks');
      if (/FROM memories t WHERE NOT EXISTS/i.test(src)) {
        const ev = new Set(pick('evidence').filter(e => e.owner_type === 'memory').map(e => e.owner_id));
        return pick('memories').filter(m => !ev.has(m.id) && (m.source || 'auto') === 'auto' && !m.locked).map(m => ({ id: m.id }));
      }
      if (/FROM claims t WHERE NOT EXISTS/i.test(src)) return [];
      if (/FROM calendar_events t WHERE NOT EXISTS/i.test(src)) return [];
      if (/COUNT\(\*\)/.test(src) && /activities/.test(src)) {
        const [from, to] = params || [];
        const c = pick('activities').filter(a => a.started_at >= from && a.started_at < to).length;
        return [{ c }];
      }
      return [];
    },
    get(sql, params) {
      const rows = st.all(sql, params);
      if (/COUNT\(\*\)/.test(sql)) return { c: (rows[0] && (rows[0].c != null) ? rows[0].c : rows.length) || 0 };
      return rows[0] || { c: 0 };
    },
    run(sql, params) {
      if (/DELETE FROM evidence WHERE id=\?/.test(sql)) {
        tables.evidence = tables.evidence.filter(e => e.id !== params[0]);
        return;
      }
      if (/DELETE FROM evidence WHERE ts>=/.test(sql)) {
        const [from, to] = params;
        tables.evidence = tables.evidence.filter(e => !(e.ts >= from && e.ts < to));
        return;
      }
      if (/DELETE FROM wiki_pages WHERE id=\?/.test(sql)) {
        tables.wiki_pages = tables.wiki_pages.filter(p => p.id !== params[0]);
        return;
      }
      if (/UPDATE wiki_pages SET backlinks/.test(sql)) {
        const [bl, body, , id] = params;
        const p = tables.wiki_pages.find(x => x.id === id);
        if (p) { p.backlinks = bl; p.body_md = body; }
        return;
      }
      if (/DELETE FROM activities WHERE started_at>=/.test(sql)) {
        const [from, to] = params;
        tables.activities = tables.activities.filter(a => !(a.started_at >= from && a.started_at < to));
        return;
      }
      if (/DELETE FROM memories WHERE id=\?/.test(sql)) {
        tables.memories = tables.memories.filter(m => m.id !== params[0]);
        return;
      }
      if (/DELETE FROM screenshots/.test(sql) || /DELETE FROM episodes/.test(sql) || /DELETE FROM page_revisions/.test(sql)) return;
    },
    transaction(fn) { fn(); }
  };
  return st;
}

t('cascadeRange：活动已删时清掉悬空 evidence，并删除孤立 Wiki / 无证据记忆', () => {
  const t0 = Date.parse('2026-10-21T09:00:00+08:00');
  const t1 = t0 + 3600000;
  const st = memStore({
    activities: [{ id: 'keep', started_at: t1 + 1000 }],
    evidence: [
      { id: 'e-dead', owner_type: 'memory', owner_id: 'm1', event_id: 'gone', ts: t1 + 5000 },
      { id: 'e-keep', owner_type: 'memory', owner_id: 'm2', event_id: 'keep', ts: t1 + 1000 }
    ],
    memories: [
      { id: 'm1', source: 'auto' },
      { id: 'm2', source: 'auto' }
    ],
    wiki_pages: [
      { id: 'p1', kind: 'document', slug: 'doc-预算', title: '预算', backlinks: JSON.stringify(['gone']), body_md: '活动：gone', user_notes: '' },
      { id: 'p2', kind: 'document', slug: 'doc-仍在', title: '仍在', backlinks: JSON.stringify(['keep', 'gone']), body_md: '活动：keep, gone', user_notes: '' }
    ]
  });
  const n = forget.cascadeRange(t0, t1, { store: st, alreadyInTransaction: true });
  assert.ok(n.danglingEvidence >= 1, JSON.stringify(n));
  assert.ok(!st.tables.wiki_pages.some(p => p.id === 'p1'), 'orphan wiki should be deleted');
  const p2 = st.tables.wiki_pages.find(p => p.id === 'p2');
  assert.ok(p2, 'partial page kept');
  const links = JSON.parse(p2.backlinks);
  assert.deepStrictEqual(links, ['keep']);
  assert.ok(!st.tables.memories.some(m => m.id === 'm1'), 'memory with only dangling evidence removed');
  assert.ok(st.tables.memories.some(m => m.id === 'm2'));
});

t('wipeRangeCascade 在同一路径里删活动并级联；失败时 ok=false 且带 error', () => {
  const t0 = Date.parse('2026-10-21T09:00:00+08:00');
  const st = memStore({
    activities: [
      { id: 'a1', started_at: t0 + 10 },
      { id: 'a2', started_at: t0 + 2 * 3600000 }
    ],
    wiki_pages: [
      { id: 'p1', backlinks: JSON.stringify(['a1']), body_md: '活动：a1', user_notes: '' }
    ],
    evidence: []
  });
  const r = forget.wipeRangeCascade(t0, t0 + 3600000, { store: st });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.activities, 1);
  assert.ok(!st.tables.activities.some(a => a.id === 'a1'));
  assert.ok(st.tables.activities.some(a => a.id === 'a2'));
  assert.ok(!st.tables.wiki_pages.some(p => p.id === 'p1'));

  const bad = memStore({ activities: [{ id: 'z', started_at: t0 }] });
  const orig = bad.run;
  bad.run = (sql, params) => { if (/DELETE FROM activities/.test(sql)) throw new Error('disk full'); return orig.call(bad, sql, params); };
  const failR = forget.wipeRangeCascade(t0, t0 + 10, { store: bad });
  assert.strictEqual(failR.ok, false);
  assert.match(String(failR.error), /disk full/);
});

t('forgetWikiByTerms 按标题/slug 删除文档页，但不删时间卷', () => {
  const st = memStore({
    wiki_pages: [
      { id: 'd', kind: 'document', slug: 'doc-预算说明', title: '预算说明.docx' },
      { id: 'tm', kind: 'time', slug: 'day-2026-10-21', title: '2026-10-21 预算说明相关' }
    ]
  });
  const n = { pages: 0 };
  forget.forgetWikiByTerms(st, ['预算说明'], n);
  assert.strictEqual(n.pages, 1);
  assert.ok(!st.tables.wiki_pages.some(p => p.id === 'd'));
  assert.ok(st.tables.wiki_pages.some(p => p.id === 'tm'));
});

console.log(`r18: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
