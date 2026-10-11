const { PRESETS } = require('../main/config');

async function chatCompletion(cfg, messages, options = {}) {
  const ai = cfg.ai || {};
  if (!ai.baseUrl) throw new Error('请先在 AI 设置中配置 API 地址');
  if (!ai.apiKey && !ai.baseUrl.includes('127.0.0.1') && !ai.baseUrl.includes('localhost')) {
    throw new Error('请先配置 API Key');
  }
  const url = ai.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const body = {
    model: options.model || ai.model || 'deepseek-chat',
    messages,
    temperature: options.temperature ?? 0.4,
    max_tokens: options.max_tokens || 2000
  };
  const headers = {
    'Content-Type': 'application/json'
  };
  if (ai.apiKey) headers['Authorization'] = `Bearer ${ai.apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options.signal
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI API ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  return { content, raw: data };
}

function parseJsonLoose(text) {
  if (!text) return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch (_) {}
  const start = s.search(/[\{\[]/);
  if (start >= 0) {
    const chunk = s.slice(start);
    try { return JSON.parse(chunk); } catch (_) {}
    // try trim trailing
    for (let i = chunk.length; i > 10; i--) {
      try { return JSON.parse(chunk.slice(0, i)); } catch (_) {}
    }
  }
  return null;
}

function applyPreset(cfg, name) {
  const p = PRESETS[name];
  if (!p) return cfg;
  cfg.ai.provider = name;
  if (p.baseUrl) cfg.ai.baseUrl = p.baseUrl;
  if (p.model) cfg.ai.model = p.model;
  return cfg;
}

module.exports = { chatCompletion, parseJsonLoose, applyPreset, PRESETS };
