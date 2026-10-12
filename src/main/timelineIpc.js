// 时间线体验（2.3.2）：应用图标 / 网站图标缓存、打开链接/路径、忽略来源、加入知识库、详情面板、AI 摘要
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const { app, ipcMain, shell } = require('electron');

function register({ store, getConfig, setConfig, v23 }) {
  const dir = () => { const d = path.join(app.getPath('userData'), 'icon-cache'); fs.mkdirSync(d, { recursive: true }); return d; };
  const mem = new Map();
  const key = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
  const fromDisk = (k) => { const f = path.join(dir(), k + '.png'); if (fs.existsSync(f)) { const b = fs.readFileSync(f); return b.length ? 'data:image/png;base64,' + b.toString('base64') : ''; } return null; };
  const toDisk = (k, buf) => { try { fs.writeFileSync(path.join(dir(), k + '.png'), buf || Buffer.alloc(0)); } catch (_) {} };

  async function exeIcon(exe) {
    const k = 'exe-' + key(exe.toLowerCase());
    if (mem.has(k)) return mem.get(k);
    let v = fromDisk(k);
    if (v == null) {
      try { const img = await app.getFileIcon(exe, { size: 'normal' }); const png = img.isEmpty() ? null : img.toPNG(); toDisk(k, png); v = png ? 'data:image/png;base64,' + png.toString('base64') : ''; }
      catch (_) { toDisk(k, null); v = ''; }
    }
    mem.set(k, v); return v;
  }
  async function favicon(url) {
    let host; try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) return ''; host = u.host; } catch (_) { return ''; }
    const cfg = getConfig();
    const k = 'fav-' + key(host);
    if (mem.has(k)) return mem.get(k);
    let v = fromDisk(k);
    // 本地优先：仅本地模式或关闭网站图标时不联网
    if (v == null && !cfg.privacy?.localOnly && cfg.privacy?.fetchFavicons !== false) {
      try {
        const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 3000);
        const r = await fetch(`https://${host}/favicon.ico`, { signal: ctl.signal, redirect: 'follow' }); clearTimeout(tm);
        const buf = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
        const ok = buf && buf.length > 64 && buf.length < 200000;
        const { nativeImage } = require('electron');
        const img = ok ? nativeImage.createFromBuffer(buf) : null;
        const png = img && !img.isEmpty() ? img.resize({ width: 32, height: 32 }).toPNG() : (ok && /^\x89PNG/.test(buf.slice(0, 4).toString('latin1')) ? buf : null);
        toDisk(k, png); v = png ? 'data:image/png;base64,' + png.toString('base64') : '';
      } catch (_) { toDisk(k, null); v = ''; }
    }
    mem.set(k, v || ''); return v || '';
  }
  // 批量取图标：[{k, exe?, process?, url?}] → {k: dataUrl}
  ipcMain.handle('tl-icons', async (_e, list = []) => {
    const out = {};
    for (const it of list.slice(0, 80)) {
      try {
        let exe = it.exe;
        if (!exe && it.process && process.platform === 'win32') {
          const r = store.get(`SELECT meta FROM activities WHERE process_name=? AND meta LIKE '%"exe"%' ORDER BY started_at DESC LIMIT 1`, [it.process]);
          try { exe = r && JSON.parse(r.meta).exe; } catch (_) {}
        }
        out[it.k] = it.url ? await favicon(it.url) : (exe ? await exeIcon(exe) : '');
      } catch (_) { out[it.k] = ''; }
    }
    return out;
  });
  ipcMain.handle('tl-open', async (_e, { url, path: p } = {}) => {
    if (url && /^https?:\/\//i.test(url)) { await shell.openExternal(url); return { ok: true }; }
    if (p) { if (fs.existsSync(p)) shell.showItemInFolder(p); else return { ok: false, error: '文件不存在或已移动' }; return { ok: true }; }
    return { ok: false };
  });
  ipcMain.handle('tl-ignore-source', (_e, { app: a } = {}) => {
    const name = String(a || '').trim(); if (!name) return { ok: false };
    const cfg = getConfig(); const list = new Set(cfg.privacy?.blacklistApps || []); list.add(name);
    setConfig({ privacy: { blacklistApps: [...list] } });
    return { ok: true, list: [...list] };
  });
  ipcMain.handle('tl-add-kb', (_e, { title, text } = {}) => {
    const id = store.insertActivity({ type: 'note', started_at: Date.now(), ended_at: Date.now(), app_name: '知迹', window_title: title || '时间线摘录', content: text || '', meta: { source: 'timeline', userNote: true } });
    try { v23.kb.ingestNew(); } catch (_) {}
    store.persist(); return { ok: !!id };
  });
  ipcMain.handle('tl-detail', (_e, { ids = [], from, to } = {}) => {
    const acts = ids.length ? store.all(`SELECT * FROM activities WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY started_at`, ids) : [];
    const a = from || (acts[0] && acts[0].started_at) || Date.now();
    const z = to || (acts.length ? Math.max(...acts.map(x => x.ended_at || x.started_at)) : a);
    const shots = store.all(`SELECT id,taken_at,file_path,app_name,window_title,description,ocr_text FROM screenshots WHERE taken_at>=? AND taken_at<=? ORDER BY taken_at LIMIT 6`, [a - 60000, z + 60000]);
    const hay = acts.map(x => `${x.window_title || ''} ${x.content || ''} ${x.url || ''}`).join(' ').slice(0, 20000);
    let entities = [];
    try { entities = store.all(`SELECT id,name,type FROM entities WHERE length(name)>=2 AND instr(?, name)>0 ORDER BY mention_count DESC LIMIT 8`, [hay]); }
    catch (_) { try { entities = store.all(`SELECT id,name,type FROM entities WHERE length(name)>=2 AND instr(?, name)>0 LIMIT 8`, [hay]); } catch (__) {} }
    return { acts, shots, entities };
  });
  // AI 摘要（可选）：一次请求多块，结果缓存在 kv
  ipcMain.handle('tl-ai-summary', async (_e, blocks = []) => {
    const cfg = getConfig(); const U = require('../common/util');
    const out = {}; const need = [];
    for (const b of blocks.slice(0, 30)) { const c = U.kvGet('tlsum:' + b.id, null); if (c) out[b.id] = c; else need.push(b); }
    if (!need.length || !cfg.ai?.apiKey || cfg.ai?.autoSummarize === false) return out;
    try {
      if (!v23.budget.allow('extract', cfg, 1500)) return out;
      const { chatCompletion, parseJsonLoose } = require('../ai/client');
      const prompt = '为每个活动块写一句不超过 24 字的中文动作摘要（如“在微信与3位联系人聊天”），只用给出的信息，不要编造。输出 JSON 对象 {id: 摘要}。\n' + JSON.stringify(need.map(b => ({ id: b.id, app: b.app, type: b.type, minutes: b.minutes, titles: (b.titles || []).slice(0, 6) })));
      const r = await chatCompletion(cfg, [{ role: 'user', content: prompt }], { max_tokens: 800, temperature: 0.2, purpose: 'timeline' });
      const j = parseJsonLoose(r.content) || {};
      for (const b of need) if (typeof j[b.id] === 'string' && j[b.id].trim()) { out[b.id] = j[b.id].trim().slice(0, 40); U.kvSet('tlsum:' + b.id, out[b.id]); }
    } catch (e) { console.error('[tl-ai-summary]', e.message); }
    return out;
  });
}
module.exports = { register };
