// 2.5 R1 · 内容感知的会话 / 小时 / 日摘要
const assert = require('assert');
const { digest, objectOf } = require('../src/content/docDigest');
const S = require('../src/content/sessionSummary');
const summarizer = require('../src/ai/summarizer');

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + (e.stack || e.message)); } };

const rows = [
  {
    id: 'w1', type: 'window', started_at: Date.parse('2026-10-21T09:00:00+08:00'), duration_ms: 40 * 60000,
    app_name: 'Word', process_name: 'WINWORD', window_title: '2026年Q3预算说明.docx - Word',
    file_path: 'D:\\工作\\2026年Q3预算说明.docx',
    content: '第三季度市场费用下降 12%，建议将结余转入品牌投放。',
    meta: '{"doc":{"kind":"office","name":"2026年Q3预算说明.docx"}}'
  },
  {
    id: 'b1', type: 'browser', started_at: Date.parse('2026-10-21T10:00:00+08:00'), duration_ms: 20 * 60000,
    app_name: 'Edge', process_name: 'msedge', window_title: 'DeepSeek API 文档',
    url: 'https://api-docs.deepseek.com/pricing',
    content: '按 token 计费，输入与输出单价不同，缓存命中可降低费用。'
  },
  {
    id: 'f1', type: 'file', started_at: Date.parse('2026-10-21T11:00:00+08:00'), duration_ms: 0,
    app_name: '最近使用', file_path: 'E:\\docs\\方案.pdf'
  }
];

t('file 类型纳入文档对象', () => {
  const o = objectOf(rows[2]);
  assert.ok(o && o.name === '方案.pdf' && o.kind === 'document');
});

t('digest 保留正文、活动 id 与主题', () => {
  const list = digest(rows, { limit: 10 });
  const budget = list.find(d => /预算说明/.test(d.name));
  assert.ok(budget, JSON.stringify(list.map(d => d.name)));
  assert.ok(/市场费用下降/.test(budget.snippet));
  assert.ok(budget.ids.includes('w1'));
  assert.ok(budget.topic);
  assert.ok(list.some(d => d.name === '方案.pdf'));
});

t('UIA 正文并入同名会话', () => {
  const chat = [
    { id: 'c1', type: 'window', started_at: 1, duration_ms: 300000, app_name: '微信', process_name: 'WeChat', window_title: '产品研发群', meta: '{"doc":{"kind":"chat","name":"产品研发群"}}' },
    { id: 'u1', type: 'uia', started_at: 2, app_name: '微信', window_title: '产品研发群', content: '李四：周五前把发布说明发我。我：好的，周四给你初稿。' }
  ];
  const list = digest(chat);
  const g = list.find(d => d.name === '产品研发群');
  assert.ok(g && /发布说明/.test(g.snippet));
  assert.ok(g.ids.includes('c1') && g.ids.includes('u1'));
});

t('会话摘要点名文档并引用摘录，而非「用了 Word」', () => {
  const line = S.sessionLine([rows[0]]);
  assert.match(line, /2026年Q3预算说明/);
  assert.match(line, /市场费用下降/);
  assert.doesNotMatch(line, /用了\s*Word/);
  assert.ok([...line].length <= S.LINE_MAX, line);
});

t('网页会话摘要用书名号式页面名 + 正文', () => {
  const line = S.sessionLine([rows[1]]);
  assert.match(line, /DeepSeek API 文档/);
  assert.match(line, /token/);
  assert.doesNotMatch(line, /用了\s*Edge/);
});

t('多对象摘要短且点名两项', () => {
  const line = S.sessionLine(rows);
  assert.match(line, /预算说明/);
  assert.match(line, /DeepSeek/);
  assert.ok([...line].length <= S.LINE_MAX, line);
});

t('小时规则摘要含文档与摘录', () => {
  const md = S.hourMarkdown(rows, '2026-10-21 09:00');
  assert.match(md, /## 2026-10-21 09:00/);
  assert.match(md, /预算说明/);
  assert.match(md, /市场费用下降/);
  assert.match(md, /DeepSeek API 文档/);
});

t('日规则摘要以文档为骨架', () => {
  const md = S.dayMarkdown(rows, '2026-10-21');
  assert.match(md, /# 2026-10-21/);
  assert.match(md, /预算说明/);
  assert.match(md, /方案\.pdf/);
  assert.doesNotMatch(md, /用了 Word 40/);
});

t('docSection / formatActivities 含文档清单与正文', () => {
  const sec = summarizer.docSection(rows);
  assert.match(sec, /今日处理的文档/);
  assert.match(sec, /内容：/);
  assert.match(sec, /市场费用下降/);
  const fmt = summarizer.formatActivities(rows);
  assert.match(fmt, /今日处理的文档/);
  assert.match(fmt, /预算说明/);
  assert.match(fmt, /方案\.pdf/);
});

t('提示词路径脱敏，不复述密钥', () => {
  const dirty = [{
    id: 'x', type: 'window', started_at: Date.now(), duration_ms: 60000,
    app_name: 'Word', process_name: 'WINWORD', window_title: '备注.docx - Word',
    content: 'api_key sk-abcdefghijklmnopqrstuvwxyz123456 不要外传',
    meta: '{"doc":{"kind":"office","name":"备注.docx"}}'
  }];
  const line = S.sessionLine(dirty);
  const block = S.promptBlock(dirty);
  assert.doesNotMatch(line, /sk-abcdefghijklmnopqrstuvwxyz123456/);
  assert.doesNotMatch(block, /sk-abcdefghijklmnopqrstuvwxyz123456/);
});

t('无文档时退回标题，仍不说「用了 XX 分钟」', () => {
  const line = S.sessionLine([{ id: 'z', type: 'window', app_name: '计算器', window_title: '计算器', duration_ms: 40 * 60000 }]);
  assert.doesNotMatch(line, /用了/);
  assert.ok(line.length > 0);
});

console.log(`r12: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
