// 时间线分块/摘要（渲染层逻辑，vm 加载）
const vm = require('vm'), fs = require('fs');
const ctx = { window: {}, document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } }, localStorage: { getItem() { return null; } }, console };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(__dirname + '/../src/renderer/js/timeline.js', 'utf8'), ctx);
const T = ctx.window.TLFeed; const noise = require('../src/core/noise');
const base = new Date('2026-10-12T00:00:00+08:00').getTime();
const rows = noise.sessionize(noise.filter(require('./fixtures/noisy-day')(base), { now: base + 86400000 }));
const B = T.toBlocks(rows);
let pass = 0, fail = 0; const t = (n, ok, i = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (i ? ' — ' + i : '')); };
const wx = B.find(b => b.app === '微信');
t('微信块：一句话摘要含联系人数', wx && /与 3 位联系人/.test(wx.summary), wx && wx.summary);
t('Edge 窗口+网页合并为一个块', B.filter(b => b.app === 'Edge' && b.kind === 'web').every(b => b.items.length >= 2), B.filter(b => b.app === 'Edge').map(b => b.items.length).join(','));
t('VS Code 摘要含文件与项目', B.some(b => /编辑 noise\.js（mindtrace）/.test(b.summary)));
t('剪贴板摘要含来源', B.some(b => /^从 Edge 复制了/.test(b.summary)));
t('IDE 摘要结构化', B.some(b => /3 个工作区，今日 2 次提交/.test(b.summary)));
t('时长取窗口驻留合计', wx && Math.round(wx.dur / 60000) === 12, wx && wx.dur);
console.log(`timeline-feed: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
