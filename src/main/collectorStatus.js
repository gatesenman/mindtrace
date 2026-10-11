/** In-memory collector health for 采集中心 */
const states = {
  window: { id: 'window', name: '窗口与应用时间线', status: 'idle', message: '未启动', lastOkAt: null, lastError: null, todayCount: 0 },
  browser: { id: 'browser', name: '浏览器历史', status: 'idle', message: '未启动', lastOkAt: null, lastError: null, todayCount: 0 },
  documents: { id: 'documents', name: '文档与笔记', status: 'idle', message: '未启动', lastOkAt: null, lastError: null, todayCount: 0 },
  clipboard: { id: 'clipboard', name: '剪贴板', status: 'idle', message: '未启动', lastOkAt: null, lastError: null, todayCount: 0 },
  screenshots: { id: 'screenshots', name: '定时截屏', status: 'idle', message: '未启动', lastOkAt: null, lastError: null, todayCount: 0 }
};

function setStatus(id, patch) {
  if (!states[id]) return;
  states[id] = { ...states[id], ...patch };
}

function ok(id, message = '运行中') {
  setStatus(id, { status: 'ok', message, lastOkAt: Date.now(), lastError: null });
}

function err(id, error) {
  const msg = error?.message || String(error);
  setStatus(id, { status: 'error', message: msg, lastError: msg });
}

function idle(id, message = '已停止') {
  setStatus(id, { status: 'idle', message });
}

function disabled(id) {
  setStatus(id, { status: 'off', message: '已关闭' });
}

function getAll() {
  return Object.values(states).map(s => ({ ...s }));
}

function wrapTick(id, fn) {
  return async (...args) => {
    try {
      const r = await fn(...args);
      ok(id, '运行中');
      return r;
    } catch (e) {
      err(id, e);
      const { appendLog } = require('./logger');
      appendLog('ERROR', `collector:${id}`, e);
      return null;
    }
  };
}

module.exports = { setStatus, ok, err, idle, disabled, getAll, wrapTick, states };
