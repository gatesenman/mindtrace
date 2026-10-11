const {
  app, BrowserWindow, Tray, Menu, nativeImage, ipcMain,
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

let mainWindow = null;
let tray = null;
let config = null;
let summarizeTimer = null;

const isDev = process.argv.includes('--dev');

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
  seedDemoData();
  await mainWindow.webContents.executeJavaScript(`window.mindtrace && (async()=>{const s=document.querySelector('[data-view=dashboard]'); s&&s.click(); await new Promise(r=>setTimeout(r,400));})()`);
  await wait(800);
  await capture('05-dashboard.png');
  for (const [view, file] of [['timeline','06-timeline.png'],['knowledge','07-knowledge.png'],['chat','08-chat.png'],['collect','09-collect.png'],['ai','10-settings.png']]) {
    await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view="${view}"]')?.click()`);
    await wait(700);
    await capture(file);
  }
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
  const p = path.join(__dirname, '../../assets/icon-32.png');
  if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  return nativeImage.createEmpty();
}

function buildTray() {
  tray = new Tray(trayIcon());
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
  const any = Object.values(cols).some(Boolean);
  if (!any) { console.log('no collectors enabled'); }

  windowTracker.start({ ...opts, intervalMs: 2000, onChange: () => {} });
  browserHistory.start({ ...opts, intervalMs: 60000 });
  clipboardCollector.start({ ...opts, clipboard, intervalMs: 1500 });
  documents.start(opts);
  screenshots.start({ ...opts, desktopCapturer, BrowserWindow });
  if (config.api?.enabled) apiServer.start({ getConfig });
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
      url: a[2] === 'browser' ? 'https://example.com/' + i : null,
      file_path: a[2] === 'document' ? 'C:/Users/Demo/Documents/季度总结.docx' : null,
      content: a[2] === 'document' ? '本季度重点推进知识管理系统建设…' : null
    });
  }
  store.upsertKnowledgeCard({ kind: 'project', title: '知迹 MindTrace', summary: '个人桌面行为转数字资产的桌面应用', tags: ['产品', 'Electron'] });
  store.upsertKnowledgeCard({ kind: 'learning', title: 'Electron 安全预加载', summary: '使用 contextBridge 暴露有限 API，关闭 nodeIntegration', tags: ['技术'] });
  store.upsertKnowledgeCard({ kind: 'person', title: '张三', summary: '协作沟通对象（示例）', tags: ['人脉'] });
  store.upsertKnowledgeCard({ kind: 'todo', title: '配置 AI API Key', summary: '在设置中填入 DeepSeek / 通义 / Kimi Key', tags: ['待办'] });
  store.upsertJournal({
    period: 'daily',
    period_key: new Date().toISOString().slice(0, 10),
    title: '示例日报：搭建数字资产管道',
    content: '今天主要在浏览器查阅资料、用文档整理思路，并通过微信沟通。知迹将这些碎片活动汇总为可检索资产。',
    highlights: ['搭建采集器', '设计知识卡片', '准备 AI 总结']
  });
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
}

app.whenReady().then(async () => {
  config = loadConfig();
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
