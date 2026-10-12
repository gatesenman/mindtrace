const fs = require('fs');
const path = require('path');
const os = require('os');
const status = require('../main/collectorStatus');

let watchers = [];
let getConfig = () => ({});
let bus = null;
let pollTimer = null;
const mtimes = new Map();

function defaultNoteFolders(cfg) {
  const home = os.homedir();
  const list = [...(cfg.noteFolders || [])];
  const guesses = [
    path.join(home, 'Documents', 'Notes'),
    path.join(home, 'Documents', 'Obsidian'),
    path.join(home, 'Obsidian'),
    path.join(home, 'NotionExport')
  ];
  for (const g of guesses) if (fs.existsSync(g) && !list.includes(g)) list.push(g);
  return list.filter(f => f && fs.existsSync(f));
}

function walkMd(dir, depth, out) {
  if (depth < 0) return;
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(full, depth - 1, out);
    else if (/\.(md|txt|markdown)$/i.test(e.name)) out.push(full);
  }
}

function ingestFile(file, event) {
  const cfg = getConfig();
  if (!cfg.authorized || cfg.privacy?.paused || !cfg.collectors?.notes) return;
  let st; try { st = fs.statSync(file); } catch { return; }
  const prev = mtimes.get(file);
  mtimes.set(file, st.mtimeMs);
  if (event === 'poll' && prev === undefined) return;
  if (prev && st.mtimeMs <= prev) return;
  let content = '';
  try {
    if (st.size < 2 * 1024 * 1024) content = fs.readFileSync(file, 'utf8').slice(0, 20000);
  } catch (_) {}
  bus?.push({
    type: 'note',
    ts_start: st.mtimeMs || Date.now(),
    app: '笔记',
    title: path.basename(file),
    path: file,
    content,
    meta: { event, ext: path.extname(file) },
    source: 'notes'
  });
  status.ok('notes', path.basename(file));
}

/** Programmatic quick note from main */
function addQuickNote({ title, content, tags }) {
  const now = Date.now();
  bus?.push({
    type: 'note',
    ts_start: now,
    app: '速记',
    title: title || `速记 ${new Date(now).toLocaleString('zh-CN')}`,
    content: content || '',
    meta: { quick: true, tags: tags || [] },
    source: 'notes-hotkey'
  });
}

function poll() {
  const cfg = getConfig();
  if (!cfg.authorized || cfg.privacy?.paused || !cfg.collectors?.notes) {
    if (!cfg.collectors?.notes) status.disabled('notes');
    return;
  }
  for (const folder of defaultNoteFolders(cfg)) {
    const files = [];
    walkMd(folder, 3, files);
    for (const f of files) ingestFile(f, 'poll');
  }
}

function start(opts = {}) {
  getConfig = opts.getConfig || getConfig;
  bus = opts.bus;
  stop();
  poll();
  pollTimer = setInterval(poll, opts.intervalMs || 8000);
  status.ok('notes', '监视笔记目录');
}

function stop() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  for (const w of watchers) try { w.close(); } catch (_) {}
  watchers = [];
}

module.exports = { start, stop, addQuickNote, defaultNoteFolders };
