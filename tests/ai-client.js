// 单元 + 可选真实 API 测试：DEEPSEEK_KEY 仅从环境变量读取，绝不打印
const assert = require('assert');
const Module = require('module');
const orig = Module._load;
Module._load = function (req, ...a) { if (req === '../pro') throw new Error('no pro'); if (req === '../main/config') return { PRESETS: {} }; return orig.call(this, req, ...a); };
const c = require('../src/ai/client');
let pass = 0, fail = 0;
const t = (name, ok, info = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); };
const L = [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', input_modalities: ['text', 'image'] }, { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', input_modalities: ['text'] }];
t('cleanModel trims', c.cleanModel('  deepseek-flash\u200B ') === 'deepseek-flash');
t('resolve exact id', c.resolveModel('deepseek-flash', L).id === 'deepseek-flash');
t('resolve display name "DeepSeek V4 Flash"', c.resolveModel('DeepSeek V4 Flash', L).id === 'deepseek-flash');
t('resolve display name "DeepSeek-V4-Pro"', c.resolveModel('DeepSeek-V4-Pro', L).id === 'deepseek-v4-pro');
t('friendly 400 model', /模型名「DeepSeek V4 Flash」不被接受.*deepseek-flash/.test(c.friendlyError(400, '{"error":{"message":"supported API model names are deepseek-flash, deepseek-v4-pro, but you passed DeepSeek V4 Flash"}}', 'DeepSeek V4 Flash')));
t('friendly 401', /API Key 无效/.test(c.friendlyError(401, '{"error":{"message":"Authentication Fails"}}', 'x')));
(async () => {
  const key = process.env.DEEPSEEK_KEY;
  if (!key) { console.log('SKIP real API (no DEEPSEEK_KEY)'); }
  else {
    const cfg = { ai: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'stale', model: 'stale-saved-model' } };
    const form = (m, v = '') => ({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: key, model: m, visionModel: v });
    let r = await c.testConnection(cfg, form('deepseek-flash'));
    t('real: deepseek-flash (form value, not stale saved config)', r.ok && r.model === 'deepseek-flash', r.ok ? `${r.latency}ms ${r.content}` : r.error);
    t('real: /models lists ids', !!r.models && r.models.map(m => m.id).includes('deepseek-v4-pro'), (r.models || []).map(m => m.id).join(','));
    r = await c.testConnection(cfg, form('deepseek-v4-pro'));
    t('real: deepseek-v4-pro', r.ok, r.ok ? `${r.latency}ms` : r.error);
    r = await c.testConnection(cfg, form('DeepSeek V4 Flash'));
    t('real: display name auto-mapped to id', r.ok && r.mapped && r.model === 'deepseek-flash', r.error || '');
    r = await c.testConnection(cfg, form('deepseek-v4-pro', 'deepseek-v4-pro'));
    t('real: text-only vision model warned', r.ok && r.vision.status === 'warn', r.vision && r.vision.message);
    r = await c.testConnection(cfg, form('deepseek-flash', ''));
    t('real: empty vision skipped', r.ok && r.vision.status === 'skip');
    const s = await c.chatCompletion({ ai: { baseUrl: 'https://api.deepseek.com/v1', apiKey: key, model: 'deepseek-flash' } }, [{ role: 'user', content: '用 JSON 输出 {"title":"x"}' }], { max_tokens: 64 });
    t('real: small max_tokens → content non-empty after reasoning retry', !!s.content.trim(), `finish=${s.finish} len=${s.content.length}`);
    r = await c.testConnection(cfg, { ...form('deepseek-flash'), apiKey: 'sk-invalid0000' });
    t('real: bad key friendly', !r.ok && /API Key 无效/.test(r.error), r.error);
    const out = JSON.stringify(r) + JSON.stringify(s.raw || {});
    t('key never echoed', !out.includes(key));
  }
  console.log(`ai-client: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
