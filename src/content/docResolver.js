/**
 * 2.4.8 · 文档名 → 完整路径 → 正文片段
 * 解析顺序：标题里的绝对路径 → 进程命令行 → 最近使用 .lnk → Office MRU 注册表 → VS Code 工作区内按名查找
 * 正文：本地文件直接抽取（大小上限、缓存、只取前若干 KB），低 CPU。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const diag = require('./diag');

const SNIPPET_MAX = 1500;
const FILE_MAX = 20 * 1024 * 1024;
const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'json', 'yml', 'yaml', 'log', 'ini', 'xml', 'html', 'htm', 'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'go', 'rs', 'c', 'h', 'cpp', 'cs', 'sql', 'sh', 'ps1', 'vue', 'css']);
const norm = (s) => String(s || '').toLowerCase().trim();
const stem = (s) => norm(s).replace(/\.[a-z0-9]{1,6}$/i, '');
const exists = (p) => { try { return !!p && fs.statSync(p).isFile(); } catch (_) { return false; } };
const existsAny = (p) => { try { return !!p && !!fs.statSync(p); } catch (_) { return false; } };

/* ── 最近使用 .lnk 索引 ── */
let recentIdx = { at: 0, byName: new Map(), byStem: new Map() };
function recentDir() { return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Recent'); }
function buildRecentIndex(dir = recentDir(), now = Date.now()) {
  if (now - recentIdx.at < 60000 && recentIdx.dir === dir) return recentIdx;
  const byName = new Map(), byStem = new Map();
  try {
    const { resolveLnk } = require('../common/lnk');
    const files = fs.readdirSync(dir).filter(f => /\.lnk$/i.test(f))
      .map(f => { const full = path.join(dir, f); let m = 0; try { m = fs.statSync(full).mtimeMs; } catch (_) {} return { full, m }; })
      .sort((a, b) => b.m - a.m).slice(0, 400);
    for (const { full } of files) {
      const r = resolveLnk(full); if (!r.ok || !r.target) continue;
      const b = path.win32.basename(r.target);
      if (!byName.has(norm(b))) byName.set(norm(b), r.target);
      if (!byStem.has(stem(b))) byStem.set(stem(b), r.target);
    }
  } catch (_) {}
  recentIdx = { at: now, dir, byName, byStem };
  return recentIdx;
}

/* ── Office MRU（HKCU\Software\Microsoft\Office\<ver>\<App>\User MRU\*\File MRU） ── */
let mru = { at: 0, list: [] };
function parseMruOutput(txt) {
  const out = [];
  for (const line of String(txt || '').split(/\r?\n/)) {
    const m = /\*([A-Za-z]:\\[^\r\n]+?)\s*$/.exec(line) || /\*(\\\\[^\r\n]+?)\s*$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}
function refreshMru(force) {
  if (process.platform !== 'win32' || (!force && Date.now() - mru.at < 5 * 60000)) return Promise.resolve(mru.list);
  mru.at = Date.now();
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Office', '/s'], { timeout: 6000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' }, (e, buf) => {
      if (!e) mru.list = parseMruOutput(decodeConsole(buf)); else diag.err('mru', e);
      resolve(mru.list);
    });
  });
}

/** reg.exe 在中文系统输出 GBK（OEM 代码页） */
function decodeConsole(buf) {
  const u = Buffer.from(buf || '').toString('utf8');
  if (!/\ufffd/.test(u)) return u;
  try { return new (require('util').TextDecoder)('gbk').decode(buf); } catch (_) { return u; }
}

/* ── VS Code / Cursor 工作区 ── */
function workspaces() {
  try { const ide = require('../collectors/ide'); return ide.readRecentWorkspaces().map(w => decodeURIComponent(String(w.uri).replace(/^file:\/\/\/?/, '')).replace(/\//g, process.platform === 'win32' ? '\\' : '/')); } catch (_) { return []; }
}
function findInDir(root, name, budget = { n: 3000 }, depth = 0) {
  if (depth > 4 || budget.n <= 0) return null;
  let ents; try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return null; }
  for (const e of ents) { budget.n--; if (e.isFile() && norm(e.name) === norm(name)) return path.join(root, e.name); }
  for (const e of ents) {
    if (!e.isDirectory() || /^(node_modules|\.git|dist|build|out|target|\.venv|venv|__pycache__)$/.test(e.name) || e.name.startsWith('.')) continue;
    const r = findInDir(path.join(root, e.name), name, budget, depth + 1); if (r) return r;
  }
  return null;
}

/* ── 命令行里的文件参数 ── */
function fromCmdline(cmd, doc) {
  if (!cmd) return null;
  const args = []; const re = /"([^"]+)"|(\S+)/g; let m;
  while ((m = re.exec(cmd))) args.push(m[1] || m[2]);
  const want = norm(doc), ws = stem(doc);
  for (const a of args.slice(1)) {
    if (!/^[a-z]:\\|^\\\\/i.test(a)) continue;
    const b = norm(path.win32.basename(a));
    if (b === want || stem(b) === ws) return a;
  }
  return null;
}

/**
 * @param parsed parseTitle 结果
 * @param ctx { cmdline, checkExists }
 */
async function resolvePath(parsed, ctx = {}) {
  if (!parsed || !parsed.doc || parsed.unsaved || parsed.kind === 'browser' || parsed.kind === 'chat') return null;
  const ok = ctx.checkExists || (parsed.kind === 'explorer' ? existsAny : exists);
  if (parsed.path && ok(parsed.path)) return { path: parsed.path, via: 'title' };
  const c = fromCmdline(ctx.cmdline, parsed.doc); if (c && ok(c)) return { path: c, via: 'cmdline' };
  if (parsed.kind === 'explorer') return null;
  const idx = buildRecentIndex(ctx.recentDir);
  const r = idx.byName.get(norm(parsed.doc)) || (!parsed.ext && idx.byStem.get(stem(parsed.doc)));
  if (r && ok(r)) return { path: r, via: 'recent' };
  if (parsed.kind === 'office' || parsed.kind === 'wps') {
    const list = ctx.mru || await refreshMru();
    const hit = list.find(p => norm(path.win32.basename(p)) === norm(parsed.doc)) || (!parsed.ext && list.find(p => stem(path.win32.basename(p)) === stem(parsed.doc)));
    if (hit && ok(hit)) return { path: hit, via: 'mru' };
  }
  if (parsed.kind === 'code' && parsed.doc) {
    const roots = (ctx.workspaces || workspaces()).filter(w => !parsed.project || norm(path.basename(w)) === norm(parsed.project));
    for (const root of roots.slice(0, 4)) { const f = findInDir(root, parsed.doc); if (f) return { path: f, via: 'workspace' }; }
  }
  return null;
}

/* ── 正文片段 ── */
const snipCache = new Map();
function squash(s) { return String(s || '').replace(/\r/g, '').replace(/[ \t\u3000]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(); }
function xmlText(xml) { return String(xml).replace(/<a:br\/>|<\/a:p>|<\/w:p>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
async function extractSnippet(file, { max = SNIPPET_MAX } = {}) {
  let st; try { st = fs.statSync(file); } catch (_) { return ''; }
  if (!st.isFile() || st.size > FILE_MAX) return '';
  const key = file + '|' + st.mtimeMs;
  if (snipCache.has(key)) return snipCache.get(key);
  const ext = path.extname(file).slice(1).toLowerCase();
  let text = '';
  try {
    if (TEXT_EXT.has(ext)) {
      const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(Math.min(st.size, 64 * 1024)); fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
      text = buf.toString('utf8'); if (/^\ufeff/.test(text)) text = text.slice(1);
      if (/\ufffd/.test(text.slice(0, 400))) { try { text = new (require('util').TextDecoder)('gbk').decode(buf); } catch (_) {} }
      if (ext === 'html' || ext === 'htm') text = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ');
    } else if (ext === 'docx') {
      const r = await require('mammoth').extractRawText({ path: file }); text = r.value || '';
    } else if (ext === 'xlsx' || ext === 'pptx') {
      const JSZip = require('jszip'); const zip = await JSZip.loadAsync(fs.readFileSync(file));
      if (ext === 'xlsx') {
        const ss = zip.file('xl/sharedStrings.xml'); const names = [];
        const wb = zip.file('xl/workbook.xml'); if (wb) { const x = await wb.async('string'); for (const m of x.matchAll(/<sheet [^>]*name="([^"]+)"/g)) names.push(m[1]); }
        const strs = ss ? [...(await ss.async('string')).matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(m => m[1]).slice(0, 400) : [];
        text = (names.length ? `工作表：${names.join('、')}\n` : '') + strs.join(' | ');
      } else {
        const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/))).slice(0, 15);
        const parts = []; for (const s of slides) parts.push(`[${s.match(/\d+/)[0]}] ` + squash(xmlText(await zip.file(s).async('string'))).replace(/\n/g, ' '));
        text = parts.join('\n');
      }
    } else if (ext === 'pdf') {
      const data = await require('pdf-parse')(fs.readFileSync(file), { max: 3 }); text = data.text || '';
    }
  } catch (e) { diag.err('snippet', e); text = ''; }
  text = squash(text).slice(0, max);
  snipCache.set(key, text); if (snipCache.size > 300) snipCache.delete(snipCache.keys().next().value);
  return text;
}

module.exports = { decodeConsole, resolvePath, extractSnippet, buildRecentIndex, parseMruOutput, fromCmdline, findInDir, refreshMru, _reset: () => { recentIdx = { at: 0, byName: new Map(), byStem: new Map() }; mru = { at: 0, list: [] }; snipCache.clear(); } };
