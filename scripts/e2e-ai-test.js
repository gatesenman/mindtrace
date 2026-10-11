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
