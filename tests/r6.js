const assert = require('assert');
let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + (e.stack || e.message)); } };
const reports = require('../src/core/reports');
const commits = require('../src/core/commitments');

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
  { id: '1', type: 'window', started_at: H('2026-10-21T09:00:00+08:00'), duration_ms: 3600000, app_name: 'VS Code', window_title: 'mindtrace', meta: '{"layer":"focus"}' },
  { id: '2', type: 'browser', started_at: H('2026-10-21T10:00:00+08:00'), duration_ms: 1800000, app_name: 'Edge', url: 'https://api-docs.deepseek.com/pricing', meta: '{"layer":"artifact"}' },
  { id: '3', type: 'file', started_at: H('2026-10-21T11:00:00+08:00'), duration_ms: 600000, app_name: '最近使用', file_path: 'E:/docs/方案.pdf', meta: '{"layer":"artifact"}' },
  { id: '4', type: 'uia', started_at: H('2026-10-21T14:00:00+08:00'), duration_ms: 120000, app_name: '微信', content: '我来写周报，明天下午交给你', meta: '{"layer":"communication"}' }
];

t('日报：有数据 → OK + markdown 含应用', () => {
  const r = reports.summarizeDay(fakeStore(rows), day);
  assert.strictEqual(r.status, 'OK');
  assert.match(r.markdown, /VS Code/);
  assert.match(r.markdown, /api-docs\.deepseek\.com/);
  assert.ok(r.stats.activities >= 4);
});

t('日报：无数据 → NO_DATA', () => {
  const r = reports.summarizeDay(fakeStore([]), day);
  assert.strictEqual(r.status, 'NO_DATA');
  assert.match(r.markdown, /NO_DATA/);
});

t('周报：跨天聚合', () => {
  const weekRows = rows.concat([
    { id: '5', type: 'window', started_at: H('2026-10-20T09:00:00+08:00'), duration_ms: 7200000, app_name: 'Cursor', meta: '{}' }
  ]);
  const r = reports.summarizeWeek(fakeStore(weekRows), day);
  assert.strictEqual(r.status, 'OK');
  assert.match(r.markdown, /Standup/);
  assert.ok(r.stats.days >= 2);
});

t('承诺抽取：我来写周报', () => {
  const items = commits.extractFromText('好的，我来写周报，明天下午交给你。', { now: H('2026-10-21T14:00:00+08:00') });
  assert.ok(items.length >= 1);
  assert.match(items[0].title, /周报/);
  assert.ok(items[0].start_at == null || items[0].start_at > 0);
});

t('承诺抽取：无承诺词不产出', () => {
  assert.strictEqual(commits.extractFromText('今天天气不错，看看文档').length, 0);
});

t('承诺抽取：帮我改一下方案', () => {
  const items = commits.extractFromText('麻烦你帮我改一下方案，周五之前。', { now: H('2026-10-21T10:00:00+08:00') });
  assert.ok(items.length >= 1);
});

console.log(`r6: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
