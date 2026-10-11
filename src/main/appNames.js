/**
 * Process/app name normalization + self-exclusion for 知迹 MindTrace.
 */
const FRIENDLY = [
  [/^(wechat|weixin)$/i, '微信'],
  [/^wxwork$/i, '企业微信'],
  [/^(feishu|lark)$/i, '飞书'],
  [/^dingtalk$/i, '钉钉'],
  [/^(chrome|google-chrome|google chrome)$/i, 'Chrome'],
  [/^(msedge|microsoft.?edge|edge)$/i, 'Edge'],
  [/^(code|code - oss|code\.exe|visual studio code|vs code)$/i, 'VS Code'],
  [/^cursor$/i, 'Cursor'],
  [/^(winword|word)$/i, 'Word'],
  [/^(excel)$/i, 'Excel'],
  [/^(powerpnt|powerpoint)$/i, 'PowerPoint'],
  [/^(notepad\+?\+?|notepad)$/i, '记事本'],
  [/^(explorer)$/i, '资源管理器'],
  [/^(firefox)$/i, 'Firefox'],
  [/^(obsidian)$/i, 'Obsidian'],
  [/^(slack)$/i, 'Slack'],
  [/^(telegram|telegram\.exe)$/i, 'Telegram'],
  [/^(qq)$/i, 'QQ'],
  [/^(notion)$/i, 'Notion'],
  [/^(figma)$/i, 'Figma'],
  [/^(spotify)$/i, 'Spotify'],
  [/^(windows.?terminal|wt)$/i, '终端'],
  [/^(powershell|pwsh)$/i, 'PowerShell'],
  [/^(cmd)$/i, '命令提示符'],
];

/** Known third-party process names — never treat as self even if title mentions mindtrace */
const THIRD_PARTY = /^(chrome|google-chrome|msedge|edge|firefox|code|code - oss|vs code|visual studio code|cursor|wechat|weixin|wxwork|feishu|lark|dingtalk|winword|excel|powerpnt|obsidian|slack|telegram|qq|notion|figma|spotify|explorer|notepad|powershell|pwsh|cmd|WindowsTerminal)$/i;

function normalizeProc(name) {
  return String(name || '').replace(/\.exe$/i, '').trim();
}

function friendlyAppName(appOrProcess, processName, windowTitle) {
  const candidates = [processName, appOrProcess].filter(Boolean);
  for (const c of candidates) {
    const base = normalizeProc(c);
    for (const [re, name] of FRIENDLY) {
      if (re.test(base) || re.test(c)) return name;
    }
  }
  const title = String(windowTitle || '');
  if (/微信|WeChat/i.test(title) && !/企业微信|WXWork/i.test(title)) return '微信';
  if (/企业微信|WXWork/i.test(title)) return '企业微信';
  if (/Visual Studio Code|VS Code/i.test(title)) return 'VS Code';
  if (/Google Chrome/i.test(title)) return 'Chrome';
  if (/Microsoft.?Edge/i.test(title)) return 'Edge';

  const raw = normalizeProc(appOrProcess || processName);
  if (!raw) return '未知应用';
  if (/^[a-z0-9 _-]+$/i.test(raw) && raw.length <= 24) {
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  return raw;
}

function isSelfApp({ app, process, title } = {}) {
  const proc = normalizeProc(process);
  const appN = normalizeProc(app);
  // Explicit third-party process → never self
  if (THIRD_PARTY.test(proc) || THIRD_PARTY.test(appN)) return false;

  // Self only when process/app is electron/mindtrace, or title is exactly our product chrome
  if (/^electron$/i.test(proc) || /^electron$/i.test(appN)) return true;
  if (/^mindtrace$/i.test(proc) || /^mindtrace$/i.test(appN)) return true;
  if (/^知迹/.test(appN) || /^知迹/.test(proc)) return true;

  const t = String(title || '');
  // Title match alone is insufficient if process looks like a normal app name we don't know
  if (/^知迹(\s*MindTrace)?$/i.test(t.trim()) && (!proc || /^electron$/i.test(proc) || !proc)) return true;
  if (/MindTrace/i.test(t) && /^electron$/i.test(proc || 'electron') && !THIRD_PARTY.test(proc)) {
    // electron process with MindTrace title
    if (!proc || /^electron$/i.test(proc)) return true;
  }
  return false;
}

module.exports = { friendlyAppName, isSelfApp, FRIENDLY };
