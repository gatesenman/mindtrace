// 2.4 R3 集成：真实形态一天数据 → 回忆框命中率（hit@1 / hit@5）+ 7 天回顾 + 回填流程（electron）
const { app } = require('electron'); const fs = require('fs'), path = require('path');
const UD = '/tmp/mt-r3-int';
let pass = 0, fail = 0; const t = (n, ok, i = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (i ? ' — ' + i : '')); };
app.whenReady().then(async () => {
  fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true }); app.setPath('userData', UD);
  const store = require('../src/main/store'); await store.initStore({ dbPath: path.join(UD, 'mt.db') });
  require('../src/pro').init({ getConfig: () => ({}) }); require('../src/core/schema').migrate();
  const d0 = new Date(); d0.setHours(0, 0, 0, 0); const base = d0.getTime() - 86400000; // 昨天
  for (const r of require('./fixtures/real-day')(base)) { const { id, ...rest } = r; rest.meta = r.meta ? JSON.parse(r.meta) : undefined; store.insertActivity(rest); }
  store.insertActivity({ type: 'uia', app_name: '微信', process_name: 'Weixin.exe', window_title: '张伟', content: '张伟：2.4 评审改到周五下午三点，记得带上排期表', started_at: base + 13.5 * 3600000 });
  const { recall } = require('../src/recall');
  const Q = [
    ['昨天那个 PRD 文档', r => /PRD-2\.4\.docx/.test(r.path || '')],
    ['昨天下午下载的 zip', r => /electron-v33/.test(r.path || '')],
    ['DeepSeek 文档', r => /deepseek\.com/.test(r.url || '')],
    ['知乎上看的知识管理文章', r => /zhihu\.com/.test(r.url || '')],
    ['周报 PPT', r => /周报-第42周\.pptx/.test(r.path || '')],
    ['better-sqlite3 的 API', r => /better-sqlite3/.test(r.url || '')],
    ['需求排期表格', r => /需求排期\.xlsx/.test(r.path || '')],
    ['昨天上午看的 Electron 文档', r => /electronjs\.org/.test(r.url || '')],
    ['张伟在微信里说的评审时间', r => r.kind === 'conversation' && /周五下午三点/.test(r.snippet || '')],
    ['screenpipe', r => /screenpipe/.test(r.url || '')]
  ];
  let h1 = 0, h5 = 0; const t0 = Date.now(); const miss = [];
  for (const [q, ok] of Q) { const r = recall(store, q).results; const i = r.findIndex(ok); if (i === 0) h1++; if (i >= 0 && i < 5) h5++; else miss.push(q + ' → ' + (r[0]?.title || '空')); }
  const ms = (Date.now() - t0) / Q.length;
  t(`回忆框 hit@5 ≥ 80%`, h5 / Q.length >= 0.8, `hit@1 ${h1}/${Q.length} · hit@5 ${h5}/${Q.length} · 平均 ${ms.toFixed(1)}ms/次${miss.length ? ' · 未命中：' + miss.join('；') : ''}`);
  t('回忆框单次查询 < 150ms', ms < 150, ms.toFixed(1) + 'ms');
  const top = recall(store, '昨天那个 PRD 文档').results[0];
  t('结果带可打开原件路径与来源', !!top.path && top.sources.length >= 1, JSON.stringify({ title: top.title, sources: top.sources, hits: top.hits }));
  const v = require('../src/core/backfill').review7(store, { days: 7 });
  t('7 天回顾：网站 / 文件 / 天数', v.daysActive >= 1 && v.topSites.length >= 4 && v.files.length >= 3, JSON.stringify({ days: v.daysActive, sites: v.topSites.map(s => s.host), files: v.files.map(f => f.name) }));
  const bf = await require('../src/core/backfill').run({ getConfig: () => ({ authorized: true, collectors: {}, privacy: {} }), days: 7 });
  t('回填流程在无数据环境下安全完成', bf.ok && bf.steps.length === 4, JSON.stringify(bf.steps));
  const nb = await require('../src/core/backfill').run({ getConfig: () => ({ authorized: false }) });
  t('未授权时拒绝回填', nb.ok === false);
  console.log(`r3-integration: ${pass} passed, ${fail} failed`); app.exit(fail ? 1 : 0);
});
