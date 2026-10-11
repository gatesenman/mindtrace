const store = require('../main/store');

let timer = null;
let lastText = '';
let getConfig = () => ({});
let clipboard = null;

function isBlacklisted(text, cfg) {
  const keywords = cfg.privacy?.blacklistKeywords || [];
  const t = text || '';
  for (const k of keywords) if (k && t.includes(k)) return true;
  return false;
}

function poll() {
  const cfg = getConfig();
  if (!cfg.authorized || cfg.privacy?.paused || !cfg.collectors?.clipboard) return;
  if (!clipboard) return;
  try {
    const text = clipboard.readText();
    if (!text || text === lastText) return;
    if (text.length < 2) return;
    const maxLen = cfg.privacy?.clipboardMaxLen || 5000;
    if (isBlacklisted(text, cfg)) {
      lastText = text;
      return;
    }
    lastText = text;
    const content = text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
    store.insertActivity({
      type: 'clipboard',
      started_at: Date.now(),
      ended_at: Date.now(),
      content,
      meta: { length: text.length }
    });
  } catch (e) {
    console.error('clipboard', e.message);
  }
}

function start(opts = {}) {
  getConfig = opts.getConfig || getConfig;
  clipboard = opts.clipboard;
  stop();
  timer = setInterval(poll, opts.intervalMs || 1500);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop };
