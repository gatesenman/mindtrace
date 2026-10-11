const http = require('http');
const store = require('../main/store');
const summarizer = require('../ai/summarizer');

let server = null;
let getConfig = () => ({});

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
  });
}

function authOk(req, cfg) {
  const token = cfg.api?.token;
  if (!token) return true;
  const h = req.headers['authorization'] || '';
  return h === `Bearer ${token}` || h === token;
}

function start(opts = {}) {
  getConfig = opts.getConfig || getConfig;
  stop();
  const cfg = getConfig();
  if (!cfg.api?.enabled) return;
  const port = cfg.api.port || 17890;

  server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      });
      return res.end();
    }
    const cfgNow = getConfig();
    if (!authOk(req, cfgNow)) return json(res, 401, { error: 'unauthorized' });

    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return json(res, 200, { ok: true, name: 'MindTrace', version: '1.0.0' });
      }
      if (req.method === 'GET' && url.pathname === '/stats/today') {
        return json(res, 200, store.getTodayStats());
      }
      if (req.method === 'GET' && url.pathname === '/activities') {
        const q = url.searchParams.get('q') || undefined;
        const type = url.searchParams.get('type') || undefined;
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        return json(res, 200, { items: store.searchActivities({ q, type, limit }) });
      }
      if (req.method === 'GET' && url.pathname === '/cards') {
        const kind = url.searchParams.get('kind');
        const items = kind
          ? store.all(`SELECT * FROM knowledge_cards WHERE kind=? ORDER BY updated_at DESC LIMIT 100`, [kind])
          : store.all(`SELECT * FROM knowledge_cards ORDER BY updated_at DESC LIMIT 100`);
        return json(res, 200, { items });
      }
      if (req.method === 'GET' && url.pathname === '/journals') {
        return json(res, 200, { items: store.all(`SELECT * FROM journals ORDER BY period_key DESC LIMIT 60`) });
      }
      if (req.method === 'POST' && url.pathname === '/ask') {
        const body = await readBody(req);
        if (!body.question) return json(res, 400, { error: 'question required' });
        const answer = await summarizer.askHistory(cfgNow, body.question);
        return json(res, 200, { answer });
      }
      if (req.method === 'GET' && url.pathname === '/mcp/tools') {
        return json(res, 200, {
          tools: [
            { name: 'search_activities', description: '搜索桌面活动时间线' },
            { name: 'list_knowledge_cards', description: '列出知识卡片' },
            { name: 'ask_history', description: '基于个人历史问答' },
            { name: 'today_stats', description: '今日统计' }
          ]
        });
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`MindTrace API http://127.0.0.1:${port}`);
  });
}

function stop() {
  if (server) {
    try { server.close(); } catch (_) {}
    server = null;
  }
}

module.exports = { start, stop };
