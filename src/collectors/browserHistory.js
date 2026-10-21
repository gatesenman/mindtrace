const fs = require('fs');
const path = require('path');
const os = require('os');
const initSqlJs = require('sql.js');
const store = require('../main/store');
const status = require('../main/collectorStatus');

let timer = null;
let getConfig = () => ({});
const lastByPath = new Map();
let SQL = null;

function listProfileHistories() {
  const home = os.homedir();
  const roots = [];
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    roots.push(
      { browser: 'chrome', root: path.join(la, 'Google', 'Chrome', 'User Data') },
      { browser: 'edge', root: path.join(la, 'Microsoft', 'Edge', 'User Data') }
    );
  } else if (process.platform === 'linux') {
    roots.push(
      { browser: 'chrome', root: path.join(home, '.config', 'google-chrome') },
      { browser: 'chromium', root: path.join(home, '.config', 'chromium') },
      { browser: 'edge', root: path.join(home, '.config', 'microsoft-edge') }
    );
  } else {
    roots.push({ browser: 'chrome', root: path.join(home, 'Library', 'Application Support', 'Google', 'Chrome') });
  }

  const out = [];
  for (const { browser, root } of roots) {
    if (!fs.existsSync(root)) continue;
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (e) {
      status.err('browser', e);
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const name = ent.name;
      if (!(name === 'Default' || /^Profile \d+$/i.test(name) || /^Profile\d+$/i.test(name))) continue;
      const hist = path.join(root, name, 'History');
      if (fs.existsSync(hist)) {
        out.push({ browser, profile: name, filePath: hist });
      }
    }
  }
  return out;
}

function chromeTimeToMs(ct) {
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

async function readHistoryFile(filePath, sinceChromeTime, browserName, profile) {
  if (!fs.existsSync(filePath)) return [];
  const safe = Buffer.from(filePath, 'utf8').toString('hex').slice(0, 24);
  const tmp = path.join(os.tmpdir(), `mt-hist-${browserName}-${safe}-${Date.now()}.db`);
  try {
    fs.copyFileSync(filePath, tmp);
  } catch (e) {
    try {
      const buf = fs.readFileSync(filePath);
      fs.writeFileSync(tmp, buf);
    } catch (e2) {
      throw new Error(`无法复制历史库（可能被占用）: ${path.basename(path.dirname(filePath))}/${path.basename(filePath)}`);
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
      profile,
      chromeTime: r.last_visit_time
    }));
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

async function poll(opts = {}) {
  const cfg = (opts.getConfig || getConfig)();
  if (!cfg.authorized || cfg.privacy?.paused || (!cfg.collectors?.browser && !opts.force)) {
    status.disabled('browser');
    return;
  }
  try {
    const profiles = listProfileHistories();
    if (!profiles.length) {
      status.setStatus('browser', { status: 'warn', message: '未找到 Chrome/Edge 历史文件' });
      return;
    }
    let added = 0;
    for (const p of profiles) {
      const since = opts.sinceMs ? (opts.sinceMs + 11644473600000) * 1000 : (lastByPath.get(p.filePath) || ((Date.now() + 11644473600000) * 1000 - 24 * 3600 * 1000000));
      let rows = [];
      try {
        rows = await readHistoryFile(p.filePath, since, p.browser, p.profile);
      } catch (e) {
        status.err('browser', e);
        continue;
      }
      let maxCt = since;
      for (const r of rows.reverse()) {
        if (isBlacklistedUrl(r.url, cfg)) continue;
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
          app_name: p.browser === 'edge' ? 'Microsoft Edge' : (p.browser === 'chromium' ? 'Chromium' : 'Google Chrome'),
          process_name: p.browser,
          window_title: r.title,
          url: r.url,
          meta: { visitCount: r.visitCount, browser: p.browser, profile: p.profile }
        });
        added++;
        maxCt = Math.max(maxCt, r.chromeTime);
      }
      if (!opts.sinceMs) lastByPath.set(p.filePath, maxCt || since);
    }
    status.ok('browser', `已扫描 ${profiles.length} 个配置档` + (added ? `，新增 ${added}` : ''));
    return { profiles: profiles.length, added };
  } catch (e) {
    status.err('browser', e);
  }
}

function start(opts = {}) {
  getConfig = opts.getConfig || getConfig;
  stop();
  const cfg = getConfig();
  if (!cfg.collectors?.browser) { status.disabled('browser'); return; }
  status.setStatus('browser', { status: 'ok', message: '已启动' });
  timer = setInterval(() => { poll().catch(e => status.err('browser', e)); }, opts.intervalMs || 60000);
  setTimeout(() => { poll().catch(e => status.err('browser', e)); }, 5000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  status.idle('browser');
}

module.exports = { start, stop, poll, listProfileHistories };
