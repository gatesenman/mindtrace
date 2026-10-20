// 2.3.3 时间线：标题清洗 / 分类 / 任务合并 / 关键对象 / 概览（渲染层逻辑，vm 加载）
const vm = require('vm'), fs = require('fs');
const ctx = { window: {}, document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } }, localStorage: { getItem() { return null; } }, console, URL };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(__dirname + '/../src/renderer/js/timeline.js', 'utf8'), ctx);
const T = ctx.window.TLFeed; const noise = require('../src/core/noise');
let pass = 0, fail = 0; const t = (n, ok, i = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (i ? ' — ' + i : '')); };
const eq = (n, a, b) => t(n, a === b, JSON.stringify(a));
// 标题清洗
eq('Edge 后缀（个人 + 零宽字符）', T.cleanTitle('DeepSeek API 文档 - 个人 - Microsoft\u200b Edge', 'Edge'), 'DeepSeek API 文档');
eq('Edge 和另外 N 个页面', T.cleanTitle('Screenpipe · GitHub 和另外 3 个页面 - 个人 - Microsoft Edge', 'Edge'), 'Screenpipe · GitHub');
eq('Edge 前置未读数', T.cleanTitle('(3) 知乎 - 有问题，就会有答案 - Microsoft Edge', 'Edge'), '知乎 - 有问题，就会有答案');
eq('Chrome 后缀', T.cleanTitle('Issues · repo - Google Chrome', 'Chrome'), 'Issues · repo');
eq('VS Code 后缀 + 未保存标记', T.cleanTitle('● timeline.ts - mindtrace - Visual Studio Code', 'VS Code'), 'timeline.ts - mindtrace');
eq('Cursor 后缀', T.cleanTitle('app.tsx - web - Cursor', 'Cursor'), 'app.tsx - web');
eq('Word 后缀', T.cleanTitle('PRD.docx - Word', 'Word'), 'PRD.docx');
eq('Word 兼容模式', T.cleanTitle('旧合同.doc  -  兼容模式 - Word', 'Word'), '旧合同.doc');
eq('微信群未读数', T.cleanTitle('产品研发群(5)', '微信'), '产品研发群');
eq('微信主窗未读 → 与应用名相同视为空', T.cleanTitle('微信 (12)', '微信'), '');
// 真实一天
const base = new Date('2026-10-20T00:00:00+08:00').getTime();
const rows = noise.sessionize(noise.filter(require('./fixtures/real-day')(base), { now: base + 86400000 }));
const B = T.toBlocks(rows); const find = (re) => B.find(b => re.test(b.summary));
const code1 = find(/在 VS Code 编辑 timeline\.ts/);
t('VS Code 文件级摘要', !!code1, B.map(b => b.summary).join(' | '));
t('编码会话不被短暂 Edge 打断以外的事件拆散（09:16 段含 timeline.ts）', code1 && code1.files.includes('timeline.ts'));
t('剪贴板依附当前编码任务', B.some(b => b.cat === 'code' && b.types.clipboard));
t('项目识别 mindtrace', code1 && code1.projects[0] === 'mindtrace');
const wx = find(/^微信 · 与 产品研发群、张伟 等 3 个会话/);
t('微信：联系人会话（去未读数、过滤图片和视频）', !!wx, B.filter(b => b.cat === 'comm').map(b => b.summary).join(' | '));
t('微信连续窗口合并为一段', wx && wx.items.length === 5);
const web = find(/^浏览 4 个页面：DeepSeek API 文档/);
t('Edge 调研合并 + 标题清洗', !!web, B.filter(b => b.cat === 'web').map(b => b.summary).join(' | '));
t('站点对象提取', web && ['api-docs.deepseek.com', 'github.com', 'timingapp.com', 'zhihu.com'].every(h => web.hosts.includes(h)), web && web.hosts.join(','));
t('会议分类', B.some(b => b.cat === 'meet' && /2\.4 版本评审会/.test(b.summary)));
const doc = find(/在 Word 编辑 MindTrace-PRD-2\.4\.docx/);
t('Office：资源管理器 + Word + Excel 合并为文档任务', doc && doc.apps.join('/') === 'Word/Excel/资源管理器', doc && doc.apps.join('/'));
t('锁屏不进入时间线', !B.some(b => /lock/i.test(b.app)));
const { blocks, idles } = T.toBlocks(require('./fixtures/real-day')(base), { withIdle: true });
t('锁屏计入离开', idles.length === 1 && idles[0].end - idles[0].start === 75 * 60000);
const o = T.overview(blocks, idles);
t('概览：编码占比最高', Object.entries(o.byCat).sort((a, b) => b[1] - a[1])[0][0] === 'code', JSON.stringify(o.byCat));
t('概览：top 应用 VS Code', o.apps[0][0] === 'VS Code');
t('IDE 快照独立成段', B.some(b => b.lone && /今日 3 次提交/.test(b.summary)));
// 旧噪声样本仍然可用
const base2 = new Date('2026-10-12T00:00:00+08:00').getTime();
const B2 = T.toBlocks(noise.sessionize(noise.filter(require('./fixtures/noisy-day')(base2), { now: base2 + 86400000 })));
t('噪声样本：不出现任务切换/开始菜单', !B2.some(b => /任务切换|开始/.test(b.summary)), B2.map(b => b.summary).join(' | '));
t('噪声样本：微信 3 位联系人', B2.some(b => /与 张三、2\.3 发布群 等 3 个会话/.test(b.summary)));
console.log(`timeline-feed: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
