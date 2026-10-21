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
  (ctx.extra || []).forEach(fn => fn(ipcMain, ctx));
}
module.exports = { register };
