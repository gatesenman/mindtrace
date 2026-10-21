// 2.4 R2 集成：入库即打六层标签 + 对象注册表 + 跨来源去重（electron 下运行）
const { app } = require('electron'); const fs = require('fs'), path = require('path');
const UD = '/tmp/mt-r2-int';
let pass = 0, fail = 0; const t = (n, ok, i = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (i ? ' — ' + i : '')); };
app.whenReady().then(async () => {
  fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true }); app.setPath('userData', UD);
  const store = require('../src/main/store'); await store.initStore({ dbPath: path.join(UD, 'mt.db') });
  require('../src/pro').init({ getConfig: () => ({}) }); require('../src/core/schema').migrate();
  const now = Date.now() - 60000; const page = '六层信号模型：注意力、内容、产出、资源、沟通、上下文。下游只认统一事件，按对象去重而不是按来源去重。';
  store.insertActivity({ type: 'browser', url: 'https://www.example.com/sig?utm_source=x', window_title: '信号模型 - Microsoft Edge', app_name: 'Edge', started_at: now });
  const u = store.insertActivity({ type: 'uia', app_name: 'Edge', window_title: '信号模型 - Microsoft Edge', content: page, started_at: now + 1000 });
  const o = store.insertActivity({ type: 'uia', app_name: 'Edge', window_title: '信号模型 - Microsoft Edge', content: page + ' ', started_at: now + 2000, meta: { via: 'ocr-like' } });
  const n = store.insertActivity({ type: 'note', app_name: '速记', window_title: '想法', content: page, started_at: now + 3000 });
  const d = store.dedupContent({ type: 'screenshot', app_name: 'Edge', window_title: '信号模型 - Microsoft Edge', content: page + ' 10:31', started_at: now + 4000 });
  const rows = store.all(`SELECT type, meta FROM activities ORDER BY started_at`);
  const metas = rows.map(r => JSON.parse(r.meta || '{}'));
  t('入库写入 layer / obj / conf', metas.every(m => m.layer && 'obj' in m), JSON.stringify(metas.map(m => m.layer)));
  t('浏览与 UIA 归并到同一网页对象', metas[0].obj && metas[0].obj === metas[1].obj);
  t('同对象重复 UIA 内容被丢弃', !!u && o === null);
  t('笔记（产出层）照常入库', !!n);
  t('之后的同页 OCR 被判跨来源重复', d.drop === true, d.reason);
  const ob = store.get(`SELECT * FROM objects WHERE hash=?`, [metas[0].obj]);
  t('对象注册表：触达次数与多来源', ob && ob.touches === 2 && ob.adapters === 'browser,uia' && ob.uri === 'example.com/sig', JSON.stringify(ob));
  console.log(`r2-integration: ${pass} passed, ${fail} failed`); app.exit(fail ? 1 : 0);
});
