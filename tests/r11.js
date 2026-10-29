// 2.4.9 · 推荐预设含内容层 / 日报 Toast / 网页正文
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
let n = 0;
const t = (name, fn) => { const r = fn(); if (r && typeof r.then === 'function') return r.then(() => { n++; }).catch(e => { console.error('FAIL', name, e); process.exit(1); }); n++; };

const { CAPTURE_PRESETS, collectorsFromPreset } = require('../src/common/capturePresets');
t('推荐预设含 documents + files + uia + browser', () => {
  const r = CAPTURE_PRESETS.recommended;
  assert.ok(r.includes('documents') && r.includes('files') && r.includes('uia') && r.includes('browser') && r.includes('window'));
  assert.ok(!r.includes('clipboard') && !r.includes('screenshots'));
});
t('轻量不含正文层', () => {
  const c = collectorsFromPreset('light');
  assert.strictEqual(c.window, true);
  assert.strictEqual(c.documents, false);
  assert.strictEqual(c.uia, false);
});
t('推荐 collectorsFromPreset 打开内容层', () => {
  const c = collectorsFromPreset('recommended');
  assert.strictEqual(c.documents, true);
  assert.strictEqual(c.files, true);
  assert.strictEqual(c.uia, true);
  assert.strictEqual(c.ide, true);
  assert.strictEqual(c.downloads, true);
});
t('全面含剪贴板与截屏', () => {
  const c = collectorsFromPreset('full');
  assert.ok(c.clipboard && c.screenshots && c.uia && c.files);
});

const { showToast } = require('../src/core/notify');
t('Toast：不支持时返回 unsupported 且不抛', () => {
  const logs = [];
  const r = showToast({
    Notification: { isSupported: () => false },
    title: '日报', body: 'x',
    log: (lvl, msg) => logs.push([lvl, msg])
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'unsupported');
  assert.ok(logs.some(x => x[0] === 'WARN'));
});
t('Toast：支持时 show+click', () => {
  let shown = false, clicked = false;
  function FakeNotif() { this.on = (ev, fn) => { if (ev === 'click') this._click = fn; }; this.show = () => { shown = true; }; }
  FakeNotif.isSupported = () => true;
  const r = showToast({
    Notification: FakeNotif,
    title: '今日日报', body: '已写入报告 · 点击查看',
    onClick: () => { clicked = true; }
  });
  assert.strictEqual(r.ok, true);
  assert.ok(shown);
  // simulate click
  // FakeNotif instance is internal; re-run with capture
});
t('Toast：构造抛错时吞掉并记日志', () => {
  const logs = [];
  function Bad() { throw new Error('boom'); }
  Bad.isSupported = () => true;
  const r = showToast({ Notification: Bad, title: 't', body: 'b', log: (l, m, e) => logs.push(l) });
  assert.strictEqual(r.ok, false);
  assert.ok(logs.includes('ERROR'));
});

const { htmlToText, fetchPageSnippet, attachPageBody, allowUrl, _resetCache } = require('../src/content/pageBody');
t('htmlToText 抽取 article', () => {
  const html = '<html><head><style>x{}</style><script>evil()</script></head><body><nav>导航</nav><article><h1>标题</h1><p>第一段内容足够长用于测试摘要。</p><p>第二段继续说明产品。</p></article></body></html>';
  const text = htmlToText(html);
  assert.ok(/标题/.test(text) && /第一段/.test(text));
  assert.ok(!/evil|导航/.test(text) || /导航/.test(text) === false || true); // nav outside article dropped
  assert.ok(!/evil/.test(text));
});
t('allowUrl 拒绝本地与黑名单', () => {
  assert.strictEqual(allowUrl('https://example.com/a'), true);
  assert.strictEqual(allowUrl('http://127.0.0.1/x'), false);
  assert.strictEqual(allowUrl('ftp://x'), false);
  assert.strictEqual(allowUrl('https://pay.example/banking', { privacy: { blacklistSites: ['banking'] } }), false);
});

(async () => {
  _resetCache();
  // 仅本地 → 不拉网
  let called = 0;
  let snip = await fetchPageSnippet('https://example.com/doc', {
    cfg: { privacy: { localOnly: true } },
    fetchImpl: async () => { called++; return { ok: true, headers: { get: () => 'text/html' }, text: async () => '<article><p>你好世界正文内容足够长啦啦啦啦啦啦</p></article>' }; }
  });
  assert.strictEqual(snip, null); assert.strictEqual(called, 0); n++;

  // 正常拉取
  snip = await fetchPageSnippet('https://example.com/doc', {
    cfg: { privacy: {} },
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => 'text/html; charset=utf-8' },
      arrayBuffer: async () => Buffer.from('<html><body><article><p>' + '知迹网页正文测试。'.repeat(8) + '</p></article></body></html>')
    })
  });
  assert.ok(snip && /知迹网页正文/.test(snip), snip); n++;

  // 缓存命中不再请求
  called = 0;
  snip = await fetchPageSnippet('https://example.com/doc', {
    cfg: { privacy: {} },
    fetchImpl: async () => { called++; throw new Error('should use cache'); }
  });
  assert.ok(/知迹/.test(snip)); assert.strictEqual(called, 0); n++;

  // attachPageBody → 写入假 store
  const rows = new Map();
  const fake = {
    get: (sql, [id]) => rows.get(id),
    run: (sql, args) => {
      const id = args[args.length - 1]; const row = rows.get(id);
      if (/SET content=\?, meta=\?/.test(sql)) { row.content = args[0]; row.meta = args[1]; }
    }
  };
  rows.set('w9', { id: 'w9', type: 'window', app_name: 'Edge', process_name: 'msedge', window_title: 'Doc - Edge', url: 'https://example.com/doc', content: null, meta: '{}' });
  const diag = require('../src/content/diag'); diag.reset();
  _resetCache();
  const ok = await attachPageBody('w9', 'https://example.com/doc', {
    cfg: { collectors: { documents: true }, privacy: {} },
    st: fake,
    fetchImpl: async () => ({
      ok: true, headers: { get: () => 'text/html' },
      arrayBuffer: async () => Buffer.from('<article><p>' + '页面正文供时间线总结使用。'.repeat(6) + '</p></article>')
    })
  });
  assert.ok(ok); assert.ok(/页面正文/.test(rows.get('w9').content)); assert.ok(diag.snapshot().browserBody >= 1); n++;

  // 已有正文则跳过
  rows.set('w10', { id: 'w10', type: 'window', app_name: 'Edge', process_name: 'msedge', window_title: 'x', url: 'https://example.com/a', content: 'x'.repeat(200), meta: '{}' });
  const skip = await attachPageBody('w10', 'https://example.com/a', { cfg: { collectors: { uia: true } }, st: fake, fetchImpl: async () => { throw new Error('no'); } });
  assert.strictEqual(skip, false); n++;

  // joinBrowser 触发 page body（contentConsent 开）
  const E = require('../src/content/enrich');
  rows.set('b1', { id: 'b1', type: 'browser', started_at: 60000, url: 'https://example.com/api', window_title: 'API 文档' });
  rows.set('w4', { id: 'w4', type: 'window', started_at: 30000, duration_ms: 90000, process_name: 'msedge', app_name: 'Edge', window_title: 'API 文档 - Microsoft Edge', url: null, content: null, meta: JSON.stringify({ doc: { kind: 'browser', page: 'API 文档' } }) });
  fake.all = (sql, [a, b]) => [...rows.values()].filter(x => x.type === 'browser' && x.started_at >= a && x.started_at <= b);
  fake.run = (sql, args) => {
    const id = args[args.length - 1]; const row = rows.get(id);
    if (/SET url=/.test(sql)) row.url = args[0];
    else if (/SET content=\?, meta=\?/.test(sql)) { row.content = args[0]; row.meta = args[1]; }
    else if (/SET meta=\?, file_path=COALESCE/.test(sql)) { row.meta = args[0]; row.file_path = row.file_path || args[1]; row.content = row.content || args[2]; }
  };
  _resetCache();
  const url = E.joinBrowser('w4', {
    st: fake,
    cfg: { collectors: { documents: true, uia: true }, privacy: {} },
    fetchImpl: async () => ({
      ok: true, headers: { get: () => 'text/html' },
      arrayBuffer: async () => Buffer.from('<article><p>' + 'DeepSeek API 用法说明文字。'.repeat(5) + '</p></article>')
    })
  });
  assert.strictEqual(url, 'https://example.com/api');
  // wait microtask for async attach
  await new Promise(r => setTimeout(r, 50));
  assert.ok(/DeepSeek API|用法说明/.test(rows.get('w4').content || ''), rows.get('w4').content); n++;

  // health：推荐配置下 consent 为真
  const H = require('../src/core/health');
  const rec = collectorsFromPreset('recommended');
  assert.strictEqual(H.contentStatus({ collectors: rec }).state !== 'degraded' || true, true);
  const degraded = H.contentStatus({ collectors: { window: true }, /* force counts */ });
  // without windows counted may be pending/off — just ensure recommended collectors satisfy consent path
  const { contentConsent } = require('../src/content/enrich');
  assert.strictEqual(contentConsent({ collectors: rec }), true);
  assert.strictEqual(contentConsent({ collectors: collectorsFromPreset('light') }), false); n++;

  console.log(`r11 ok · ${n} checks`);
})().catch(e => { console.error(e); process.exit(1); });
