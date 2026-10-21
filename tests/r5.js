const assert = require('assert');
let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + e.message); } };
const S = require('../src/recall/semantic');
const R = require('../src/privacy/redact');
const recall = require('../src/recall');

t('同义词扩展：本地优先 → 含仅本地/local-first', () => {
  const e = S.expandTerms('讲本地优先的文章');
  assert.ok(e.some(x => /仅本地|local-first|不上云/.test(x)));
});

t('bigram 余弦：近义 > 无关', () => {
  const a = S.cosine(S.bigrams('DeepSeek API 定价'), S.bigrams('DeepSeek 价格费用'));
  const b = S.cosine(S.bigrams('DeepSeek API 定价'), S.bigrams('今天天气不错'));
  assert.ok(a > b);
});

t('RRF：两路融合把语义命中抬上来', () => {
  const fts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const sem = [{ id: 'c' }, { id: 'a' }, { id: 'd' }];
  const fused = S.rrf([fts.map(x => x.id), sem.map(x => x.id)], { k: 60 });
  assert.strictEqual(fused[0][0], 'a'); // 两路都靠前
  assert.ok(fused.find(x => x[0] === 'c')[1] > fused.find(x => x[0] === 'd')[1]);
});

t('hybrid：语义池能找回 FTS 未命中的同义标题', () => {
  const fts = [{ id: '1', title: 'Electron 安全', content: '' }];
  const pool = [
    { id: '1', title: 'Electron 安全', content: '' },
    { id: '2', title: '资费说明', content: 'DeepSeek 价格与费用' },
    { id: '3', title: '完全无关', content: '天气预报' }
  ];
  const h = S.hybrid(fts, pool, '定价费用', { limit: 5 });
  assert.ok(h.some(x => x.id === '2'), '应召回资费说明');
});

t('脱敏：身份证/手机/Key', () => {
  const out = R.redactText('证 110101199001011234 手机13812345678 sk-abcdefghijklmnopqrstuv');
  assert.ok(out.includes('[敏感-证件号]'));
  assert.ok(out.includes('[敏感-手机]'));
  assert.ok(out.includes('[敏感-Key]'));
});

t('敏感检测：密码窗整条 drop', () => {
  const d = R.shouldDropCapture({ content: 'MyP@ss', window_title: '登录 - Password' });
  assert.strictEqual(d.drop, true);
  assert.ok(d.hits.includes('password'));
});

t('敏感检测：普通内容不 drop', () => {
  const d = R.shouldDropCapture({ content: '今天评审方案', window_title: '飞书' });
  assert.strictEqual(d.drop, false);
});

t('回忆：语义同义词不破坏原解析', () => {
  const p = recall.parseQuery('上周看的 DeepSeek 定价文章', new Date('2026-10-22T10:00:00+08:00').getTime());
  assert.strictEqual(p.kind, 'web');
  assert.ok(p.terms.includes('DeepSeek'));
});

console.log(`r5: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
