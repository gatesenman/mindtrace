const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const store = require('../main/store');
const status = require('../main/collectorStatus');
const { friendlyAppName, isSelfApp } = require('../main/appNames');

let timer = null;
let current = null; // { id, app, process, title, startedAt }
let idleSince = null;
let getConfig = () => ({});
let onChange = () => {};

function isWin() { return process.platform === 'win32'; }
function isLinux() { return process.platform === 'linux'; }

// 2.4.8：前台窗口改用常驻 PowerShell（原来每 2 秒新起 powershell + 现编译 C#，慢机器上常超时 5s → 整次丢失）；
// GetWindowTextW 显式 Unicode（原 DllImport 默认 ANSI，中文标题会变成 ???，文档名全丢）；附带进程命令行（按 pid 缓存）用于解析文档完整路径。
const { PsHost } = require('../common/psHost');
const FG_SCRIPT = String.raw`
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class MTW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct LII { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LII p);
  [DllImport("kernel32.dll")] public static extern uint GetTickCount();
}
"@
$cmdCache = @{}
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  try {
    $i = New-Object MTW+LII; $i.cbSize = [uint32][Runtime.InteropServices.Marshal]::SizeOf($i); [void][MTW]::GetLastInputInfo([ref]$i)
    $idle = [int](([MTW]::GetTickCount() - $i.dwTime) / 1000)
    $h = [MTW]::GetForegroundWindow(); $sb = New-Object Text.StringBuilder 1024; [void][MTW]::GetWindowTextW($h, $sb, 1024)
    $procId = 0; [void][MTW]::GetWindowThreadProcessId($h, [ref]$procId)
    $pn = ''; $desc = ''; $exe = ''
    try { $p = Get-Process -Id $procId -ErrorAction Stop; $pn = $p.ProcessName; try { $exe = $p.Path; $desc = $p.MainModule.FileVersionInfo.FileDescription } catch {} } catch {}
    $cmd = ''
    if ($line -eq 'cmd' -and $procId) {
      if ($cmdCache.ContainsKey($procId)) { $cmd = $cmdCache[$procId] } else {
        try { $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction Stop).CommandLine } catch {}
        if ($cmdCache.Count -gt 200) { $cmdCache.Clear() }; $cmdCache[$procId] = $cmd
      }
    }
    @{ ok = $true; title = $sb.ToString(); process = $pn; app = $desc; pid = $procId; exe = $exe; idle = $idle; cmd = $cmd } | ConvertTo-Json -Compress
  } catch { @{ ok = $false; error = "$($_.Exception.Message)" } | ConvertTo-Json -Compress }
  [Console]::Out.Flush()
}
`;
let fgHost = null;
// 首次请求包含 PowerShell 启动 + Add-Type 编译，给足 15s；之后单次 3s
function fgHostGet(spawnImpl) {
  if (spawnImpl) { fgHost && fgHost.stop(); fgHost = new PsHost({ name: 'fg', script: FG_SCRIPT, timeoutMs: 3000, firstTimeoutMs: 3000, idleExitMs: 0, spawnImpl }); }
  if (!fgHost) fgHost = new PsHost({ name: 'fg', script: FG_SCRIPT, timeoutMs: 3000, firstTimeoutMs: 15000, idleExitMs: 0, maxRestarts: 20 });
  return fgHost;
}
let hostFailStreak = 0;
async function getForegroundHost(wantCmd) {
  const r = await fgHostGet().request(wantCmd ? 'cmd' : 'fg');
  if (!r || !r.ok) throw new Error(r && r.error || 'fg host');
  return { title: r.title || '', process: r.process || '', app: r.app || r.process || '', pid: r.pid, exe: r.exe || '', idle: r.idle, cmd: r.cmd || '' };
}

async function getForeground(opts = {}) {
  if ((isWin() || fgHost?.spawnImpl) && hostFailStreak < 5) {
    try { const r = await getForegroundHost(opts.cmd); hostFailStreak = 0; return r; } catch (e) { hostFailStreak++; lastFgErr = e.message; }
  }
  return getForegroundLegacy();
}
let lastFgErr = null;

async function getForegroundLegacy() {
  try {
    if (isWin()) {
      const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
$h = [W]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 1024
[void][W]::GetWindowText($h, $sb, $sb.Capacity)
$procId = 0
[void][W]::GetWindowThreadProcessId($h, [ref]$procId)
$p = Get-Process -Id $procId -ErrorAction SilentlyContinue
@{ title = $sb.ToString(); process = $(if($p){$p.ProcessName}else{''}); app = $(if($p){$p.MainModule.FileVersionInfo.FileDescription}else{''}); pid = $procId; exe = $(if($p){$p.Path}else{''}) } | ConvertTo-Json -Compress
`;
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' + script], { timeout: 5000, windowsHide: true, encoding: 'utf8' });
      const j = JSON.parse(stdout.trim() || '{}');
      return { title: j.title || '', process: j.process || '', app: j.app || j.process || '', pid: j.pid, exe: j.exe || '' };
    }
    if (isLinux()) {
      try {
        const { stdout: wid } = await execFileAsync('xdotool', ['getactivewindow'], { timeout: 2000 });
        const id = wid.trim();
        const { stdout: title } = await execFileAsync('xdotool', ['getwindowname', id], { timeout: 2000 });
        let process = '', app = title.trim();
        try {
          const { stdout: pid } = await execFileAsync('xdotool', ['getwindowpid', id], { timeout: 2000 });
          const { stdout: comm } = await execFileAsync('ps', ['-p', pid.trim(), '-o', 'comm='], { timeout: 2000 });
          process = comm.trim();
          app = process;
        } catch (_) {}
        return { title: title.trim(), process, app, pid: 0 };
      } catch (_) {
        return { title: 'Desktop', process: 'unknown', app: 'Desktop', pid: 0 };
      }
    }
    // darwin fallback
    return { title: 'Desktop', process: 'unknown', app: 'Desktop', pid: 0 };
  } catch (e) {
    return null;
  }
}

async function getIdleSeconds() {
  try {
    if (isWin()) {
      const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class I {
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [DllImport("kernel32.dll")] public static extern uint GetTickCount();
}
"@
$i = New-Object I+LASTINPUTINFO
$i.cbSize = [uint32][System.Runtime.InteropServices.Marshal]::SizeOf($i)
[void][I]::GetLastInputInfo([ref]$i)
[int](([I]::GetTickCount() - $i.dwTime) / 1000)
`;
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 3000, windowsHide: true, encoding: 'utf8' });
      return parseInt(stdout.trim(), 10) || 0;
    }
    if (isLinux()) {
      try {
        const { stdout } = await execFileAsync('xprintidle', [], { timeout: 2000 });
        return Math.floor(parseInt(stdout.trim(), 10) / 1000);
      } catch (_) {
        return 0;
      }
    }
  } catch (_) {}
  return 0;
}

function isBlacklisted(fg, cfg) {
  const privacy = cfg.privacy || {};
  const apps = privacy.blacklistApps || [];
  const keywords = privacy.blacklistKeywords || [];
  const hay = `${fg.app || ''} ${fg.process || ''} ${fg.title || ''}`.toLowerCase();
  for (const a of apps) if (a && hay.includes(String(a).toLowerCase())) return true;
  for (const k of keywords) if (k && hay.includes(String(k).toLowerCase())) return true;
  return false;
}

async function tick() {
  const cfg = getConfig();
  if (!cfg.authorized || cfg.privacy?.paused || !cfg.collectors?.window) {
    if (!cfg.collectors?.window) status.disabled('window');
    return;
  }
  try {
    // 2.4.8：一次请求同时拿空闲秒数与前台窗口
    const fg0 = await getForeground({ cmd: true });
    const idleSec = fg0 && typeof fg0.idle === 'number' ? fg0.idle : await getIdleSeconds();
    const thresh = cfg.privacy?.idleThresholdSec || 180;
    if (idleSec >= thresh) {
      if (current) {
        const ended = Date.now();
        store.updateActivityEnd(current.id, ended, ended - current.startedAt);
        current = null;
        onChange({ type: 'idle' });
      }
      idleSince = idleSince || Date.now();
      status.ok('window', '空闲中');
      return;
    }
    idleSince = null;

    const fg = fg0;
    if (!fg) { status.ok('window', '无前台窗口'); return; }
    lastFg = { ...fg, self: isSelfApp(fg), at: Date.now() };
    if (isSelfApp(fg)) {
      if (current) {
        const ended = Date.now();
        const dur = ended - current.startedAt;
        if (dur < ((cfg.privacy?.minDwellSec || 10) * 1000)) {
          try { store.run(`DELETE FROM activities WHERE id=?`, [current.id]); } catch (_) {}
        } else {
          store.updateActivityEnd(current.id, ended, dur);
        }
        current = null;
      }
      status.ok('window', '已忽略知迹自身');
      return;
    }
    fg.app = friendlyAppName(fg.app, fg.process, fg.title);
    if (isBlacklisted(fg, cfg)) {
      if (current) {
        const ended = Date.now();
        store.updateActivityEnd(current.id, ended, ended - current.startedAt);
        current = null;
      }
      status.ok('window', '黑名单跳过');
      return;
    }

    const same = current && current.title === fg.title && current.process === fg.process;
    if (same) {
      status.ok('window', current.app || fg.app || '前台');
      return;
    }

    const now = Date.now();
    const minDwellMs = (cfg.privacy?.minDwellSec || 10) * 1000;
    if (current) {
      const dur = now - current.startedAt;
      if (dur < minDwellMs) {
        try { store.run(`DELETE FROM activities WHERE id=?`, [current.id]); } catch (_) {}
      } else {
        store.updateActivityEnd(current.id, now, dur);
      }
    }
    const id = store.insertActivity({
      type: 'window',
      started_at: now,
      app_name: fg.app || fg.process,
      process_name: fg.process,
      window_title: fg.title,
      meta: { pid: fg.pid, exe: fg.exe || undefined }
    });
    current = id ? { id, app: fg.app, process: fg.process, title: fg.title, startedAt: now } : null;
    if (!current) { status.ok('window', '已忽略系统切换'); return; }
    // 2.4.8：异步补文档对象/路径/正文/URL，不阻塞
    try {
      const enrich = require('../content/enrich');
      const row = { app_name: fg.app || fg.process, process_name: fg.process, window_title: fg.title };
      enrich.enrichWindow(id, row, { cfg, cmdline: fg.cmd }).then(r => {
        if (r && r.parsed && r.parsed.kind === 'browser') { const t = setTimeout(() => { try { enrich.joinBrowser(id); } catch (_) {} }, 75000); t.unref?.(); }
      }).catch(e => require('../content/diag').err('enrich', e));
    } catch (_) {}
    onChange({ type: 'window', current });
    status.ok('window', current.app || '前台');
  } catch (e) {
    status.err('window', e);
  }
}

function start(opts = {}) {

  getConfig = opts.getConfig || getConfig;
  onChange = opts.onChange || onChange;
  stop();
  timer = setInterval(tick, opts.intervalMs || 2000);
  tick();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  if (fgHost) fgHost.stop();
  if (current) {
    const ended = Date.now();
    store.updateActivityEnd(current.id, ended, ended - current.startedAt);
    current = null;
  }
}

let lastFg = null;
function getCurrent() { return current; }
function getLastForeground() { return lastFg; }

module.exports = { start, stop, getCurrent, getLastForeground, getForeground, getIdleSeconds, FG_SCRIPT, _injectHost: fgHostGet, hostInfo: () => ({ ...(fgHost ? fgHost.info() : { alive: false }), lastErr: lastFgErr, legacy: hostFailStreak >= 5 }) };
