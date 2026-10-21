// 2.4 R1：出网闸门 / 常驻进程宿主 / 本地 OCR 管线 / 文本去重（纯 node）
const assert = require('assert');
const Module = require('module'); const _ld = Module._load;
Module._load = function (req, ...a) { if (req === '../pro') throw new Error('no pro'); if (req === '../main/config') return { PRESETS: {} }; return _ld.call(this, req, ...a); };
const { spawn } = require('child_process');
let pass = 0, fail = 0; const t = async (n, fn) => { try { await fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + e.message); } };
const gate = require('../src/net/gate');
const fake = (lines) => () => spawn(process.execPath, ['-e', `const rl=require('readline').createInterface({input:process.stdin});rl.on('line',l=>{ if(l==='__probe__') return console.log(JSON.stringify({ok:true,langs:['zh-Hans-CN','en-US'],lang:'zh-Hans-CN'})); if(l.includes('hang')) return; if(l.includes('crash')) process.exit(3); console.log(JSON.stringify({ok:true,lines:${JSON.stringify(lines)}})); });`]);
(async () => {
  await t('仅本地：外部地址被拦截且不调用 fetch', async () => {
    gate._reset(); let called = 0;
    await assert.rejects(gate.gatedFetch('https://api.deepseek.com/v1/chat/completions', {}, { cfg: { privacy: { localOnly: true } }, purpose: 'llm:chat', fetchImpl: () => { called++; } }), e => e.blocked);
    assert.strictEqual(called, 0); assert.strictEqual(gate.getStats().blocked, 1);
  });
  await t('仅本地：127.0.0.1 / localhost 放行并计为本机', async () => {
    gate._reset();
    await gate.gatedFetch('http://127.0.0.1:11434/v1/x', {}, { cfg: { privacy: { localOnly: true } }, fetchImpl: async () => 'ok' });
    await gate.gatedFetch('http://localhost:3921/v1/x', {}, { cfg: { privacy: { localOnly: true } }, fetchImpl: async () => 'ok' });
    const s = gate.getStats(); assert.strictEqual(s.local, 2); assert.strictEqual(s.external, 0);
  });
  await t('关闭仅本地：外发计数 +1，按用途分账', async () => {
    gate._reset();
    await gate.gatedFetch('https://example.com/favicon.ico', {}, { cfg: {}, purpose: 'favicon', fetchImpl: async () => 'ok' });
    const s = gate.getStats(); assert.strictEqual(s.external, 1); assert.strictEqual(s.byPurpose.favicon.allowed, 1);
  });
  await t('关闭网站图标 → favicon 被拦', async () => { assert.strictEqual(gate.check('https://a.com', { privacy: { fetchFavicons: false } }, 'favicon').ok, false); });
  await t('AI 客户端走闸门：仅本地下 chatCompletion 直接报错', async () => {
    gate._reset();
    const { chatCompletion } = require('../src/ai/client');
    const realFetch = globalThis.fetch; let called = 0; globalThis.fetch = async () => { called++; throw new Error('should not'); };
    try { await assert.rejects(chatCompletion({ ai: { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'x', model: 'deepseek-flash' }, privacy: { localOnly: true } }, [{ role: 'user', content: 'hi' }]), /仅本地/); }
    finally { globalThis.fetch = realFetch; }
    assert.strictEqual(called, 0);
  });
  await t('源码里除闸门外没有裸 fetch（防回归）', async () => {
    const out = require('child_process').execSync(`grep -rn "fetch(" src --include=*.js | grep -v "gatedFetch\\|renderer/\\|src/net/gate.js" || true`).toString().trim();
    assert.strictEqual(out, '', out);
  });
  const { PsHost } = require('../src/common/psHost');
  await t('常驻宿主：多次请求只拉起 1 个进程，串行返回', async () => {
    const h = new PsHost({ name: 't', spawnImpl: fake(['a']), idleExitMs: 0 });
    const r = await Promise.all([h.request('1'), h.request('2'), h.request('3')]);
    assert.strictEqual(r.length, 3); assert.strictEqual(h.info().spawns, 1); h.stop();
  });
  await t('常驻宿主：超时后自动重启并继续服务', async () => {
    const h = new PsHost({ name: 't', spawnImpl: fake(['a']), timeoutMs: 400, idleExitMs: 0 });
    await assert.rejects(h.request('hang'), /超时/);
    const r = await h.request('ok'); assert.ok(r.ok); assert.strictEqual(h.info().spawns, 2); h.stop();
  });
  await t('常驻宿主：进程崩溃 → 报错并重启', async () => {
    const h = new PsHost({ name: 't', spawnImpl: fake(['a']), idleExitMs: 0 });
    await assert.rejects(h.request('crash'), /退出/); assert.ok((await h.request('x')).ok); h.stop();
  });
  await t('常驻宿主：空闲自动退出', async () => {
    const h = new PsHost({ name: 't', spawnImpl: fake(['a']), idleExitMs: 150 });
    await h.request('x'); assert.ok(h.info().alive); await new Promise(r => setTimeout(r, 300)); assert.ok(!h.info().alive);
  });
  const w = require('../src/ocr/winocr');
  await t('本地 OCR：汉字间空格被合并、重复行去掉、缓存命中', async () => {
    w._inject(fake(['会 议 纪 要 ： 周 五 发 布 v2.4', '会 议 纪 要 ： 周 五 发 布 v2.4', '|', 'Open MindTrace 设 置']));
    const a = await w.recognize('C:/x.png', { key: 'h1' });
    assert.deepStrictEqual(a.lines, ['会议纪要：周五发布 v2.4', 'Open MindTrace 设置']);
    const b = await w.recognize('C:/x.png', { key: 'h1' }); assert.ok(b.cached);
    assert.strictEqual(w.info().requests, 1);
    const p = await w.probe(); assert.ok(p.ok); assert.strictEqual(p.lang, 'zh-Hans-CN'); w.stop();
  });
  await t('PowerShell OCR 脚本包含 WinRT 关键调用', async () => { for (const k of ['Windows.Media.Ocr.OcrEngine', 'TryCreateFromLanguage', 'IAsyncOperation`1', 'RecognizeAsync', 'ReadLine']) assert.ok(w.SCRIPT.includes(k), k); });
  const d = require('../src/ocr/textdedup');
  await t('文本去重：光标/时间变化的帧判为重复，换页不判重复', async () => {
    const a = '项目周报\n本周完成：时间线重做、降噪\n下周计划：本地 OCR\n10:31';
    assert.ok(d.similarity(a, a.replace('10:31', '10:32')) > 0.92);
    assert.ok(d.similarity(a, '微信 张伟：明天下午三点评审\n收到') < 0.3);
    assert.deepStrictEqual(d.delta(['a', 'b'], ['a', 'b', 'c']), ['c']);
  });
  console.log(`r1: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
