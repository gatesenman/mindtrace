#!/usr/bin/env node
/**
 * Minimal OpenAI-compatible mock for MindTrace E2E tests.
 * POST /v1/chat/completions
 * Usage: node scripts/mock-openai-server.js [port=3921]
 */
const http = require('http');
const port = parseInt(process.argv[2] || '3921', 10);

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function extractUserText(messages) {
  const parts = [];
  for (const m of messages || []) {
    if (typeof m.content === 'string') parts.push(m.content);
    else if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.type === 'text') parts.push(p.text);
        if (p.type === 'image_url') parts.push('[IMAGE]');
      }
    }
  }
  return parts.join('\n');
}

function replyFor(userText) {
  // Vision
  if (userText.includes('[IMAGE]') || /截屏|vision|app_guess/.test(userText)) {
    return JSON.stringify({
      app_guess: '微信',
      ui: '聊天窗口',
      key_text: ['张三', '项目进度'],
      activity: '正在与同事讨论项目',
      sensitive: false
    });
  }
  // Daily journal
  if (/请输出 JSON（不要 markdown 围栏）/.test(userText) || /"title": "一句话标题"/.test(userText) || /今日概览/.test(userText)) {
    return JSON.stringify({
      title: '扎实推进知迹采集与知识沉淀',
      summary: '今天主要在 VS Code 中实现采集与界面，通过 Chrome/Edge 查阅文档，并用微信与张三同步进度。已形成可导出的知识卡片雏形。',
      highlights: ['完成窗口时间线与授权引导', '打通日刊与卡片抽取', '确认微信走截屏识图'],
      topics: ['知迹 MindTrace', 'Electron 桌面开发'],
      todos: ['配置生产环境 API Key', '验证 Windows 安装包'],
      learnings: ['Chrome History 需复制后读取', 'Electron 下避免 ESM-only 依赖'],
      people: ['张三'],
      links: [{ title: 'Electron 文档', url: 'https://www.electronjs.org/docs' }]
    });
  }
  // Knowledge cards
  if (/抽取知识卡片/.test(userText) || /"kind":"person\|project/.test(userText)) {
    return JSON.stringify([
      { kind: 'learning', title: 'History 锁定文件', summary: 'Chrome 运行时锁 DB，必须 copyFile 后再读', tags: ['浏览器'], importance: 4 },
      { kind: 'todo', title: '验证 NSIS 安装包', summary: '在 Windows 真机冒烟安装与托盘', tags: ['发布'], importance: 5 },
      { kind: 'person', title: '张三', summary: '今日微信沟通项目进度', tags: ['协作'], importance: 3 },
      { kind: 'project', title: '知迹 MindTrace', summary: '桌面行为转知识资产', tags: ['产品'], importance: 5 },
      { kind: 'link', title: 'DeepSeek API', summary: 'https://api-docs.deepseek.com', tags: ['文档'], importance: 3 }
    ]);
  }
  // Topic cluster
  if (/聚类为/.test(userText) || /cardTitles/.test(userText)) {
    return JSON.stringify([
      { name: '知迹产品开发', summary: '采集、AI 沉淀与导出相关工作', cardTitles: ['知迹 MindTrace'], keywords: ['Electron', '采集'] },
      { name: '协作与沟通', summary: '与张三等同步进度', cardTitles: ['张三'], keywords: ['微信'] }
    ]);
  }
  // Ask history with citations
  if (/CITATIONS:/.test(userText) || /引用编号/.test(userText)) {
    const keys = [...userText.matchAll(/\[([ECJ]\d+)\]/g)].map(x => x[1]);
    const used = [...new Set(keys)].slice(0, 3);
    const citeLine = used.length ? used.join(',') : 'none';
    return `根据你的历史记录：今天通过微信与相关同事讨论了项目，并在编辑器中推进实现。[${used[0] || 'E1'}]\n\n若需要更完整的结论，可再生成今日日刊。\nCITATIONS: ${citeLine}`;
  }
  // Generic test
  if (/介绍你自己/.test(userText)) {
    return '我是知迹的知识整理助手，可以把你的桌面活动沉淀为日刊与知识卡片。';
  }
  return JSON.stringify({ ok: true, echo: userText.slice(0, 120) });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/v1/models')) {
    return json(res, 200, { ok: true, data: [{ id: 'mock-mindtrace' }] });
  }
  if (req.method === 'POST' && /\/chat\/completions/.test(req.url)) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) {}
    const text = extractUserText(body.messages);
    const content = replyFor(text);
    return json(res, 200, {
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      model: body.model || 'mock-mindtrace',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }]
    });
  }
  json(res, 404, { error: 'not found', path: req.url });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Mock OpenAI http://127.0.0.1:${port}/v1`);
});
