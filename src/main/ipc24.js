// 2.4 IPC：出网账本、本地 OCR 状态（后续轮次在此扩展）
const { ipcMain } = require('electron');
function register(ctx) {
  const { getConfig, pro } = ctx;
  const gate = require('../net/gate');
  if (pro) gate.setAudit((k, a, t, d) => pro.audit(k, a, t, d));
  ipcMain.handle('r24-net-stats', () => ({ ...gate.getStats(), localOnly: !!getConfig().privacy?.localOnly }));
  ipcMain.handle('r24-ocr-status', async () => {
    const w = require('../ocr/winocr');
    const p = await w.probe();
    return { ...p, host: w.info(), platform: process.platform };
  });
  ipcMain.handle('r24-context', () => {
    try { return require('../collectors/context').snapshot(); } catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('r24-signal-overview', () => {
    const { store } = ctx; const sig = require('../core/signal');
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); const since = d0.getTime();
    const cfg = getConfig();
    let counts = {}; try { for (const r of store.all(`SELECT json_extract(meta,'$.layer') l, COUNT(*) c FROM activities WHERE started_at>=? GROUP BY l`, [since])) counts[r.l || 'legacy'] = r.c; } catch (_) {}
    let objects = { total: 0, multi: 0, top: [] };
    try {
      store.ensureObjects();
      objects.total = store.get(`SELECT COUNT(*) c FROM objects WHERE last_seen>=?`, [since])?.c || 0;
      objects.multi = store.get(`SELECT COUNT(*) c FROM objects WHERE last_seen>=? AND adapters LIKE '%,%'`, [since])?.c || 0;
      objects.top = store.all(`SELECT hash,type,uri,title,touches,layers,adapters,last_seen FROM objects WHERE last_seen>=? ORDER BY touches DESC, last_seen DESC LIMIT 6`, [since]);
    } catch (_) {}
    const layers = Object.entries(sig.LAYERS).map(([k, v]) => ({ key: k, ...v, today: counts[k] || 0, enabled: v.collectors.filter(c => cfg.collectors?.[c]).length }));
    return { layers, objects, dedup: store.signalStats(), legacy: counts.legacy || 0, collectorsOn: cfg.collectors || {} };
  });
  // ── R3：回忆框 ──
  const { shell } = require('electron');
  const recallWin = require('./recallWindow');
  ipcMain.handle('r24-recall', (_e, { q } = {}) => require('../recall').recall(ctx.store, q || '', { limit: 8 }));
  ipcMain.handle('r24-recall-hide', () => { recallWin.hide(); return true; });
  ipcMain.handle('r24-recall-toggle', () => { recallWin.toggle(getConfig()); return true; });
  ipcMain.handle('r24-recall-open', async (_e, { url, path: p, inApp } = {}) => {
    const fs = require('fs');
    if (!inApp && url && /^https?:\/\//i.test(url)) { await shell.openExternal(url); recallWin.hide(); return { ok: true }; }
    if (!inApp && p) { if (fs.existsSync(p)) { const err = await shell.openPath(p); if (err) shell.showItemInFolder(p); recallWin.hide(); return { ok: true }; } return { ok: false, error: '文件不存在或已移动' }; }
    const w = ctx.getWindow?.(); if (w) { w.show(); w.focus(); w.webContents.send('r24-goto', { view: 'timeline' }); }
    recallWin.hide(); return { ok: true };
  });
  // ── R3：MCP 一键接入 ──
  const inst = require('../mcp/install');
  const mcpOpts = () => { const c = getConfig(); return { url: `http://127.0.0.1:${(c.api?.port || 17321) + 1}/mcp`, token: c.api?.token || '' }; };
  ipcMain.handle('r24-mcp-status', () => ({ ...mcpOpts(), token: undefined, enabled: !!getConfig().api?.enabled, targets: inst.status(mcpOpts()) }));
  ipcMain.handle('r24-mcp-install', async (_e, { key } = {}) => {
    try { ctx.ensureApi && ctx.ensureApi(); const r = inst.install(key, mcpOpts()); pro && pro.audit('mcp', 'install', key, { file: r.file }); return r; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('r24-mcp-uninstall', (_e, { key } = {}) => { try { return inst.uninstall(key, mcpOpts()); } catch (e) { return { ok: false, error: e.message }; } });
  // ── R3：首日见效（回填 + 7 天回顾） ──
  const bf = require('../core/backfill');
  ipcMain.handle('r24-backfill', async (e, { days = 7 } = {}) => {
    const r = await bf.run({ getConfig, days, onProgress: (p) => { try { e.sender.send('r24-backfill-progress', p); } catch (_) {} } });
    if (r.ok) { const c = getConfig(); c.backfillDoneAt = Date.now(); ctx.saveConfig && ctx.saveConfig(); pro && pro.audit('backfill', 'run', `${days}d`, { total: r.total }); }
    return r;
  });
  ipcMain.handle('r24-review7', () => ({ ...bf.review7(ctx.store, { days: 7 }), backfillDoneAt: getConfig().backfillDoneAt || null }));
  ipcMain.handle('r24-health', () => {
    try {
      const inst = require('../mcp/install');
      const c = getConfig();
      const mcpOpts = { url: `http://127.0.0.1:${(c.api?.port || 17321) + 1}/mcp`, token: c.api?.token || '' };
      return require('../core/health').snapshot(c, { mcpInstall: inst.status(mcpOpts) });
    } catch (e) { return { overall: 'error', summary: e.message, items: [] }; }
  });
  // ── R6：日报/周报 + 承诺扫描 ──
  const reports = require('../core/reports');
  const commits = require('../core/commitments');
  ipcMain.handle('r24-report-daily', (_e, { date } = {}) => { try { return { ok: true, ...reports.draftDaily(date) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('r24-report-weekly', (_e, { date } = {}) => { try { return { ok: true, ...reports.draftWeekly(date) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('r24-report-preview', (_e, { period = 'daily', date } = {}) => {
    try { return period === 'weekly' ? reports.summarizeWeek(ctx.store, date) : reports.summarizeDay(ctx.store, date); }
    catch (e) { return { status: 'ERROR', error: e.message }; }
  });
  ipcMain.handle('r24-commitments-scan', () => { try { const r = commits.ingestRecent({ hours: 72 }); pro && pro.audit('commitments', 'scan', `${r.created.length}/${r.scanned}`); return { ok: true, ...r }; } catch (e) { return { ok: false, error: e.message }; } });
  (ctx.extra || []).forEach(fn => fn(ipcMain, ctx));
}
module.exports = { register };
