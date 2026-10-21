/**
 * 2.4 R4 · 上下文层采集（不上时间轴，只给其他事件打标签）
 * 借鉴 ActivityWatch aw-watcher-afk：空闲超时打 afk 标签；
 * https://docs.activitywatch.net/en/latest/faq.html#how-does-activitywatch-know-when-i-am-afk
 * 电源 / 网络仅作上下文，不产生活动条。
 */
const os = require('os');
const status = require('../main/collectorStatus');

let timer = null;
let getConfig = () => ({});
let windowTracker = null;
let state = {
  afk: false,
  afkSince: null,
  onBattery: null,
  online: true,
  lastTick: 0,
  samples: 0
};

function readPower() {
  try {
    // Electron powerMonitor 在主进程可用；此处用 os + 可选注入
    if (typeof state._powerFn === 'function') return state._powerFn();
    // Linux: /sys/class/power_supply
    if (process.platform === 'linux') {
      const fs = require('fs');
      const base = '/sys/class/power_supply';
      if (!fs.existsSync(base)) return { onBattery: false };
      const dirs = fs.readdirSync(base).filter(d => d.startsWith('BAT') || d === 'BAT0');
      for (const d of dirs) {
        try {
          const st = fs.readFileSync(`${base}/${d}/status`, 'utf8').trim();
          if (/Discharging/i.test(st)) return { onBattery: true };
          if (/Charging|Full|Not charging/i.test(st)) return { onBattery: false };
        } catch (_) {}
      }
    }
    return { onBattery: false };
  } catch (_) { return { onBattery: null }; }
}

function readOnline() {
  try {
    if (typeof state._onlineFn === 'function') return state._onlineFn();
    // 不主动出网探测；用 DNS 解析能力粗判（0.0.0.0 拒绝也算在线接口存在）
    const nis = os.networkInterfaces();
    for (const list of Object.values(nis || {})) {
      for (const n of list || []) {
        if (!n.internal && n.family === 'IPv4') return true;
      }
    }
    return false;
  } catch (_) { return true; }
}

async function tick() {
  const cfg = getConfig();
  if (!cfg.authorized || cfg.privacy?.paused || !cfg.collectors?.context) {
    if (!cfg.collectors?.context) status.disabled('context');
    return;
  }
  const idleSec = Number(cfg.privacy?.idleThresholdSec || 180);
  let idle = 0;
  try {
    if (windowTracker?.getIdleSeconds) idle = await windowTracker.getIdleSeconds();
  } catch (_) {}
  const wasAfk = state.afk;
  state.afk = idle >= idleSec;
  if (state.afk && !wasAfk) state.afkSince = Date.now() - idle * 1000;
  if (!state.afk) state.afkSince = null;
  const p = readPower();
  state.onBattery = p.onBattery;
  state.online = readOnline();
  state.lastTick = Date.now();
  state.samples++;
  status.ok('context', state.afk ? `离开 · ${Math.round(idle / 60)} 分` : (state.onBattery ? '电池' : '电源') + (state.online ? ' · 在线' : ' · 离线'));
}

/** 给其他事件打的上下文标签（不写 activities） */
function tags() {
  const t = [];
  if (state.afk) t.push('afk');
  if (state.onBattery === true) t.push('battery');
  if (state.onBattery === false) t.push('ac');
  if (state.online === false) t.push('offline');
  else if (state.online === true) t.push('online');
  return t;
}

function snapshot() {
  return {
    afk: !!state.afk,
    afkSince: state.afkSince,
    onBattery: state.onBattery,
    online: state.online,
    tags: tags(),
    lastTick: state.lastTick,
    samples: state.samples
  };
}

function start(opts = {}) {
  getConfig = opts.getConfig || getConfig;
  windowTracker = opts.windowTracker || null;
  if (opts.powerFn) state._powerFn = opts.powerFn;
  if (opts.onlineFn) state._onlineFn = opts.onlineFn;
  stop();
  timer = setInterval(() => { tick().catch(() => {}); }, opts.intervalMs || 15000);
  setTimeout(() => { tick().catch(() => {}); }, 2000);
}

function stop() { if (timer) clearInterval(timer); timer = null; }

/** 测试注入 */
function _set(partial) { Object.assign(state, partial); }

module.exports = { start, stop, tick, tags, snapshot, _set, readPower, readOnline };
