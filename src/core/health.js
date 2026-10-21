/**
 * 2.4 R8 · 采集/OCR/热键/MCP 健康状态（给设置与采集中心用）
 * 目标：Linux 盒子上也能给出清晰的「可用 / 降级 / 不可用」中文说明，Windows 真机再验证。
 */
function ocrStatus() {
  const w = require('../ocr/winocr');
  const platform = process.platform;
  if (platform !== 'win32' && !(w.info && w.info().alive)) {
    return {
      key: 'ocr', name: '本地 OCR',
      state: 'degraded',
      label: '当前环境非 Windows',
      detail: '正式版在 Windows 10/11 使用系统自带 OCR（Windows.Media.Ocr）。当前为开发/测试环境，截图文字识别不可用，可改用界面文字（UIA）采集。',
      action: '在 Windows 安装「中文光学字符识别」可选功能'
    };
  }
  const host = w.info();
  return {
    key: 'ocr', name: '本地 OCR',
    state: host.alive ? 'ok' : 'pending',
    label: host.alive ? '宿主已就绪' : '尚未探测',
    detail: host.alive ? `已处理 ${host.requests || 0} 次请求` : '打开截图采集后会自动拉起 OCR 宿主',
    host
  };
}

function uiaStatus() {
  const uia = require('../collectors/uia');
  const info = uia.info ? uia.info() : { alive: false };
  const platform = process.platform;
  if (platform !== 'win32' && !info.alive) {
    return {
      key: 'uia', name: '界面文字 (UIA)',
      state: 'degraded',
      label: '当前环境非 Windows',
      detail: 'UI Automation 仅在 Windows 可用。非 Windows 下不会启动 PowerShell 宿主，避免空转。'
    };
  }
  return {
    key: 'uia', name: '界面文字 (UIA)',
    state: info.alive ? 'ok' : 'off',
    label: info.alive ? '常驻宿主运行中' : '未启动',
    detail: info.alive
      ? `请求 ${info.requests || 0} 次 · 密码框已按 IsPassword 跳过`
      : '在采集中心开启「界面文字」后启动；超时 350ms 只返回已读部分',
    host: info
  };
}

function hotkeyStatus(cfg = {}) {
  const recall = cfg.recallHotkey || 'CommandOrControl+Shift+Space';
  const note = cfg.noteHotkey || 'CommandOrControl+Shift+N';
  const pause = cfg.privacy?.pauseHotkey || 'CommandOrControl+Shift+M';
  return {
    key: 'hotkey', name: '全局热键',
    state: 'ok',
    label: '已配置',
    detail: `回忆 ${pretty(recall)} · 速记 ${pretty(note)} · 暂停 ${pretty(pause)}`,
    keys: { recall, note, pause },
    warn: '若与输入法或其他软件冲突，可在设置中修改；修改后需重新注册。'
  };
}

function pretty(accel) {
  return String(accel).replace(/CommandOrControl/g, 'Ctrl').replace(/Control/g, 'Ctrl');
}

function mcpStatus(cfg = {}, installStatus) {
  const enabled = !!cfg.api?.enabled;
  const port = (cfg.api?.port || 17321) + 1;
  let label = enabled ? '本机 API 已开启' : '未开启';
  let state = enabled ? 'ok' : 'off';
  const targets = installStatus || {};
  const bits = [];
  for (const [k, v] of Object.entries(targets)) {
    if (v?.installed && v?.current) bits.push(`${k} 已接入`);
    else if (v?.installed) bits.push(`${k} 令牌需更新`);
    else if (v?.appFound) bits.push(`${k} 未接入`);
  }
  return {
    key: 'mcp', name: 'MCP',
    state, label,
    detail: `端点 127.0.0.1:${port}/mcp` + (bits.length ? ' · ' + bits.join(' · ') : ' · 可在设置一键接入 Cursor / Claude'),
    enabled, port
  };
}

function contextStatus() {
  try {
    const s = require('../collectors/context').snapshot();
    return {
      key: 'context', name: '上下文',
      state: s.lastTick ? 'ok' : 'off',
      label: s.afk ? '当前离开' : (s.lastTick ? '监听中' : '未启动'),
      detail: `标签 ${(s.tags || []).join(', ') || '—'} · 采样 ${s.samples || 0} 次`
    };
  } catch (e) {
    return { key: 'context', name: '上下文', state: 'error', label: '异常', detail: e.message };
  }
}

function gateStatus(cfg = {}) {
  const gate = require('../net/gate');
  const s = gate.getStats();
  return {
    key: 'net', name: '出网闸门',
    state: cfg.privacy?.localOnly ? (s.external === 0 ? 'ok' : 'warn') : 'ok',
    label: cfg.privacy?.localOnly ? '仅本地' : '允许外发',
    detail: `今日外发 ${s.external} · 拦截 ${s.blocked} · 本机 ${s.local}`
  };
}

function snapshot(cfg = {}, { mcpInstall } = {}) {
  const items = [
    ocrStatus(),
    uiaStatus(),
    hotkeyStatus(cfg),
    mcpStatus(cfg, mcpInstall),
    contextStatus(),
    gateStatus(cfg)
  ];
  const order = { error: 0, warn: 1, degraded: 2, off: 3, pending: 4, ok: 5 };
  const worst = items.slice().sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9))[0];
  return {
    overall: worst?.state || 'ok',
    summary: worst ? `${worst.name}：${worst.label}` : '全部正常',
    items,
    platform: process.platform,
    verifiedOnWindows: false
  };
}

module.exports = { snapshot, ocrStatus, uiaStatus, hotkeyStatus, mcpStatus, contextStatus, gateStatus, pretty };
