const {
  app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen,
  clipboard, desktopCapturer, dialog, shell, globalShortcut
} = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const { loadConfig, saveConfig, PRESETS } = require('./config');
const store = require('./store');
const windowTracker = require('../collectors/windowTracker');
const browserHistory = require('../collectors/browserHistory');
const clipboardCollector = require('../collectors/clipboard');
const documents = require('../collectors/documents');
const screenshots = require('../collectors/screenshots');
const summarizer = require('../ai/summarizer');
const { chatCompletion } = require('../ai/client');
const { exportVault } = require('../export/markdown');
const apiServer = require('../api/server');
const collectorStatus = require('./collectorStatus');
const { installProcessHandlers, appendLog, getLogPath, initLogger } = require('./logger');

let mainWindow = null;
let tray = null;
let config = null;
let summarizeTimer = null;

const isDev = process.argv.includes('--dev');

try {
  app.setName('知迹 MindTrace');
  if (process.platform === 'linux') {
    app.commandLine.appendSwitch('class', 'MindTrace');
  }
} catch (_) {}


// Single-instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}


function getConfig() { return config; }


async function runScreenshotTour() {
  const shotDir = path.join(__dirname, '../../screenshots');
  fs.mkdirSync(shotDir, { recursive: true });
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const capture = async (name) => {
    const img = await mainWindow.webContents.capturePage();
    const dest = path.join(shotDir, name);
    fs.writeFileSync(dest, img.toPNG());
    console.log('SHOT', dest);
  };
  await wait(1500);
  await capture('01-onboarding-welcome.png');
  await mainWindow.webContents.executeJavaScript(`document.getElementById('ob-next1')?.click()`);
  await wait(600);
  await capture('02-onboarding-collectors.png');
  await mainWindow.webContents.executeJavaScript(`document.getElementById('ob-c-window').checked=true;document.getElementById('ob-c-browser').checked=true;document.getElementById('ob-next2')?.click()`);
  await wait(600);
  await capture('03-onboarding-ai.png');
  await mainWindow.webContents.executeJavaScript(`document.getElementById('ob-skip3')?.click()`);
  await wait(600);
  await capture('04-onboarding-ready.png');
  await mainWindow.webContents.executeJavaScript(`document.getElementById('ob-finish')?.click()`);
  await wait(1200);
  setDemoMode(true);
  await mainWindow.webContents.executeJavaScript(`window.mindtrace && (async()=>{const s=document.querySelector('[data-view=dashboard]'); s&&s.click(); await new Promise(r=>setTimeout(r,400));})()`);
  await wait(800);
  await capture('05-dashboard.png');
  for (const [view, file] of [['timeline','06-timeline.png'],['knowledge','07-knowledge.png'],['chat','08-chat.png'],['collect','09-collect.png'],['ai','10-settings.png']]) {
    await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view="${view}"]')?.click()`);
    await wait(700);
    if (view === 'knowledge') {
      await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-ktab=journals]')?.click()`);
      await wait(400); await capture('07a-knowledge-journals.png');
      await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-ktab=topics]')?.click()`);
      await wait(400); await capture('07b-knowledge-topics.png');
      await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-ktab=cards]')?.click()`);
      await wait(400);
    }
    await capture(file);
  }
  // Dark mode tour
  await mainWindow.webContents.executeJavaScript(`
    document.body.setAttribute('data-theme','dark');
    document.body.classList.add('theme-dark');
    document.body.classList.remove('theme-light');
    document.querySelector('[data-view=dashboard]')?.click();
  `);
  await wait(600);
  await capture('11-dashboard-dark.png');
  for (const [view, file] of [['timeline','12-timeline-dark.png'],['knowledge','13-knowledge-dark.png'],['chat','14-chat-dark.png'],['collect','15-collect-dark.png'],['ai','16-settings-dark.png']]) {
    await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view="${view}"]')?.click()`);
    await wait(600);
    await capture(file);
  }
  // Empty states (demo off)
  setDemoMode(false);
  await mainWindow.webContents.executeJavaScript(`
    document.body.setAttribute('data-theme','light');
    document.body.classList.remove('theme-dark');
    document.querySelector('[data-view=dashboard]')?.click();
  `);
  await wait(700);
  await capture('17-dashboard-empty.png');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=chat]')?.click()`);
  await wait(500);
  await capture('18-chat-empty.png');
  console.log('SCREENSHOT_TOUR_DONE');
  app.isQuitting = true;
  app.quit();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: '知迹 MindTrace',
    backgroundColor: '#F6F7F9',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, '../../assets/icon.png')
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.argv.includes('--screenshot-tour')) {
      // fresh onboarding for tour
      runScreenshotTour().catch(e => { console.error(e); app.quit(); });
    }
  });
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function trayIcon() {
  let factor = 1;
  try {
    factor = screen.getPrimaryDisplay()?.scaleFactor || 1;
  } catch (_) {}
  // Windows tray: ~16px logical; HiDPI needs scaleFactor×16 physical pixels
  const target = Math.max(16, Math.round(16 * factor));
  const assets = path.join(__dirname, '../../assets');
  let srcName = 'icon-32.png';
  if (target > 64) srcName = 'icon-128.png';
  else if (target > 32) srcName = 'icon-64.png';
  const p = path.join(assets, srcName);
  const fallback = path.join(assets, 'icon-32.png');
  const use = fs.existsSync(p) ? p : (fs.existsSync(fallback) ? fallback : null);
  if (!use) return nativeImage.createEmpty();
  let img = nativeImage.createFromPath(use);
  if (img.isEmpty()) return img;
  const { width, height } = img.getSize();
  if (width !== target || height !== target) {
    img = img.resize({ width: target, height: target, quality: 'best' });
  }
  return img;
}

function refreshTrayImage() {
  if (!tray) return;
  try { tray.setImage(trayIcon()); } catch (e) { console.error('tray image', e.message); }
}

function buildTray() {
  tray = new Tray(trayIcon());
  try {
    screen.removeAllListeners('display-metrics-changed');
    screen.on('display-metrics-changed', () => refreshTrayImage());
  } catch (_) {}
  const update = () => {
    const paused = !!config.privacy?.paused;
    const menu = Menu.buildFromTemplate([
      { label: '打开知迹', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
      { label: paused ? '继续采集' : '暂停采集', click: () => setPaused(!paused) },
      { type: 'separator' },
      { label: '立即截图', click: () => screenshots.capture(true) },
      { label: '生成今日日报', click: () => summarizer.buildDailyJournal(config).catch(console.error) },
      { type: 'separator' },
      { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(menu);
    tray.setToolTip(paused ? '知迹 MindTrace（已暂停）' : '知迹 MindTrace');
  };
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
  update();
  return update;
}

let updateTray = () => {};

function setPaused(paused) {
  config.privacy.paused = !!paused;
  saveConfig(config);
  updateTray();
  broadcastStatus();
}

function broadcastStatus() {
  mainWindow?.webContents.send('status', {
    paused: !!config.privacy?.paused,
    authorized: !!config.authorized,
    collecting: !!config.authorized && !config.privacy?.paused
  });
}

function startCollectors() {
  const opts = { getConfig };
  const cols = config.collectors || {};
  const safe = (name, fn) => {
    try { fn(); }
    catch (e) {
      collectorStatus.err(name, e);
      appendLog('ERROR', `start:${name}`, e);
    }
  };
  if (!cols.window) collectorStatus.disabled('window');
  else safe('window', () => windowTracker.start({ ...opts, intervalMs: 2000, onChange: () => {} }));
  if (!cols.browser) collectorStatus.disabled('browser');
  else safe('browser', () => browserHistory.start({ ...opts, intervalMs: 60000 }));
  if (!cols.clipboard) collectorStatus.disabled('clipboard');
  else safe('clipboard', () => clipboardCollector.start({ ...opts, clipboard, intervalMs: 1500 }));
  if (!cols.documents) collectorStatus.disabled('documents');
  else safe('documents', () => documents.start(opts));
  if (!cols.screenshots) collectorStatus.disabled('screenshots');
  else safe('screenshots', () => screenshots.start({ ...opts, desktopCapturer, BrowserWindow }));
  try {
    if (config.api?.enabled) apiServer.start({ getConfig });
  } catch (e) { appendLog('ERROR', 'start:api', e); }
  scheduleSummarize();
}

function stopCollectors() {
  windowTracker.stop();
  browserHistory.stop();
  clipboardCollector.stop();
  documents.stop();
  screenshots.stop();
  apiServer.stop();
  if (summarizeTimer) clearInterval(summarizeTimer);
}

function scheduleSummarize() {
  if (summarizeTimer) clearInterval(summarizeTimer);
  const min = config.ai?.summarizeIntervalMin || 60;
  summarizeTimer = setInterval(() => {
    summarizer.maybeAutoSummarize(config);
  }, Math.max(15, min) * 60 * 1000);
}


function registerPauseHotkey() {
  try { globalShortcut.unregisterAll(); } catch (_) {}
  const accel = config.privacy?.pauseHotkey || 'CommandOrControl+Shift+M';
  try {
    globalShortcut.register(accel, () => {
      setPaused(!config.privacy.paused);
      mainWindow?.webContents.send('status', { paused: config.privacy.paused, toast: config.privacy.paused ? '已暂停采集' : '已恢复采集' });
    });
  } catch (e) {
    console.error('hotkey', e.message);
  }
}

function applyBoot() {
  try {
    app.setLoginItemSettings({ openAtLogin: !!config.startOnBoot, path: process.execPath });
  } catch (_) {}
}

function seedDemoData() {
  store.clearDemoData();
  const now = Date.now();
  const apps = [
    ['Google Chrome', '阅读：Electron 最佳实践', 'browser'],
    ['微信', '与张三的聊天', 'window'],
    ['Word', '季度总结.docx', 'document'],
    ['VS Code', 'mindtrace - main.js', 'window'],
    ['Microsoft Edge', 'DeepSeek API 文档', 'browser']
  ];
  for (let i = 0; i < 20; i++) {
    const a = apps[i % apps.length];
    const start = now - (20 - i) * 12 * 60000;
    store.insertActivity({
      type: a[2] === 'browser' ? 'browser' : a[2] === 'document' ? 'document' : 'window',
      started_at: start,
      ended_at: start + 10 * 60000,
      duration_ms: 10 * 60000,
      app_name: a[0],
      process_name: a[0],
      window_title: a[1],
      url: a[2] === 'browser' ? 'https://example.com/demo/' + i : null,
      file_path: a[2] === 'document' ? 'C:/Users/演示用户/Documents/季度总结.docx' : null,
      content: a[2] === 'document' ? '本季度重点推进知识管理系统建设…' : null,
      meta: { isDemo: true }
    });
  }
  const c1 = store.upsertKnowledgeCard({ kind: 'project', title: '【示例】知迹 MindTrace', summary: '个人桌面行为转数字资产的桌面应用', tags: ['产品', 'Electron', '示例'], content: '示例项目卡片：覆盖采集、AI 沉淀与导出。' });
  const c2 = store.upsertKnowledgeCard({ kind: 'learning', title: '【示例】Electron 安全预加载', summary: '使用 contextBridge 暴露有限 API，关闭 nodeIntegration', tags: ['技术', '示例'] });
  const c3 = store.upsertKnowledgeCard({ kind: 'person', title: '【示例】张三', summary: '协作沟通对象（示例）', tags: ['人脉', '示例'] });
  store.upsertKnowledgeCard({ kind: 'todo', title: '【示例】配置 AI API Key', summary: '在设置中填入 DeepSeek / 通义 / Kimi Key', tags: ['待办', '示例'] });
  store.upsertKnowledgeCard({ kind: 'link', title: '【示例】DeepSeek API 文档', summary: 'https://api-docs.deepseek.com', tags: ['链接', '示例'], links: [{ title: 'DeepSeek', url: 'https://api-docs.deepseek.com' }] });
  store.upsertJournal({
    period: 'daily',
    period_key: new Date().toISOString().slice(0, 10),
    title: '示例日报：搭建数字资产管道',
    content: '【示例数据】今天主要在浏览器查阅资料、用文档整理思路，并通过微信沟通。知迹将这些碎片活动汇总为可检索资产。',
    highlights: ['搭建采集器', '设计知识卡片', '准备 AI 总结']
  });
  store.upsertTopic({ name: '【示例】桌面知识产品', summary: '围绕知迹产品的设计与实现。示例主题。', card_ids: [c1, c2], activity_count: 12, last_seen: now });
  store.upsertTopic({ name: '【示例】协作沟通', summary: '与张三等协作相关的讨论与待办。示例主题。', card_ids: [c3], activity_count: 5, last_seen: now });

  // Sample ask-history thread with citations (demo mode empty-state polish)
  try { store.run(`DELETE FROM chat_messages`); } catch (_) {}
  const acts = store.all(`SELECT id, app_name, window_title, started_at FROM activities WHERE meta LIKE '%isDemo%' ORDER BY started_at DESC LIMIT 5`);
  const wechat = acts.find(a => /微信/.test(a.app_name || '')) || acts[0];
  const vscode = acts.find(a => /VS Code|Code/.test(a.app_name || '')) || acts[1] || acts[0];
  store.addChatMessage('user', '今天我和谁讨论过项目进度？');
  store.addChatMessage(
    'assistant',
    '根据记录，你今天通过微信与「张三」沟通了项目相关事项，并在 VS Code 中继续推进知迹的实现。[C1]\n\n建议把「配置 AI API Key」待办尽快完成，以便自动生成日刊。',
    [
      wechat && { key: 'E1', kind: 'activity', id: wechat.id, type: 'window', label: `${wechat.app_name || ''} ${wechat.window_title || ''}`.trim(), started_at: wechat.started_at },
      { key: 'C1', kind: 'card', id: c3, type: 'person', label: '【示例】张三' },
      vscode && { key: 'E2', kind: 'activity', id: vscode.id, type: 'window', label: `${vscode.app_name || ''} ${vscode.window_title || ''}`.trim(), started_at: vscode.started_at }
    ].filter(Boolean)
  );
}

function setDemoMode(on) {
  config.demoMode = !!on;
  saveConfig(config);
  if (on) seedDemoData();
  else store.clearDemoData();
  return { ok: true, demoMode: config.demoMode };
}

function registerIpc() {
  ipcMain.handle('get-state', () => ({
    config: {
      ...config,
      ai: { ...config.ai, apiKey: config.ai.apiKey ? '••••' + config.ai.apiKey.slice(-4) : '' }
    },
    configRawKeySet: !!config.ai.apiKey,
    platform: process.platform,
    version: app.getVersion(),
    userData: app.getPath('userData'),
    apiPort: config.api?.port || 17321
  }));

  ipcMain.handle('set-config', (_e, patch) => {
    // preserve real api key if masked
    if (patch.ai && typeof patch.ai.apiKey === 'string' && patch.ai.apiKey.startsWith('••••')) {
      patch.ai.apiKey = config.ai.apiKey;
    }
    const merge = (a, b) => {
      for (const k of Object.keys(b || {})) {
        if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) a[k] = merge(a[k] || {}, b[k]);
        else a[k] = b[k];
      }
      return a;
    };
    config = merge(config, patch);
    saveConfig(config);
    applyBoot();
    if (patch.api || patch.collectors || patch.privacy || patch.watchFolders) {
      stopCollectors();
      if (config.authorized && config.startCollectingOnLaunch !== false) startCollectors();
    } else {
      scheduleSummarize();
      apiServer.stop();
      if (config.api?.enabled) apiServer.start({ getConfig });
    }
    registerPauseHotkey();
    updateTray();
    broadcastStatus();
    return { ok: true };
  });

  ipcMain.handle('authorize', (_e, ok, collectorsPatch) => {
    config.authorized = !!ok;
    config.onboardingCompleted = !!ok;
    config.authorizedAt = ok ? new Date().toISOString() : null;
    if (ok && collectorsPatch && typeof collectorsPatch === 'object') {
      config.collectors = { ...config.collectors, ...collectorsPatch };
    }
    saveConfig(config);
    if (ok) startCollectors();
    else stopCollectors();
    registerPauseHotkey();
    updateTray();
    broadcastStatus();
    return { ok: true, authorized: config.authorized, collectors: config.collectors };
  });

  ipcMain.handle('set-paused', (_e, paused) => {
    setPaused(paused);
    return { ok: true, paused: config.privacy.paused };
  });

  ipcMain.handle('get-today-stats', () => store.getTodayStats());
  ipcMain.handle('get-timeline', (_e, opts = {}) => {
    const from = opts.from || (Date.now() - 86400000);
    const to = opts.to || Date.now();
    return store.searchActivities({ q: opts.q, type: opts.type, from, to, limit: opts.limit || 200 });
  });
  ipcMain.handle('get-cards', (_e, opts = {}) => {
    if (opts.kind) return store.all(`SELECT * FROM knowledge_cards WHERE kind=? ORDER BY updated_at DESC LIMIT 200`, [opts.kind]);
    return store.all(`SELECT * FROM knowledge_cards ORDER BY updated_at DESC LIMIT 200`);
  });
  ipcMain.handle('get-journals', () => store.all(`SELECT * FROM journals ORDER BY period_key DESC LIMIT 60`));
  ipcMain.handle('get-chat', () => store.all(`SELECT * FROM chat_messages ORDER BY created_at ASC LIMIT 200`));

  ipcMain.handle('ask', async (_e, q) => {
    try {
      const result = await summarizer.askHistory(config, q);
      const answer = typeof result === 'string' ? result : result.answer;
      const citations = typeof result === 'string' ? [] : (result.citations || []);
      return { ok: true, answer, citations };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('summarize-today', async () => {
    try {
      const r = await summarizer.buildDailyJournal(config);
      return { ok: true, journal: r };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('cluster-topics', async () => {
    try {
      const ids = await summarizer.clusterTopics(config);
      return { ok: true, ids };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('extract-cards', async () => {
    try {
      const ids = await summarizer.extractCardsFromRecent(config, 12);
      return { ok: true, ids };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('export-vault', async (_e, p) => {
    try {
      let dest = p || config.export?.vaultPath;
      if (!dest) {
        const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
        if (r.canceled || !r.filePaths[0]) return { ok: false, error: '未选择目录' };
        dest = path.join(r.filePaths[0], 'MindTraceVault');
      }
      const result = exportVault(dest);
      config.export.vaultPath = dest;
      saveConfig(config);
      return { ok: true, ...result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('pick-folder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return null;
    return r.filePaths[0];
  });

  ipcMain.handle('open-path', async (_e, p) => {
    if (p) await shell.openPath(p);
    return { ok: true };
  });

  ipcMain.handle('test-ai', async () => {
    try {
      const { content } = await chatCompletion(config, [
        { role: 'user', content: '请用一句话介绍你自己，并说明你可以如何帮助整理个人数字资产。' }
      ], { max_tokens: 200 });
      return { ok: true, content };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('capture-now', async () => {
    const r = await screenshots.capture(true);
    return { ok: !!r, ...(r || {}) };
  });

  ipcMain.handle('get-presets', () => PRESETS);
  ipcMain.handle('seed-demo', () => { seedDemoData(); return { ok: true }; });
  ipcMain.handle('set-demo-mode', (_e, on) => setDemoMode(on));
  ipcMain.handle('get-collector-status', () => collectorStatus.getAll());
  ipcMain.handle('get-topics', () => store.all(`SELECT * FROM topics ORDER BY updated_at DESC LIMIT 100`));
  ipcMain.handle('get-by-id', (_e, { kind, id }) => {
    if (kind === 'activity' || kind === 'event') return { ok: true, item: store.getActivityById(id) };
    if (kind === 'card') return { ok: true, item: store.getCardById(id) };
    if (kind === 'journal') return { ok: true, item: store.getJournalById(id) };
    return { ok: false, error: 'unknown kind' };
  });
  ipcMain.handle('get-log-path', () => getLogPath());
  ipcMain.handle('open-log', async () => {
    const p = getLogPath();
    if (p) await shell.openPath(p);
    return { ok: true, path: p };
  });
}


app.whenReady().then(async () => {
  if (!gotLock) return;
  installProcessHandlers();
  initLogger();
  config = loadConfig();
  if (config.demoMode) { /* will seed after store init */ }
  if (process.argv.includes('--screenshot-tour')) {
    config.onboardingCompleted = false;
    config.authorized = false;
    saveConfig(config);
  }
  if (!config.api.token) {
    config.api.token = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    saveConfig(config);
  }
  await store.initStore();
  try {
    store.pruneOldData({
      activityRetainDays: config.privacy?.activityRetainDays || 90,
      screenshotRetainDays: config.privacy?.screenshotRetainDays || 14,
      chatMax: config.privacy?.chatMaxMessages || 500
    });
  } catch (e) { appendLog('WARN', 'prune', e); }
  setInterval(() => {
    try {
      store.pruneOldData({
        activityRetainDays: config.privacy?.activityRetainDays || 90,
        screenshotRetainDays: config.privacy?.screenshotRetainDays || 14,
        chatMax: config.privacy?.chatMaxMessages || 500
      });
    } catch (e) { console.error('prune', e.message); }
  }, 6 * 3600 * 1000);
  if (config.demoMode) seedDemoData();
  registerIpc();
  createWindow();
  updateTray = buildTray();
  applyBoot();
  registerPauseHotkey();
  if (config.authorized && config.startCollectingOnLaunch !== false) startCollectors();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  try { globalShortcut.unregisterAll(); } catch (_) {}
  stopCollectors();
  store.closeStore();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // keep tray
  }
});
