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
  (ctx.extra || []).forEach(fn => fn(ipcMain, ctx));
}
module.exports = { register };
