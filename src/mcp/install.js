// 2.4 MCP 一键接入：把知迹写进 Cursor / Claude Desktop 的 MCP 配置（合并、先备份、不破坏已有服务器）
// 参考：Cursor MCP 配置 ~/.cursor/mcp.json（https://cursor.com/docs/mcp）；
//       Screenpipe 的一键安装做法（https://docs.screenpipe.com/mcp-server）。
const fs = require('fs'), path = require('path'), os = require('os');
const NAME = 'mindtrace';
function targets({ home = os.homedir(), appdata = process.env.APPDATA, platform = process.platform } = {}) {
  const claudeDir = platform === 'win32' ? path.join(appdata || path.join(home, 'AppData', 'Roaming'), 'Claude')
    : platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Claude') : path.join(home, '.config', 'Claude');
  return {
    cursor: { key: 'cursor', name: 'Cursor', file: path.join(home, '.cursor', 'mcp.json'), detect: [path.join(home, '.cursor')] },
    claude: { key: 'claude', name: 'Claude Desktop', file: path.join(claudeDir, 'claude_desktop_config.json'), detect: [claudeDir] }
  };
}
function entryFor(key, { url, token }) {
  if (key === 'cursor') return { url, headers: { Authorization: `Bearer ${token}` } };
  // Claude Desktop 配置只支持 stdio 命令 → 用 mcp-remote 桥接到本机 HTTP 端点
  return { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', `Authorization:Bearer ${token}`] };
}
function readJson(file) {
  if (!fs.existsSync(file)) return { json: {}, existed: false };
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  if (!raw.trim()) return { json: {}, existed: true };
  try { return { json: JSON.parse(raw), existed: true }; } catch (e) { const err = new Error(`${path.basename(file)} 不是合法 JSON，为避免破坏你的配置已停止写入`); err.code = 'BAD_JSON'; throw err; }
}
function status(opts = {}) {
  const T = targets(opts); const out = {};
  for (const [k, t] of Object.entries(T)) {
    let installed = false, current = false, error = null;
    try { const { json } = readJson(t.file); const e = json.mcpServers?.[NAME]; installed = !!e; current = !!e && JSON.stringify(e) === JSON.stringify(entryFor(k, opts)); } catch (e) { error = e.message; }
    out[k] = { name: t.name, file: t.file, detected: t.detect.some(d => fs.existsSync(d)), installed, current, error };
  }
  return out;
}
function install(key, opts = {}) {
  const t = targets(opts)[key]; if (!t) throw new Error('未知目标：' + key);
  if (!opts.url || !opts.token) throw new Error('缺少 MCP 地址或令牌');
  const { json, existed } = readJson(t.file);
  let backup = null;
  if (existed) { backup = `${t.file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`; fs.copyFileSync(t.file, backup); }
  json.mcpServers = json.mcpServers && typeof json.mcpServers === 'object' ? json.mcpServers : {};
  json.mcpServers[NAME] = entryFor(key, opts);
  fs.mkdirSync(path.dirname(t.file), { recursive: true });
  const tmp = t.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(json, null, 2), 'utf8'); fs.renameSync(tmp, t.file);
  return { ok: true, key, name: t.name, file: t.file, backup, others: Object.keys(json.mcpServers).filter(n => n !== NAME) };
}
function uninstall(key, opts = {}) {
  const t = targets(opts)[key]; const { json, existed } = readJson(t.file);
  if (!existed || !json.mcpServers?.[NAME]) return { ok: true, removed: false };
  fs.copyFileSync(t.file, `${t.file}.bak-${Date.now()}`); delete json.mcpServers[NAME];
  fs.writeFileSync(t.file, JSON.stringify(json, null, 2), 'utf8'); return { ok: true, removed: true };
}
module.exports = { targets, status, install, uninstall, entryFor, NAME };
