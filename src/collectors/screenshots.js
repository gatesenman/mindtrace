const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const store = require('../main/store');
const windowTracker = require('./windowTracker');

let timer = null;
let getConfig = () => ({});
let desktopCapturer = null;
let BrowserWindow = null;

function shotDir() {
  const dir = path.join(app.getPath('userData'), 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function capture() {
  const cfg = getConfig();
  if (!cfg.authorized || cfg.privacy?.paused || !cfg.collectors?.screenshots) return null;
  if (!desktopCapturer) return null;

  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 }
    });
    if (!sources.length) return null;
    const source = sources[0];
    const png = source.thumbnail.toPNG();
    const now = Date.now();
    const file = path.join(shotDir(), `shot-${now}.png`);
    fs.writeFileSync(file, png);
    const cur = windowTracker.getCurrent();
    const id = store.insertScreenshot({
      taken_at: now,
      file_path: file,
      app_name: cur?.app || null,
      window_title: cur?.title || null
    });
    store.insertActivity({
      type: 'screenshot',
      started_at: now,
      ended_at: now,
      app_name: cur?.app || '屏幕',
      window_title: cur?.title || '截图',
      file_path: file,
      meta: { screenshotId: id }
    });
    return { id, file };
  } catch (e) {
    console.error('screenshot', e.message);
    return null;
  }
}

function start(opts = {}) {
  getConfig = opts.getConfig || getConfig;
  desktopCapturer = opts.desktopCapturer;
  BrowserWindow = opts.BrowserWindow;
  stop();
  const tick = () => {
    const cfg = getConfig();
    const sec = cfg.privacy?.screenshotIntervalSec || 120;
    capture();
    timer = setTimeout(tick, Math.max(30, sec) * 1000);
  };
  timer = setTimeout(tick, 15000);
}

function stop() {
  if (timer) { clearTimeout(timer); timer = null; }
}

module.exports = { start, stop, capture, shotDir };
