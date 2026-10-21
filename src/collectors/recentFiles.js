const fs = require('fs');
const path = require('path');
const os = require('os');
const status = require('../main/collectorStatus');
const { extractExcerpt } = require('./downloads');

let timer = null;
let getConfig = () => ({});
let bus = null;
const seen = new Map();

const DOC_EXT = /\.(pdf|docx?|md|txt|epub|xlsx|pptx|html?|csv)$/i;

function recentDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Recent');
  }
  // Linux: recently-used.xbel
  return path.join(os.homedir(), '.local', 'share');
}

async function scanWinRecent(opts = {}) {
  const dir = recentDir();
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.lnk')).slice(0, opts.maxAgeDays ? 300 : 40);
  let added = 0;
  for (const f of files) {
    const full = path.join(dir, f);
    let st; try { st = fs.statSync(full); } catch { continue; }
    if (Date.now() - st.mtimeMs > (opts.maxAgeDays || 2) * 86400000) continue;
    const name = f.replace(/\.lnk$/i, '');
    if (!DOC_EXT.test(name) && !/\./.test(name)) {
      // still record
    }
    const key = full + st.mtimeMs;
    if (seen.has(key)) continue;
    seen.set(key, true);
    (opts.sink || ((e) => bus?.push(e)))({
      type: 'file',
      ts_start: st.mtimeMs,
      app: '最近使用',
      title: name,
      path: full,
      content: null,
      meta: { shortcut: true },
      source: 'recent'
    });
    added++;
  }
  return { added };
}

async function scanLinuxRecent() {
  const xbel = path.join(os.homedir(), '.local', 'share', 'recently-used.xbel');
  if (!fs.existsSync(xbel)) return;
  let xml; try { xml = fs.readFileSync(xbel, 'utf8'); } catch { return; }
  const re = /href="file:\/\/([^"]+)"/g;
  let m; const paths = [];
  while ((m = re.exec(xml)) && paths.length < 30) {
    try { paths.push(decodeURIComponent(m[1])); } catch (_) {}
  }
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    let st; try { st = fs.statSync(p); } catch { continue; }
    const key = p + st.mtimeMs;
    if (seen.has(key)) continue;
    seen.set(key, true);
    let content = null;
    if (DOC_EXT.test(p) && st.size < 8 * 1024 * 1024) {
      content = await extractExcerpt(p);
    }
    bus?.push({
      type: 'file',
      ts_start: st.mtimeMs,
      app: '最近使用',
      title: path.basename(p),
      path: p,
      content,
      meta: {},
      source: 'recent'
    });
  }
}

async function tick() {
  const cfg = getConfig();
  if (!cfg.authorized || cfg.privacy?.paused || !cfg.collectors?.files) {
    if (!cfg.collectors?.files) status.disabled('files');
    return;
  }
  if (process.platform === 'win32') await scanWinRecent();
  else await scanLinuxRecent();
  status.ok('files', '最近文件');
}

function start(opts = {}) {
  getConfig = opts.getConfig || getConfig;
  bus = opts.bus;
  stop();
  timer = setInterval(tick, opts.intervalMs || 60000);
  setTimeout(tick, 7000);
}
function stop() { if (timer) clearInterval(timer); timer = null; }

async function backfill(opts = {}) { return process.platform === 'win32' ? scanWinRecent(opts) : { added: 0, unsupported: true }; }
module.exports = { start, stop, backfill };
