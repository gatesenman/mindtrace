const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const USER_DATA = '/tmp/mindtrace-perf-ud';

app.whenReady().then(async () => {
  const results = [];
  const pass = (n, ok, d) => { results.push({ n, ok, d }); console.log(ok ? 'PASS' : 'FAIL', n, d || ''); };
  try {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
    app.setPath('userData', USER_DATA);
    const store = require('../src/main/store');
    const { EventBus } = require('../src/worker/bus');
    const wiki = require('../src/wiki/engine');
    await store.initStore();

    const t0 = Date.now();
    const batch = [];
    for (let i = 0; i < 10000; i++) {
      batch.push({
        type: i % 5 === 0 ? 'browser' : i % 5 === 1 ? 'note' : 'window',
        ts_start: Date.now() - i * 60000,
        app: ['微信', 'Chrome', 'VS Code', 'Word', '终端'][i % 5],
        title: `事件标题 ${i} mindtrace perf`,
        content: i % 3 === 0 ? `这是第 ${i} 条可检索内容，包含关键词知识库与下载资料` : null,
        url: i % 5 === 0 ? `https://example.com/p/${i}` : null
      });
      if (batch.length >= 100) {
        store.insertActivityBatch(batch.splice(0));
      }
    }
    if (batch.length) store.insertActivityBatch(batch);
    const insertMs = Date.now() - t0;
    pass('insert-10k', insertMs < 15000, `ms=${insertMs}`);

    const t1 = Date.now();
    const stats = store.getTodayStats();
    pass('stats', stats.activityCount > 0, `count=${stats.activityCount} ms=${Date.now()-t1}`);

    const t2 = Date.now();
    const fts = store.searchFts('知识库', 20);
    pass('fts-search', fts.length >= 1, `hits=${fts.length} ms=${Date.now()-t2}`);

    const t3 = Date.now();
    const day = require('dayjs')().format('YYYY-MM-DD');
    // rule-based day rollup without AI
    await wiki.buildDayRollup({ ai: {} }, day);
    const rolls = store.getRollups('day');
    pass('day-rollup', rolls.length >= 1, `ms=${Date.now()-t3}`);

    const t4 = Date.now();
    const tl = store.searchActivities({ from: Date.now() - 86400000, limit: 200 });
    pass('timeline-query', tl.length >= 1 && (Date.now()-t4) < 500, `n=${tl.length} ms=${Date.now()-t4}`);

    const wikiPages = store.listWiki('time');
    pass('wiki-time-page', wikiPages.length >= 1, `n=${wikiPages.length}`);

    store.closeStore();
  } catch (e) {
    pass('exception', false, e.stack || e.message);
  }
  const failed = results.filter(r => !r.ok);
  console.log('PERF', results.length - failed.length, '/', results.length);
  app.exit(failed.length ? 1 : 0);
}).catch(e => { console.error(e); app.exit(1); });
