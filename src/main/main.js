const {
  app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen,
  clipboard, desktopCapturer, dialog, shell, globalShortcut, Notification
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
const pro = require('../pro');
const v23 = {
  schema: require('../core/schema'), pipeline: require('../core/pipeline'), inbox: require('../core/inbox'), forget: require('../core/forget'),
  search: require('../core/search'), budget: require('../core/budget'), demo: require('../core/demo'),
  kb: require('../kb'), memory: require('../memory'), calendar: require('../calendar'), zhtime: require('../calendar/zhtime')
};
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



async function v23TourShots(capture, wait, dark) {
  const js = (s) => mainWindow.webContents.executeJavaScript(s).catch(e => console.error('tour js', e.message));
  for (let i = 0; i < 40 && !(v23.demo.ids().entities || []).length; i++) await wait(250);
  const sfx = dark ? '-dark' : '';
  await js(`document.querySelector('[data-view=dashboard]')?.click()`); await wait(1200);
  await js(`document.getElementById('today-v23')?.scrollIntoView({block:'start'})`); await wait(300);
  await capture(`40-v23-today${sfx}.png`);
  await js(`document.querySelectorAll('*').forEach(e=>{ if (e.scrollTop) e.scrollTop = 0; })`);
  await js(`document.querySelector('[data-view=kb]')?.click()`); await wait(900);
  await js(`(()=>{const it=[...document.querySelectorAll('#kb-list .v-list-item')].find(x=>/知迹 2.3/.test(x.textContent)); it&&it.click();})()`); await wait(700);
  await capture(`41-kb-entity${sfx}.png`);
  if (!dark) {
    await js(`document.querySelector('#kb-tabs [data-t=facts]')?.click()`); await wait(500); await capture('42-kb-facts.png');
    await js(`document.querySelector('#kb-tabs [data-t=hist]')?.click()`); await wait(500); await capture('43-kb-history.png');
    await js(`document.querySelector('#kb-tabs [data-t=log]')?.click()`); await wait(500); await capture('43b-kb-log.png');
    await js(`(()=>{document.querySelector('#kb-tabs [data-t=page]')?.click(); const it=[...document.querySelectorAll('#kb-list .v-list-item')].find(x=>/张三/.test(x.textContent)); it&&it.click();})()`); await wait(700);
    await capture('43c-kb-person.png');
  }
  await js(`document.querySelector('[data-view=calendar]')?.click()`); await wait(400);
  await js(`document.querySelector('#cal-mode [data-m=week]')?.click()`); await wait(900);
  await capture(`44-calendar-week${sfx}.png`);
  await js(`document.querySelector('#cal-mode [data-m=day]')?.click()`); await wait(900);
  await capture(`45-calendar-day${sfx}.png`);
  if (!dark) {
    await js(`document.querySelector('#cal-mode [data-m=month]')?.click()`); await wait(800); await capture('46-calendar-month.png');
    await js(`document.querySelector('#cal-mode [data-m=agenda]')?.click()`); await wait(800); await capture('47-calendar-agenda.png');
    await js(`(()=>{const q=document.getElementById('cal-quick'); q.value='下周一上午10点 和王芳评审测试平台'; q.dispatchEvent(new Event('input'));})()`); await wait(600);
    await capture('47b-calendar-quickadd.png');
    await js(`document.getElementById('cal-quick').value=''; document.getElementById('cal-parse').textContent=''; document.querySelector('#cal-mode [data-m=week]')?.click()`); await wait(700);
    await js(`document.querySelector('#cal-body .cal-ev')?.click()`); await wait(500); await capture('47c-calendar-popover.png');
    await js(`document.querySelector('.cal-pop')?.remove()`);
  }
  await js(`document.querySelector('[data-view=inbox]')?.click()`); await wait(900);
  await capture(`48-inbox${sfx}.png`);
  if (!dark) { await js(`document.querySelector('#ib-tabs [data-t=conflict]')?.click()`); await wait(600); await capture('48b-inbox-conflict.png'); await js(`document.querySelector('#ib-tabs [data-t=all]')?.click()`); }
  await js(`document.querySelector('[data-view=memory]')?.click()`); await wait(900);
  await capture(`49-memory${sfx}.png`);
  if (!dark) { await js(`document.querySelector('#mm-status [data-s=superseded]')?.click()`); await wait(700); await capture('50-memory-superseded.png'); await js(`document.querySelector('#mm-status [data-s=active]')?.click()`); await wait(300); }
}

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
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-preset=recommended]')?.click()`);
  await wait(200);
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
  try { mainWindow.setSize(1280, 840); } catch (_) {}
  await mainWindow.webContents.executeJavaScript(`window.mindtrace && (async()=>{const s=document.querySelector('[data-view=dashboard]'); s&&s.click(); await new Promise(r=>setTimeout(r,400));})()`);
  await wait(1200);
  await capture('05-dashboard.png');
  // 1024px width sweep — ensure KPI / chrome do not wrap or clip
  try { mainWindow.setSize(1024, 720); } catch (_) {}
  await wait(500);
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=dashboard]')?.click()`);
  await wait(700);
  await capture('05b-dashboard-1024.png');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=timeline]')?.click()`);
  await wait(500); await capture('06d-timeline-1024.png');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=wiki]')?.click()`);
  await wait(500); await capture('07d-wiki-1024.png');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=chat]')?.click()`);
  await wait(500); await capture('08b-chat-1024.png');
  try { mainWindow.setSize(1280, 840); } catch (_) {}
  await wait(400);
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=dashboard]')?.click()`);
  await wait(400);
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
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=insights]')?.click()`);
  await wait(800); await capture('20-insights.png');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=memory]')?.click()`);
  await wait(700);
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-mstatus=pending]')?.click()`);
  await wait(500); await capture('21-wiki-review.png');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-mstatus=active]')?.click()`);
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=collect]')?.click()`);
  await wait(700);
  await mainWindow.webContents.executeJavaScript(`document.getElementById('btn-rule-add')?.click(); document.getElementById('rules-body')?.closest('.card')?.scrollIntoView({block:'start',behavior:'instant'})`);
  await wait(500); await capture('22-privacy-audit.png');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=ai]')?.click()`);
  await wait(800);
  await mainWindow.webContents.executeJavaScript(`window.MTUX.settingsTab('usage')`);
  await wait(400); await capture('23-usage-jobs.png');
  await mainWindow.webContents.executeJavaScript(`window.MTUX.settingsTab('integration')`);
  await wait(400); await capture('24-backup-mcp.png');
  await mainWindow.webContents.executeJavaScript(`document.querySelectorAll('.view').forEach(v=>v.scrollTop=0); document.querySelector('.content, main')?.scrollTo?.(0,0)`);
  await mainWindow.webContents.executeJavaScript(`window.MTUX.settingsTab('model')`);
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=collect]')?.click()`);
  await wait(800); await capture('30-collect-table.png');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=timeline]')?.click()`);
  await wait(1200);
  await mainWindow.webContents.executeJavaScript(`(()=>{const tr=document.getElementById('scrub-track'); if(!tr) return; const r=tr.getBoundingClientRect(); const x=(i)=>r.left+r.width*(i+.5)/96; const y=r.top+20; tr.dispatchEvent(new MouseEvent('mousedown',{clientX:x(40),clientY:y,bubbles:true})); tr.dispatchEvent(new MouseEvent('mousemove',{clientX:x(47),clientY:y,bubbles:true})); window.dispatchEvent(new MouseEvent('mouseup',{clientX:x(47),clientY:y,bubbles:true})); setTimeout(()=>tr.dispatchEvent(new MouseEvent('mousemove',{clientX:x(44),clientY:y,bubbles:true})),500);})()`);
  await wait(1200); await capture('31-timeline-scrubber.png');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=wiki]')?.click()`);
  await wait(900);
  await mainWindow.webContents.executeJavaScript(`document.querySelector('#wiki-list [data-slug="demo-知迹 2.2"]')?.click()`);
  await wait(600);
  await mainWindow.webContents.executeJavaScript(`(()=>{const a=document.querySelector('#wiki-body .wikilink'); a&&a.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));})()`);
  await wait(700); await capture('32-wiki-hovercard.png');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('.hovercard')?.classList.add('hidden')`);
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=chat]')?.click()`);
  await wait(900);
  await mainWindow.webContents.executeJavaScript(`document.querySelector('#view-chat .cite-card')?.click()`);
  await wait(900); await capture('33-citation-panel.png');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('.side-panel')?.classList.remove('open')`);
  await mainWindow.webContents.executeJavaScript(`document.getElementById('btn-cmd-open')?.click()`);
  await wait(300);
  await mainWindow.webContents.executeJavaScript(`(()=>{const i=document.getElementById('cmd-input'); i.value='@'; i.dispatchEvent(new Event('input'));})()`);
  await wait(600); await capture('34-cmdk-people.png');
  await mainWindow.webContents.executeJavaScript(`(()=>{const i=document.getElementById('cmd-input'); i.value='>'; i.dispatchEvent(new Event('input')); setTimeout(()=>{i.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})); i.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));},250);})()`);
  await wait(500); await capture('35-cmdk-commands.png');
  await mainWindow.webContents.executeJavaScript(`document.getElementById('cmd-overlay')?.classList.add('hidden')`);
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=dashboard]')?.click()`);
  await wait(800); await capture('36-dashboard-checklist.png');
  await v23TourShots(capture, wait, false);
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
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=insights]')?.click()`);
  await wait(700); await capture('25-insights-dark.png');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=memory]')?.click()`);
  await wait(600);
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-mstatus=pending]')?.click()`);
  await wait(500); await capture('26-wiki-review-dark.png');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=collect]')?.click()`);
  await wait(600);
  await mainWindow.webContents.executeJavaScript(`document.getElementById('audit-body')?.closest('.card')?.scrollIntoView({block:'end',behavior:'instant'})`);
  await wait(400); await capture('27-audit-dark.png');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=ai]')?.click()`);
  await wait(700);
  await mainWindow.webContents.executeJavaScript(`window.MTUX.settingsTab('data')`);
  await wait(400); await capture('28-settings-pro-dark.png');
  await mainWindow.webContents.executeJavaScript(`window.MTUX.settingsTab('model')`);
  await v23TourShots(capture, wait, true);
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
  for (const [v, f] of [['calendar', '51-calendar-empty.png'], ['inbox', '52-inbox-empty.png'], ['kb', '53-kb-empty.png']]) {
    await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view=${v}]')?.click()`); await wait(700); await capture(f);
  }
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
    if (require('./devShot').arg()) { require('./devShot').shoot(mainWindow); return; }
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
      mcpServer.start({ getConfig, hooks: { version: app.getVersion() } });
    }
  } catch (e) { appendLog('ERROR', 'start:api', e); }
  scheduleSummarize();
  scheduleReports();
}

function stopCollectors() {
  try { workerHost.stop(); } catch (_) {}
  apiServer.stop();
  try { mcpServer.stop(); } catch (_) {}
  if (summarizeTimer) clearInterval(summarizeTimer);
  if (reportTimer) clearInterval(reportTimer);
}


let reportTimer = null;
function notifyReportReady(report, kind = 'daily') {
  try {
    const { showToast } = require('../core/notify');
    const isEmpty = report?.status === 'NO_DATA';
    const title = kind === 'weekly'
      ? (report?.title || '本周周报已生成')
      : (report?.title || '今日日报已生成');
    const body = isEmpty
      ? (kind === 'weekly' ? '本周暂无活动记录' : '今日暂无活动记录')
      : '已写入报告 · 点击查看';
    showToast({
      Notification,
      title,
      body,
      log: appendLog,
      onClick: () => {
        try {
          mainWindow?.show();
          mainWindow?.focus();
          mainWindow?.webContents.send('open-view', {
            view: 'knowledge',
            tab: 'journals',
            id: report?.journalId,
            period_key: report?.period_key
          });
        } catch (e) { appendLog('ERROR', 'report-toast-click', e); }
      }
    });
  } catch (e) { appendLog('ERROR', 'report-toast', e); }
}
function scheduleReports() {
  if (reportTimer) clearInterval(reportTimer);
  reportTimer = setInterval(() => {
    try {
      const now = new Date();
      // 每天 18:00–18:14 生成日报；周五同时生成周报
      if (now.getHours() === 18 && now.getMinutes() < 15) {
        const key = now.toISOString().slice(0, 10);
        const last = config._lastDailyReportKey;
        if (last !== key) {
          config._lastDailyReportKey = key;
          const daily = require('../core/reports').draftDaily();
          notifyReportReady(daily, 'daily');
          try { require('../core/commitments').ingestRecent({ hours: 24 }); } catch (e) { appendLog('ERROR', 'commitments', e); }
          if (now.getDay() === 5) {
            const weekly = require('../core/reports').draftWeekly();
            notifyReportReady(weekly, 'weekly');
          }
          saveConfig(config);
        }
      }
    } catch (e) { appendLog('ERROR', 'scheduleReports', e); }
  }, 5 * 60 * 1000);
}

function scheduleSummarize() {
  if (summarizeTimer) clearInterval(summarizeTimer);
  const min = config.ai?.summarizeIntervalMin || 60;
  summarizeTimer = setInterval(() => {
    summarizer.maybeAutoSummarize(config);
  }, Math.max(15, min) * 60 * 1000);
}


function registerNoteHotkey() {
  try { require('./recallWindow').registerHotkey(config); } catch (e) { console.error('recall hotkey', e.message); }
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
  try { v23.demo.clear(); } catch (e) { appendLog('WARN', 'demo-v23-clear', e); }
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
    const durMin = Math.max(5, Math.round(item.dur[ti % item.dur.length] * 0.7));
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

  // Previous 6 days: varied counts for week-trend + plausible KPI deltas vs yesterday
  // counts for days -6..-1 (today is seeded above as ~60)
  const histCounts = [42, 51, 36, 48, 44, 55];
  const histDurMin = [9, 10, 8, 11, 9, 8]; // day-1 ~8m avg → today ~+8–12% time // avg minutes / event → yesterday ~ close to today
  for (let d = 6; d >= 1; d--) {
    const dayBase = base - d * 86400000;
    const count = histCounts[6 - d];
    const avgDur = histDurMin[6 - d];
    let cursor = dayBase + (8 * 60 + 40) * 60000;
    for (let i = 0; i < count; i++) {
      const item = catalog[i % catalog.length];
      const ti = i % item.titles.length;
      const durMin = Math.max(4, avgDur + ((i % 5) - 2));
      const start = cursor;
      const duration_ms = durMin * 60000;
      store.insertActivity({
        type: item.type,
        started_at: start,
        ended_at: start + duration_ms,
        duration_ms,
        app_name: item.app,
        process_name: item.app,
        window_title: `【示例·D-${d}】` + item.titles[ti],
        url: item.type === 'browser' ? `https://example.com/demo/d${d}/${i}` : null,
        file_path: item.type === 'document' ? (item.paths && item.paths[ti % item.paths.length]) : null,
        meta: { isDemo: true }
      });
      cursor += duration_ms + (3 + (i % 4)) * 60000;
      if (cursor > dayBase + 21 * 3600000) cursor = dayBase + (9 * 60) * 60000 + i * 9 * 60000;
    }
  }
  // Yesterday cards baseline (~11) so cards delta ≈ +8–10% (today creates 12)
  const yCardBase = base - 86400000 + 12 * 3600000;
  for (let i = 0; i < 11; i++) {
    try {
      const id = crypto.randomUUID();
      store.run(
        `INSERT INTO knowledge_cards (id,kind,title,summary,content,tags,links,source_ids,importance,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [id, 'note', `【示例】昨日笔记 ${i + 1}`, '昨日示例卡片', '示例', JSON.stringify(['示例']), null, null, 2, yCardBase + i * 60000, yCardBase + i * 60000]
      );
    } catch (_) {}
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
  seedProDemo(now);
  v23.demo.seed(now).then(r => { appendLog('INFO', 'demo-v23', JSON.stringify(r)); mainWindow?.webContents.send('v23-changed', { demo: true }); }).catch(e => appendLog('WARN', 'demo-v23', e));
}

function seedProDemo(now) {
  const H = 3600e3, M = 60e3;
  const q = (sql, a) => { try { store.run(sql, a); } catch (e) { appendLog('WARN', 'seed-pro', e); } };
  const aud = [
    [now - 12 * M, 'capture', 'blocked', '1Password', '{"reason":"sensitive-app","示例":true}'],
    [now - 35 * M, 'mcp', 'call', 'search', '{"query":"知迹 发布","示例":true}'],
    [now - 48 * M, 'capture', 'title-only', 'Chrome', '{"reason":"rule:site:intranet.corp","示例":true}'],
    [now - 70 * M, 'mcp', 'call', 'get_wiki_page', '{"slug":"day-today","示例":true}'],
    [now - 2 * H, 'llm', 'call', 'deepseek-flash', '{"purpose":"rollup","示例":true}'],
    [now - 3 * H, 'capture', 'blocked', 'Edge InPrivate', '{"reason":"sensitive-window","示例":true}'],
    [now - 5 * H, 'backup', 'encrypted', 'D:/备份/MindTrace.mtbak', '{"activities":412,"示例":true}'],
    [now - 26 * H, 'wipe', 'range', '昨日 12:00~12:15', '{"activities":6,"示例":true}']
  ];
  aud.forEach((r, i) => q(`INSERT OR REPLACE INTO audit_log (id,ts,kind,action,target,detail) VALUES (?,?,?,?,?,?)`, ['demo-a' + i, ...r]));
  const use = [['deepseek-flash', 'summarize', 3200, 820, 0.0018, 2100, 1], ['deepseek-flash', 'rollup', 5400, 1300, 0.0029, 2900, 1], ['deepseek-flash', 'chat', 1800, 640, 0.0012, 1600, 1], ['qwen-vl-plus', 'vision', 2100, 300, 0.0012, 3400, 1], ['deepseek-flash', 'rollup', 0, 0, 0, 30000, 0]];
  for (let d = 0; d < 9; d++) use.forEach((u, i) => q(`INSERT OR REPLACE INTO llm_usage (id,ts,provider,model,purpose,prompt_tokens,completion_tokens,cost_usd,latency_ms,ok,error) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [`demo-u${d}-${i}`, now - d * 20 * H - i * M, 'deepseek', u[0], u[1], u[2], u[3], u[4] * 3, u[5], u[6], u[6] ? null : '超时（示例）']));
  const jobs = [['rollup', 'done', 1, now - 15 * M, null], ['summarize', 'done', 1, now - 62 * M, null], ['rollup', 'failed', 2, now - 2 * H, 'AI API 429: rate limited（示例）'], ['rollup', 'done', 1, now - 3 * H, null], ['summarize', 'done', 2, now - 6 * H, null]];
  jobs.forEach((j, i) => q(`INSERT OR REPLACE INTO jobs (id,kind,status,params,attempts,created_at,started_at,finished_at,error) VALUES (?,?,?,?,?,?,?,?,?)`, ['demo-j' + i, j[0], j[1], JSON.stringify({ level: 'hour', demo: true }), j[2], j[3], j[3], j[3] + 4000, j[4]]));
  // Wiki 实体页 + 各级汇总卷（示例）
  const pages = [
    ['person', '张三', '## 张三\n\n- 角色：Windows 打包与签名负责人\n- 最近：今日 10:20 微信同步 [[知迹 2.2]] 发布进度\n- 关联：[[李四]]、[[发布流程]]'],
    ['person', '李四', '## 李四\n\n- 角色：设计评审\n- 最近：飞书评审 [[知迹 2.2]] 洞察页\n- 关联：[[张三]]'],
    ['project', '知迹 2.2', '## 知迹 2.2\n\n专业版：隐私规则、加密备份、记忆审核、标准 MCP。\n\n- 负责人：[[张三]]\n- 评审：[[李四]]\n- 相关主题：[[隐私合规]]、[[发布流程]]'],
    ['project', '发布流程', '## 发布流程\n\nNSIS 安装包 + 便携版 + zip，wine 构建。\n\n- 关联项目：[[知迹 2.2]]'],
    ['topic', '隐私合规', '## 隐私合规\n\n参考 Microsoft Recall 的排除规则与敏感内容过滤；审计日志可追溯。\n\n- 落地：[[知迹 2.2]]'],
    ['topic', '检索与性能', '## 检索与性能\n\nFTS5 全文索引，1 万条事件检索 <5ms。\n\n- 关联：[[知迹 2.2]]']
  ];
  pages.forEach(([kind, title, body]) => store.upsertWikiPage({ kind, slug: 'demo-' + title, title: '【示例】' + title, body_md: body }));
  const dk = wikiEngine.dayKey(now);
  store.upsertWikiPage({ kind: 'time', slug: 'demo-day-' + dk, title: '【示例】' + dk + ' 日卷', body_md: '## 今日日卷\n\n上午检索资料，下午在 VS Code 推进 [[知迹 2.2]]，与 [[张三]] 对齐发布。' });
  const R = (level, key, title, md, stats) => store.upsertRollup({ level, period_key: key, title: '【示例】' + title, summary_md: md, stats: { ...stats, demo: true } });
  for (let h = 1; h <= 6; h++) {
    const ts = now - h * H;
    R('hour', wikiEngine.hourKey(ts), `${new Date(ts).getHours()}:00 – ${new Date(ts).getHours() + 1}:00`, ['在 VS Code 编写隐私规则引擎与测试', '飞书评审洞察页，记录 3 条意见', 'Chrome 查阅 MCP 规范与 JSON-RPC', '微信与张三同步打包进度', '整理 PDF 资料并写速记', 'Cursor 重构设置页'][h - 1], { events: 8 + h, minutes: 40 + h * 3 });
  }
  for (let w = 0; w < 4; w++) R('week', wikiEngine.weekKey(now - w * 7 * 86400e3), `第 ${w + 1} 周回顾`, ['完成 2.2 专业版主体功能与测试', '2.1 企业级界面两轮打磨', '2.0 采集器与 Wiki 引擎', 'PRD 与竞品调研'][w], { minutes: 2100 - w * 160 });
  for (let m = 0; m < 3; m++) { const d = new Date(now); d.setMonth(d.getMonth() - m); R('month', wikiEngine.monthKey(d.getTime()), `${d.getMonth() + 1} 月回顾`, ['发布 2.0→2.2，形成完整本地知识库产品', '原型与设计系统', '需求调研'][m], { minutes: 8800 - m * 900 }); }
  [['preference', '【示例】偏好在上午处理需要深度专注的编码任务', 0.62], ['decision', '【示例】2.2 版本暂缓 utilityProcess 隔离，优先隐私规则', 0.7], ['fact', '【示例】张三负责 Windows 安装包签名', 0.66]]
    .forEach(([kind, text, confidence]) => store.upsertMemory({ kind, text, confidence, status: 'pending' }));
  [['preference', '【示例】默认使用 DeepSeek 作为摘要模型', 0.9], ['fact', '【示例】知迹的数据只保存在本机 SQLite', 0.92]]
    .forEach(([kind, text, confidence]) => store.upsertMemory({ kind, text, confidence, status: 'active' }));
}

function setDemoMode(on) {
  config.demoMode = !!on;
  saveConfig(config);
  if (on) seedDemoData();
  else { try { v23.demo.clear(); } catch (_) {} store.clearDemoData(); }
  return { ok: true, demoMode: config.demoMode };
}

/* ───────── v2.3：统一流水线 / 知识库 / 记忆 / 日历 / 待处理 ───────── */
let pipelineBusy = false;
async function runPipeline(trigger = 'manual') {
  if (pipelineBusy) return { skipped: true };
  if (trigger !== 'manual' && (!config.authorized || config.v23?.autoPipeline === false)) return { skipped: true };
  pipelineBusy = true;
  try {
    const r = await v23.pipeline.run({ cfg: config });
    store.persist();
    mainWindow?.webContents.send('v23-changed', { trigger, summary: r });
    return r;
  } catch (e) { appendLog('ERROR', 'pipeline', e); return { error: e.message }; } finally { pipelineBusy = false; }
}
function showReminder(n) {
  try {
    if (Notification.isSupported()) {
      const notif = new Notification({ title: n.title, body: n.body + '（点击打开日历）', silent: false });
      notif.on('click', () => { mainWindow?.show(); mainWindow?.webContents.send('open-view', { view: 'calendar', id: n.id }); });
      notif.show();
    }
  } catch (_) {}
  mainWindow?.webContents.send('reminder', n);
}
function v23Decorate(table, rows) { return (rows || []).map(r => ({ ...r, demo: v23.demo.isDemo(table, r.id) })); }
function registerV23Ipc() {
  const h = (name, fn) => ipcMain.handle(name, async (...a) => { try { return await fn(...a); } catch (e) { appendLog('ERROR', name, e); return { ok: false, error: e.message }; } });
  const dayStart = (ts) => { const d = new Date(ts + 8 * 3600e3); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 8 * 3600e3; };
  h('v23-run-pipeline', () => runPipeline('manual'));
  h('v23-overview', () => ({ kb: v23.kb.stats(), memory: v23.memory.stats(), calendar: v23.calendar.stats(), inbox: v23.inbox.counts(), last: v23.pipeline.lastRun(), budget: v23.budget.status(config), fts: store.ftsStatus() }));
  // 知识库
  h('v23-kb-entities', (_e, o = {}) => {
    const w = ["merged_into IS NULL"]; const p = [];
    if (o.status) { w.push('status=?'); p.push(o.status); } else w.push("status IN ('active','candidate')");
    if (o.type) { w.push('type=?'); p.push(o.type); }
    if (o.q) { w.push('(name LIKE ? OR pinyin LIKE ?)'); p.push('%' + o.q + '%', '%' + String(o.q).toLowerCase() + '%'); }
    return v23Decorate('entities', store.all(`SELECT e.*, (SELECT id FROM wiki_pages w WHERE w.entity_id=e.id) page_id, (SELECT staleness FROM wiki_pages w WHERE w.entity_id=e.id) staleness, (SELECT COUNT(*) FROM claims c WHERE c.entity_id=e.id AND c.status='conflict') conflicts FROM entities e WHERE ${w.join(' AND ')} ORDER BY status='active' DESC, salience DESC LIMIT 300`, p));
  });
  h('v23-kb-entity', (_e, id) => { const d = v23.kb.entityDetail(id); if (d) { d.demo = v23.demo.isDemo('entities', d.entity.id); d.claims = d.claims.map(c => ({ ...c, evidence: require('../common/evidence').list('claim', c.id).slice(0, 3) })); } return d; });
  h('v23-kb-set-notes', (_e, { pageId, notes }) => { const ok = v23.kb.setUserNotes(pageId, notes); store.persist(); return { ok }; });
  h('v23-kb-revision', (_e, id) => v23.kb.revision(id));
  h('v23-kb-log', () => v23.kb.logMarkdown(200));
  h('v23-kb-documents', (_e, o = {}) => v23Decorate('documents', store.all(`SELECT id,kind,title,uri,app,first_seen,last_seen,dwell_ms,privacy_level,version,(SELECT COUNT(*) FROM chunks c WHERE c.doc_id=d.id) chunks FROM documents d ${o.q ? 'WHERE title LIKE ?' : ''} ORDER BY last_seen DESC LIMIT 200`, o.q ? ['%' + o.q + '%'] : [])));
  h('v23-kb-merge', (_e, { keep, drop }) => ({ op: v23.kb.mergeEntities(keep, drop) }));
  h('v23-kb-undo-merge', (_e, op) => ({ ok: v23.kb.undoMerge(op) }));
  h('v23-search', (_e, q) => v23.search.search(q));
  // 记忆
  h('v23-memories', (_e, o = {}) => v23Decorate('memories', v23.memory.list(o)));
  h('v23-memory', (_e, id) => { const m = v23.memory.get(id); if (m) { m.history = v23.memory.history(id); m.demo = v23.demo.isDemo('memories', id); } return m; });
  h('v23-memory-edit', (_e, { id, text, kind }) => ({ ok: v23.memory.edit(id, { text, kind }) }));
  h('v23-memory-pin', (_e, { id, on }) => ({ ok: v23.memory.pin(id, on) }));
  h('v23-memory-delete', (_e, id) => ({ ok: v23.memory.remove(id) }));
  h('v23-memory-add', (_e, { text, kind }) => v23.memory.ingest({ type: kind || 'preference', text, predicate: kind === 'decision' ? '决定' : undefined, object: text, confidence: 1 }, { source: 'user' }));
  h('v23-memory-export', async () => {
    const r = await dialog.showSaveDialog(mainWindow, { defaultPath: 'mindtrace-memories.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return { ok: false };
    fs.writeFileSync(r.filePath, JSON.stringify(v23.memory.exportJson(), null, 2)); return { ok: true, path: r.filePath };
  });
  h('v23-profile', () => v23.memory.getProfile({ scope: 'app', budget: 2000 }));
  h('v23-episodes', (_e, o = {}) => v23Decorate('episodes', require('../calendar/blocks').getEpisodes({ from: o.from || Date.now() - 7 * 86400e3, to: o.to || Date.now() + 86400e3, q: o.q })));
  // 日历
  h('v23-calendar-range', (_e, { from, to }) => { const r = v23.calendar.listRange(from, to); r.plan = v23Decorate('calendar_events', r.plan); r.undated = v23Decorate('calendar_events', r.undated); return r; });
  h('v23-calendar-day-compare', (_e, ts) => v23.calendar.dayCompare(dayStart(ts || Date.now())));
  h('v23-calendar-create', (_e, ev) => {
    let start = ev.start_at, end = ev.end_at;
    if (!start && ev.when) { const t = v23.zhtime.parse(String(ev.when), Date.now())[0]; if (t) { start = t.start; end = t.end || null; } }
    return { id: v23.calendar.create({ ...ev, start_at: start ?? null, end_at: end ?? null, status: 'confirmed' }, { by: 'user' }) };
  });
  h('v23-calendar-update', (_e, { id, patch }) => ({ ok: v23.calendar.update(id, patch) }));
  h('v23-calendar-complete', (_e, id) => ({ ok: v23.calendar.complete(id) }));
  h('v23-calendar-delete', (_e, id) => ({ ok: v23.calendar.remove(id) }));
  h('v23-calendar-snooze', (_e, { id, minutes }) => ({ until: v23.calendar.snooze(id, minutes || 10) }));
  h('v23-calendar-parse', (_e, text) => v23.zhtime.parse(String(text || ''), Date.now()).map(x => ({ ...x, label: v23.zhtime.fmt(x.start) + (x.end ? ' – ' + v23.zhtime.fmt(x.end).slice(11) : '') })));
  h('v23-calendar-export-ics', async () => {
    const r = await dialog.showSaveDialog(mainWindow, { defaultPath: 'mindtrace.ics', filters: [{ name: 'iCalendar', extensions: ['ics'] }] });
    if (r.canceled) return { ok: false };
    fs.writeFileSync(r.filePath, v23.calendar.exportIcs()); return { ok: true, path: r.filePath };
  });
  h('v23-calendar-feed', () => {
    config.calendar = config.calendar || {};
    if (!config.calendar.feedToken) { config.calendar.feedToken = crypto.randomUUID().replace(/-/g, ''); saveConfig(config); }
    return { url: `http://127.0.0.1:${config.api?.port || 17321}/calendar/feed.ics?token=${config.calendar.feedToken}`, apiEnabled: !!config.api?.enabled };
  });
  // 待处理
  h('v23-inbox', () => v23.inbox.list().map(i => ({ ...i, demo: v23.demo.isDemo({ memory: 'memories', calendar: 'calendar_events', calendar_change: 'calendar_events', merge: 'merge_suggestions', conflict: 'claims' }[i.type], i.id) || (i.type === 'conflict' && v23.demo.isDemo('claims', i.id)) })));
  h('v23-inbox-counts', () => v23.inbox.counts());
  h('v23-inbox-act', (_e, { type, id, action, extra }) => { const ok = v23.inbox.act(type, id, action, extra || {}); store.persist(); return { ok }; });
  // 遗忘
  h('v23-forget-preview', (_e, subject) => {
    const like = '%' + subject + '%';
    const g = (s, p) => store.get(s, p)?.c || 0;
    return { memories: g(`SELECT COUNT(*) c FROM memories WHERE text LIKE ?`, [like]), calendar: g(`SELECT COUNT(*) c FROM calendar_events WHERE title LIKE ? OR participants LIKE ?`, [like, like]), chunks: g(`SELECT COUNT(*) c FROM chunks WHERE text LIKE ?`, [like]), activities: g(`SELECT COUNT(*) c FROM activities WHERE window_title LIKE ? OR content LIKE ?`, [like, like]) };
  });
  h('v23-forget', (_e, { subject, purgeRaw }) => { const r = v23.forget.forgetSubject(subject, { purgeRaw }); store.persist(true); return r; });
  // 今日合并视图
  h('v23-today', () => {
    const s = dayStart(Date.now());
    const cal = v23.calendar.listRange(s, s + 86400e3);
    return {
      plan: v23Decorate('calendar_events', cal.plan), actual: cal.actual, compare: v23.calendar.dayCompare(s),
      entities: v23Decorate('entities', store.all(`SELECT e.id, e.name, e.type, COUNT(*) n FROM mentions m JOIN entities e ON e.id=m.entity_id WHERE m.ts>=? AND e.status='active' GROUP BY e.id ORDER BY n DESC LIMIT 8`, [s])),
      memories: v23Decorate('memories', store.all(`SELECT id, kind, text, status FROM memories WHERE (created_at>=? OR last_seen_at>=?) AND status IN ('active','pending') ORDER BY updated_at DESC LIMIT 6`, [s, s])),
      inbox: v23.inbox.counts()
    };
  });
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
    const noise = require('../core/noise');
    const lim = opts.limit || 200;
    const hideLow = opts.hideLow !== false;
    let rows = store.searchActivities({ q: opts.q, type: opts.type, from, to, limit: hideLow ? Math.min(lim * 4, 5000) : lim });
    rows = noise.filter(rows, { hideLow });
    if (opts.group !== false && !opts.q) rows = noise.sessionize(rows);
    return rows.slice(0, lim);
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
      const j = await pro.runJob('summarize', {});
      if (!j.ok) return { ok: false, error: j.error };
      return { ok: true, journal: store.get(`SELECT * FROM journals ORDER BY updated_at DESC LIMIT 1`) };
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

  ipcMain.handle('test-ai', async (_e, form) => {
    try { return await require('../ai/client').testConnection(config, form || {}); }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('list-models', async (_e, form = {}) => {
    const ai = { ...config.ai };
    if (form.baseUrl) ai.baseUrl = String(form.baseUrl).trim();
    if (form.apiKey && !String(form.apiKey).startsWith('••••')) ai.apiKey = String(form.apiKey).trim();
    return (await require('../ai/client').listModels({ ...config, ai })) || null;
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
    const j = await pro.runJob('rollup', { level: opts.level || 'day', key: opts.key });
    return j.ok ? { ok: true } : { ok: false, error: j.error };
  });
  ipcMain.handle('clear-chat', () => { store.run(`DELETE FROM chat_messages`); store.persist(); return { ok: true }; });
  // ── v2.2 pro ──
  const safe = fn => async (...a) => { try { return await fn(...a); } catch (e) { return { ok: false, error: e.message }; } };
  ipcMain.handle('pro-audit', (_e, o) => pro.listAudit(o || {}));
  ipcMain.handle('pro-wipe-range', safe((_e, { from, to }) => { const r = pro.wipeRange(from, to); const c = v23.forget.cascadeRange(from, to); store.persist(true); return { ok: true, ...r, derived: c }; }));
  registerV23Ipc();
  require('./timelineIpc').register({ store, v23, getConfig: () => config, setConfig: (patch) => {
    const merge = (a, b) => { for (const k of Object.keys(b || {})) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) a[k] = merge(a[k] || {}, b[k]); else a[k] = b[k]; } return a; };
    config = merge(config, patch); saveConfig(config);
  } });
  require('./ipc24').register({ store, v23, pro, getConfig: () => config, saveConfig: () => saveConfig(config), getWindow: () => mainWindow, ensureApi: () => {
    if (!config.api) config.api = { port: 17321 };
    if (!config.api.token) config.api.token = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    if (!config.api.enabled) { config.api.enabled = true; saveConfig(config); try { apiServer.start({ getConfig }); mcpServer.start({ getConfig, hooks: { version: app.getVersion() } }); } catch (e) { appendLog('ERROR', 'ensureApi', e); } }
    else saveConfig(config);
  } });
  ipcMain.handle('pro-get-rules', () => ({ rules: config.privacy.rules || [], sensitiveDetection: config.privacy.sensitiveDetection !== false, localOnly: !!config.privacy.localOnly }));
  ipcMain.handle('pro-set-rules', safe((_e, o = {}) => {
    if (Array.isArray(o.rules)) config.privacy.rules = o.rules.filter(r => r && r.match).map(r => ({ match: String(r.match), scope: r.scope === 'site' ? 'site' : 'app', mode: ['none', 'title', 'full'].includes(r.mode) ? r.mode : 'none' }));
    if (typeof o.sensitiveDetection === 'boolean') config.privacy.sensitiveDetection = o.sensitiveDetection;
    if (typeof o.localOnly === 'boolean') config.privacy.localOnly = o.localOnly;
    if (typeof o.monthlyBudgetUsd === 'number') config.ai.monthlyBudgetUsd = Math.max(0, o.monthlyBudgetUsd);
    saveConfig(config); pro.audit('privacy', 'update-rules', null, o);
    return { ok: true };
  }));
  ipcMain.handle('pro-usage', () => pro.usageSummary());
  ipcMain.handle('pro-jobs', () => pro.listJobs(50));
  ipcMain.handle('pro-retry-job', safe((_e, id) => pro.retryJob(id)));
  ipcMain.handle('pro-review-queue', (_e, s) => pro.reviewQueue(s || 'pending'));
  ipcMain.handle('pro-review', safe((_e, { id, action, text }) => pro.reviewMemory(id, action, text)));
  ipcMain.handle('pro-memory-counts', () => pro.memoryCounts());
  ipcMain.handle('pro-analytics', (_e, o = {}) => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return pro.analytics(o.from || d.getTime(), o.to || d.getTime() + 86400000);
  });
  ipcMain.handle('pro-weekly', () => pro.weeklyReview());
  ipcMain.handle('pro-backup', safe(async (_e, { passphrase } = {}) => {
    const r = await dialog.showSaveDialog(mainWindow, { title: '导出加密备份', defaultPath: `MindTrace-${new Date().toISOString().slice(0, 10)}.mtbak`, filters: [{ name: 'MindTrace 备份', extensions: ['mtbak'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    return { ok: true, ...pro.backup(r.filePath, passphrase) };
  }));
  ipcMain.handle('pro-restore', safe(async (_e, { passphrase } = {}) => {
    const r = await dialog.showOpenDialog(mainWindow, { title: '从备份恢复', properties: ['openFile'], filters: [{ name: 'MindTrace 备份', extensions: ['mtbak'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, ...pro.restore(r.filePaths[0], passphrase) };
  }));
  ipcMain.handle('pro-diagnostics', safe(async () => {
    const r = await dialog.showSaveDialog(mainWindow, { title: '导出诊断包', defaultPath: `MindTrace-diagnostics-${Date.now()}.json` });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    const d = pro.diagnostics({ appVersion: app.getVersion(), collectorStatus: collectorStatus.getAll(), logPath: getLogPath() });
    fs.writeFileSync(r.filePath, JSON.stringify(d, null, 2));
    return { ok: true, path: r.filePath };
  }));
  ipcMain.handle('pro-mcp-info', () => ({ url: `http://127.0.0.1:${(config.api?.port || 17321) + 1}/mcp`, token: config.api?.token, enabled: !!config.api?.enabled, tools: mcpServer.TOOLS.map(t => ({ name: t.name, description: t.description })) }));

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
  require('./devShot').prepareConfig(config);
  if (!config.api.token) {
    config.api.token = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    saveConfig(config);
  }
  await store.initStore();
  require('./devShot').seed(store);
  pro.init({ getConfig: () => config });
  try { v23.schema.migrate(); } catch (e) { appendLog('ERROR', 'v23-migrate', e); }
  v23.pipeline.setConfigGetter(() => config);
  v23.memory.setThreshold(config.wiki?.memoryMinConfidence ?? 0.7);
  v23.calendar.setNotifier(showReminder);
  setInterval(() => { try { const ids = v23.calendar.tick(); if (ids.length) store.persist(); } catch (e) { console.error('reminder', e.message); } }, 60 * 1000);
  setInterval(() => runPipeline('timer'), Math.max(5, config.v23?.pipelineIntervalMin || 10) * 60 * 1000);
  setTimeout(() => runPipeline('boot'), 30 * 1000);
  store.setInsertPolicy(row => pro.applyPolicy(row));
  store.setMemoryThreshold(config.wiki?.memoryMinConfidence ?? 0.75);
  pro.registerJob('summarize', () => summarizer.buildDailyJournal(config).then(r => ({ id: r && r.id })));
  pro.registerJob('rollup', async (o = {}) => {
    const level = o.level || 'day';
    if (level === 'hour') await wikiEngine.buildHourRollup(config, o.key || wikiEngine.hourKey(Date.now()));
    else if (level === 'week') await wikiEngine.buildWeekRollup(config, o.key || wikiEngine.weekKey(Date.now()));
    else if (level === 'month') await wikiEngine.buildMonthRollup(config, o.key || wikiEngine.monthKey(Date.now()));
    else await wikiEngine.buildDayRollup(config, o.key || wikiEngine.dayKey(Date.now()));
    return { level };
  });
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
