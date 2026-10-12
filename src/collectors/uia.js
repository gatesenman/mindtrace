/**
 * UI Automation text capture — Windows via PowerShell UIAutomation; Linux: stub (title only via windowTracker).
 */
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const status = require('../main/collectorStatus');
const { isSelfApp } = require('../main/appNames');

let timer = null;
let getConfig = () => ({});
let bus = null;
let lastHash = '';
let lastTs = 0;

async function captureWinUia() {
  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
\$root = [System.Windows.Automation.AutomationElement]::FocusedElement
if (-not \$root) { \$root = [System.Windows.Automation.AutomationElement]::FromHandle((Get-Process -Id (Get-ForegroundWindowHelper)).MainWindowHandle) }
function Get-ForegroundWindowHelper {
  Add-Type @"
using System; using System.Runtime.InteropServices;
public class FG { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }
"@
  return [FG]::GetForegroundWindow()
}
try {
  \$hwnd = (Add-Type @"
using System; using System.Runtime.InteropServices;
public class H { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }
"@ -PassThru)::GetForegroundWindow()
  \$el = [System.Windows.Automation.AutomationElement]::FromHandle(\$hwnd)
  if (-not \$el) { '{}' ; return }
  \$name = \$el.Current.Name
  \$ctype = \$el.Current.ControlType.ProgrammaticName
  \$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)
  \$texts = \$el.FindAll([System.Windows.Automation.TreeScope]::Descendants, \$cond)
  \$arr = @()
  \$i = 0
  foreach (\$t in \$texts) {
    if (\$i -ge 40) { break }
    \$n = \$t.Current.Name
    if (\$n -and \$n.Length -gt 1) { \$arr += \$n; \$i++ }
  }
  @{ title = \$name; texts = \$arr } | ConvertTo-Json -Compress
} catch { '{}' }
`;
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], {
      timeout: 4000, windowsHide: true, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024
    });
    return JSON.parse(stdout.trim() || '{}');
  } catch (_) {
    return {};
  }
}

async function tick(windowTracker) {
  const cfg = getConfig();
  if (!cfg.authorized || cfg.privacy?.paused || !cfg.collectors?.uia) {
    if (!cfg.collectors?.uia) status.disabled('uia');
    return;
  }
  if (bus?.budget?.skipUia) return;
  const now = Date.now();
  if (now - lastTs < 30000) return; // throttle 30s

  const cur = windowTracker?.getCurrent?.();
  if (cur && isSelfApp(cur)) return;
  if (cur && (cfg.privacy?.blacklistApps || []).some(a => `${cur.app} ${cur.process}`.toLowerCase().includes(String(a).toLowerCase()))) {
    return;
  }

  let text = '';
  let title = cur?.title || '';
  if (process.platform === 'win32') {
    const data = await captureWinUia();
    title = data.title || title;
    text = (data.texts || []).join('\n').slice(0, 8000);
  } else {
    // Linux: no UIA — record title-only marker infrequently
    text = '';
  }
  if (!text && !title) return;
  const hash = `${cur?.process || ''}|${title}|${text.slice(0, 200)}`;
  if (hash === lastHash) return;
  lastHash = hash;
  lastTs = now;

  // Skip password-ish
  if (/password|密码|•{3,}/i.test(text)) text = '[已隐藏-可能含密码字段]';

  bus?.push({
    type: 'uia',
    ts_start: now,
    app: cur?.app || '前台应用',
    title,
    content: text || null,
    meta: { process: cur?.process, len: (text || '').length },
    source: 'uia'
  });
  status.ok('uia', title.slice(0, 40));
}

function start(opts = {}) {
  getConfig = opts.getConfig || getConfig;
  bus = opts.bus;
  const windowTracker = opts.windowTracker;
  stop();
  timer = setInterval(() => tick(windowTracker), opts.intervalMs || 8000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop };
