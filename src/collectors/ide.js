const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const status = require('../main/collectorStatus');

let timer = null;
let getConfig = () => ({});
let bus = null;
let lastGitKey = '';

function vscodePaths() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return [
      path.join(appdata, 'Code', 'User', 'globalStorage', 'storage.json'),
      path.join(appdata, 'Cursor', 'User', 'globalStorage', 'storage.json'),
      path.join(appdata, 'Code', 'storage.json'),
      path.join(appdata, 'Cursor', 'storage.json')
    ];
  }
  return [
    path.join(home, '.config', 'Code', 'User', 'globalStorage', 'storage.json'),
    path.join(home, '.config', 'Cursor', 'User', 'globalStorage', 'storage.json'),
    path.join(home, '.config', 'Code', 'storage.json'),
    path.join(home, '.config', 'Cursor', 'storage.json')
  ];
}

function readRecentWorkspaces() {
  const found = [];
  for (const p of vscodePaths()) {
    if (!fs.existsSync(p)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const backup = j.backupWorkspaces || j.profileAssociations || {};
      const folders = backup.folders || [];
      for (const f of folders) {
        const u = f.folderUri || f;
        if (typeof u === 'string') found.push({ uri: u, source: p.includes('Cursor') ? 'Cursor' : 'VS Code' });
      }
      // openedPathsList legacy
      const opl = j.openedPathsList || {};
      for (const w of (opl.workspaces3 || opl.entries || [])) {
        const u = w?.configURIPath || w?.folderUri || w;
        if (typeof u === 'string') found.push({ uri: u, source: p.includes('Cursor') ? 'Cursor' : 'VS Code' });
      }
    } catch (_) {}
  }
  return found.slice(0, 30);
}

function uriToPath(uri) {
  if (!uri) return '';
  let s = String(uri);
  if (s.startsWith('file://')) {
    s = decodeURIComponent(s.replace(/^file:\/\//, ''));
    if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(s)) s = s.slice(1);
  }
  return s;
}

async function gitTodaySummary(cwd) {
  if (!cwd || !fs.existsSync(path.join(cwd, '.git'))) return null;
  try {
    const { stdout } = await execFileAsync('git', [
      '-C', cwd, 'log', '--since=midnight', '--pretty=format:%h|%s|%an|%aI', '--no-show-signature'
    ], { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 });
    const lines = stdout.trim().split('\n').filter(Boolean);
    return lines.slice(0, 50).map(l => {
      const [hash, subject, author, date] = l.split('|');
      return { hash, subject, author, date };
    });
  } catch (_) { return null; }
}

async function tick() {
  const cfg = getConfig();
  if (!cfg.authorized || cfg.privacy?.paused || !cfg.collectors?.ide) {
    if (!cfg.collectors?.ide) status.disabled('ide');
    return;
  }
  const recent = readRecentWorkspaces();
  const paths = [...new Set(recent.map(r => uriToPath(r.uri)).filter(p => p && fs.existsSync(p)))].slice(0, 8);
  const commits = [];
  for (const p of paths) {
    const g = await gitTodaySummary(p);
    if (g && g.length) commits.push({ workspace: p, commits: g });
  }
  const key = JSON.stringify({ recent: recent.slice(0, 5), commits: commits.map(c => c.commits[0]) });
  if (key === lastGitKey) {
    status.ok('ide', `工作区 ${paths.length}`);
    return;
  }
  lastGitKey = key;

  const content = [
    '## 最近工作区',
    ...recent.slice(0, 10).map(r => `- [${r.source}] ${uriToPath(r.uri) || r.uri}`),
    '## 今日提交',
    ...commits.flatMap(c => c.commits.slice(0, 10).map(x => `- ${c.workspace} ${x.hash} ${x.subject}`))
  ].join('\n');

  bus?.push({
    type: 'ide',
    ts_start: Date.now(),
    app: commits.length ? 'Git/IDE' : (recent[0]?.source || 'IDE'),
    title: `IDE 会话快照 · ${paths.length} 个工作区 · ${commits.reduce((n, c) => n + c.commits.length, 0)} 提交`,
    content,
    meta: { workspaces: paths, commitCount: commits.reduce((n, c) => n + c.commits.length, 0) },
    source: 'ide'
  });
  status.ok('ide', `工作区 ${paths.length}`);
}

function start(opts = {}) {
  getConfig = opts.getConfig || getConfig;
  bus = opts.bus;
  stop();
  timer = setInterval(tick, opts.intervalMs || 10 * 60 * 1000);
  setTimeout(tick, 5000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, readRecentWorkspaces, gitTodaySummary };
