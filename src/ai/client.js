const { PRESETS } = require('../main/config');
const gate = require('../net/gate');

/** 模型名只取字段值本身：去首尾空白/零宽字符，绝不使用显示名 */
function cleanModel(m) { return String(m == null ? '' : m).replace(/[\u200B-\u200D\uFEFF]/g, '').trim(); }

/** 把服务端错误翻译成友好的中文提示 */
function friendlyError(status, text, model) {
  let msg = text || '';
  try { const j = JSON.parse(text); msg = j.error?.message || j.message || msg; } catch (_) {}
  const m = String(msg).slice(0, 240);
  if (status === 401 || /invalid.*(api[_ ]?key|token)|authentication/i.test(m)) return 'API Key 无效或已过期，请检查是否复制完整（不要包含空格）。';
  if (status === 402 || /insufficient|balance|quota/i.test(m)) return '账户余额不足或额度已用尽，请到服务商控制台充值。';
  if (status === 429) return '请求过于频繁或并发超限，请稍后再试。';
  if (status === 404) return `接口地址不存在（HTTP 404），请检查 Base URL 是否以 /v1 结尾。`;
  const names = m.match(/model names? (?:are|is)\s+([^,]+(?:,\s*[\w.-]+)*)/i);
  if (/model/i.test(m) && (status === 400 || status === 422)) {
    return `模型名「${model}」不被接受。${names ? '可用模型：' + names[1].replace(/\s*,\s*but.*$/i, '') + '。' : ''}请在「模型」中填写模型 ID（如 deepseek-flash），而不是显示名称。`;
  }
  if (status >= 500) return `服务商暂时不可用（HTTP ${status}），请稍后重试。`;
  return `请求失败（HTTP ${status}）：${m}`;
}

async function chatCompletion(cfg, messages, options = {}) {
  const ai = cfg.ai || {};
  const baseUrl = String(ai.baseUrl || '').trim();
  if (!baseUrl) throw new Error('请先在 AI 设置中配置 API 地址');
  if (!ai.apiKey && !baseUrl.includes('127.0.0.1') && !baseUrl.includes('localhost')) {
    throw new Error('请先配置 API Key');
  }
  let pro = null;
  try { pro = require('../pro'); } catch (_) {}
  if (pro) { pro.assertEndpointAllowed(baseUrl, cfg); pro.assertBudget(cfg); }
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const t0 = Date.now();
  const model = cleanModel(options.model) || cleanModel(ai.model) || 'deepseek-flash';
  const body = {
    model,
    messages,
    temperature: options.temperature ?? (ai.temperature ?? 0.3),
    max_tokens: Math.max(64, options.max_tokens || 2000)
  };
  const headers = { 'Content-Type': 'application/json' };
  if (ai.apiKey) headers['Authorization'] = `Bearer ${String(ai.apiKey).trim()}`;

  const meta = { provider: ai.provider, model: body.model, purpose: options.purpose || 'chat', messages };
  let res;
  try {
    res = await gate.gatedFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: options.signal }, { cfg, purpose: 'llm:' + (options.purpose || 'chat') });
  } catch (e) {
    if (e.blocked) throw e;
    pro && pro.recordUsage({ ...meta, latency_ms: Date.now() - t0, ok: false, error: e.message });
    const err = new Error(`无法连接到 ${baseUrl}：${e.cause?.code || e.message}。请检查网络、代理或 Base URL。`); err.network = true; throw err;
  }
  if (!res.ok) {
    const t = await res.text();
    pro && pro.recordUsage({ ...meta, latency_ms: Date.now() - t0, ok: false, error: `HTTP ${res.status}` });
    const err = new Error(friendlyError(res.status, t, model)); err.status = res.status; err.raw = t.slice(0, 300); throw err;
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message || {};
  const finish = data.choices?.[0]?.finish_reason;
  let content = typeof msg.content === 'string' ? msg.content : (Array.isArray(msg.content) ? msg.content.map(p => p.text || '').join('') : '');
  const reasoning = msg.reasoning_content || msg.reasoning || '';
  // 推理模型：max_tokens 不够时 content 为空、只有 reasoning_content → 自动加大重试一次
  if (!content.trim() && reasoning && finish === 'length' && !options._retried && !options.noRetry) {
    pro && pro.recordUsage({ ...meta, content: '', raw: data, latency_ms: Date.now() - t0 });
    return chatCompletion(cfg, messages, { ...options, model, max_tokens: Math.min(16000, body.max_tokens * 3), _retried: true });
  }
  const usage = pro ? pro.recordUsage({ ...meta, content, raw: data, latency_ms: Date.now() - t0 }) : null;
  return { content: content || '', reasoning, finish, model: data.model || model, raw: data, usage };
}

/** GET /models → [{id,name,input_modalities}]；失败返回 null（不是所有服务都支持） */
async function listModels(cfg) {
  const ai = cfg.ai || {};
  const baseUrl = String(ai.baseUrl || '').trim().replace(/\/+$/, '');
  if (!baseUrl) return null;
  try {
    const headers = {}; if (ai.apiKey) headers.Authorization = `Bearer ${String(ai.apiKey).trim()}`;
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000);
    const r = await gate.gatedFetch(baseUrl + '/models', { headers, signal: ctl.signal }, { cfg, purpose: 'llm:models' }); clearTimeout(tm);
    if (!r.ok) return null;
    const j = await r.json();
    const arr = Array.isArray(j.data) ? j.data : (Array.isArray(j.models) ? j.models : []);
    return arr.map(m => ({ id: String(m.id || m.name || '').trim(), name: m.name || m.display_name || m.id, input_modalities: m.input_modalities || null })).filter(m => m.id);
  } catch (_) { return null; }
}

/** 若用户填的是显示名（如「DeepSeek V4 Flash」），映射到列表中的 id */
function resolveModel(input, list) {
  const v = cleanModel(input);
  if (!v || !list || !list.length) return { id: v, mapped: false };
  if (list.some(m => m.id === v)) return { id: v, mapped: false };
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const ci = list.find(m => m.id.toLowerCase() === v.toLowerCase() || norm(m.name) === norm(v) || norm(m.id) === norm(v));
  if (ci) return { id: ci.id, mapped: true };
  const toks = new Set(norm(v).split(' ').filter(Boolean));
  let best = null, bestScore = 0;
  for (const m of list) {
    const mt = norm(m.id).split(' ').filter(Boolean);
    const words = mt.filter(x => !/^v?\d/.test(x) && toks.has(x)).length; // 只按词（flash/pro）匹配，版本号不计
    const all = mt.filter(x => !/^v?\d/.test(x)).every(x => toks.has(x));
    const score = all ? words + 1 : 0;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best ? { id: best.id, mapped: true } : { id: v, mapped: false };
}

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** 测试连接：使用表单当前值（而非已保存配置），分别校验对话模型与视觉模型 */
async function testConnection(cfg, form = {}) {
  const ai = { ...(cfg.ai || {}) };
  for (const k of ['baseUrl', 'provider']) if (typeof form[k] === 'string' && form[k].trim()) ai[k] = form[k].trim();
  if (typeof form.apiKey === 'string' && form.apiKey.trim() && !form.apiKey.startsWith('••••')) ai.apiKey = form.apiKey.trim();
  const inputModel = cleanModel(form.model != null ? form.model : ai.model);
  const vision = cleanModel(form.visionModel != null ? form.visionModel : ai.visionModel);
  const c = { ...cfg, ai };
  if (!inputModel) return { ok: false, error: '请填写模型 ID（例如 deepseek-flash）。' };
  const list = await listModels(c);
  const { id, mapped } = resolveModel(inputModel, list);
  const out = { ok: false, model: id, inputModel, mapped, models: list ? list.map(m => ({ id: m.id, name: m.name, vision: Array.isArray(m.input_modalities) ? m.input_modalities.includes('image') : null })) : null };
  const t0 = Date.now();
  try {
    const r = await chatCompletion(c, [{ role: 'user', content: '回复“OK”。' }], { model: id, max_tokens: 64, noRetry: true, purpose: 'test' });
    out.ok = true; out.latency = Date.now() - t0;
    out.content = r.content.trim() || (r.reasoning ? '（推理模型，已返回思考内容）' : '（已连通，返回为空）');
  } catch (e) { out.error = e.message; out.latency = Date.now() - t0; return out; }
  if (!vision) { out.vision = { status: 'skip', message: '未填写视觉模型：截屏照常保存，跳过识图。' }; return out; }
  const meta = list && list.find(m => m.id === resolveModel(vision, list).id);
  const vid = list ? resolveModel(vision, list).id : vision;
  if (meta && Array.isArray(meta.input_modalities) && !meta.input_modalities.includes('image')) {
    out.vision = { status: 'warn', model: vid, message: `「${vid}」不支持图像输入，识图将失败。请改用多模态模型或留空。` }; return out;
  }
  try {
    const r = await chatCompletion(c, [{ role: 'user', content: [{ type: 'text', text: '这张图是什么颜色？一句话。' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + PNG_1PX } }] }], { model: vid, max_tokens: 64, noRetry: true, purpose: 'test' });
    out.vision = { status: 'ok', model: vid, message: `视觉模型「${vid}」可接收图像。` + (r.content ? '' : '') };
  } catch (e) {
    out.vision = { status: 'warn', model: vid, message: `视觉模型「${vid}」测试失败：${e.message}` };
  }
  return out;
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

module.exports = { chatCompletion, listModels, resolveModel, testConnection, friendlyError, cleanModel, visionDescribe, parseJsonLoose, applyPreset, PRESETS };
