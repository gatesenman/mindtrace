const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const store = require('../main/store');
const windowTracker = require('./windowTracker');
const prompts = require('../ai/prompts');
const { visionDescribe, parseJsonLoose } = require('../ai/client');
const status = require('../main/collectorStatus');
const { sampleHash, similar } = require('../worker/phash');
const { redactText } = require('../privacy/redact');
const winocr = require('../ocr/winocr');
const tdedup = require('../ocr/textdedup');
const gate = require('../net/gate');
let lastOcr = { lines: [], text: '', app: '' };

let timer = null;
let getConfig = () => ({});
let desktopCapturer = null;
let BrowserWindow = null;
let visionQueue = Promise.resolve();
let lastPhash = null;
let bus = null;

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
  const base = String(ai.baseUrl || '');
  const model = String(ai.visionModel || ai.model || '').trim();
  // No model configured → skip OCR quietly (screenshot file still saved)
  if (!model) return false;
  if (!ai.apiKey && !base.includes('11434') && !base.includes('localhost') && !base.includes('127.0.0.1')) {
    return false;
  }
  if (!gate.check(base, cfg, 'llm:vision').ok) return false;
  // visionModel preferred; otherwise allow known multimodal names or local endpoints
  if (ai.visionModel && String(ai.visionModel).trim()) return true;
  const m = model.toLowerCase();
  if (/127\.0\.0\.1|localhost/.test(base)) return true;
  return /gpt-4o|gpt-4\.1|vision|qwen-vl|qwen2-vl|llava|moondream|gemini|glm-4v|internvl|mock/.test(m);
}

/** 2.4：本地 OCR 优先（Windows.Media.Ocr），文本级去重；只有本地拿不到文字时才考虑云端识图 */
async function localOcr(cfg, id, file, phash, appName) {
  if (cfg.privacy?.ocrEngine === 'off' || !winocr.supported()) return null;
  const r = await winocr.recognize(file, { key: phash });
  if (!r.ok) { status.ok('screenshots', '本地 OCR 不可用：' + String(r.error).slice(0, 40)); return null; }
  if (!r.text || r.text.replace(/\s/g, '').length < 12) return { empty: true };
  const sim = lastOcr.app === appName ? tdedup.similarity(r.text, lastOcr.text) : 0;
  const newLines = lastOcr.app === appName ? tdedup.delta(lastOcr.lines, r.lines) : r.lines;
  lastOcr = { lines: r.lines, text: r.text, app: appName };
  let text = r.text, description;
  if (sim >= 0.92) description = `本地 OCR · 与上一帧文字基本相同（相似度 ${Math.round(sim * 100)}%）`;
  else description = `本地 OCR · ${r.lines.length} 行${newLines.length < r.lines.length ? `（新增 ${newLines.length} 行）` : ''} · ${r.ms}ms`;
  if (cfg.privacy?.autoRedact !== false) text = redactText(text);
  store.updateScreenshotDescription(id, description, text);
  return { ok: true, duplicate: sim >= 0.92, lines: r.lines.length, newLines: newLines.length, ms: r.ms };
}

async function describeShot(cfg, id, file, phash, appName) {
  try {
    const loc = await localOcr(cfg, id, file, phash, appName).catch(() => null);
    if (loc && loc.ok && !cfg.ai?.visionAfterOcr) return loc;
    if (!canUseVision(cfg)) return loc;
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
    if (cfg.privacy?.autoRedact !== false) {
      description = redactText(description || '');
      if (ocr) ocr = redactText(ocr);
    }
    store.updateScreenshotDescription(id, description, ocr);
  } catch (e) {
    console.error('visionDescribe', e.message);
    store.updateScreenshotDescription(id, `[识图失败] ${e.message}`.slice(0, 200), null);
  }
}

function enqueueVision(cfg, id, file, phash, appName) {
  visionQueue = visionQueue.then(() => describeShot(cfg, id, file, phash, appName)).catch(() => {});
}

async function capture(force = false) {
  const cfg = getConfig();
  if (!cfg.authorized || cfg.privacy?.paused || !cfg.collectors?.screenshots) {
    if (!cfg.collectors?.screenshots) status.disabled('screenshots');
    return null;
  }
  if (!desktopCapturer) return null;

  try {
    const idle = await windowTracker.getIdleSeconds();
    const idleLimit = cfg.privacy?.idleThresholdSec || 300;
    if (!force && idle >= idleLimit) return null;

    const cur = windowTracker.getCurrent();
    if (!force && !shouldCaptureForApp(cfg, cur)) return null;

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 }
    });
    if (!sources.length) return null;
    const source = sources[0];
    const png = source.thumbnail.toPNG();
    const phash = sampleHash(png);
    if (!force && similar(phash, lastPhash)) {
      status.ok('screenshots', '画面未变，跳过');
      return null;
    }
    lastPhash = phash;
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
      meta: { screenshotId: id, visionPending: true, phash }
    });
    // 2.4：本地 OCR（Windows.Media.Ocr）优先，云端识图仅兜底
    enqueueVision(cfg, id, file, phash, cur?.app || '');
    status.ok('screenshots', '已截屏');
    return { id, file };
  } catch (e) {
    console.error('screenshot', e.message);
    status.err('screenshots', e);
    return null;
  }
}

function start(opts = {}) {
  getConfig = opts.getConfig || getConfig;
  desktopCapturer = opts.desktopCapturer;
  BrowserWindow = opts.BrowserWindow;
  bus = opts.bus || null;
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

module.exports = { start, stop, capture, shotDir, describeShot, localOcr, _resetOcr: () => { lastOcr = { lines: [], text: '', app: '' }; } };
