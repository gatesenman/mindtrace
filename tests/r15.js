// 2.5 R4 · 检索：正文/路径/URL 全文 + 语义混合 + 摘录 + 筛选 + 跳转
const assert = require('assert');
const S = require('../src/core/search');

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + (e.stack || e.message)); } };

const t0 = Date.parse('2026-10-21T09:00:00+08:00');
const rows = [
  { id: 'w1', type: 'window', title: '2026年Q3预算说明.docx - Word', window_title: '2026年Q3预算说明.docx - Word', content: '第三季度市场费用下降 12%，建议将结余转入品牌投放。', path: 'D:\\工作\\2026年Q3预算说明.docx', file_path: 'D:\\工作\\2026年Q3预算说明.docx', app: 'Word', app_name: 'Word', started_at: t0, meta: '{"doc":{"kind":"office","name":"2026年Q3预算说明.docx"}}' },
  { id: 'b1', type: 'browser', title: 'DeepSeek API 文档', content: '按 token 计费，输入与输出单价不同。', url: 'https://api-docs.deepseek.com/pricing', app: 'Edge', started_at: t0 + 3600000 },
  { id: 'c1', type: 'window', title: '产品研发群', content: '周五前把发布说明发我。', app: '微信', app_name: '微信', started_at: t0 + 7200000, meta: '{"doc":{"kind":"chat","name":"产品研发群"}}' },
  { id: 'x1', type: 'window', title: '无关窗口', content: '今天天气不错', app: '记事本', started_at: t0 + 3 * 3600000 }
];

function fakeStore(list) {
  return {
    searchFts(q, limit) {
      const terms = String(q).split(/\s+/).filter(Boolean);
      return list.filter(r => {
        const hay = [r.title, r.content, r.url, r.path, r.file_path, r.app].join(' ');
        return terms.every(t => hay.toLowerCase().includes(t.toLowerCase()));
      }).slice(0, limit);
    }
  };
}

t('摘录围绕命中词，并加省略号', () => {
  const long = '前序说明若干字。' + '啊'.repeat(40) + '市场费用下降 12%，建议将结余转入品牌投放。' + '啊'.repeat(40);
  const ex = S.excerpt(long, '市场费用');
  assert.match(ex, /市场费用下降/);
  assert.ok(ex.startsWith('…'));
  assert.ok(ex.length <= S.EXCERPT_MAX + 2, String(ex.length));
});

t('kindOf：路径→文档，URL→网页，聊天→会话', () => {
  assert.strictEqual(S.kindOf(rows[0]), 'file');
  assert.strictEqual(S.kindOf(rows[1]), 'page');
  assert.strictEqual(S.kindOf(rows[2]), 'chat');
});

t('可搜正文并返回摘录与跳转字段', () => {
  const r = S.search('市场费用', { store: fakeStore(rows) });
  assert.strictEqual(r.activities.length, 1);
  assert.strictEqual(r.activities[0].id, 'w1');
  assert.match(r.activities[0].excerpt, /市场费用下降 12%/);
  assert.deepStrictEqual(r.activities[0].jump, { activityId: 'w1', started_at: t0 });
  assert.strictEqual(r.activities[0].kind, 'file');
});

t('可按文件路径检索', () => {
  const r = S.search('Q3预算说明.docx', { store: fakeStore(rows) });
  assert.ok(r.activities.some(a => a.id === 'w1'));
});

t('可按 URL 检索', () => {
  const r = S.search('api-docs.deepseek.com', { store: fakeStore(rows) });
  assert.ok(r.activities.some(a => a.id === 'b1'));
  assert.strictEqual(r.activities[0].kind, 'page');
});

t('kind 筛选：只要网页', () => {
  const r = S.search('计费', { store: fakeStore(rows), kind: 'page' });
  assert.ok(r.activities.every(a => a.kind === 'page'));
  assert.ok(r.activities.some(a => a.id === 'b1'));
});

t('时间窗筛选', () => {
  const r = S.search('文档', { store: fakeStore(rows), from: t0 + 1800000, to: t0 + 2 * 3600000 });
  assert.ok(r.activities.every(a => a.id === 'b1'), JSON.stringify(r.activities.map(a => a.id)));
});

t('语义混合：同义池能找回 FTS 未直接命中的正文', () => {
  const ftsMiss = {
    searchFts() { return [rows[3]]; } // 字面未命中定价
  };
  const pool = [
    rows[3],
    { id: 'p2', title: '资费说明', content: 'DeepSeek 价格与费用', app: 'Edge', type: 'browser', url: 'https://x.example/pricing', started_at: t0 }
  ];
  const r = S.search('定价费用', { store: ftsMiss, pool });
  assert.ok(r.activities.some(a => a.id === 'p2'), JSON.stringify(r.activities.map(a => a.id)));
});

t('空查询不搜', () => {
  const r = S.search('  ', { store: fakeStore(rows) });
  assert.deepStrictEqual(r.activities, []);
});

console.log(`r15: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
