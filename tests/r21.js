require('./stub-electron');
// 2.5 加固 R4 · AI 摘要的隐私和输入预算
const assert = require('assert');
const { redactText, detectSensitive } = require('../src/privacy/redact');
const S = require('../src/content/sessionSummary');
const { formatActivities, buildClusterPayload, PROMPT_MAX_CHARS } = require('../src/ai/summarizer');

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + (e.stack || e.message)); } };

t('github_pat_ / glpat 与旧的 ghp_ 一样被脱敏，并被 detectSensitive 识别', () => {
  const pat = 'github_pat_abcdefghijklmnopqrstuvwxyz0123456789ABCD';
  const gl = 'glpat-' + 'a'.repeat(24);
  const out = redactText('token ' + pat + ' and ' + gl);
  assert.doesNotMatch(out, /github_pat_/);
  assert.doesNotMatch(out, /glpat-aaaa/);
  assert.match(out, /敏感-Key/);
  const hits = detectSensitive('leak ' + pat);
  assert.ok(hits.includes('api-key'), JSON.stringify(hits));
});

t('eventLine / redactUrl 去掉 URL 里的 access_token，不把密钥送进模型', () => {
  const u = S.redactUrl('https://api.example.com/callback?access_token=supersecret&ok=1');
  assert.match(u, /REDACTED/);
  assert.doesNotMatch(u, /supersecret/);
  const line = S.eventLine({
    started_at: Date.parse('2026-10-21T09:00:00+08:00'),
    type: 'browser', app_name: 'Edge', window_title: 'OAuth',
    url: 'https://api.example.com/cb?token=abc123secret',
    content: 'sk-abcdefghijklmnopqrstuvwxyz123456 正常正文'
  });
  assert.doesNotMatch(line, /abc123secret/);
  assert.doesNotMatch(line, /sk-abcdefghijklmnopqrstuvwxyz123456/);
  assert.match(line, /敏感/);
});

t('formatActivities 遵守总字符预算，超长明细被截断', () => {
  const rows = [];
  for (let i = 0; i < 80; i++) {
    rows.push({
      id: 'r' + i, type: 'window', started_at: Date.parse('2026-10-21T09:00:00+08:00') + i * 60000,
      duration_ms: 60000, app_name: 'Word', process_name: 'WINWORD',
      window_title: `文档${i}.docx - Word`,
      file_path: `D:\\\\工作\\\\文档${i}.docx`,
      content: '这是一段相当长的正文，用来把提示词撑过预算。' + '字'.repeat(80),
      meta: JSON.stringify({ doc: { kind: 'office', name: `文档${i}.docx` } })
    });
  }
  const out = formatActivities(rows, 80, { maxChars: 2000 });
  assert.ok(out.length <= 2000, out.length);
  assert.ok(out.length > 200, out.length);
});

t('clusterTopics 载荷在送出前脱敏卡片与活动正文，并截断长度', () => {
  const cards = [{ id: 'c1', title: '密钥备份', kind: 'note', summary: 'github_pat_abcdefghijklmnopqrstuvwxyz0123456789ABCD 存在记事本' }];
  const acts = [{ app_name: '记事本', type: 'window', window_title: 'keys.txt', content: 'sk-abcdefghijklmnopqrstuvwxyz123456 还有一大段 ' + '密'.repeat(500) }];
  const payload = buildClusterPayload(cards, acts, { max: 1500 });
  assert.ok(payload.length <= 1500, payload.length);
  assert.doesNotMatch(payload, /github_pat_/);
  assert.doesNotMatch(payload, /sk-abcdefghijklmnopqrstuvwxyz123456/);
  assert.match(payload, /敏感-Key/);
});

t('PROMPT_MAX_CHARS 默认上限存在且合理', () => {
  assert.ok(PROMPT_MAX_CHARS >= 4000 && PROMPT_MAX_CHARS <= 20000);
});

console.log(`r21: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
