// 2.5 R2 · Wiki / 记忆基于文档与正文，并回链会话
const assert = require('assert');
const G = require('../src/content/ground');

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + (e.stack || e.message)); } };

const day = '2026-10-21';
const rows = [
  {
    id: 'w1', type: 'window', started_at: Date.parse('2026-10-21T09:00:00+08:00'), duration_ms: 40 * 60000,
    app_name: 'Word', process_name: 'WINWORD', window_title: '发布计划.md - Word',
    file_path: 'D:\\工作\\发布计划.md',
    content: '周会决议：决定 10 月 30 日发布 2.4.8。张三负责安装包签名。建议将结余转入品牌投放。',
    meta: '{"doc":{"kind":"office","name":"发布计划.md"}}'
  },
  {
    id: 'b1', type: 'browser', started_at: Date.parse('2026-10-21T10:00:00+08:00'), duration_ms: 15 * 60000,
    app_name: 'Edge', window_title: 'DeepSeek API 文档', url: 'https://api-docs.deepseek.com/pricing',
    content: '按 token 计费，输入与输出单价不同。我比较喜欢用缓存命中来降低费用。'
  }
];

t('Wiki 页点名文档、摘录、路径，并回链活动 id', () => {
  const { pages } = G.build(rows, { day });
  const doc = pages.find(p => p.kind === 'document' && /发布计划/.test(p.title));
  assert.ok(doc, pages.map(p => p.kind + ':' + p.title).join(','));
  assert.match(doc.body_md, /10 月 30 日发布/);
  assert.match(doc.body_md, /路径：/); assert.match(doc.body_md, /发布计划\.md/);
  assert.ok(doc.backlinks.includes('w1'));
  assert.match(doc.body_md, /关联会话/);
  assert.match(doc.body_md, /w1/);
});

t('网页也生成主题页并带 URL 与活动 id', () => {
  const { pages } = G.build(rows, { day });
  const page = pages.find(p => /DeepSeek/.test(p.title));
  assert.ok(page && page.kind === 'topic');
  assert.match(page.body_md, /api-docs\.deepseek\.com/);
  assert.ok(page.backlinks.includes('b1'));
});

t('记忆来自正文中的决定/偏好，并带活动证据', () => {
  const { memories } = G.build(rows, { day });
  assert.ok(memories.some(m => m.type === 'decision' && /10 月 30 日发布/.test(m.text)), JSON.stringify(memories));
  assert.ok(memories.some(m => (m.eventIds || []).includes('w1')));
  assert.ok(memories.some(m => m.type === 'preference' && /缓存命中/.test(m.text)));
});

t('人物页从摘录抽出并回链', () => {
  const { pages } = G.build(rows, { day });
  const person = pages.find(p => p.kind === 'person' && p.title === '张三');
  assert.ok(person, pages.filter(p => p.kind === 'person').map(p => p.title).join(','));
  assert.ok(person.backlinks.includes('w1'));
});

t('拒绝空泛的应用使用记忆', () => {
  assert.ok(G.isGeneric('用了 Word 40 分钟'));
  assert.ok(G.isGeneric('处理了 文档'));
  const mems = G.memoriesFromText('用了 Word 40 分钟', { eventIds: ['x'] });
  assert.ok(!mems.some(m => G.isGeneric(m.text)));
  const { memories } = G.build([
    { id: 'z', type: 'window', app_name: 'Word', process_name: 'WINWORD', window_title: '文档1 - Word', duration_ms: 40 * 60000, content: '', meta: '{"doc":{"kind":"office","name":"文档1"}}' }
  ], { day });
  assert.ok(!memories.some(m => /用了 Word/.test(m.text || '')));
});

t('脱敏：密钥不进入记忆或 Wiki', () => {
  const dirty = [{
    id: 's1', type: 'window', app_name: '记事本', process_name: 'Notepad',
    window_title: '密钥.txt - 记事本', content: '我们决定把 api 换成 sk-abcdefghijklmnopqrstuvwxyz123456',
    meta: '{"doc":{"kind":"text","name":"密钥.txt"}}', started_at: Date.parse('2026-10-21T12:00:00+08:00'), duration_ms: 60000
  }];
  const { pages, memories } = G.build(dirty, { day });
  const blob = JSON.stringify({ pages, memories });
  assert.doesNotMatch(blob, /sk-abcdefghijklmnopqrstuvwxyz123456/);
});

t('apply 写入 Wiki 与记忆，证据为活动 id', () => {
  const wiki = [];
  const mems = [];
  const fake = {
    get() { return null; },
    upsertWikiPage(p) { wiki.push(p); return 'p' + wiki.length; },
    upsertMemory(m) { mems.push(m); return 'm' + mems.length; }
  };
  const r = G.apply(rows, { day, store: fake });
  assert.ok(wiki.some(p => p.kind === 'document' && p.backlinks.includes('w1')));
  assert.ok(r.pageIds.length >= 1);
  // memory.ingest 可能因无 DB 走 upsertMemory
  assert.ok(r.memories.some(m => (m.eventIds || []).includes('w1')));
});

t('mergeBody：已含摘录则不重复，否则追加证据', () => {
  const next = G.pageMarkdown({ name: '发布计划.md', kind: 'office', app: 'Word', snippet: '决定 10 月 30 日发布 2.4.8', ids: ['w1'], first: Date.parse('2026-10-21T09:00:00+08:00') }, { day });
  const keep = G.mergeBody('# 发布计划.md\n\n> 决定 10 月 30 日发布 2.4.8\n', next);
  assert.doesNotMatch(keep, /## 证据/);
  const merged = G.mergeBody('# 旧文\n\nAI 写的长摘要。\n', next);
  assert.match(merged, /## 证据/);
  assert.match(merged, /发布计划/);
});

console.log(`r13: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
