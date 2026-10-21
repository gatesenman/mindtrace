// 2.4 R4：上下文层 + 信号层着色辅助
const assert = require('assert');
let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + e.message); } };

const ctx = require('../src/collectors/context');
const sig = require('../src/core/signal');

t('LAYERS.context 绑定 context 采集器', () => {
  assert.deepStrictEqual(sig.LAYERS.context.collectors, ['context']);
});

t('context 默认不在线时 tags 含 online/ac 或 battery', () => {
  ctx._set({ afk: false, onBattery: false, online: true, afkSince: null });
  const tags = ctx.tags();
  assert.ok(tags.includes('online'));
  assert.ok(tags.includes('ac'));
  assert.ok(!tags.includes('afk'));
});

t('afk + 电池 → tags 含 afk/battery', () => {
  ctx._set({ afk: true, afkSince: Date.now() - 600000, onBattery: true, online: false });
  const tags = ctx.tags();
  assert.deepStrictEqual(tags.sort(), ['afk', 'battery', 'offline'].sort());
  const s = ctx.snapshot();
  assert.strictEqual(s.afk, true);
  assert.strictEqual(s.onBattery, true);
});

t('envelope：window → focus；聊天窗口 → communication', () => {
  const a = sig.envelope({ type: 'window', app_name: 'VS Code', window_title: 'a.js', started_at: 1 });
  assert.strictEqual(a.layer, 'focus');
  const b = sig.envelope({ type: 'window', app_name: '微信', window_title: '张伟', started_at: 1 });
  assert.strictEqual(b.layer, 'communication');
});

t('envelope：browser → artifact；uia 聊天 → communication', () => {
  assert.strictEqual(sig.envelope({ type: 'browser', url: 'https://example.com', started_at: 1 }).layer, 'artifact');
  assert.strictEqual(sig.envelope({ type: 'uia', app_name: '飞书', content: 'hi', started_at: 1 }).layer, 'communication');
});

t('readOnline / readPower 可调用且不抛', () => {
  assert.strictEqual(typeof ctx.readOnline(), 'boolean');
  const p = ctx.readPower();
  assert.ok('onBattery' in p);
});

console.log(`r4: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
