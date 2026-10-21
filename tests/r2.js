// 2.4 R2：六层信号 / 统一信封 / 对象级去重 / 常驻 UIA（纯 node）
const assert = require('assert'); const { spawn } = require('child_process');
let pass = 0, fail = 0; const t = async (n, fn) => { try { await fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + e.message); } };
const S = require('../src/core/signal');
const T0 = new Date('2026-10-22T10:00:00+08:00').getTime();
(async () => {
  await t('类型 → 六层映射', () => {
    assert.strictEqual(S.layerOf({ type: 'window', app_name: 'VS Code' }), 'focus');
    assert.strictEqual(S.layerOf({ type: 'uia', app_name: 'Edge' }), 'content');
    assert.strictEqual(S.layerOf({ type: 'ide' }), 'authoring');
    assert.strictEqual(S.layerOf({ type: 'clipboard', app_name: 'VS Code' }), 'authoring');
    assert.strictEqual(S.layerOf({ type: 'browser' }), 'artifact');
    assert.strictEqual(S.layerOf({ type: 'uia', app_name: '微信', process_name: 'WeChat.exe' }), 'communication');
    assert.strictEqual(S.layerOf({ type: 'screenshot', app_name: '飞书' }), 'communication');
  });
  await t('沟通层隐私等级为 high', () => assert.strictEqual(S.envelope({ type: 'uia', app_name: '企业微信' }).privacy_level, 'high'));
  await t('URL 规整：去 www/锚点/utm/spm、参数排序', () => {
    assert.strictEqual(S.normUrl('https://www.Zhihu.com/q/1/?utm_source=a&b=2&a=1#x'), 'zhihu.com/q/1?a=1&b=2');
    assert.strictEqual(S.normUrl('https://item.taobao.com/item.htm?id=9&spm=a1'), 'item.taobao.com/item.htm?id=9');
    assert.strictEqual(S.normUrl('file:///c:/a'), null);
  });
  await t('路径规整：反斜杠与盘符大小写', () => assert.strictEqual(S.normPath('C:\\Users\\A\\Doc\\方案.docx'), 'c:/users/a/doc/方案.docx'));
  await t('标题清洗：浏览器后缀与未读数', () => {
    assert.strictEqual(S.cleanTitle('(3) DeepSeek API 文档 - Microsoft Edge'), 'DeepSeek API 文档');
    assert.strictEqual(S.cleanTitle('需求评审 - 和另外 4 个页面 - 个人 - Microsoft Edge'), '需求评审');
  });
  await t('同一文件不同写法 → 同一对象哈希', () => {
    const a = S.envelope({ type: 'file', file_path: 'C:\\Work\\PRD.docx' }), b = S.envelope({ type: 'document', file_path: 'c:/work/PRD.docx' });
    assert.strictEqual(a.object.hash, b.object.hash);
  });
  const page = '本地 OCR 方案对比：Windows.Media.Ocr 中文准确率约 90%，单张 0.26 秒；Tesseract 更准但更慢；PaddleOCR 需要额外运行时。';
  await t('跨来源去重：UIA 已读到的页面，随后同页 OCR 近似文本被丢弃', () => {
    const d = new S.ObjectDeduper();
    const v = { type: 'browser', url: 'https://docs.example.com/ocr', window_title: 'OCR 对比 - Microsoft Edge', started_at: T0 };
    assert.ok(!d.check(v, S.envelope(v)).drop);
    const u = { type: 'uia', app_name: 'Edge', window_title: 'OCR 对比 - Microsoft Edge', content: page, started_at: T0 + 20000 };
    const eu = S.envelope(u); assert.ok(!d.check(u, eu).drop); assert.strictEqual(eu.object.type, 'web', '窗口对象应归并到网页对象');
    const o = { type: 'screenshot', app_name: 'Edge', window_title: 'OCR 对比 - Microsoft Edge', content: page.replace('0.26', '0.2б') + ' 10:31', started_at: T0 + 60000 };
    const r = d.check(o, S.envelope(o)); assert.ok(r.drop, JSON.stringify(r)); assert.match(r.reason, /uia→screenshot/);
    assert.strictEqual(d.stats.dropped, 1); assert.strictEqual(d.stats.byLayer.content.dropped, 1);
  });
  await t('反向：先 OCR 后 UIA（更可信）→ 保留', () => {
    const d = new S.ObjectDeduper();
    const o = { type: 'screenshot', app_name: 'WPS', window_title: '周报.docx - WPS', content: page, started_at: T0 };
    const u = { ...o, type: 'uia', started_at: T0 + 30000 };
    assert.ok(!d.check(o, S.envelope(o)).drop); assert.ok(!d.check(u, S.envelope(u)).drop);
  });
  await t('浏览历史心跳：30 分钟内重复访问同一页只记一次（ActivityWatch pulsetime）', () => {
    const d = new S.ObjectDeduper(); const v = { type: 'browser', url: 'https://a.com/x?utm_source=1', started_at: T0 };
    assert.ok(!d.check(v, S.envelope(v)).drop); assert.ok(d.check({ ...v, url: 'https://www.a.com/x', started_at: T0 + 600000 }, S.envelope({ ...v, url: 'https://www.a.com/x' })).drop);
    assert.ok(!d.check({ ...v, started_at: T0 + 40 * 60000 }, S.envelope({ ...v, started_at: T0 + 40 * 60000 })).drop);
  });
  await t('产出层（笔记/IDE/复制）永不被去重', () => {
    const d = new S.ObjectDeduper(); const n = { type: 'note', content: page, window_title: 'x', app_name: 'MindTrace速记', started_at: T0 };
    assert.ok(!d.check(n, S.envelope(n)).drop); assert.ok(!d.check({ ...n, started_at: T0 + 1 }, S.envelope(n)).drop);
  });
  await t('不同内容同一对象 → 保留', () => {
    const d = new S.ObjectDeduper(); const a = { type: 'uia', app_name: 'Edge', window_title: 'X', content: page, started_at: T0 };
    d.check(a, S.envelope(a)); const b = { ...a, content: '完全不同的一段关于周五发布计划和评审安排的文本内容', started_at: T0 + 5000 };
    assert.ok(!d.check(b, S.envelope(b)).drop);
  });
  const uia = require('../src/collectors/uia');
  await t('常驻 UIA：多次采集只拉起 1 个进程，传递时限参数', async () => {
    uia._inject(() => spawn(process.execPath, ['-e', `require('readline').createInterface({input:process.stdin}).on('line',l=>console.log(JSON.stringify({ok:true,title:'T',process:'msedge',texts:['a','b'],ms:Number(l),truncated:false})))`]));
    const a = await uia.captureWinUia(350), b = await uia.captureWinUia(200);
    assert.strictEqual(a.ms, 350); assert.strictEqual(b.ms, 200); assert.strictEqual(uia.info().spawns, 1); uia.stop();
  });
  await t('UIA 脚本：按 IsPassword 跳过密码框、遍历设时限与条数上限', () => { for (const k of ['IsPassword', 'ElapsedMilliseconds', '$budget', '$max', 'ValuePattern', 'ReadLine']) assert.ok(uia.UIA_SCRIPT.includes(k), k); });
  console.log(`r2: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
