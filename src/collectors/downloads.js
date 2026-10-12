const fs = require('fs');
const path = require('path');
const os = require('os');
const status = require('../main/collectorStatus');

let timer = null;
let getConfig = () => ({});
let bus = null;
const seen = new Map();

const TEXT_EXT = new Set(['.pdf', '.docx', '.doc', '.md', '.txt', '.epub', '.rtf', '.csv', '.xlsx', '.pptx', '.html', '.htm', '.json']);

function downloadsDir(cfg) {
  if (cfg.downloadFolder && fs.existsSync(cfg.downloadFolder)) return cfg.downloadFolder;
  return path.join(os.homedir(), 'Downloads');
}

async function extractExcerpt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    const st = fs.statSync(filePath);
    if (st.size > 12 * 1024 * 1024) return `[大文件 ${Math.round(st.size / 1024 / 1024)}MB，仅索引元数据]`;
    if (['.txt', '.md', '.csv', '.json', '.html', '.htm', '.rtf'].includes(ext)) {
      return fs.readFileSync(filePath, 'utf8').slice(0, 15000);
    }
    if (ext === '.docx') {
      const mammoth = require('mammoth');
      const r = await mammoth.extractRawText({ path: filePath });
      return (r.value || '').slice(0, 15000);
    }
    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(fs.readFileSync(filePath));
      return (data.text || '').slice(0, 15000);
    }
  } catch (e) {
    return `[抽取失败: ${e.message}]`;
  }
  return '';
}

async function scan() {
  const cfg = getConfig();
  if (!cfg.authorized || cfg.privacy?.paused || !cfg.collectors?.downloads) {
    if (!cfg.collectors?.downloads) status.disabled('downloads');
    return;
  }
  const dir = downloadsDir(cfg);
  if (!fs.existsSync(dir)) return;
  let ents; try { ents = fs.readdirSync(dir); } catch { return; }
  const now = Date.now();
  for (const name of ents.slice(0, 80)) {
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    let st; try { st = fs.statSync(full); } catch { continue; }
    if (!st.isFile()) continue;
    if (now - st.mtimeMs > 3 * 86400000) continue;
    const ext = path.extname(name).toLowerCase();
    const key = full + ':' + st.mtimeMs;
    if (seen.has(key)) continue;
    seen.set(key, true);
    let content = '';
    if (TEXT_EXT.has(ext)) content = await extractExcerpt(full);
    bus?.push({
      type: 'download',
      ts_start: st.mtimeMs,
      app: '下载',
      title: name,
      path: full,
      content,
      meta: { size: st.size, ext },
      source: 'downloads'
    });
  }
  status.ok('downloads', dir);
}

function start(opts = {}) {
  getConfig = opts.getConfig || getConfig;
  bus = opts.bus;
  stop();
  timer = setInterval(scan, opts.intervalMs || 45000);
  setTimeout(scan, 6000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, extractExcerpt, downloadsDir };
