// 2.4 回忆框窗口：全局快捷键唤起的轻量浮窗（默认 Ctrl+Shift+Space）
const path = require('path');
const { BrowserWindow, globalShortcut, screen } = require('electron');
let win = null;
function create(theme) {
  const d = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: 720, height: 520, x: Math.round(d.x + (d.width - 720) / 2), y: Math.round(d.y + d.height * 0.16),
    frame: false, resizable: false, show: false, skipTaskbar: true, alwaysOnTop: true, transparent: false,
    backgroundColor: theme === 'dark' ? '#15171C' : '#FFFFFF', title: '知迹 · 回忆',
    webPreferences: { preload: path.join(__dirname, '../preload/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  win.loadFile(path.join(__dirname, '../renderer/recall.html'), { query: { theme: theme || 'light' } });
  win.on('blur', () => { if (!process.argv.includes('--shot-recall')) win?.hide(); });
  win.on('closed', () => { win = null; });
  return win;
}
function toggle(cfg = {}) {
  if (!win) create(cfg.theme);
  if (win.isVisible()) { win.hide(); return; }
  win.show(); win.focus(); win.webContents.send('r24-recall-focus');
}
function hide() { win?.hide(); }
function registerHotkey(cfg = {}) {
  const accel = cfg.recallHotkey || 'CommandOrControl+Shift+Space';
  try { globalShortcut.register(accel, () => toggle(cfg)); return accel; } catch (e) { console.error('recall hotkey', e.message); return null; }
}
module.exports = { toggle, hide, registerHotkey, create, get: () => win };
