const { PRESETS } = require('../main/config');

async function chatCompletion(cfg, messages, options = {}) {
  const ai = cfg.ai || {};
  if (!ai.baseUrl) throw new Error('请先在 AI 设置中配置 API 地址');
  if (!ai.apiKey && !ai.baseUrl.includes('127.0.0.1') && !ai.baseUrl.includes('localhost')) {
    throw new Error('请先配置 API Key');
  }
  let pro = null;
  try { pro = require('../pro'); } catch (_) {}
  if (pro) { pro.assertEndpointAllowed(ai.baseUrl, cfg); pro.assertBudget(cfg); }
  const url = ai.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const t0 = Date.now();
  const body = {
    model: options.model || ai.model || 'deepseek-chat',
    messages,
    temperature: options.temperature ?? (ai.temperature ?? 0.3),
    max_tokens: options.max_tokens || 2000
  };
  const headers = { 'Content-Type': 'application/json' };
  if (ai.apiKey) headers['Authorization'] = `Bearer ${ai.apiKey}`;

  const meta = { provider: ai.provider, model: body.model, purpose: options.purpose || 'chat', messages };
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: options.signal });
  } catch (e) {
    pro && pro.recordUsage({ ...meta, latency_ms: Date.now() - t0, ok: false, error: e.message });
    throw e;
  }
  if (!res.ok) {
    const t = await res.text();
    pro && pro.recordUsage({ ...meta, latency_ms: Date.now() - t0, ok: false, error: `HTTP ${res.status}` });
    throw new Error(`AI API ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  const usage = pro ? pro.recordUsage({ ...meta, content, raw: data, latency_ms: Date.now() - t0 }) : null;
  return { content, raw: data, usage };
}

/** OpenAI-compatible vision: image as data URL in user content parts */
async function visionDescribe(cfg, imagePathOrBuffer, prompt, options = {}) {
  const fs = require('fs');
  const ai = cfg.ai || {};
  const model = options.model || ai.visionModel || ai.model;
  if (!model) throw new Error('未配置视觉模型（AI 设置中的 visionModel 或 model）');

  let b64;
  if (Buffer.isBuffer(imagePathOrBuffer)) {
    b64 = imagePathOrBuffer.toString('base64');
  } else {
    b64 = fs.readFileSync(imagePathOrBuffer).toString('base64');
  }
  const dataUrl = `data:image/png;base64,${b64}`;
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }
  ];
  return chatCompletion(cfg, messages, { ...options, model, max_tokens: options.max_tokens || 800 });
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

module.exports = { chatCompletion, visionDescribe, parseJsonLoose, applyPreset, PRESETS };
