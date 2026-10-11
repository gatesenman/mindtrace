const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const store = require('../main/store');
const windowTracker = require('./windowTracker');
const prompts = require('../ai/prompts');
const { visionDescribe, parseJsonLoose } = require('../ai/client');

let timer = null;
let getConfig = () => ({});
let desktopCapturer = null;
let BrowserWindow = null;
let visionQueue = Promise.resolve();

function shotDir() {
  const dir = path.join(app.getPath('userData'), 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function shouldCaptureForApp(cfg, cur) {
  const only = cfg.privacy?.onlyScreenshotApps || [];
  if (!only.length) return true;
  if (!cur) return false;
  const hay = `${cur.app || ''} ${cur.process || ''} ${cur.title || ''}`.toLowerCase();
  return only.some(a => a && hay.includes(String(a).toLowerCase()));
}

function purgeOld(retainDays) {
  const days = retainDays || 14;
  const cutoff = Date.now() - days * 86400000;
  try {
    const dir = shotDir();
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs < cutoff) fs.unlinkSync(full);
      } catch (_) {}
    }
  } catch (_) {}
}

function canUseVision(cfg) {
  const ai = cfg.ai || {};
  if (!ai.apiKey && !String(ai.baseUrl || '').includes('11434') && !String(ai.baseUrl || '').includes('localhost')) {
    return false;
  }
  // visionModel preferred; otherwise allow if user set a known multimodal model name
  const m = (ai.visionModel || ai.model || '').toLowerCase();
  if (ai.visionModel) return true;
  return /gpt-4o|gpt-4\.1|vision|qwen-vl|qwen2-vl|llava|moondream|gemini|glm-4v|internvl/.test(m);
}

async function describeShot(cfg, id, file) {
  try {
    if (!canUseVision(cfg)) return;
    const model = cfg.ai.visionModel || cfg.ai.model;
    const { content } = await visionDescribe(cfg, file, prompts.visionScreenshot, {
      model,
      max_tokens: 600
    });
    const parsed = parseJsonLoose(content);
    let description = content;
    let ocr = null;
    if (parsed) {
      const parts = [
        parsed.app_guess && `应用：${parsed.app_guess}`,
        parsed.ui && `界面：${parsed.ui}`,
        parsed.activity && `活动：${parsed.activity}`,
        Array.isArray(parsed.key_text) && parsed.key_text.length ? `关键文本：${parsed.key_text.join('；')}` : null
      ].filter(Boolean);
      description = parts.join(' · ') || content;
      ocr = Array.isArray(parsed.key_text) ? parsed.key_text.join('\n') : null;
      if (parsed.sensitive) description += ' · [含敏感，已省略细节]';
    }
    store.updateScreenshotDescription(id, description, ocr);
  } catch (e) {
    console.error('visionDescribe', e.message);
    store.updateScreenshotDescription(id, `[识图失败] ${e.message}`.slice(0, 200), null);
  }
}

function enqueueVision(cfg, id, file) {
  visionQueue = visionQueue.then(() => describeShot(cfg, id, file)).catch(() => {});
}

async function capture(force = false) {
  const cfg = getConfig();
  if (!cfg.authorized || cfg.privacy?.paused || !cfg.collectors?.screenshots) return null;
  if (!desktopCapturer) return null;

  try {
    const idle = await windowTracker.getIdleSeconds();
    if (!force && idle >= 300) return null;

    const cur = windowTracker.getCurrent();
    if (!force && !shouldCaptureForApp(cfg, cur)) return null;

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
      content: null,
      meta: { screenshotId: id, visionPending: true }
    });
    // async vision write-back
    enqueueVision(cfg, id, file);
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
    const sec = cfg.privacy?.screenshotIntervalSec || 300;
    capture(false);
    purgeOld(cfg.privacy?.screenshotRetainDays || 14);
    timer = setTimeout(tick, Math.max(30, sec) * 1000);
  };
  timer = setTimeout(tick, 15000);
}

function stop() {
  if (timer) { clearTimeout(timer); timer = null; }
}

module.exports = { start, stop, capture, shotDir, describeShot };
