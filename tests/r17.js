// 2.5 R6 · 知识闭环加固：覆盖率、上限、脱敏、闸门、回归
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require('../src/content/coverage');
const H = require('../src/core/health');
const S = require('../src/content/sessionSummary');
const search = require('../src/core/search');

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + (e.stack || e.message)); } };

const t0 = Date.parse('2026-10-21T09:00:00+08:00');
const rows = [
  { id: 'w1', type: 'window', started_at: t0, duration_ms: 40 * 60000, app_name: 'Word', process_name: 'WINWORD', window_title: '预算.docx - Word', content: '第三季度市场费用下降 12%。', meta: '{"doc":{"kind":"office","name":"预算.docx"}}' },
  { id: 'b1', type: 'browser', started_at: t0 + 3600000, duration_ms: 10 * 60000, app_name: 'Edge', window_title: 'DeepSeek API 文档', url: 'https://api-docs.deepseek.com/pricing', content: '按 token 计费，输入与输出单价不同。' },
  { id: 'z', type: 'window', started_at: t0 + 7200000, duration_ms: 60000, app_name: '计算器', window_title: '计算器' }
];

t('覆盖率：识别对象与正文段数', () => {
  const m = C.measure(rows);
  assert.ok(m.docs >= 2);
  assert.strictEqual(m.docsWithSnippet, 2);
  assert.ok(m.withSnippet >= 2);
  assert.ok(m.activities === 3);
});

t('健康卡：有正文时为 ok，短行不超过上限', () => {
  const it = C.coverageStatus({}, { rows });
  assert.strictEqual(it.key, 'knowledge');
  assert.strictEqual(it.state, 'ok');
  assert.match(it.label, /正文/);
  assert.ok([...it.label].length <= H.SHORT_MAX, it.label);
  const snap = H.snapshot({ privacy: { localOnly: true }, api: { enabled: false } });
  assert.strictEqual(snap.items.length, 8);
  assert.ok(snap.items.some(x => x.key === 'knowledge'));
  for (const x of snap.items) assert.ok([...x.short].length <= H.SHORT_MAX, x.key + ':' + x.short);
});

t('无正文时降级，无活动时 pending', () => {
  const bare = [{ id: 'a', type: 'window', app_name: 'Word', process_name: 'WINWORD', window_title: '预算.docx - Word', duration_ms: 60000, meta: '{"doc":{"kind":"office","name":"预算.docx"}}' }];
  assert.strictEqual(C.coverageStatus({}, { rows: bare }).state, 'degraded');
  assert.strictEqual(C.coverageStatus({}, { rows: [] }).state, 'pending');
});

t('摘要与检索长度设上限，密钥被脱敏', () => {
  const dirty = [{
    id: 's', type: 'window', started_at: t0, duration_ms: 60000,
    app_name: '记事本', process_name: 'Notepad', window_title: '密钥.txt - 记事本',
    content: 'sk-abcdefghijklmnopqrstuvwxyz123456 ' + '正文'.repeat(3000),
    meta: '{"doc":{"kind":"text","name":"密钥.txt"}}'
  }];
  const line = S.sessionLine(dirty);
  assert.ok([...line].length <= S.LINE_MAX, line);
  assert.doesNotMatch(line, /sk-abcdefghijklmnopqrstuvwxyz123456/);
  const block = S.promptBlock(dirty);
  assert.ok(block.length <= 4200, block.length);
  const ex = search.excerpt('前'.repeat(200) + '市场费用' + '后'.repeat(200), '市场费用');
  assert.ok(ex.length <= search.EXCERPT_MAX + 2);
});

t('新模块不引入绕过闸门的裸 fetch', () => {
  const files = [
    'src/content/sessionSummary.js', 'src/content/ground.js', 'src/content/coverage.js',
    'src/content/docDigest.js', 'src/core/search.js', 'src/core/reports.js'
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.doesNotMatch(src, /(?<![\w.])fetch\s*\(/, f);
  }
});

t('版本号 2.5.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.strictEqual(pkg.version, '2.5.0');
});

console.log(`r17: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
