/**
 * UI Automation text capture — Windows via PowerShell UIAutomation; Linux: stub (title only via windowTracker).
 */
const status = require('../main/collectorStatus');
const { isSelfApp } = require('../main/appNames');

let timer = null;
let getConfig = () => ({});
let bus = null;
let lastHash = '';
let lastTs = 0;
let lastMs = null, lastTrunc = false;

// 2.4：常驻 PowerShell UIA 宿主（原来每 8 秒新起一个 powershell.exe）。
// 借鉴 Screenpipe 事件驱动规格：无障碍树遍历设硬时限（这里 350ms），超时就用已拿到的部分；密码框按 IsPassword 属性跳过。
const { PsHost } = require('../common/psHost');
const UIA_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices;
public class MTFG { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); }
"@
$AE = [System.Windows.Automation.AutomationElement]
$CT = [System.Windows.Automation.ControlType]
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  try {
    $budget = 350; $max = 60
    if ($line -match '^\d+$') { $budget = [int]$line }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $h = [MTFG]::GetForegroundWindow(); $procId = 0; $null = [MTFG]::GetWindowThreadProcessId($h, [ref]$procId)
    $pname = ''; try { $pname = (Get-Process -Id $procId).ProcessName } catch {}
    $el = $AE::FromHandle($h)
    if (-not $el) { '{"ok":true,"texts":[]}'; [Console]::Out.Flush(); continue }
    $arr = New-Object System.Collections.ArrayList; $seen = @{}; $nodes = 0; $truncated = $false
    $stack = New-Object System.Collections.Stack; $stack.Push(@($el, 0))
    while ($stack.Count -gt 0) {
      if ($sw.ElapsedMilliseconds -gt $budget -or $arr.Count -ge $max) { $truncated = $true; break }
      $pair = $stack.Pop(); $n = $pair[0]; $depth = $pair[1]; $nodes++
      try {
        $c = $n.Current
        $isPw = $false; try { $isPw = $c.IsPassword } catch {}
        if (-not $isPw) {
          $t = $c.ControlType
          $txt = $null
          if ($t -eq $CT::Text -or $t -eq $CT::ListItem -or $t -eq $CT::Hyperlink -or $t -eq $CT::Header -or $t -eq $CT::DataItem) { $txt = $c.Name }
          elseif ($t -eq $CT::Document -or $t -eq $CT::Edit) { try { $vp = $n.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $txt = $vp.Current.Value } catch { $txt = $c.Name } }
          if ($txt -and $txt.Length -gt 1 -and -not $seen.ContainsKey($txt)) { $seen[$txt] = 1; $null = $arr.Add($txt.Substring(0, [Math]::Min(2000, $txt.Length))) }
        }
        if ($depth -lt 25) { $ch = $walker.GetLastChild($n); while ($ch) { $stack.Push(@($ch, ($depth + 1))); $ch = $walker.GetPreviousSibling($ch) } }
      } catch {}
    }
    @{ ok = $true; title = $el.Current.Name; process = $pname; texts = @($arr); nodes = $nodes; ms = $sw.ElapsedMilliseconds; truncated = $truncated } | ConvertTo-Json -Compress -Depth 3
  } catch { @{ ok = $false; error = "$($_.Exception.Message)" } | ConvertTo-Json -Compress }
  [Console]::Out.Flush()
}
`;
let host = null;
function uiaHost(spawnImpl) { if (spawnImpl) { host && host.stop(); host = new PsHost({ name: 'uia', script: UIA_SCRIPT, timeoutMs: 3000, idleExitMs: 0, spawnImpl }); } if (!host) host = new PsHost({ name: 'uia', script: UIA_SCRIPT, timeoutMs: 4000, idleExitMs: 10 * 60000 }); return host; }
async function captureWinUia(budgetMs = 350) {
  try { const r = await uiaHost().request(String(budgetMs)); return r && r.ok ? r : {}; } catch (_) { return {}; }
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
  if (process.platform === 'win32' || host?.spawnImpl) {
    const data = await captureWinUia(cfg.privacy?.uiaBudgetMs || 350);
    title = data.title || title; lastMs = data.ms; lastTrunc = !!data.truncated;
    text = (data.texts || []).join('\n').slice(0, 8000);
  } else {
    // Linux: no UIA — record title-only marker infrequently
    text = '';
  }
  if (!text && !title) return;
  // 只有窗口名、没有足够正文 → 不记录（2.3.2）
  if (text.replace(title, '').replace(/\s+/g, '').length < require('../core/noise').UIA_MIN_LEN) return;
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
    meta: { process: cur?.process, len: (text || '').length, uia_ms: lastMs, truncated: lastTrunc },
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
  if (host) host.stop();
}

module.exports = { start, stop, captureWinUia, UIA_SCRIPT, _inject: uiaHost, info: () => host ? host.info() : { alive: false } };
