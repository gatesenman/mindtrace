const store = require('../main/store');
const { redactText, looksLikePassword } = require('../privacy/redact');
const status = require('../main/collectorStatus');

let timer = null;
let lastText = '';
let getConfig = () => ({});
let clipboard = null;
let windowTracker = null;
let BrowserWindow = null;
const noise = require('../core/noise');
const { isSelfApp, friendlyAppName } = require('../main/appNames');

/** 复制时的前台窗口 = 来源应用；知迹自身在前台时返回 self */
async function sourceAtCopy() {
  try { if (BrowserWindow && BrowserWindow.getFocusedWindow && BrowserWindow.getFocusedWindow()) return { self: true }; } catch (_) {}
  let fg = windowTracker?.getLastForeground?.();
  if (!fg || Date.now() - fg.at > 4000) { try { fg = await windowTracker?.getForeground?.(); } catch (_) { fg = null; } }
  if (!fg) return null;
  if (fg.self || isSelfApp(fg)) return { self: true };
  return { app: friendlyAppName(fg.app, fg.process, fg.title), process: fg.process, title: fg.title };
}

function isBlacklisted(text, cfg) {
  const keywords = cfg.privacy?.blacklistKeywords || [];
  const t = text || '';
  for (const k of keywords) if (k && t.includes(k)) return true;
  return false;
}

async function poll() {
  const cfg = getConfig();
  if (!cfg.authorized || cfg.privacy?.paused || !cfg.collectors?.clipboard) {
    if (!cfg.collectors?.clipboard) status.disabled('clipboard');
    return;
  }
  if (!clipboard) return;
  try {
    const text = clipboard.readText();
    if (!text || text === lastText) return;
    if (text.length < 2) return;
    const maxLen = cfg.privacy?.clipboardMaxLen || 5000;
    lastText = text;
    const src = await sourceAtCopy();
    if (src && src.self) { status.ok('clipboard', '已忽略知迹自身'); return; }
    if (noise.classify({ type: 'clipboard', content: text }).drop) return;
    let content;
    if (isBlacklisted(text, cfg)) {
      content = '[已隐藏]';
    } else {
      content = text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
      if (looksLikePassword(content)) {
        content = '[已隐藏-可能为密码]';
      } else if (cfg.privacy?.autoRedact !== false) {
        content = redactText(content);
      }
    }
    store.insertActivity({
      type: 'clipboard',
      started_at: Date.now(),
      ended_at: Date.now(),
      app_name: src?.app || null,
      process_name: src?.process || null,
      window_title: src?.title || null,
      content,
      meta: { length: text.length, sourceApp: src?.app || null, sourceProcess: src?.process || null, lowValue: noise.classify({ type: 'clipboard', content }).low || undefined, redacted: content !== text.slice(0, maxLen) && content !== text.slice(0, maxLen) + '…' }
    });
    status.ok('clipboard', '运行中');
  } catch (e) {
    console.error('clipboard', e.message);
    status.err('clipboard', e);
  }
}

function start(opts = {}) {
  getConfig = opts.getConfig || getConfig;
  clipboard = opts.clipboard;
  windowTracker = opts.windowTracker || require('./windowTracker');
  BrowserWindow = opts.BrowserWindow || null;
  stop();
  timer = setInterval(poll, opts.intervalMs || 1500);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop };
