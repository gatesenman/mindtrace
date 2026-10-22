// 2.4.8 · 内容层：窗口标题解析 / 路径解析 / 正文片段 / 文档聚合 / 健康诊断
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { parseTitle, parseBrowser } = require('../src/content/titleParse');
let n = 0; const t = (name, fn) => { fn(); n++; };
const P = (process, title) => parseTitle({ process, title });

t('Word 中文 + 兼容模式', () => { const r = P('WINWORD', '2026年Q3预算说明.docx [兼容模式] - Word'); assert.strictEqual(r.kind, 'office'); assert.strictEqual(r.doc, '2026年Q3预算说明.docx'); assert.strictEqual(r.ext, 'docx'); });
t('Word 隐藏扩展名 + 已保存', () => { const r = P('WINWORD.EXE', '项目周报 - 已保存到此电脑 - Word'); assert.strictEqual(r.doc, '项目周报'); assert.strictEqual(r.ext, ''); });
t('Word 新文档', () => { assert.ok(P('WINWORD', '文档1 - Word').unsaved); });
t('Excel 只读', () => { const r = P('EXCEL', '销售数据-10月.xlsx  [只读] - Excel'); assert.strictEqual(r.doc, '销售数据-10月.xlsx'); });
t('PowerPoint', () => { assert.strictEqual(P('POWERPNT', '知迹产品发布会.pptx - PowerPoint').doc, '知迹产品发布会.pptx'); });
t('WPS 文字', () => { const r = P('wps', '合同草案v3.docx - WPS Office'); assert.strictEqual(r.kind, 'wps'); assert.strictEqual(r.doc, '合同草案v3.docx'); });
t('WPS 首页忽略', () => { assert.strictEqual(P('wps', 'WPS Office'), null); });
t('VS Code 未保存 + 项目', () => { const r = P('Code', '● store.js - mindtrace - Visual Studio Code'); assert.strictEqual(r.kind, 'code'); assert.strictEqual(r.doc, 'store.js'); assert.strictEqual(r.project, 'mindtrace'); });
t('VS Code 管理员', () => { const r = P('Code', 'main.py - spider [管理员] - Visual Studio Code'); assert.strictEqual(r.doc, 'main.py'); assert.strictEqual(r.project, 'spider'); });
t('Cursor 欢迎页', () => { assert.strictEqual(P('Cursor', 'Welcome - Cursor').doc, ''); });
t('记事本 Win11', () => { const r = P('Notepad', '*会议纪要.txt - 记事本'); assert.strictEqual(r.doc, '会议纪要.txt'); });
t('Notepad++ 完整路径', () => { const r = P('notepad++', 'D:\\work\\notes\\todo.md - Notepad++'); assert.strictEqual(r.path, 'D:\\work\\notes\\todo.md'); assert.strictEqual(r.doc, 'todo.md'); });
t('Acrobat', () => { const r = P('Acrobat', '论文-注意力机制.pdf - Adobe Acrobat Reader (64-bit)'); assert.strictEqual(r.kind, 'pdf'); assert.strictEqual(r.doc, '论文-注意力机制.pdf'); });
t('SumatraPDF', () => { assert.strictEqual(P('SumatraPDF', 'manual.pdf - SumatraPDF').doc, 'manual.pdf'); });
t('资源管理器', () => { const r = P('explorer', 'D:\\项目\\知迹'); assert.strictEqual(r.kind, 'explorer'); assert.strictEqual(r.doc, '知迹'); });
t('Edge 中文 + 个人', () => { const r = P('msedge', 'DeepSeek API 文档 - 个人 - Microsoft​ Edge'); assert.strictEqual(r.kind, 'browser'); assert.strictEqual(r.page, 'DeepSeek API 文档'); });
t('Edge 多页', () => { const r = P('msedge', 'GitHub - electron/electron 和另外 5 个页面 - 个人 - Microsoft Edge'); assert.strictEqual(r.page, 'GitHub - electron/electron'); });
t('Chrome', () => { assert.strictEqual(P('chrome', '知乎 - 有问题，就会有答案 - Google Chrome').page, '知乎 - 有问题，就会有答案'); });
t('Office 网页版', () => { const r = P('msedge', '年度计划.xlsx - Microsoft Excel Online - 个人 - Microsoft Edge'); assert.ok(r.doc.startsWith('年度计划'), JSON.stringify(r)); });
t('飞书云文档', () => { const r = P('chrome', '产品需求文档 PRD - 飞书云文档 - Google Chrome'); assert.strictEqual(r.doc, '产品需求文档 PRD'); assert.ok(r.cloudDoc); });
t('新标签页', () => { assert.strictEqual(P('chrome', '新标签页 - Google Chrome').page, ''); });
t('微信主窗口', () => { const r = P('WeChat', '微信'); assert.strictEqual(r.kind, 'chat'); assert.strictEqual(r.chat, ''); });
t('微信会话窗口', () => { assert.strictEqual(P('WeChat', '产品研发群').chat, '产品研发群'); });
t('通用兜底', () => { const r = P('XMind', 'XMind - 设计稿.xmind'); assert.strictEqual(r.doc, '设计稿.xmind'); });
t('空标题', () => { assert.strictEqual(P('WINWORD', ''), null); });

// ── 路径解析 ──
const R = require('../src/content/docResolver');
t('命令行解析', () => {
  assert.strictEqual(R.fromCmdline('"C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE" /n "D:\\工作\\预算.docx" /o ""', '预算.docx'), 'D:\\工作\\预算.docx');
  assert.strictEqual(R.fromCmdline('"C:\\notepad.exe" C:\\a\\b.txt', 'b'), 'C:\\a\\b.txt');
  assert.strictEqual(R.fromCmdline('"C:\\WINWORD.EXE"', 'x.docx'), null);
});
t('Office MRU 输出解析', () => {
  const out = `HKEY_CURRENT_USER\\Software\\Microsoft\\Office\\16.0\\Word\\User MRU\\ADAL_X\\File MRU\r\n    Item 1    REG_SZ    [F00000000][T01DB2A1B2C3D4E5F][O00000000]*D:\\工作\\Q3 预算说明.docx\r\n    Item 2    REG_SZ    [F00000000][T01DB][O00000000]*\\\\nas\\share\\周报.xlsx\r\n`;
  assert.deepStrictEqual(R.parseMruOutput(out), ['D:\\工作\\Q3 预算说明.docx', '\\\\nas\\share\\周报.xlsx']);
});
t('GBK 控制台输出解码', () => {
  const gbk = Buffer.from([0xb9, 0xa4, 0xd7, 0xf7]); // "工作"
  assert.strictEqual(R.decodeConsole(gbk), '工作');
  assert.strictEqual(R.decodeConsole(Buffer.from('abc')), 'abc');
});

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-r10-'));
  const proj = path.join(tmp, 'mindtrace'); fs.mkdirSync(path.join(proj, 'src', 'main'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'main', 'store.js'), '// store\nfunction insertActivity() {}\n');
  fs.mkdirSync(path.join(proj, 'node_modules', 'x'), { recursive: true }); fs.writeFileSync(path.join(proj, 'node_modules', 'x', 'store.js'), 'nope');
  const md = path.join(tmp, '会议纪要.md'); fs.writeFileSync(md, '# 周会\n\n- 决定 10 月 30 日发布 2.4.8\n- 张三负责安装包签名\n');
  // 1) 标题绝对路径
  let r = await R.resolvePath({ kind: 'text', doc: '会议纪要.md', path: md }); assert.deepStrictEqual(r, { path: md, via: 'title' });
  // 2) 工作区内按名查找（跳过 node_modules）
  r = await R.resolvePath({ kind: 'code', doc: 'store.js', project: 'mindtrace' }, { workspaces: [proj], recentDir: tmp });
  assert.strictEqual(r.via, 'workspace'); assert.ok(!r.path.includes('node_modules')); n++;
  // 3) MRU（注入列表）+ checkExists
  r = await R.resolvePath({ kind: 'office', doc: 'Q3 预算说明', ext: '' }, { mru: ['D:\\工作\\Q3 预算说明.docx'], checkExists: () => true, recentDir: tmp });
  assert.strictEqual(r.via, 'mru'); n++;
  // 4) .lnk 最近使用（注入解析器）
  const lnk = require('../src/common/lnk'); fs.writeFileSync(path.join(tmp, '会议纪要.md.lnk'), 'x');
  lnk.resolveLnk._impl = (f) => /会议纪要/.test(f) ? { ok: true, target: md } : { ok: false };
  R._reset();
  r = await R.resolvePath({ kind: 'text', doc: '会议纪要.md' }, { recentDir: tmp }); assert.deepStrictEqual(r, { path: md, via: 'recent' }); n++;
  delete lnk.resolveLnk._impl;
  // 正文片段：md / docx(不存在→空) / xlsx / pptx（用 jszip 现造）
  let s = await R.extractSnippet(md); assert.ok(s.includes('2.4.8') && s.length <= 1500); n++;
  const JSZip = require('jszip');
  const xz = new JSZip(); xz.file('xl/workbook.xml', '<workbook><sheets><sheet name="十月" sheetId="1"/></sheets></workbook>'); xz.file('xl/sharedStrings.xml', '<sst><si><t>客户</t></si><si><t>金额</t></si></sst>');
  const xf = path.join(tmp, 'a.xlsx'); fs.writeFileSync(xf, await xz.generateAsync({ type: 'nodebuffer' }));
  s = await R.extractSnippet(xf); assert.ok(/十月/.test(s) && /客户 \| 金额/.test(s), s); n++;
  const pz = new JSZip(); pz.file('ppt/slides/slide1.xml', '<p:sld><a:p><a:r><a:t>知迹发布</a:t></a:r></a:p></p:sld>'); pz.file('ppt/slides/slide2.xml', '<a:t>路线图</a:t>');
  const pf = path.join(tmp, 'b.pptx'); fs.writeFileSync(pf, await pz.generateAsync({ type: 'nodebuffer' }));
  s = await R.extractSnippet(pf); assert.ok(/\[1\] 知迹发布/.test(s) && /\[2\] 路线图/.test(s), s); n++;
  const gb = path.join(tmp, 'gbk.txt'); fs.writeFileSync(gb, Buffer.concat([Buffer.from([0xb9, 0xa4, 0xd7, 0xf7, 0xbc, 0xc6, 0xbb, 0xae])])); // 工作计划
  s = await R.extractSnippet(gb); assert.strictEqual(s, '工作计划'); n++;

  // enrichWindow：用内存假 store
  const rows = new Map();
  const fake = {
    get: (sql, [id]) => rows.get(id), all: (sql, [a, b]) => [...rows.values()].filter(x => x.type === 'browser' && x.started_at >= a && x.started_at <= b),
    run: (sql, args) => {
      const id = args[args.length - 1]; const row = rows.get(id);
      if (/SET meta=\?, file_path=COALESCE/.test(sql)) { row.meta = args[0]; row.file_path = row.file_path || args[1]; row.content = row.content || args[2]; }
      else if (/SET url=/.test(sql)) row.url = args[0];
      else if (/SET content=\?, meta=\?/.test(sql)) { row.content = args[0]; row.meta = args[1]; }
    }
  };
  const diag = require('../src/content/diag'); diag.reset();
  const E = require('../src/content/enrich');
  rows.set('w1', { id: 'w1', type: 'window', started_at: 1000, process_name: 'notepad', app_name: '记事本', window_title: `${md} - 记事本`, meta: '{}' });
  const cfgOn = { collectors: { window: true, documents: true }, privacy: {} };
  await E.enrichWindow('w1', rows.get('w1'), { cfg: cfgOn, st: fake });
  assert.strictEqual(rows.get('w1').file_path, md); assert.ok(/张三/.test(rows.get('w1').content)); assert.strictEqual(JSON.parse(rows.get('w1').meta).doc.name, '会议纪要.md'); n++;
  // 未授权正文 → 只记名字和路径，不读正文
  rows.set('w2', { id: 'w2', type: 'window', started_at: 1000, process_name: 'notepad', app_name: '记事本', window_title: `${md} - 记事本`, meta: '{}' });
  await E.enrichWindow('w2', rows.get('w2'), { cfg: { collectors: { window: true } }, st: fake });
  assert.strictEqual(rows.get('w2').file_path, md); assert.ok(!rows.get('w2').content); n++;
  // 敏感内容 → 隐私跳过
  const pw = path.join(tmp, '账号.txt'); fs.writeFileSync(pw, 'password: hunter2hunter2\napi_key=sk-abcdefabcdefabcdefabcdefabcdef12');
  rows.set('w3', { id: 'w3', type: 'window', started_at: 1000, process_name: 'notepad', app_name: '记事本', window_title: `${pw} - 记事本`, meta: '{}' });
  await E.enrichWindow('w3', rows.get('w3'), { cfg: cfgOn, st: fake });
  assert.ok(!rows.get('w3').content, '敏感正文不应入库'); n++;
  // 浏览器补 URL
  rows.set('b1', { id: 'b1', type: 'browser', started_at: 60000, url: 'https://api-docs.deepseek.com/zh-cn/', window_title: 'DeepSeek API 文档' });
  rows.set('w4', { id: 'w4', type: 'window', started_at: 30000, duration_ms: 90000, process_name: 'msedge', app_name: 'Edge', window_title: 'DeepSeek API 文档 - 个人 - Microsoft Edge', meta: '{}' });
  await E.enrichWindow('w4', rows.get('w4'), { cfg: cfgOn, st: fake });
  assert.strictEqual(E.joinBrowser('w4', { st: fake }), 'https://api-docs.deepseek.com/zh-cn/'); n++;
  // UIA 文本挂到窗口
  rows.set('w5', { id: 'w5', type: 'window', started_at: 1000, process_name: 'WeChat', app_name: '微信', window_title: '产品研发群', meta: '{}' });
  assert.ok(E.attachText('w5', '产品研发群\n李四：周五前把发布说明发我\n我：好的，周四给你初稿', 'uia', { cfg: cfgOn, st: fake }));
  assert.ok(/发布说明/.test(rows.get('w5').content) && !/^产品研发群/.test(rows.get('w5').content)); n++;
  const d = diag.snapshot(); assert.ok(d.windows >= 4 && d.docNamed >= 3 && d.pathResolved >= 2 && d.snippet >= 1 && d.browserJoined === 1 && d.privacySkipped >= 1, JSON.stringify(d)); n++;

  // 文档聚合 → 日报 / 提示词
  const DD = require('../src/content/docDigest');
  const list = DD.digest([
    { ...rows.get('w1'), duration_ms: 20 * 60000 }, { ...rows.get('w4') }, { ...rows.get('w5'), duration_ms: 5 * 60000 },
    { type: 'window', process_name: 'WINWORD', app_name: 'Word', window_title: '预算.docx - Word', duration_ms: 30 * 60000 },
    { type: 'window', process_name: 'explorer', app_name: '资源管理器', window_title: 'D:\\x', duration_ms: 60000 }
  ]);
  assert.strictEqual(list[0].name, '预算.docx'); assert.ok(list.some(x => x.name === '会议纪要.md' && /张三/.test(x.snippet))); assert.ok(list.some(x => x.kind === 'chat' && x.name === '产品研发群')); assert.ok(!list.some(x => x.kind === 'explorer')); n++;
  const pr = DD.toPrompt(list); assert.ok(/\[文档\] 预算.docx \(Word\) 30分钟/.test(pr) && /内容：/.test(pr), pr); n++;

  // 健康诊断
  const H = require('../src/core/health');
  const c = H.contentStatus({ collectors: { window: true, documents: true } });
  assert.strictEqual(c.key, 'content'); assert.strictEqual(c.state, 'ok'); assert.ok(/窗口 \d+ → 文档名/.test(c.detail)); n++;
  assert.strictEqual(H.contentStatus({ collectors: { window: true } }).state, 'degraded'); n++;
  const snap = H.snapshot({ collectors: { window: true, documents: true } }); assert.strictEqual(snap.items[0].key, 'content'); assert.ok([...snap.items[0].short].length <= H.SHORT_MAX); n++;

  // PsHost 首请求宽限
  const { PsHost } = require('../src/common/psHost');
  const h = new PsHost({ name: 'x', script: '', timeoutMs: 100 }); assert.strictEqual(h.firstTimeoutMs, 15000); n++;
  console.log(`r10 ok · ${n} checks`);
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(1); });
