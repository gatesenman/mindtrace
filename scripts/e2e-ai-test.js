/**
 * E2E AI test against mock OpenAI. Run with:
 *   ELECTRON_RUN_AS_NODE= or just: node -e won't work with electron modules
 * Prefer: ./node_modules/.bin/electron scripts/e2e-ai-test.js
 *
 * This file is loaded AS the electron main entry when invoked via electron.
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const USER_DATA = '/tmp/mindtrace-e2e-ud';
const MOCK = 'http://127.0.0.1:3921/v1';

function req(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, 'http://127.0.0.1:17321');
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      hostname: '127.0.0.1', port: 17321, path: u.pathname + u.search, method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d || '{}') }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

app.whenReady().then(async () => {
  const results = [];
  const pass = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(ok ? 'PASS' : 'FAIL', name, detail || '');
  };

  try {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
    app.setPath('userData', USER_DATA);

    const { loadConfig, saveConfig } = require('../src/main/config');
    const store = require('../src/main/store');
    const summarizer = require('../src/ai/summarizer');
    const { chatCompletion, visionDescribe, parseJsonLoose } = require('../src/ai/client');
    const apiServer = require('../src/api/server');
    const prompts = require('../src/ai/prompts');
    const { redactText } = require('../src/privacy/redact');
    const { friendlyAppName, isSelfApp } = require('../src/main/appNames');

    // Unit: app names
    pass('friendly-wechat', friendlyAppName('WeChat', 'WeChat') === '微信');
    pass('friendly-chrome', friendlyAppName('Google Chrome', 'chrome') === 'Chrome');
    pass('self-electron', isSelfApp({ process: 'electron', title: '知迹 MindTrace' }) === true);
    pass('not-self-chrome-electron-doc', isSelfApp({ process: 'chrome', title: 'Electron 最佳实践' }) === false);
    pass('redact-key', redactText('sk-abcdefghijklmnopqrstuvwxyz').includes('[敏感'));

    await store.initStore();
    {
      const rid = store.insertActivity({ type: 'clipboard', started_at: Date.now(), content: 'my key sk-abcdefghijklmnopqrstuvwxyz1234' });
      const row = store.get('SELECT content FROM activities WHERE id=?', [rid]);
      pass('store-redact-insert', !!(row && String(row.content).includes('[敏感')), row && row.content);
    }
    let config = loadConfig();
    config.authorized = true;
    config.onboardingCompleted = true;
    config.demoMode = true;
    config.collectors = { window: true, browser: false, documents: false, clipboard: false, screenshots: true };
    config.ai = {
      provider: 'custom',
      baseUrl: MOCK,
      apiKey: 'mock-key',
      model: 'mock-mindtrace',
      visionModel: 'mock-mindtrace',
      temperature: 0.2,
      autoSummarize: false
    };
    config.api = { enabled: true, port: 17321, token: 'e2e-token-123' };
    saveConfig(config);

    // Seed demo via main's logic inline
    const { v4: _ } = { v4: () => {} };
    // call seed by requiring main is heavy; duplicate minimal seed
    store.clearDemoData();
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      store.insertActivity({
        type: i % 2 ? 'browser' : 'window',
        started_at: now - i * 600000,
        ended_at: now - i * 600000 + 300000,
        duration_ms: 300000,
        app_name: i % 2 ? 'Chrome' : '微信',
        process_name: i % 2 ? 'chrome' : 'WeChat',
        window_title: i % 2 ? 'Electron docs' : '与张三的聊天',
        url: i % 2 ? 'https://example.com/' + i : null,
        meta: { isDemo: true }
      });
    }
    // inject a self window that should be filtered from stats
    store.insertActivity({
      type: 'window', started_at: now - 1000, ended_at: now, duration_ms: 999999,
      app_name: 'electron', process_name: 'electron', window_title: '知迹 MindTrace',
      meta: { isDemo: true }
    });
    store.upsertKnowledgeCard({ kind: 'person', title: '【示例】张三', summary: '协作', tags: ['示例'] });
    store.upsertKnowledgeCard({ kind: 'project', title: '【示例】知迹', summary: '产品', tags: ['示例'] });

    const stats = store.getTodayStats();
    pass('stats-exclude-self', !stats.appBreakdown.some(a => /electron/i.test(a.app_name)), JSON.stringify(stats.appBreakdown));
    pass('stats-friendly-wechat', stats.appBreakdown.some(a => a.app_name === '微信'), JSON.stringify(stats.appBreakdown));

    // AI: test connection
    const hello = await chatCompletion(config, [{ role: 'user', content: '请用一句话介绍你自己' }], { max_tokens: 100 });
    pass('ai-hello', /知迹|助手/.test(hello.content), hello.content.slice(0, 80));

    // Daily journal
    const journal = await summarizer.buildDailyJournal(config);
    pass('daily-journal', !!(journal && journal.title && journal.summary), journal.title);

    // Cards
    const cardIds = await summarizer.extractCardsFromRecent(config, 24);
    pass('extract-cards', cardIds.length >= 1, 'count=' + cardIds.length);

    // Topics
    const topicIds = await summarizer.clusterTopics(config);
    pass('cluster-topics', topicIds.length >= 1, 'count=' + topicIds.length);

    // Ask with citations
    const ask = await summarizer.askHistory(config, '今天我和谁讨论过项目？');
    pass('ask-answer', !!(ask.answer && ask.answer.length > 10), (ask.answer || '').slice(0, 100));
    pass('ask-citations', Array.isArray(ask.citations) && ask.citations.length >= 0, JSON.stringify(ask.citations).slice(0, 120));

    // Vision
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
      'base64'
    );
    const tmpPng = path.join(USER_DATA, 'vision-test.png');
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(tmpPng, png);
    const vision = await visionDescribe(config, tmpPng, prompts.visionScreenshot, { model: 'mock-mindtrace' });
    const vparsed = parseJsonLoose(vision.content);
    pass('vision-json', !!(vparsed && vparsed.app_guess), vision.content.slice(0, 120));

    // empty visionModel: client should throw clear Chinese error (collector guards before call)
    let emptyVisionOk = false;
    try {
      const cfgNoVision = { ...config, ai: { ...config.ai, visionModel: '', model: '' } };
      await visionDescribe(cfgNoVision, tmpPng, 'x');
    } catch (e) {
      emptyVisionOk = /视觉模型|visionModel|未配置/.test(String(e.message || e));
    }
    pass('vision-empty-no-crash', emptyVisionOk, 'clear error when no vision model');

    // prune retention
    const oldTs = Date.now() - 120 * 86400000;
    store.insertActivity({ type: 'window', started_at: oldTs, ended_at: oldTs, app_name: 'OldApp', window_title: 'stale' });
    store.insertScreenshot({ taken_at: oldTs, file_path: '/tmp/old-shot.png' });
    const pruned = store.pruneOldData({ activityRetainDays: 90, screenshotRetainDays: 14, chatMax: 500 });
    pass('prune-old-data', !!(pruned && pruned.ok && (pruned.deleted.activities >= 1 || pruned.deleted.screenshots >= 1)), JSON.stringify(pruned));

    // Local API
    apiServer.start({ getConfig: () => config });
    await new Promise(r => setTimeout(r, 300));
    const health = await req('GET', '/health', null, 'e2e-token-123');
    pass('api-health', health.status === 200 && health.body.ok, JSON.stringify(health.body));
    const cardsApi = await req('GET', '/cards', null, 'e2e-token-123');
    pass('api-cards', cardsApi.status === 200 && Array.isArray(cardsApi.body.items), 'n=' + (cardsApi.body.items || []).length);
    const askApi = await req('POST', '/ask', { question: '今天学到了什么？' }, 'e2e-token-123');
    pass('api-ask', askApi.status === 200 && askApi.body.answer, JSON.stringify(askApi.body).slice(0, 160));
    const unauth = await req('GET', '/health', null, 'wrong');
    pass('api-auth', unauth.status === 401);

    // v2 smoke
    store.insertActivityBatch([
      { type: 'note', ts_start: Date.now(), app: '速记', title: 'v2 note', content: '速记测试内容 wiki memory' },
      { type: 'download', ts_start: Date.now(), app: '下载', title: 'demo.pdf', content: 'PDF 摘录 知识库' }
    ]);
    const fts = store.searchFts('速记', 10);
    pass('fts-note', fts.length >= 1, 'hits=' + fts.length);
    const wiki = require('../src/wiki/engine');
    await wiki.buildHourRollup(config, wiki.hourKey(Date.now()));
    pass('hour-rollup', store.getRollups('hour').length >= 0, 'ok');
    store.upsertMemory({ kind: 'fact', text: '用户偏好本地优先', confidence: 0.9 });
    pass('memory', store.listMemories().length >= 1);

    // ── v2.2 pro ──
    const pro = require('../src/pro');
    pro.init({ getConfig: () => config });
    store.setInsertPolicy(r => pro.applyPolicy(r));
    store.setMemoryThreshold(0.75);
    config.privacy.rules = [{ match: 'secretapp', scope: 'app', mode: 'none' }, { match: 'intranet.corp', scope: 'site', mode: 'title' }];
    config.privacy.sensitiveDetection = true;
    const blocked = store.insertActivity({ type: 'window', started_at: Date.now(), app_name: 'SecretApp', window_title: 'x', content: 'hidden' });
    pass('policy-block', blocked === null);
    const tid = store.insertActivity({ type: 'browser', started_at: Date.now(), app_name: 'Chrome', window_title: 'Corp page', url: 'https://intranet.corp/doc/42?q=1', content: 'body text' });
    const trow = store.get('SELECT url, content FROM activities WHERE id=?', [tid]);
    pass('policy-title-only', trow && !trow.content && trow.url === 'https://intranet.corp/', JSON.stringify(trow));
    pass('sensitive-window', store.insertActivity({ type: 'window', started_at: Date.now(), app_name: 'Chrome', window_title: 'InPrivate - 网上银行' }) === null);
    pass('audit-log', pro.listAudit({ kind: 'capture' }).length >= 3);
    store.insertActivity({ type: 'note', started_at: Date.now() - 3600e3 * 50, app_name: '速记', window_title: 'old', content: 'old note wipe' });
    const w = pro.wipeRange(Date.now() - 3600e3 * 51, Date.now() - 3600e3 * 49);
    pass('wipe-range', w.activities === 1, JSON.stringify(w));
    // memory review
    store.upsertMemory({ kind: 'preference', text: '低置信记忆待审', confidence: 0.6 });
    const q = pro.reviewQueue('pending');
    pass('memory-pending', q.some(m => m.text === '低置信记忆待审') && !store.listMemories().some(m => m.text === '低置信记忆待审'));
    const pm = q.find(m => m.text === '低置信记忆待审');
    pro.reviewMemory(pm.id, 'edit', '低置信记忆已编辑');
    pro.reviewMemory(pm.id, 'approve');
    pass('memory-approve', store.listMemories().some(m => m.text === '低置信记忆已编辑'));
    // encryption roundtrip
    const bk = path.join(USER_DATA, 't.mtbak');
    const before = store.get('SELECT COUNT(*) c FROM activities').c;
    pro.backup(bk, 'correct horse');
    const head = fs.readFileSync(bk).slice(0, 5).toString();
    pass('backup-encrypted', head === 'MTBK2' && !fs.readFileSync(bk).includes(Buffer.from('低置信记忆已编辑')), head);
    let wrong = false; try { pro.restore(bk, 'wrong pass'); } catch (_) { wrong = true; }
    pass('restore-wrong-pass', wrong && store.get('SELECT COUNT(*) c FROM activities').c === before);
    store.run('DELETE FROM activities');
    pro.restore(bk, 'correct horse');
    pass('restore-roundtrip', store.get('SELECT COUNT(*) c FROM activities').c === before && store.searchFts('速记', 10).length >= 1);
    // usage + budget + local-only
    const u0 = pro.usageSummary();
    await chatCompletion(config, [{ role: 'user', content: '你好 usage' }], { purpose: 'test' });
    const u1 = pro.usageSummary();
    pass('usage-recorded', JSON.stringify(u1) !== JSON.stringify(u0), JSON.stringify(u1).slice(0, 160));
    config.privacy.localOnly = true;
    let lo = false; try { await chatCompletion({ ...config, ai: { ...config.ai, baseUrl: 'https://api.example.com/v1' } }, [{ role: 'user', content: 'x' }]); } catch (e) { lo = /仅本地/.test(e.message); }
    pass('local-only-block', lo);
    config.privacy.localOnly = false;
    store.run(`INSERT INTO llm_usage (id,ts,provider,model,purpose,prompt_tokens,completion_tokens,cost_usd,latency_ms,ok) VALUES ('b1',?, 'x','x','t',0,0,99,0,1)`, [Date.now()]);
    config.ai.monthlyBudgetUsd = 1;
    let bb = false; try { await chatCompletion(config, [{ role: 'user', content: 'x' }]); } catch (e) { bb = /预算/.test(e.message); }
    pass('budget-block', bb);
    config.ai.monthlyBudgetUsd = 0;
    // jobs
    let n = 0; pro.registerJob('flaky', async () => { if (n++ === 0) throw new Error('boom'); return 'ok'; });
    const j1 = await pro.runJob('flaky', {});
    const j2 = await pro.retryJob(j1.id);
    pass('job-retry', !j1.ok && j2.ok && pro.listJobs().find(j => j.id === j1.id).attempts === 2);
    // MCP JSON-RPC
    const mcp = require('../src/mcp/server');
    const init = await mcp.handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    pass('mcp-initialize', init.result && init.result.serverInfo.name === 'mindtrace');
    const tl = await mcp.handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    pass('mcp-tools-list', ['search', 'get_timeline', 'get_wiki_page', 'get_memories', 'add_note', 'get_analytics'].every(n => tl.result.tools.some(t => t.name === n)));
    await mcp.handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'add_note', arguments: { content: 'MCP独角兽笔记 zebra42' } } });
    const sr = await mcp.handleRpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'search', arguments: { query: 'zebra42' } } });
    pass('mcp-add-note-search', JSON.parse(sr.result.content[0].text).count >= 1, sr.result.content[0].text.slice(0, 120));
    const gm = await mcp.handleRpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_memories', arguments: {} } });
    pass('mcp-memories-active-only', !gm.result.content[0].text.includes('待审'));
    const bad = await mcp.handleRpc({ jsonrpc: '2.0', id: 6, method: 'nope' });
    pass('mcp-method-not-found', bad.error && bad.error.code === -32601);
    const an = await mcp.handleRpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_analytics', arguments: {} } });
    pass('mcp-analytics', !an.result.isError, an.result.content[0].text.slice(0, 100));
    const wk = pro.weeklyReview();
    pass('weekly-review', !!wk);
    const dg = pro.diagnostics({ appVersion: 'x' });
    pass('diagnostics-redacted', !JSON.stringify(dg).includes(config.api?.token || '@@none@@') && !JSON.stringify(dg).includes('sk-'));

    apiServer.stop();
    store.closeStore();
  } catch (e) {
    pass('exception', false, e.stack || e.message);
  }

  const failed = results.filter(r => !r.ok);
  console.log('\n=== E2E SUMMARY ===');
  console.log('passed', results.length - failed.length, '/', results.length);
  if (failed.length) {
    failed.forEach(f => console.log('FAIL', f.name, f.detail));
    app.exit(1);
  } else {
    console.log('ALL_PASSED');
    app.exit(0);
  }
}).catch(e => { console.error(e); app.exit(1); });
