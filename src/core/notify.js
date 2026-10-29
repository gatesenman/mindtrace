/**
 * 2.4.9 · 系统通知 Toast
 * Notification 不可用时只记日志，不抛错——调用方仍应写完日报等主流程。
 */
function showToast({ Notification, title, body, onClick, log, silent = false } = {}) {
  try {
    if (!Notification || typeof Notification.isSupported !== 'function' || !Notification.isSupported()) {
      if (log) try { log('WARN', 'toast-unsupported', title); } catch (_) {}
      return { ok: false, reason: 'unsupported' };
    }
    const n = new Notification({ title: String(title || '知迹'), body: String(body || ''), silent: !!silent });
    if (typeof onClick === 'function') n.on('click', onClick);
    n.show();
    return { ok: true };
  } catch (e) {
    if (log) try { log('ERROR', 'toast', e); } catch (_) {}
    return { ok: false, reason: e && e.message ? e.message : String(e) };
  }
}

module.exports = { showToast };
