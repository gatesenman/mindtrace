// 2.5 加固 R3 · 重复知识 / 旧 slug 兼容迁移
const assert = require('assert');
const slugs = require('../src/wiki/slugs');
const G = require('../src/content/ground');

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + (e.stack || e.message)); } };

t('规范 slug：人物/文档/项目带前缀；时间卷保持原样', () => {
  assert.strictEqual(slugs.canonicalSlug('person', '张三'), 'person-张三');
  assert.strictEqual(slugs.canonicalSlug('document', '预算说明.docx'), 'doc-预算说明.docx');
  assert.strictEqual(slugs.canonicalSlug('project', 'mindtrace'), 'proj-mindtrace');
  assert.strictEqual(slugs.canonicalSlug('time', '2026-10-21', 'day-2026-10-21'), 'day-2026-10-21');
  assert.strictEqual(slugs.canonicalSlug('person', '张三', 'person-张三'), 'person-张三');
});

t('别名包含旧的无前缀 slug 与标题', () => {
  const a = slugs.aliasSlugs('person', '张三', 'person-张三');
  assert.ok(a.includes('person-张三'));
  assert.ok(a.includes('张三'));
});

function pageStore(rows) {
  const pages = rows.slice();
  return {
    pages,
    get(sql, params) {
      if (/FROM wiki_pages WHERE kind=\? AND slug=\?/.test(sql)) {
        return pages.find(p => p.kind === params[0] && p.slug === params[1]) || null;
      }
      if (/FROM wiki_pages WHERE kind=\? AND title=\?/.test(sql)) {
        return pages.find(p => p.kind === params[0] && p.title === params[1]) || null;
      }
      if (/FROM wiki_pages WHERE id=\?/.test(sql)) return pages.find(p => p.id === params[0]) || null;
      return null;
    },
    run(sql, params) {
      if (/UPDATE wiki_pages SET slug=\? WHERE id=\?/.test(sql)) {
        const taken = pages.find(p => p.slug === params[0] && p.kind && pages.find(x => x.id === params[1] && x.kind === p.kind) && p.id !== params[1]);
        const cur = pages.find(p => p.id === params[1]);
        if (taken && cur && taken.kind === cur.kind) throw new Error('UNIQUE constraint failed: wiki_pages.kind, slug');
        if (cur) cur.slug = params[0];
        return;
      }
      if (/DELETE FROM wiki_pages WHERE id=\?/.test(sql)) {
        const i = pages.findIndex(p => p.id === params[0]);
        if (i >= 0) pages.splice(i, 1);
      }
    }
  };
}

t('旧页 slug=张三 在写入 person-张三 时被迁移，不新建重复页', () => {
  const st = pageStore([{ id: 'old', kind: 'person', slug: '张三', title: '张三', body_md: '早期条目' }]);
  const r = slugs.resolveForUpsert(st, { kind: 'person', title: '张三', slug: slugs.slugify('person', '张三'), body_md: '> 新摘录\n活动：w1' });
  assert.strictEqual(r.created, false);
  assert.strictEqual(r.migrated, true);
  assert.strictEqual(r.id, 'old');
  assert.strictEqual(r.slug, 'person-张三');
  assert.strictEqual(st.pages.filter(p => p.kind === 'person' && p.title === '张三').length, 1);
  assert.strictEqual(st.pages[0].slug, 'person-张三');
  assert.match(r.body_md, /早期条目/);
  assert.match(r.body_md, /新摘录|证据/);
});

t('若规范 slug 与旧 slug 两页并存，则合并进规范页并删除旧页', () => {
  const st = pageStore([
    { id: 'legacy', kind: 'person', slug: '张三', title: '张三', body_md: '旧页正文' },
    { id: 'canon', kind: 'person', slug: 'person-张三', title: '张三', body_md: '> 已有摘录' }
  ]);
  const r = slugs.resolveForUpsert(st, { kind: 'person', title: '张三', slug: 'person-张三', body_md: '> 已有摘录' });
  assert.strictEqual(r.id, 'canon');
  assert.strictEqual(r.migrated, true);
  assert.ok(!st.pages.some(p => p.id === 'legacy'), 'legacy duplicate removed');
  assert.match(r.body_md, /旧页正文|> 已有摘录/);
});

t('ground.slugify 与 slugs.slugify 对同一文档名一致，apply 能命中旧 slug', () => {
  assert.strictEqual(G.slugify('doc', '发布计划.md'), slugs.slugify('doc', '发布计划.md'));
  const st = pageStore([{ id: 'd1', kind: 'document', slug: '发布计划.md', title: '发布计划.md', body_md: '旧' }]);
  const rows = [{
    id: 'w1', type: 'window', started_at: Date.parse('2026-10-21T09:00:00+08:00'), duration_ms: 60000,
    app_name: 'Word', process_name: 'WINWORD', window_title: '发布计划.md - Word',
    file_path: 'D:\\\\工作\\\\发布计划.md',
    content: '周会决议：决定 10 月 30 日发布。',
    meta: '{"doc":{"kind":"office","name":"发布计划.md"}}'
  }];
  const ids = [];
  const fake = {
    get: st.get.bind(st),
    run: st.run.bind(st),
    upsertWikiPage(page) { ids.push(page.slug); return page.id || 'new'; }
  };
  const { pageIds } = G.apply(rows, { day: '2026-10-21', store: fake });
  assert.ok(pageIds.length >= 1);
  assert.ok(ids.some(s => s === 'doc-发布计划.md' || s.startsWith('doc-')), ids);
});

console.log(`r20: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
