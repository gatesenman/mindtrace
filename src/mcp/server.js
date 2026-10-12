const http = require('http');
const store = require('../main/store');
const summarizer = require('../ai/summarizer');

let server = null;
let getConfig = () => ({});

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

function start(opts = {}) {
  getConfig = opts.getConfig || getConfig;
  stop();
  const cfg = getConfig();
  // MCP shares API port+1 or same server paths under /mcp
  // We attach lightweight JSON-RPC-ish endpoints on api.port + 1
  const port = (cfg.api?.port || 17321) + 1;
  if (!cfg.api?.enabled) return;

  server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
      return res.end();
    }
    const token = cfg.api?.token;
    const h = req.headers['authorization'] || '';
    if (token && h !== `Bearer ${token}` && h !== token) return json(res, 401, { error: 'unauthorized' });

    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    try {
      if (url.pathname === '/mcp/tools' && req.method === 'GET') {
        return json(res, 200, {
          tools: [
            { name: 'search_events', description: '全文检索活动/笔记/OCR' },
            { name: 'get_timeline', description: '按日或小时取时间线' },
            { name: 'get_wiki_page', description: '读取 wiki 页面' },
            { name: 'list_memories', description: '列出记忆条目' },
            { name: 'ask_history', description: '基于历史问答' },
            { name: 'add_note', description: '添加一条速记（需 POST）' },
            { name: 'list_rollups', description: '小时/日/周/月卷' }
          ]
        });
      }
      if (url.pathname === '/mcp/call' && req.method === 'POST') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const name = body.tool || body.name;
        const args = body.arguments || body.args || {};
        if (name === 'search_events') return json(res, 200, { content: store.searchFts(args.q || args.query || '', args.limit || 30) });
        if (name === 'get_timeline') {
          const day = args.day;
          const from = day ? new Date(day + 'T00:00:00').getTime() : Date.now() - 86400000;
          const to = day ? new Date(day + 'T23:59:59').getTime() : Date.now();
          return json(res, 200, { content: store.searchActivities({ from, to, limit: args.limit || 100 }) });
        }
        if (name === 'get_wiki_page') {
          const page = store.get(`SELECT * FROM wiki_pages WHERE slug=? OR id=?`, [args.slug || args.id, args.slug || args.id]);
          return json(res, 200, { content: page });
        }
        if (name === 'list_memories') return json(res, 200, { content: store.listMemories(args.kind) });
        if (name === 'list_rollups') return json(res, 200, { content: store.getRollups(args.level || 'day') });
        if (name === 'ask_history') {
          const r = await summarizer.askHistory(getConfig(), args.question || '');
          return json(res, 200, { content: r });
        }
        return json(res, 400, { error: 'unknown tool' });
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });
  server.listen(port, '127.0.0.1', () => console.log(`MindTrace MCP http://127.0.0.1:${port}`));
}

function stop() {
  if (server) { try { server.close(); } catch (_) {} server = null; }
}

module.exports = { start, stop };
