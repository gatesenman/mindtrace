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

/** 2.4.8：内容层诊断——窗口 → 文档名 → 路径 → 正文，逐层成功数，哪层断了一眼可见 */
function contentStatus(cfg = {}) {
  const c = require('../content/diag').snapshot();
  let fg = {}; try { fg = require('../collectors/windowTracker').hostInfo(); } catch (_) {}
  const w = c.windows || 0, named = c.docNamed || 0, pathN = c.pathResolved || 0, snip = c.snippet || 0;
  const text = (c.uiaOk || 0) + (c.ocrOk || 0) + snip;
  const consent = !!(cfg.collectors && (cfg.collectors.documents || cfg.collectors.uia));
  let state = 'ok', short;
  if (!cfg.collectors?.window) { state = 'off'; short = '窗口采集未开启'; }
  else if (!w) { state = 'pending'; short = '等待首个窗口'; }
  else if (!named) { state = 'warn'; short = '未识别出文档名'; }
  else if (!consent) { state = 'degraded'; short = `识别 ${named} 个 · 未读正文`; }
  else if (!text) { state = 'degraded'; short = `识别 ${named} 个 · 无正文`; }
  else short = `${named} 个文档 · ${text} 段正文`;
  const via = Object.entries(c.via || {}).map(([k, v]) => `${({ title: '标题', cmdline: '命令行', recent: '最近使用', mru: 'Office 记录', workspace: '工作区' })[k] || k} ${v}`).join('、');
  const errs = Object.entries(c.lastErr || {}).map(([k, v]) => `${k}：${v}`).join('；');
  const detail = [
    `窗口 ${w} → 文档名 ${named} → 路径 ${pathN}${via ? `（${via}）` : ''} → 文件正文 ${snip}`,
    `界面文字 成功 ${c.uiaOk || 0} / 空 ${c.uiaEmpty || 0} / 失败 ${c.uiaFail || 0} · OCR 成功 ${c.ocrOk || 0} / 失败 ${c.ocrFail || 0} · 网页补链接 ${c.browserJoined || 0} · 网页正文 ${c.browserBody || 0} · 隐私跳过 ${c.privacySkipped || 0}`,
    fg.legacy ? `前台窗口宿主不可用，已退回逐次调用：${fg.lastErr || ''}` : `前台窗口宿主 ${fg.alive ? '运行中' : '未启动'}${fg.timeouts ? ` · 超时 ${fg.timeouts}` : ''}`,
    errs ? `最近错误：${errs}` : ''
  ].filter(Boolean).join('\n');
  return {
    key: 'content', name: '内容采集', state, label: short, detail, short0: short, counts: c,
    action: !consent ? '推荐预设已含文档与界面文字；请在采集中心开启以读取正文' : (!text && w ? '开启截图 OCR 作兜底，或检查网络正文（非仅本地）' : undefined)
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

const SHORT_MAX = 14;
const PILL = { ok: '正常', degraded: '降级', warn: '降级', off: '未启用', pending: '未启用', error: '异常' };
function shortLine(it) {
  const h = it.host || {};
  switch (it.key) {
    case 'ocr': return it.state === 'degraded' ? '需 Windows 环境' : it.state === 'ok' ? `已识别 ${h.requests || 0} 次` : '待首次截图';
    case 'uia': return it.state === 'degraded' ? '仅 Windows 可用' : it.state === 'ok' ? `已读取 ${h.requests || 0} 次` : '采集器未开启';
    case 'hotkey': return '3 组快捷键已注册';
    case 'mcp': return it.enabled ? `端口 ${it.port}` : '本机 API 未开启';
    case 'context': return it.state === 'error' ? '读取失败' : it.label;
    case 'content': return it.short0;
    case 'net': { const m = /外发 (\d+)/.exec(it.detail || ''); return `${it.label} · 外发 ${m ? m[1] : 0}`; }
    default: return it.label;
  }
}
function finalize(it) {
  let short = shortLine(it) || '';
  if ([...short].length > SHORT_MAX) short = [...short].slice(0, SHORT_MAX - 1).join('') + '…';
  const bad = ['degraded', 'warn', 'error'].includes(it.state);
  return { ...it, pill: PILL[it.state] || it.state, short, primary: bad ? (it.state === 'error' ? '重新检测' : '查看处理') : null };
}

function snapshot(cfg = {}, { mcpInstall } = {}) {
  const items = [
    contentStatus(cfg),
    ocrStatus(),
    uiaStatus(),
    hotkeyStatus(cfg),
    mcpStatus(cfg, mcpInstall),
    contextStatus(),
    gateStatus(cfg)
  ].map(finalize);
  const okN = items.filter(i => i.state === 'ok').length;
  const order = { error: 0, warn: 1, degraded: 2, off: 3, pending: 4, ok: 5 };
  const worst = items.slice().sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9))[0];
  return {
    overall: worst?.state || 'ok',
    summary: okN === items.length ? `${items.length} 项全部正常` : `${items.length} 项中 ${okN} 项正常`,
    okCount: okN,
    items,
    platform: process.platform,
    verifiedOnWindows: false
  };
}

module.exports = { contentStatus, snapshot, shortLine, SHORT_MAX, PILL, ocrStatus, uiaStatus, hotkeyStatus, mcpStatus, contextStatus, gateStatus, pretty };
