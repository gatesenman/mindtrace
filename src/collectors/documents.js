const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('../main/store');

let watchers = [];
let pollTimer = null;
let recentTimer = null;
let getConfig = () => ({});
const seen = new Map();
const mtimes = new Map();

const DOC_EXT = new Set(['.pdf', '.docx', '.doc', '.md', '.txt', '.epub', '.rtf', '.csv', '.xlsx', '.pptx', '.html']);

function defaultWatchFolders() {
  const home = os.homedir();
  const folders = [
    path.join(home, 'Documents'),
    path.join(home, 'Desktop'),
    path.join(home, 'Downloads')
  ];
  if (process.platform === 'win32') {
    folders.push(path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Recent'));
  }
  return folders.filter(f => f && fs.existsSync(f));
}

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === '.txt' || ext === '.md' || ext === '.csv' || ext === '.rtf') {
      return fs.readFileSync(filePath, 'utf8').slice(0, 20000);
    }
    if (ext === '.docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return (result.value || '').slice(0, 20000);
    }
    if (ext === '.pdf') {
      try {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(fs.readFileSync(filePath));
        return (data.text || '').slice(0, 20000);
      } catch (_) { return ''; }
    }
  } catch (e) {
    console.error('extractText', filePath, e.message);
  }
  return '';
}

function shouldSkip(filePath, cfg) {
  const base = path.basename(filePath);
  if (base.startsWith('.')) return true;
  const keywords = cfg.privacy?.blacklistKeywords || [];
  const hay = filePath.toLowerCase();
  for (const k of keywords) if (k && hay.includes(String(k).toLowerCase())) return true;
  return false;
}

async function recordFile(filePath, event) {
  const cfg = getConfig();
  if (!cfg.authorized || cfg.privacy?.paused || !cfg.collectors?.documents) return;
  const ext = path.extname(filePath).toLowerCase();
  if (!DOC_EXT.has(ext)) return;
  if (shouldSkip(filePath, cfg)) return;
  const key = filePath + '|' + event;
  const now = Date.now();
  if (seen.has(key) && now - seen.get(key) < 30000) return;
  seen.set(key, now);

  let content = '';
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < 8 * 1024 * 1024) content = await extractText(filePath);
  } catch (_) {}

  store.insertActivity({
    type: 'document',
    started_at: now,
    ended_at: now,
    app_name: '文档',
    window_title: path.basename(filePath),
    file_path: filePath,
    content: content || null,
    meta: { event, ext }
  });
}

function walkDir(dir, depth, out) {
  if (depth < 0) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkDir(full, depth - 1, out);
    else if (ent.isFile()) out.push(full);
  }
}

function pollFolders() {
  const cfg = getConfig();
  if (!cfg.authorized || cfg.privacy?.paused || !cfg.collectors?.documents) return;
  const folders = (cfg.watchFolders && cfg.watchFolders.length) ? cfg.watchFolders : defaultWatchFolders();
  for (const folder of folders) {
    const files = [];
    walkDir(folder, 2, files);
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if (!DOC_EXT.has(ext)) continue;
      let st;
      try { st = fs.statSync(f); } catch { continue; }
      const prev = mtimes.get(f);
      mtimes.set(f, st.mtimeMs);
      if (prev === undefined) continue; // first sighting: don't flood
      if (st.mtimeMs > prev) recordFile(f, 'change');
    }
  }
}

function scanRecent() {
  if (process.platform !== 'win32') return;
  const recent = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Recent');
  if (!fs.existsSync(recent)) return;
  try {
    const files = fs.readdirSync(recent).filter(f => f.endsWith('.lnk')).slice(0, 40);
    for (const f of files) {
      const full = path.join(recent, f);
      const mtime = fs.statSync(full).mtimeMs;
      if (Date.now() - mtime > 2 * 3600 * 1000) continue;
      const name = f.replace(/\.lnk$/i, '');
      const exists = store.get(
        `SELECT id FROM activities WHERE type='document' AND window_title=? AND started_at>? LIMIT 1`,
        [name, Date.now() - 3600000]
      );
      if (exists) continue;
      store.insertActivity({
        type: 'document',
        started_at: mtime,
        ended_at: mtime,
        app_name: '最近使用',
        window_title: name,
        file_path: full,
        meta: { event: 'recent', shortcut: true }
      });
    }
  } catch (e) {
    console.error('scanRecent', e.message);
  }
}

function start(opts = {}) {
  getConfig = opts.getConfig || getConfig;
  stop();
  const cfg = getConfig();
  const folders = (cfg.watchFolders && cfg.watchFolders.length) ? cfg.watchFolders : defaultWatchFolders();
  for (const folder of folders) {
    try {
      const w = fs.watch(folder, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const full = path.join(folder, filename);
        if (eventType === 'rename' || eventType === 'change') {
          setTimeout(() => {
            try { if (fs.existsSync(full) && fs.statSync(full).isFile()) recordFile(full, eventType); } catch (_) {}
          }, 800);
        }
      });
      w.on('error', () => {});
      watchers.push(w);
    } catch (_) {
      // recursive watch unsupported on some platforms — poll covers it
    }
  }
  // seed mtimes then poll
  pollFolders();
  pollTimer = setInterval(pollFolders, 45000);
  recentTimer = setInterval(scanRecent, 120000);
  setTimeout(scanRecent, 8000);
}

function stop() {
  for (const w of watchers) { try { w.close(); } catch (_) {} }
  watchers = [];
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (recentTimer) { clearInterval(recentTimer); recentTimer = null; }
}

module.exports = { start, stop, defaultWatchFolders, extractText };
