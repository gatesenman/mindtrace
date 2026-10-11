const store = require('../main/store');
const { redactText, looksLikePassword } = require('../privacy/redact');
const status = require('../main/collectorStatus');

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
      content,
      meta: { length: text.length, redacted: content !== text.slice(0, maxLen) && content !== text.slice(0, maxLen) + '…' }
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
  stop();
  timer = setInterval(poll, opts.intervalMs || 1500);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop };
