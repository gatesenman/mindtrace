const assert = require('assert');
let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + e.message); } };
const H = require('../src/core/health');

t('snapshot 含 6 项', () => {
  const s = H.snapshot({ privacy: { localOnly: true }, api: { enabled: false, port: 17321 } });
  assert.strictEqual(s.items.length, 6);
  assert.ok(['ok', 'degraded', 'off', 'pending', 'warn', 'error'].includes(s.overall));
  assert.strictEqual(s.verifiedOnWindows, false);
});

t('非 Windows OCR 为 degraded', () => {
  if (process.platform === 'win32') return;
  const o = H.ocrStatus();
  assert.strictEqual(o.state, 'degraded');
  assert.match(o.detail, /Windows/);
});

t('热键 pretty', () => {
  assert.strictEqual(H.pretty('CommandOrControl+Shift+Space'), 'Ctrl+Shift+Space');
});

t('仅本地时闸门 label', () => {
  const g = H.gateStatus({ privacy: { localOnly: true } });
  assert.strictEqual(g.label, '仅本地');
});

t('MCP 未开启', () => {
  const m = H.mcpStatus({ api: { enabled: false, port: 17321 } });
  assert.strictEqual(m.state, 'off');
});

console.log(`r8: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
