const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const store = require('../main/store');

let timer = null;
let current = null; // { id, app, process, title, startedAt }
let idleSince = null;
let getConfig = () => ({});
let onChange = () => {};

function isWin() { return process.platform === 'win32'; }
function isLinux() { return process.platform === 'linux'; }

async function getForeground() {
  try {
    if (isWin()) {
      const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
$h = [W]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 1024
[void][W]::GetWindowText($h, $sb, $sb.Capacity)
$procId = 0
[void][W]::GetWindowThreadProcessId($h, [ref]$procId)
$p = Get-Process -Id $procId -ErrorAction SilentlyContinue
@{ title = $sb.ToString(); process = $(if($p){$p.ProcessName}else{''}); app = $(if($p){$p.MainModule.FileVersionInfo.FileDescription}else{''}); pid = $procId } | ConvertTo-Json -Compress
`;
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' + script], { timeout: 5000, windowsHide: true });
      const j = JSON.parse(stdout.trim() || '{}');
      return { title: j.title || '', process: j.process || '', app: j.app || j.process || '', pid: j.pid };
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
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 3000, windowsHide: true });
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
  if (!cfg.authorized || cfg.privacy?.paused || !cfg.collectors?.window) return;

  const idleSec = await getIdleSeconds();
  const thresh = cfg.privacy?.idleThresholdSec || 180;
  if (idleSec >= thresh) {
    if (current) {
      const ended = Date.now();
      store.updateActivityEnd(current.id, ended, ended - current.startedAt);
      current = null;
      onChange({ type: 'idle' });
    }
    idleSince = idleSince || Date.now();
    return;
  }
  idleSince = null;

  const fg = await getForeground();
  if (!fg) return;
  if (isBlacklisted(fg, cfg)) {
    if (current) {
      const ended = Date.now();
      store.updateActivityEnd(current.id, ended, ended - current.startedAt);
      current = null;
    }
    return;
  }

  const same = current && current.title === fg.title && current.process === fg.process;
  if (same) return;

  const now = Date.now();
  const minDwellMs = (cfg.privacy?.minDwellSec || 3) * 1000;
  if (current) {
    const dur = now - current.startedAt;
    if (dur < minDwellMs) {
      // too short — drop previous micro-session
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
    meta: { pid: fg.pid }
  });
  current = { id, app: fg.app, process: fg.process, title: fg.title, startedAt: now };
  onChange({ type: 'window', current });
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
  if (current) {
    const ended = Date.now();
    store.updateActivityEnd(current.id, ended, ended - current.startedAt);
    current = null;
  }
}

function getCurrent() { return current; }

module.exports = { start, stop, getCurrent, getForeground, getIdleSeconds };
