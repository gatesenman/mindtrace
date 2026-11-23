// 2.5 R3 · 时间线会话块：文档名 / 主题芯片 / 一行内容摘要
const assert = require('assert');
const vm = require('vm'), fs = require('fs');
const ctx = { window: {}, document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } }, localStorage: { getItem() { return null; } }, console, URL };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(__dirname + '/../src/renderer/js/timeline.js', 'utf8'), ctx);
const T = ctx.window.TLFeed;

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + (e.stack || e.message)); } };

const t0 = Date.parse('2026-10-21T09:00:00+08:00');
const docRows = [
  { id: 'w1', type: 'window', started_at: t0, ended_at: t0 + 40 * 60000, duration_ms: 40 * 60000, app_name: 'Word', process_name: 'WINWORD', window_title: '2026年Q3预算说明.docx - Word', file_path: 'D:\\工作\\2026年Q3预算说明.docx', content: '第三季度市场费用下降 12%，建议将结余转入品牌投放。下一步评估渠道配比。', meta: '{"doc":{"kind":"office","name":"2026年Q3预算说明.docx"}}' }
];
const webRows = [
  { id: 'e1', type: 'window', started_at: t0 + 3600000, ended_at: t0 + 3600000 + 10 * 60000, duration_ms: 10 * 60000, app_name: 'Edge', process_name: 'msedge', window_title: 'DeepSeek API 文档 - 个人 - Microsoft Edge', url: 'https://api-docs.deepseek.com/pricing', content: '按 token 计费，输入与输出单价不同，缓存命中可降低费用。', meta: '{"doc":{"kind":"browser","name":"DeepSeek API 文档","page":"DeepSeek API 文档"}}' },
  { id: 'e2', type: 'window', started_at: t0 + 3600000 + 10 * 60000, ended_at: t0 + 3600000 + 20 * 60000, duration_ms: 10 * 60000, app_name: 'Edge', process_name: 'msedge', window_title: 'FTS5 全文检索手册 - 个人 - Microsoft Edge', url: 'https://www.sqlite.org/fts5.html', content: '', meta: '{"doc":{"kind":"browser","page":"FTS5 全文检索手册"}}' }
];

t('文档会话：摘要含文件名，chips 含文档，一行摘要取正文首句', () => {
  const B = T.toBlocks(docRows);
  assert.strictEqual(B.length, 1);
  assert.match(B[0].summary, /预算说明/);
  assert.ok(B[0].files.some(f => /预算说明/.test(f)));
  assert.ok(B[0].topics.some(x => /预算说明/.test(x)));
  assert.match(B[0].line, /市场费用下降 12%/);
  assert.doesNotMatch(B[0].line, /下一步评估/); // 首句，不含第二句
  assert.ok([...B[0].line].length <= 80, B[0].line);
  const html = T.objects(B[0]);
  assert.match(html, /预算说明/);
});

t('浏览会话：页面标题作为芯片，一行摘要来自网页正文', () => {
  const B = T.toBlocks(webRows);
  assert.ok(B.length >= 1);
  const web = B.find(b => b.cat === 'web');
  assert.ok(web);
  assert.ok(web.pages.some(p => /DeepSeek API 文档/.test(p)));
  assert.ok(web.pages.some(p => /FTS5/.test(p)));
  assert.match(web.line, /token/);
  const html = T.objects(web);
  assert.match(html, /DeepSeek API 文档|FTS5/);
});

t('优先选用带路径/URL 的正文，而不是先出现的短界面字', () => {
  const rows = [
    { id: 'u', type: 'uia', started_at: t0, duration_ms: 0, app_name: 'Word', window_title: '预算.docx - Word', content: '开始 文件 编辑 视图 插入 这是菜单栏文字够长了吧真的' },
    { id: 'w', type: 'window', started_at: t0 + 1000, ended_at: t0 + 600000, duration_ms: 600000, app_name: 'Word', process_name: 'WINWORD', window_title: '预算.docx - Word', file_path: 'D:\\预算.docx', content: '第三季度市场费用下降 12%。', meta: '{"doc":{"kind":"office","name":"预算.docx"}}' }
  ];
  const B = T.toBlocks(rows);
  assert.match(B[0].line, /市场费用下降/);
});

t('既有规则摘要不被改写：Word 编辑文件名', () => {
  const B = T.toBlocks(docRows);
  assert.match(B[0].summary, /在 Word 编辑/);
  assert.doesNotMatch(B[0].summary, /用了 Word 40/);
});

t('bestContent：无正文时为空', () => {
  const r = T.bestContent([{ type: 'window', content: '' }]);
  assert.strictEqual(r.snippet, '');
  assert.strictEqual(r.line, '');
});

console.log(`r14: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
