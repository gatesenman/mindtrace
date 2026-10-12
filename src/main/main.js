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
const workerHost = require('../worker/host');
const wikiEngine = require('../wiki/engine');
const mcpServer = require('../mcp/server');
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
  await wait(1200);
  await capture('05-dashboard.png');
  // Timeline with zoom levels
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=timeline]')?.click()`);
  await wait(700);
  await capture('06-timeline.png');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('#tl-zoom [data-zoom=hour]')?.click()`);
  await wait(400); await capture('06a-timeline-hour.png');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('#tl-zoom [data-zoom=week]')?.click()`);
  await wait(400); await capture('06b-timeline-week.png');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('#tl-zoom [data-zoom=month]')?.click()`);
  await wait(400); await capture('06c-timeline-month.png');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('#tl-zoom [data-zoom=day]')?.click()`);
  await wait(300);

  for (const [view, file] of [['knowledge','07-knowledge.png'],['wiki','07c-wiki.png'],['chat','08-chat.png'],['collect','09-collect.png'],['ai','10-settings.png']]) {
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
    width: 1320,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: '知迹 MindTrace',
    backgroundColor: '#F4F5F7',
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
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
  const opts = { getConfig, clipboard, desktopCapturer, BrowserWindow };
  try {
    workerHost.start(opts);
  } catch (e) {
    appendLog('ERROR', 'workerHost.start', e);
  }
  try {
    if (config.api?.enabled) {
      apiServer.start({ getConfig });
      mcpServer.start({ getConfig });
    }
  } catch (e) { appendLog('ERROR', 'start:api', e); }
  scheduleSummarize();
}

function stopCollectors() {
  try { workerHost.stop(); } catch (_) {}
  apiServer.stop();
  try { mcpServer.stop(); } catch (_) {}
  if (summarizeTimer) clearInterval(summarizeTimer);
}

function scheduleSummarize() {
  if (summarizeTimer) clearInterval(summarizeTimer);
  const min = config.ai?.summarizeIntervalMin || 60;
  summarizeTimer = setInterval(() => {
    summarizer.maybeAutoSummarize(config);
  }, Math.max(15, min) * 60 * 1000);
}


function registerNoteHotkey() {
  const accel = config.noteHotkey || 'CommandOrControl+Shift+N';
  try {
    globalShortcut.register(accel, () => {
      mainWindow?.webContents.send('quick-note-open');
      mainWindow?.show();
      mainWindow?.focus();
    });
  } catch (e) { console.error('note hotkey', e.message); }
}

function registerPauseHotkey() {
  try { globalShortcut.unregisterAll(); } catch (_) {}
  // note hotkey re-bound below after pause
  const accel = config.privacy?.pauseHotkey || 'CommandOrControl+Shift+M';
  try {
    globalShortcut.register(accel, () => {
      setPaused(!config.privacy.paused);
      mainWindow?.webContents.send('status', { paused: config.privacy.paused, toast: config.privacy.paused ? '已暂停采集' : '已恢复采集' });
    });
    registerNoteHotkey();
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
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const base = dayStart.getTime();

  // Richer catalog: 8 apps, realistic titles across the day
  const catalog = [
    { app: '微信', type: 'window', titles: ['与张三的项目同步', '产品群：知迹 2.1 评审', '文件传输助手'], dur: [8, 12, 6] },
    { app: 'Google Chrome', type: 'browser', titles: ['Electron Security Best Practices', 'FTS5 全文检索手册', 'uPlot 文档', 'OpenAI Compatible API'], urls: ['https://www.electronjs.org/docs/latest/tutorial/security', 'https://www.sqlite.org/fts5.html', 'https://github.com/leeoniya/uPlot', 'https://platform.openai.com/docs'], dur: [15, 10, 8, 12] },
    { app: 'Microsoft Edge', type: 'browser', titles: ['DeepSeek API 文档', '飞书开放平台', 'MDN Web Docs'], urls: ['https://api-docs.deepseek.com', 'https://open.feishu.cn', 'https://developer.mozilla.org'], dur: [14, 9, 7] },
    { app: 'VS Code', type: 'window', titles: ['mindtrace — main.js', 'mindtrace — store.js', 'mindtrace — app.css', 'Git: commit message'], dur: [18, 16, 12, 5] },
    { app: 'Cursor', type: 'window', titles: ['Agent: UI polish', 'Composer — charts.js', 'Diff: seedDemoData'], dur: [20, 15, 10] },
    { app: 'Word', type: 'document', titles: ['季度总结.docx', '知迹产品说明.docx'], paths: ['C:/Users/演示用户/Documents/季度总结.docx', 'C:/Users/演示用户/Documents/知迹产品说明.docx'], dur: [12, 10] },
    { app: '飞书', type: 'window', titles: ['周会纪要', '设计评审：企业级界面', '与李四的会话'], dur: [11, 9, 7] },
    { app: 'PDF Reader', type: 'document', titles: ['系统设计白皮书.pdf', '隐私合规清单.pdf'], paths: ['C:/Users/演示用户/Documents/系统设计白皮书.pdf', 'C:/Users/演示用户/Documents/隐私合规清单.pdf'], dur: [13, 8] }
  ];

  // Spread ~60 events from 08:30 to evening
  let cursor = base + (8 * 60 + 30) * 60000;
  let n = 0;
  const inserted = [];
  while (n < 60) {
    const item = catalog[n % catalog.length];
    const ti = Math.floor(n / catalog.length) % item.titles.length;
    const title = item.titles[ti];
    const durMin = item.dur[ti % item.dur.length];
    const start = cursor;
    const duration_ms = durMin * 60000;
    const row = {
      type: item.type,
      started_at: start,
      ended_at: start + duration_ms,
      duration_ms,
      app_name: item.app,
      process_name: item.app,
      window_title: title + (item.type !== 'window' ? '' : ''),
      url: item.type === 'browser' ? (item.urls && item.urls[ti % item.urls.length]) : null,
      file_path: item.type === 'document' ? (item.paths && item.paths[ti % item.paths.length]) : null,
      content: item.type === 'document' ? '【示例】文档摘录：本季度重点推进知识管理系统与企业级体验…' : (item.type === 'browser' ? null : '【示例】'),
      meta: { isDemo: true, label: '示例' }
    };
    store.insertActivity(row);
    inserted.push(row);
    n += 1;
    // advance with small gaps so events span the day
    cursor += duration_ms + (2 + (n % 5)) * 60000;
    if (cursor > base + 22 * 3600000) cursor = base + (9 * 60) * 60000 + (n * 7 * 60000);
  }

  // Yesterday baseline (thinner) so KPI deltas are meaningful
  const yStart = base - 86400000;
  for (let i = 0; i < 28; i++) {
    const item = catalog[i % catalog.length];
    const start = yStart + (9 * 60 + i * 18) * 60000;
    store.insertActivity({
      type: item.type === 'browser' ? 'browser' : item.type === 'document' ? 'document' : 'window',
      started_at: start,
      ended_at: start + 8 * 60000,
      duration_ms: 8 * 60000,
      app_name: item.app,
      process_name: item.app,
      window_title: '【昨日】' + item.titles[0],
      url: item.type === 'browser' ? 'https://example.com/demo-y/' + i : null,
      meta: { isDemo: true }
    });
  }

  const cards = [];
  const mk = (kind, title, summary, tags, content) => {
    const id = store.upsertKnowledgeCard({ kind, title, summary, tags: tags.concat(['示例']), content: content || summary });
    cards.push(id);
    return id;
  };
  const cProject = mk('project', '【示例】知迹 MindTrace 2.1', '企业级桌面知识工作台：采集、Wiki、问答与导出', ['产品', 'Electron']);
  const cLearn1 = mk('learning', '【示例】Electron 安全预加载', 'contextBridge 暴露有限 API，关闭 nodeIntegration', ['技术']);
  const cLearn2 = mk('learning', '【示例】SQLite FTS5', '用 FTS5 做活动/笔记全文检索，注意分词与更新策略', ['技术', '数据库']);
  const cLearn3 = mk('learning', '【示例】感知哈希截屏去重', 'phash 跳过静止帧，控制截屏磁盘与 CPU', ['技术', '性能']);
  const cPerson1 = mk('person', '【示例】张三', '协作沟通对象 · 项目进度对接', ['人脉']);
  const cPerson2 = mk('person', '【示例】李四', '设计评审参与者 · 飞书同步', ['人脉']);
  const cTodo1 = mk('todo', '【示例】配置 AI API Key', '在设置中填入 DeepSeek / 通义 / Kimi Key', ['待办']);
  const cTodo2 = mk('todo', '【示例】补齐 Windows 真机 OCR 验收', '验证 WinRT OCR 与 UIA 节流表现', ['待办']);
  const cLink1 = mk('link', '【示例】DeepSeek API 文档', 'https://api-docs.deepseek.com', ['链接'], '官方兼容接口说明');
  const cLink2 = mk('link', '【示例】飞书开放平台', 'https://open.feishu.cn', ['链接']);
  const cNote = mk('note', '【示例】企业级界面 Checklist', '标题栏、侧栏、命令面板、KPI、图表、双主题', ['笔记', '设计']);
  mk('project', '【示例】采集性能预算', '目标平均 CPU <3%、内存 <300MB，Worker 批处理', ['性能']);

  store.upsertJournal({
    period: 'daily',
    period_key: new Date().toISOString().slice(0, 10),
    title: '示例日报：企业级体验与知识沉淀',
    content: [
      '【示例数据】',
      '',
      '## 今日概览',
      '',
      '今天围绕 **知迹 2.1** 推进企业级界面与知识沉淀：上午在 Chrome / Edge 查阅 Electron 与 FTS5 资料，中午用飞书同步评审，下午在 VS Code 与 Cursor 落地 UI 与示例数据，傍晚整理 Word / PDF 文档并与张三微信对齐进度。',
      '',
      '## 进展',
      '',
      '- 完成自定义标题栏、命令面板与双主题打磨',
      '- 应用时长改为横向排名，避免图表重复',
      '- 丰富示例数据，便于交付验收与截图',
      '',
      '## 风险与下一步',
      '',
      '- Windows 真机需验收 OCR / UIA',
      '- 配置 AI Key 后可自动生成真实日刊'
    ].join('\n'),
    highlights: ['企业级界面打磨', '横向应用时长排名', '示例数据加厚', '与张三同步进度']
  });

  store.upsertTopic({ name: '【示例】桌面知识产品', summary: '围绕知迹产品的设计、实现与发布。示例主题。', card_ids: [cProject, cLearn1, cNote], activity_count: 22, last_seen: now });
  store.upsertTopic({ name: '【示例】协作沟通', summary: '微信 / 飞书上的评审与进度同步。示例主题。', card_ids: [cPerson1, cPerson2], activity_count: 14, last_seen: now });
  store.upsertTopic({ name: '【示例】检索与性能', summary: 'FTS5、截屏去重与采集预算。示例主题。', card_ids: [cLearn2, cLearn3], activity_count: 10, last_seen: now });
  store.upsertTopic({ name: '【示例】文档资产', summary: 'Word / PDF 阅读与产品说明沉淀。示例主题。', card_ids: [cLink1, cLink2], activity_count: 8, last_seen: now });

  try { store.run(`DELETE FROM chat_messages`); } catch (_) {}
  const acts = store.all(`SELECT id, app_name, window_title, started_at FROM activities WHERE meta LIKE '%isDemo%' AND started_at>=? ORDER BY started_at DESC LIMIT 20`, [base]);
  const wechat = acts.find(a => /微信/.test(a.app_name || '')) || acts[0];
  const vscode = acts.find(a => /VS Code|Code/.test(a.app_name || '')) || acts[1] || acts[0];
  const feishu = acts.find(a => /飞书/.test(a.app_name || '')) || acts[2] || acts[0];
  store.addChatMessage('user', '今天我和谁讨论过项目进度？');
  store.addChatMessage(
    'assistant',
    '根据示例记录，你今天通过**微信**与「张三」同步了项目进度，并在**飞书**参与设计评审；同时在 VS Code / Cursor 推进知迹 2.1 界面。[E1]\n\n建议优先完成「配置 AI API Key」与「Windows OCR 验收」两条待办。',
    [
      wechat && { key: 'E1', kind: 'activity', id: wechat.id, type: 'window', label: `${wechat.app_name || ''} ${wechat.window_title || ''}`.trim(), started_at: wechat.started_at },
      { key: 'C1', kind: 'card', id: cPerson1, type: 'person', label: '【示例】张三' },
      feishu && { key: 'E2', kind: 'activity', id: feishu.id, type: 'window', label: `${feishu.app_name || ''} ${feishu.window_title || ''}`.trim(), started_at: feishu.started_at },
      vscode && { key: 'E3', kind: 'activity', id: vscode.id, type: 'window', label: `${vscode.app_name || ''} ${vscode.window_title || ''}`.trim(), started_at: vscode.started_at }
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
  ipcMain.handle('window-minimize', () => { mainWindow?.minimize(); });
  ipcMain.handle('window-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle('window-close', () => { mainWindow?.close(); });
  ipcMain.handle('get-app-version', () => app.getVersion());

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

  
  ipcMain.handle('get-rollups', (_e, opts = {}) => store.getRollups(opts.level || 'day', opts.from, opts.to));
  ipcMain.handle('get-wiki', (_e, kind) => store.listWiki(kind));
  ipcMain.handle('get-memories', (_e, kind) => store.listMemories(kind));
  ipcMain.handle('search-fts', (_e, q) => store.searchFts(q, 50));
  ipcMain.handle('get-budget', () => workerHost.getBudget());
  ipcMain.handle('add-quick-note', (_e, payload) => {
    const bus = workerHost.getBus();
    if (bus) {
      const notes = require('../collectors/notes');
      // ensure bus on notes module
      notes.start({ getConfig, bus });
      notes.addQuickNote(payload || {});
      return { ok: true };
    }
    // fallback direct store
    const id = store.insertActivity({
      type: 'note', started_at: Date.now(), app_name: '速记',
      window_title: (payload && payload.title) || '速记',
      content: (payload && payload.content) || '',
      meta: { quick: true, tags: (payload && payload.tags) || [] }
    });
    return { ok: true, id };
  });
  ipcMain.handle('build-rollup', async (_e, opts = {}) => {
    try {
      const level = opts.level || 'day';
      if (level === 'hour') await wikiEngine.buildHourRollup(config, opts.key || wikiEngine.hourKey(Date.now()));
      else if (level === 'week') await wikiEngine.buildWeekRollup(config, opts.key || wikiEngine.weekKey(Date.now()));
      else if (level === 'month') await wikiEngine.buildMonthRollup(config, opts.key || wikiEngine.monthKey(Date.now()));
      else await wikiEngine.buildDayRollup(config, opts.key || wikiEngine.dayKey(Date.now()));
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
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
