// 噪声过滤集成测试：入库 / 统计 / 知识库(LLM 抽取输入) / 汇总提示词
// 运行：./node_modules/.bin/electron tests/noise-integration.js --no-sandbox
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const UD = '/tmp/mt-noise-int';
let pass = 0, fail = 0; const t = (n, ok, i = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (i ? ' — ' + i : '')); };
app.whenReady().then(async () => {
  fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true }); app.setPath('userData', UD);
  const store = require('../src/main/store');
  await store.initStore({ dbPath: path.join(UD, 'mt.db') });
  require('../src/pro').init({ getConfig: () => ({}) });
  require('../src/core/schema').migrate();
  const noise = require('../src/core/noise'); noise.resetDedupe();
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const rows = require('./fixtures/noisy-day')(Date.now() - 23 * 3600000);
  let inserted = 0;
  for (const r of rows) { const { id, ...rest } = r; rest.meta = r.meta ? JSON.parse(r.meta) : undefined; if (store.insertActivity(rest)) inserted++; }
  const db = store.all(`SELECT type, window_title, content FROM activities`);
  t('入库丢弃任务切换/外壳/知迹自身/内部 JSON', !db.some(r => /任务切换|新通知|锁屏|purpose/.test(`${r.window_title}${r.content}`)) && !db.some(r => r.window_title === '知迹'), `${rows.length} → ${inserted}`);
  t('入库 60s 内重复剪贴板去重', db.filter(r => /会议纪要/.test(r.content || '')).length === 1);
  t('低价值保留入库（可在时间线关闭过滤查看）', db.some(r => r.content === 'ok'));
  const nowT = Date.now() - 2000; // 均在今日内（避开跨零点）
  store.insertActivity({ type: 'window', app_name: '资源管理器', process_name: 'explorer.exe', window_title: '任务切换', started_at: nowT - 1500, ended_at: nowT + 500, duration_ms: 2000 });
  store.insertActivity({ type: 'window', app_name: 'Notepad', process_name: 'notepad.exe', window_title: 'x.txt', started_at: nowT - 1000, ended_at: nowT + 2000, duration_ms: 3000 });
  store.insertActivity({ type: 'window', app_name: 'Edge', process_name: 'msedge.exe', window_title: '文档', started_at: Math.max(d0.getTime(), nowT - 30000), ended_at: nowT, duration_ms: 30000 });
  const st = store.getTodayStats();
  t('统计不计低价值/噪声', (() => { const L = (st.appBreakdown || []).map(a => a.app_name); return L.includes('Edge') && !L.some(n => /资源管理器|Notepad/.test(n)); })(), JSON.stringify((st.appBreakdown||[]).map(a => a.app_name)));
  const kb = require('../src/kb'); const r = kb.ingestNew();
  const chunks = store.all(`SELECT text FROM chunks`).map(c => c.text).join('\n');
  t('知识库/LLM 抽取输入不含噪声', r.docs > 0 && !/任务切换|purpose|grokweb|deepseek-v4-pro/.test(chunks) && /会议纪要|测试平台/.test(chunks), `docs=${r.docs}`);
  const sum = require('../src/ai/summarizer').formatActivities(store.all(`SELECT * FROM activities ORDER BY started_at`));
  t('汇总提示词不含噪声', !/任务切换|grokweb|\bok\b|deepseek-v4-pro/.test(sum) && /会议纪要/.test(sum));
  console.log(`noise-integration: ${pass} passed, ${fail} failed`); app.exit(fail ? 1 : 0);
}).catch(e => { console.error(e); app.exit(1); });
