// 2.5 R5 · 日报 / 周报以文档与正文回答「实际做了什么」
const assert = require('assert');
const reports = require('../src/core/reports');

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + (e.stack || e.message)); } };

function fakeStore(rows) {
  return {
    all(sql, params) {
      let out = rows.slice();
      if (params && params.length >= 2) out = out.filter(r => r.started_at >= params[0] && r.started_at <= params[1]);
      return out;
    }
  };
}

const day = '2026-10-21';
const H = (s) => new Date(s).getTime();
const rows = [
  { id: '1', type: 'window', started_at: H('2026-10-21T09:00:00+08:00'), duration_ms: 40 * 60000, app_name: 'Word', process_name: 'WINWORD', window_title: '2026年Q3预算说明.docx - Word', file_path: 'D:\\工作\\2026年Q3预算说明.docx', content: '第三季度市场费用下降 12%，建议将结余转入品牌投放。', meta: '{"doc":{"kind":"office","name":"2026年Q3预算说明.docx"},"layer":"content"}' },
  { id: '2', type: 'browser', started_at: H('2026-10-21T10:00:00+08:00'), duration_ms: 20 * 60000, app_name: 'Edge', window_title: 'DeepSeek API 文档', url: 'https://api-docs.deepseek.com/pricing', content: '按 token 计费，输入与输出单价不同。', meta: '{"layer":"artifact"}' },
  { id: '3', type: 'window', started_at: H('2026-10-21T11:00:00+08:00'), duration_ms: 15 * 60000, app_name: 'VS Code', process_name: 'Code', window_title: 'store.js - mindtrace - Visual Studio Code', meta: '{"doc":{"kind":"code","name":"store.js","project":"mindtrace"},"layer":"focus"}' }
];

t('日报：今天做了什么点名文档并引用正文，而非只列应用时长', () => {
  const r = reports.summarizeDay(fakeStore(rows), day);
  assert.strictEqual(r.status, 'OK');
  const work = r.markdown.split('## 时间分布')[0];
  assert.match(work, /今天做了什么/);
  assert.match(work, /预算说明/);
  assert.match(work, /市场费用下降 12%/);
  assert.match(work, /DeepSeek API 文档/);
  assert.match(work, /token 计费/);
  assert.doesNotMatch(work, /用了 Word/);
  // 应用时长仍在时间分布里，满足旧用例
  assert.match(r.markdown, /## 时间分布/);
  assert.match(r.markdown, /VS Code/);
  assert.match(r.markdown, /api-docs\.deepseek\.com/);
});

t('日报文案紧凑，无客服式页脚', () => {
  const r = reports.summarizeDay(fakeStore(rows), day);
  assert.doesNotMatch(r.markdown, /飞书|邮件|AI 润色/);
  assert.doesNotMatch(r.markdown, /由知迹规则生成/);
});

t('日报无数据仍为 NO_DATA', () => {
  const r = reports.summarizeDay(fakeStore([]), day);
  assert.strictEqual(r.status, 'NO_DATA');
  assert.match(r.markdown, /NO_DATA/);
});

t('周报：本周做了什么 + Standup 写具体文档而非「应用相关工作」', () => {
  const weekRows = rows.concat([
    { id: '4', type: 'window', started_at: H('2026-10-20T09:00:00+08:00'), duration_ms: 30 * 60000, app_name: 'Word', process_name: 'WINWORD', window_title: '发布计划.md - Word', content: '决定 10 月 30 日发布 2.4.8。', meta: '{"doc":{"kind":"text","name":"发布计划.md"}}' }
  ]);
  const r = reports.summarizeWeek(fakeStore(weekRows), day);
  assert.strictEqual(r.status, 'OK');
  assert.match(r.markdown, /本周做了什么/);
  assert.match(r.markdown, /发布计划/);
  assert.match(r.markdown, /10 月 30 日发布/);
  assert.match(r.markdown, /Standup/);
  assert.match(r.markdown, /预算说明|发布计划|store\.js|DeepSeek/);
  assert.doesNotMatch(r.markdown, /VS Code 相关工作/);
  assert.ok(r.stats.days >= 2);
});

t('日报脱敏，不写出密钥', () => {
  const dirty = [{
    id: 's', type: 'window', started_at: H('2026-10-21T09:00:00+08:00'), duration_ms: 60000,
    app_name: '记事本', process_name: 'Notepad', window_title: '密钥.txt - 记事本',
    content: 'api sk-abcdefghijklmnopqrstuvwxyz123456',
    meta: '{"doc":{"kind":"text","name":"密钥.txt"}}'
  }];
  const r = reports.summarizeDay(fakeStore(dirty), day);
  assert.doesNotMatch(r.markdown, /sk-abcdefghijklmnopqrstuvwxyz123456/);
});

console.log(`r16: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
