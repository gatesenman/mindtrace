// 2.5 加固 R2 · 检索跳转及筛选正确性
const assert = require('assert');
const S = require('../src/core/search');
const T = require('../src/common/timerange');

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + (e.stack || e.message)); } };

const t0 = Date.parse('2026-10-21T09:00:00+08:00');

t('Asia/Shanghai 日界：不随宿主本地时区把 00:00 解析错', () => {
  const b = T.dayBoundsShanghai('2026-10-21');
  assert.ok(b);
  assert.strictEqual(b.from, Date.parse('2026-10-21T00:00:00+08:00'));
  assert.strictEqual(b.to, Date.parse('2026-10-21T23:59:59.999+08:00'));
  assert.ok(t0 >= b.from && t0 <= b.to);
  assert.strictEqual(T.dayOfShanghai(t0), '2026-10-21');
  // 北京时间 0 点刚过，UTC 仍是前一天
  const justAfterMidnight = Date.parse('2026-10-21T00:10:00+08:00');
  assert.strictEqual(T.dayOfShanghai(justAfterMidnight), '2026-10-21');
  assert.ok(justAfterMidnight >= b.from);
});

t('时间窗筛选：没有 started_at 的行不得混入', () => {
  assert.strictEqual(T.inRange(0, t0, t0 + 3600000), false);
  assert.strictEqual(T.inRange(null, t0, t0 + 3600000), false);
  assert.strictEqual(T.inRange(t0 + 10, t0, t0 + 3600000), true);
  assert.strictEqual(T.inRange(t0 + 10, null, null), true);
});

t('生产形态 FTS 行（无 meta）：微信窗口判为会话，VS Code 判为代码', () => {
  // searchFts 以前不返回 meta，筛选「会话」「代码」会全部落空
  const wechat = { id: 'wx1', type: 'window', title: '产品研发群', app: '微信', started_at: t0, content: '周五前把发布说明发我。' };
  const vscode = { id: 'c1', type: 'window', title: 'store.js - mindtrace - Visual Studio Code', app: 'Visual Studio Code', process_name: 'Code', started_at: t0, path: 'D:\\\\proj\\\\store.js' };
  const word = { id: 'w1', type: 'window', title: '预算.docx - Word', app: 'Word', path: 'D:\\\\工作\\\\预算.docx', started_at: t0, content: '市场费用' };
  assert.strictEqual(S.kindOf(wechat), 'chat');
  assert.strictEqual(S.kindOf(vscode), 'code');
  assert.strictEqual(S.kindOf(word), 'file');
});

t('kind 筛选在无 meta 的行上仍然有效，跳转字段完整；缺时间戳被时间窗丢掉', () => {
  const rows = [
    { id: 'wx1', type: 'window', title: '产品研发群', app: '微信', started_at: t0, content: '周五前把发布说明发我。' },
    { id: 'c1', type: 'window', title: 'store.js', app: 'Visual Studio Code', process_name: 'Code', started_at: t0 + 3600000, content: '修复检索' },
    { id: 'ghost', type: 'window', title: '产品研发群备份', app: '微信', content: '周五前把发布说明发我。' } // no started_at
  ];
  const store = {
    searchFts(q, limit) {
      return rows.filter(r => JSON.stringify(r).includes(q)).slice(0, limit);
    }
  };
  const chat = S.search('发布说明', { store, kind: 'chat', from: t0 - 1000, to: t0 + 1000 });
  assert.ok(chat.activities.every(a => a.kind === 'chat'));
  assert.deepStrictEqual(chat.activities.map(a => a.id), ['wx1']);
  assert.deepStrictEqual(chat.activities[0].jump, { activityId: 'wx1', started_at: t0 });
  assert.strictEqual(chat.activities[0].app, '微信');

  const code = S.search('检索', { store, kind: 'code' });
  assert.ok(code.activities.some(a => a.id === 'c1'));
  assert.ok(code.activities.every(a => a.kind === 'code'));
});

t('decorate 把 app_name 规整到 app，供结果列表显示', () => {
  const d = S.decorate({ id: '1', app_name: 'Word', window_title: '预算.docx', started_at: t0, content: '费用' }, '费用');
  assert.strictEqual(d.app, 'Word');
  assert.strictEqual(d.title, '预算.docx');
});

t('非法日期返回 null，不抛异常', () => {
  assert.strictEqual(T.dayBoundsShanghai('not-a-date'), null);
  assert.strictEqual(T.dayBoundsShanghai(''), null);
});

console.log(`r19: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
