const fs = require('fs');
const path = require('path');
const os = require('os');
const initSqlJs = require('sql.js');
const store = require('../main/store');

let timer = null;
let getConfig = () => ({});
let lastChrome = 0;
let lastEdge = 0;
let SQL = null;

function chromePaths() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [
      path.join(la, 'Google', 'Chrome', 'User Data', 'Default', 'History'),
      path.join(la, 'Microsoft', 'Edge', 'User Data', 'Default', 'History')
    ];
  }
  if (process.platform === 'linux') {
    return [
      path.join(home, '.config', 'google-chrome', 'Default', 'History'),
      path.join(home, '.config', 'chromium', 'Default', 'History'),
      path.join(home, '.config', 'microsoft-edge', 'Default', 'History')
    ];
  }
  return [
    path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'History')
  ];
}

function chromeTimeToMs(ct) {
  // Chrome time: microseconds since 1601-01-01
  return Math.floor(ct / 1000) - 11644473600000;
}

function isBlacklistedUrl(url, cfg) {
  const sites = cfg.privacy?.blacklistSites || [];
  const keywords = cfg.privacy?.blacklistKeywords || [];
  const u = (url || '').toLowerCase();
  for (const s of sites) if (s && u.includes(String(s).toLowerCase())) return true;
  for (const k of keywords) if (k && u.includes(String(k).toLowerCase())) return true;
  return false;
}

async function readHistoryFile(filePath, sinceChromeTime, browserName) {
  if (!fs.existsSync(filePath)) return [];
  const tmp = path.join(os.tmpdir(), `mt-hist-${browserName}-${Date.now()}.db`);
  try {
    fs.copyFileSync(filePath, tmp);
  } catch (e) {
    // file locked — try anyway with copy
    try {
      const buf = fs.readFileSync(filePath);
      fs.writeFileSync(tmp, buf);
    } catch (e2) {
      return [];
    }
  }
  try {
    if (!SQL) SQL = await initSqlJs();
    const filebuf = fs.readFileSync(tmp);
    const db = new SQL.Database(filebuf);
    const rows = [];
    const stmt = db.prepare(
      `SELECT url, title, last_visit_time, visit_count FROM urls WHERE last_visit_time > ? ORDER BY last_visit_time DESC LIMIT 200`
    );
    stmt.bind([sinceChromeTime]);
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    db.close();
    return rows.map(r => ({
      url: r.url,
      title: r.title,
      visitedAt: chromeTimeToMs(r.last_visit_time),
      visitCount: r.visit_count,
      browser: browserName,
      chromeTime: r.last_visit_time
    }));
  } catch (e) {
    console.error('browserHistory read', filePath, e.message);
    return [];
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

async function poll() {
  const cfg = getConfig();
  if (!cfg.authorized || cfg.privacy?.paused || !cfg.collectors?.browser) return;

  const paths = chromePaths().filter(p => fs.existsSync(p));
  for (const p of paths) {
    const name = p.toLowerCase().includes('edge') ? 'edge' : p.toLowerCase().includes('chromium') ? 'chromium' : 'chrome';
    const since = name === 'edge' ? lastEdge : lastChrome;
    // default: last 24h on first run
    const sinceCt = since || ((Date.now() + 11644473600000) * 1000 - 24 * 3600 * 1000000);
    const rows = await readHistoryFile(p, sinceCt, name);
    let maxCt = since;
    for (const r of rows.reverse()) {
      if (isBlacklistedUrl(r.url, cfg)) continue;
      // dedupe by url+time window
      const exists = store.get(
        `SELECT id FROM activities WHERE type='browser' AND url=? AND started_at>? LIMIT 1`,
        [r.url, r.visitedAt - 60000]
      );
      if (exists) {
        maxCt = Math.max(maxCt, r.chromeTime);
        continue;
      }
      store.insertActivity({
        type: 'browser',
        started_at: r.visitedAt,
        ended_at: r.visitedAt,
        app_name: name === 'edge' ? 'Microsoft Edge' : 'Google Chrome',
        process_name: name,
        window_title: r.title,
        url: r.url,
        meta: { visitCount: r.visitCount, browser: name }
      });
      maxCt = Math.max(maxCt, r.chromeTime);
    }
    if (name === 'edge') lastEdge = maxCt || lastEdge;
    else lastChrome = maxCt || lastChrome;
  }
}

function start(opts = {}) {
  getConfig = opts.getConfig || getConfig;
  stop();
  timer = setInterval(poll, opts.intervalMs || 60000);
  setTimeout(poll, 5000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, poll };
