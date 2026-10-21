const assert = require('assert');
let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + e.message); } };
const sig = require('../src/core/signal');

t('simhash：相同文本距离 0', () => {
  const a = sig.simhash('DeepSeek API 定价说明本地优先');
  assert.strictEqual(sig.hamming(a, a), 0);
});

t('simhash：近义文本距离小，无关文本距离大', () => {
  const a = sig.simhash('DeepSeek API 定价与费用说明');
  const b = sig.simhash('DeepSeek API 价格费用文档');
  const c = sig.simhash('今天天气晴朗适合散步');
  assert.ok(sig.hamming(a, b) < sig.hamming(a, c));
  assert.ok(sig.hamming(a, b) <= 12);
});

t('ObjectDeduper：近义 OCR 在 UIA 之后被 simhash 丢弃', () => {
  const d = new sig.ObjectDeduper({ windowMs: 600000, threshold: 0.99, hashBits: 8 }); // 抬高 jaccard 阈值，逼出 simhash 路径
  const base = { type: 'uia', app_name: 'Edge', window_title: '文档', url: 'https://example.com/a', started_at: 1000, content: '本地优先的个人知识库与记忆系统，数据不上传云端。' };
  const env1 = sig.envelope(base);
  assert.strictEqual(d.check(base, env1).drop, false);
  const ocr = { ...base, type: 'screenshot', started_at: 2000, content: '本地优先的个人知识库与记忆系统，数据不上云。' };
  const env2 = sig.envelope(ocr);
  // 强制同一 object hash
  env2.object = env1.object;
  const r = d.check(ocr, env2);
  assert.strictEqual(r.drop, true);
  assert.match(r.reason, /simhash|same-content/);
});

t('ObjectDeduper：产出层不丢', () => {
  const d = new sig.ObjectDeduper();
  const row = { type: 'note', app_name: '知迹', window_title: '速记', started_at: 1, content: '写一点笔记' };
  assert.strictEqual(d.check(row, sig.envelope(row)).drop, false);
});

console.log(`r9: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
