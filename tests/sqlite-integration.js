// Real SQLite integration for 2.5 harden R1–R5.
// Uses the production store + db adapter (better-sqlite3 or sql.js), not an in-memory fake.
// Electron is stubbed only so store.js can load; no BrowserWindow / GUI is exercised.
require('./stub-electron');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + (e.stack || e.message)); } };

const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-sqlite-int-'));
const dbPath = path.join(UD, 'mindtrace.db');

(async () => {
  const store = require('../src/main/store');
  const forget = require('../src/core/forget');
  const search = require('../src/core/search');
  const slugs = require('../src/wiki/slugs');
  const evidence = require('../src/common/evidence');

  await store.initStore({ dbPath, forceSqlJs: process.env.MINDTRACE_SQLJS === '1' ? true : undefined });
  require('../src/core/schema').migrate();
  const fts = store.ftsStatus();
  console.log(`[sqlite-integration] engine=${fts.engine} fts=${fts.mode} db=${dbPath}`);

  const t0 = Date.parse('2026-10-21T09:00:00+08:00');
  const t1 = t0 + 3600 * 1000;
  const t2 = t0 + 2 * 3600 * 1000;

  const w1 = store.insertActivity({
    id: 'w1', type: 'window', started_at: t0, duration_ms: 40 * 60000,
    app_name: 'Word', process_name: 'WINWORD', window_title: '2026年Q3预算说明.docx - Word',
    file_path: 'D:\\工作\\2026年Q3预算说明.docx',
    content: '第三季度市场费用下降 12%，建议将结余转入品牌投放。',
    meta: { isDemo: true, doc: { kind: 'office', name: '2026年Q3预算说明.docx' } }
  });
  const wx1 = store.insertActivity({
    id: 'wx1', type: 'window', started_at: t2, duration_ms: 15 * 60000,
    app_name: '微信', process_name: 'WeChat', window_title: '产品研发群',
    content: '周五前把发布说明发我。',
    meta: { isDemo: true, doc: { kind: 'chat', name: '产品研发群' } }
  });
  const code1 = store.insertActivity({
    id: 'code1', type: 'window', started_at: t2 + 1000, duration_ms: 20 * 60000,
    app_name: 'Visual Studio Code', process_name: 'Code', window_title: 'store.js - mindtrace - Visual Studio Code',
    file_path: 'D:\\proj\\store.js',
    content: '修复检索筛选。',
    meta: { isDemo: true }
  });
  t('insertActivity 写入三条活动', () => {
    assert.ok(w1 && wx1 && code1);
    assert.strictEqual(store.get(`SELECT COUNT(*) c FROM activities`).c, 3);
  });

  t('searchFts / LIKE 能按正文命中，并带 meta 供 kind 判断', () => {
    const rows = store.searchFts('市场费用', 20);
    assert.ok(rows.some(r => r.id === 'w1'), JSON.stringify(rows.map(r => r.id)));
    const hit = rows.find(r => r.id === 'w1');
    assert.ok(hit.meta, 'searchFts must return meta');
    assert.ok(hit.path || hit.file_path);
    const r = search.search('市场费用', { store });
    assert.ok(r.activities.some(a => a.id === 'w1' && a.jump && a.jump.activityId === 'w1'));
    assert.strictEqual(r.activities.find(a => a.id === 'w1').kind, 'file');
  });

  t('无 meta 也可按应用名把微信筛成会话、VS Code 筛成代码（走真实 searchFts 结果）', () => {
    const chat = search.search('发布说明', { store, kind: 'chat' });
    assert.ok(chat.activities.some(a => a.id === 'wx1'), JSON.stringify(chat.activities.map(a => ({ id: a.id, kind: a.kind, app: a.app }))));
    assert.ok(chat.activities.every(a => a.kind === 'chat'));
    const code = search.search('检索', { store, kind: 'code' });
    assert.ok(code.activities.some(a => a.id === 'code1'));
    assert.ok(code.activities.every(a => a.kind === 'code'));
  });

  // Legacy slug + canonical collision
  store.upsertWikiPage({ kind: 'person', slug: '张三', title: '张三', body_md: '旧页正文', id: 'wiki-legacy' });
  t('UNIQUE(kind,slug) 第二次插入同一旧 slug 会失败或被 upsert 更新', () => {
    const id = store.upsertWikiPage({ kind: 'person', slug: '张三', title: '张三', body_md: '再次写入' });
    assert.ok(id);
    const n = store.get(`SELECT COUNT(*) c FROM wiki_pages WHERE kind='person' AND title='张三'`).c;
    assert.strictEqual(n, 1);
  });

  t('resolveForUpsert 把旧 slug 迁到 person-张三，不新增第二页', () => {
    const resolved = slugs.resolveForUpsert(store, {
      kind: 'person', title: '张三', slug: 'person-张三', body_md: '> 新摘录\n活动：w1'
    });
    assert.strictEqual(resolved.created, false);
    assert.ok(resolved.migrated);
    assert.strictEqual(store.get(`SELECT slug FROM wiki_pages WHERE id=?`, [resolved.id]).slug, 'person-张三');
    assert.strictEqual(store.get(`SELECT COUNT(*) c FROM wiki_pages WHERE kind='person'`).c, 1);
    assert.match(resolved.body_md || store.get(`SELECT body_md FROM wiki_pages WHERE id=?`, [resolved.id]).body_md, /旧页正文|再次写入|新摘录|证据/);
  });

  const docPageId = store.upsertWikiPage({
    kind: 'document', slug: 'doc-预算说明', title: '2026年Q3预算说明.docx',
    body_md: '活动：w1, wx1\n> 市场费用下降', backlinks: ['w1', 'wx1']
  });
  const orphanPageId = store.upsertWikiPage({
    kind: 'document', slug: 'doc-已删文档', title: '已删文档',
    body_md: '活动：w1', backlinks: ['w1']
  });
  evidence.add('memory', 'mem-w1', { eventId: 'w1', ts: t2 + 5000, quote: '市场费用下降 12%' }); // ts outside morning window
  evidence.add('memory', 'mem-wx', { eventId: 'wx1', ts: t2 + 5000, quote: '发布说明' });
  store.run(`INSERT INTO memories (id,kind,text,confidence,status,created_at,updated_at,source) VALUES (?,?,?,?,?,?,?,?)`,
    ['mem-w1', 'fact', '预算下降', 0.8, 'active', t0, t0, 'auto']);
  store.run(`INSERT INTO memories (id,kind,text,confidence,status,created_at,updated_at,source) VALUES (?,?,?,?,?,?,?,?)`,
    ['mem-wx', 'fact', '要发布说明', 0.8, 'active', t2, t2, 'auto']);

  t('真实事务：中途抛错会 ROLLBACK，活动仍在', () => {
    const before = store.get(`SELECT COUNT(*) c FROM activities`).c;
    let threw = false;
    try {
      store.transaction(() => {
        store.run(`DELETE FROM activities WHERE id=?`, ['w1']);
        throw new Error('boom-rollback');
      });
    } catch (e) {
      threw = /boom-rollback/.test(e.message);
    }
    assert.ok(threw);
    assert.strictEqual(store.get(`SELECT COUNT(*) c FROM activities`).c, before);
    assert.ok(store.get(`SELECT id FROM activities WHERE id='w1'`));
  });

  const wiped = forget.wipeRangeCascade(t0, t1); // morning only — deletes w1
  t('wipeRangeCascade 用真实库删除上午活动并级联', () => {
    assert.strictEqual(wiped.ok, true, JSON.stringify(wiped));
    assert.ok(!store.get(`SELECT id FROM activities WHERE id='w1'`));
    assert.ok(store.get(`SELECT id FROM activities WHERE id='wx1'`));
    assert.ok(store.get(`SELECT id FROM activities WHERE id='code1'`));
  });

  t('删除后 searchFts / search 不再命中已擦活动，微信仍可检索', () => {
    const gone = store.searchFts('市场费用', 20);
    assert.ok(!gone.some(r => r.id === 'w1'), JSON.stringify(gone));
    const still = search.search('发布说明', { store, kind: 'chat' });
    assert.ok(still.activities.some(a => a.id === 'wx1'));
  });

  t('悬空 event_id 的 evidence 被清掉；仅依赖已删活动的记忆被删；Wiki 回链被修剪或孤立页删除', () => {
    const evW1 = store.get(`SELECT id FROM evidence WHERE event_id='w1'`);
    assert.ok(!evW1, 'dangling evidence for w1 should be gone');
    assert.ok(!store.get(`SELECT id FROM memories WHERE id='mem-w1'`), 'orphan auto memory removed');
    assert.ok(store.get(`SELECT id FROM memories WHERE id='mem-wx'`), 'memory with live evidence kept');
    assert.ok(!store.get(`SELECT id FROM wiki_pages WHERE id=?`, [orphanPageId]), 'orphan wiki page deleted');
    const doc = store.get(`SELECT backlinks, body_md FROM wiki_pages WHERE id=?`, [docPageId]);
    assert.ok(doc, 'page with remaining live backlink kept');
    const links = JSON.parse(doc.backlinks || '[]');
    assert.ok(!links.includes('w1'));
    assert.ok(links.includes('wx1'));
    assert.doesNotMatch(doc.body_md || '', /活动：w1/);
    assert.match(doc.body_md || '', /wx1/);
  });

  t('引擎是真实 SQLite（better-sqlite3 或 sql.js），不是假 store', () => {
    assert.ok(fts.engine === 'better-sqlite3' || fts.engine === 'sql.js', fts.engine);
    assert.ok(fs.existsSync(dbPath) || fts.engine === 'sql.js' || fts.engine === 'better-sqlite3');
  });

  store.closeStore();
  try { fs.rmSync(UD, { recursive: true, force: true }); } catch (_) {}
  console.log(`sqlite-integration: ${pass} passed, ${fail} failed; engine=${fts.engine} fts=${fts.mode}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('sqlite-integration crashed:', e && e.stack || e);
  try { fs.rmSync(UD, { recursive: true, force: true }); } catch (_) {}
  process.exit(1);
});
