/**
 * MCP server (JSON-RPC 2.0 over HTTP, "streamable HTTP" style single-response).
 * POST /mcp  { jsonrpc:"2.0", id, method: initialize | tools/list | tools/call | ping }
 * Legacy: GET /mcp/tools, POST /mcp/call kept for compatibility.
 */
const http = require('http');
const crypto = require('crypto');
const store = require('../main/store');

let server = null;
let getConfig = () => ({});
let hooks = {};
const PROTOCOL = '2025-03-26';

const TOOLS = [
  { name: 'search', description: '全文检索活动、笔记、OCR 与文件摘录。可按类型、应用、时间范围过滤。',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, type: { type: 'string' }, app: { type: 'string' }, from: { type: 'string', description: 'ISO 日期' }, to: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } },
  { name: 'get_timeline', description: '获取某天（或最近 24 小时）的活动时间线。',
    inputSchema: { type: 'object', properties: { day: { type: 'string', description: 'YYYY-MM-DD' }, type: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'get_wiki_page', description: '读取 Wiki 页面（时间卷/实体页），按 slug 或标题。',
    inputSchema: { type: 'object', properties: { slug: { type: 'string' }, title: { type: 'string' } } } },
  { name: 'list_wiki_pages', description: '列出 Wiki 页面目录。',
    inputSchema: { type: 'object', properties: { kind: { type: 'string' } } } },
  { name: 'get_memories', description: '获取已审核通过的记忆（事实/偏好/决策/待办）。',
    inputSchema: { type: 'object', properties: { kind: { type: 'string' } } } },
  { name: 'get_rollups', description: '获取小时/日/周/月汇总卷。',
    inputSchema: { type: 'object', properties: { level: { type: 'string', enum: ['hour', 'day', 'week', 'month'] } } } },
  { name: 'get_analytics', description: '生产力分析：专注会话、上下文切换、深度工作分、应用/项目时间分配。',
    inputSchema: { type: 'object', properties: { day: { type: 'string' }, range: { type: 'string', enum: ['day', 'week'] } } } },
  { name: 'add_note', description: '写入一条速记（Markdown），立即可被检索。',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['content'] } }
];

function text(obj) {
  return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] };
}
function dayRange(day) {
  if (!day) return [Date.now() - 86400000, Date.now()];
  const a = new Date(day + 'T00:00:00').getTime();
  return [a, a + 86400000];
}

async function callTool(name, args = {}) {
  const pro = require('../pro');
  pro.audit('mcp', 'call', name, args);
  switch (name) {
    case 'search': {
      const q = String(args.query || args.q || '').trim();
      let rows = store.searchFts(q, Math.min(200, args.limit || 50));
      const ids = rows.map(r => r.id).filter(Boolean);
      const full = ids.length ? store.all(`SELECT id,type,app_name,window_title,url,file_path,started_at,substr(content,1,300) content FROM activities WHERE id IN (${ids.map(() => '?').join(',')})`, ids) : [];
      let out = full.length ? full : rows;
      if (args.type) out = out.filter(r => r.type === args.type);
      if (args.app) out = out.filter(r => String(r.app_name || r.app || '').toLowerCase().includes(String(args.app).toLowerCase()));
      if (args.from) out = out.filter(r => !r.started_at || r.started_at >= new Date(args.from).getTime());
      if (args.to) out = out.filter(r => !r.started_at || r.started_at <= new Date(args.to).getTime() + 86399999);
      return text({ query: q, count: out.length, results: out });
    }
    case 'get_timeline': {
      const [from, to] = dayRange(args.day);
      return text(store.searchActivities({ from, to, type: args.type, limit: Math.min(500, args.limit || 200) }));
    }
    case 'get_wiki_page': {
      const key = args.slug || args.title;
      const page = store.get(`SELECT kind,slug,title,body_md,updated_at FROM wiki_pages WHERE slug=? OR title=? LIMIT 1`, [key, key]);
      return page ? text(page) : { isError: true, ...text('未找到页面: ' + key) };
    }
    case 'list_wiki_pages':
      return text(store.listWiki(args.kind).map(p => ({ kind: p.kind, slug: p.slug, title: p.title, updated_at: p.updated_at })));
    case 'get_memories':
      return text(store.listMemories(args.kind).map(m => ({ kind: m.kind, text: m.text, confidence: m.confidence, updated_at: m.updated_at })));
    case 'get_rollups':
      return text(store.getRollups(args.level || 'day').slice(0, 30));
    case 'get_analytics': {
      if (args.range === 'week') return text(pro.weeklyReview(args.day ? new Date(args.day).getTime() : Date.now()));
      const [from, to] = args.day ? dayRange(args.day) : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return [d.getTime(), d.getTime() + 86400000]; })();
      return text(pro.analytics(from, to));
    }
    case 'add_note': {
      const content = String(args.content || '').trim();
      if (!content) return { isError: true, ...text('content 不能为空') };
      const now = Date.now();
      const row = { type: 'note', started_at: now, ended_at: now, app_name: 'MCP', window_title: args.title || content.slice(0, 40), content, meta: { source: 'mcp', tags: args.tags || [] } };
      const id = store.insertActivity(row);
      if (id) store.indexActivityFts({ id, ...row });
      store.persist();
      return text({ ok: !!id, id });
    }
    default:
      return { isError: true, ...text('未知工具: ' + name) };
  }
}

async function handleRpc(msg) {
  const { id, method, params } = msg || {};
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || !method) return err(-32600, 'Invalid Request');
  if (method === 'initialize') {
    return ok({ protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'mindtrace', version: hooks.version || '2.2.0' }, instructions: '知迹 MindTrace：个人桌面活动知识库。先用 search / get_timeline 检索，再用 get_wiki_page 读汇总。' });
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'ping') return ok({});
  if (method === 'tools/list') return ok({ tools: TOOLS });
  if (method === 'tools/call') {
    const name = params?.name;
    if (!TOOLS.find(t => t.name === name)) return err(-32602, 'Unknown tool: ' + name);
    try { return ok(await callTool(name, params.arguments || {})); }
    catch (e) { return ok({ isError: true, ...text(e.message) }); }
  }
  return err(-32601, 'Method not found: ' + method);
}

function send(res, code, obj, extra = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', ...extra });
  res.end(obj == null ? '' : JSON.stringify(obj));
}

function start(opts = {}) {
  getConfig = opts.getConfig || getConfig;
  hooks = opts.hooks || hooks;
  stop();
  const cfg = getConfig();
  if (!cfg.api?.enabled) return;
  const port = (cfg.api?.port || 17321) + 1;
  server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id' });
      return res.end();
    }
    const token = getConfig().api?.token;
    const h = req.headers['authorization'] || '';
    if (token && h !== `Bearer ${token}` && h !== token) return send(res, 401, { error: 'unauthorized' });
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    try {
      let body = null;
      if (req.method === 'POST') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks).toString('utf8');
        try { body = raw ? JSON.parse(raw) : {}; } catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
      }
      if (url.pathname === '/mcp' && req.method === 'POST') {
        const session = req.headers['mcp-session-id'] || crypto.randomUUID();
        if (Array.isArray(body)) {
          const out = (await Promise.all(body.map(handleRpc))).filter(Boolean);
          return send(res, 200, out, { 'Mcp-Session-Id': session });
        }
        const out = await handleRpc(body);
        if (!out) return send(res, 202, null, { 'Mcp-Session-Id': session });
        return send(res, 200, out, { 'Mcp-Session-Id': session });
      }
      if (url.pathname === '/mcp/tools' && req.method === 'GET') return send(res, 200, { tools: TOOLS });
      if (url.pathname === '/mcp/call' && req.method === 'POST') {
        return send(res, 200, await callTool(body.tool || body.name, body.arguments || body.args || {}));
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  });
  server.on('error', e => console.error('MCP server', e.message));
  server.listen(port, '127.0.0.1');
}

function stop() { if (server) { try { server.close(); } catch (_) {} server = null; } }

module.exports = { start, stop, handleRpc, callTool, TOOLS };
