// 2.4 R3：回忆查询解析 / MCP 一键接入（纯 node）
const assert = require('assert'); const fs = require('fs'), os = require('os'), path = require('path');
let pass = 0, fail = 0; const t = async (n, fn) => { try { await fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + e.message); } };
const R = require('../src/recall'); const NOW = new Date('2026-10-22T10:00:00+08:00').getTime();
const H = (s) => new Date(s).getTime();
(async () => {
  await t('解析：昨天下午那个 PDF → 时间窗 + 文件 + .pdf', () => { const p = R.parseQuery('昨天下午那个PDF', NOW); assert.strictEqual(p.kind, 'file'); assert.strictEqual(p.ext, 'pdf'); assert.strictEqual(p.terms, ''); assert.ok(p.window[0] <= H('2026-10-21T14:00:00+08:00') && p.window[1] >= H('2026-10-21T18:00:00+08:00')); });
  await t('解析：上周看的 DeepSeek 定价文章 → 上周一~本周一 + 网页', () => { const p = R.parseQuery('上周看的 DeepSeek 定价文章', NOW); assert.strictEqual(p.kind, 'web'); assert.strictEqual(p.terms, 'DeepSeek 定价'); assert.strictEqual(p.window[0], H('2026-10-12T00:00:00+08:00')); assert.strictEqual(p.window[1], H('2026-10-19T00:00:00+08:00')); });
  await t('解析：张伟在微信里说的评审时间 → 会话 + 关键词', () => { const p = R.parseQuery('张伟在微信里说的评审时间', NOW); assert.strictEqual(p.kind, 'conversation'); assert.strictEqual(p.terms, '张伟 评审时间'); });
  await t('解析：纯关键词不加限定', () => { const p = R.parseQuery('知迹发布计划', NOW); assert.strictEqual(p.window, null); assert.strictEqual(p.kind, null); assert.strictEqual(p.terms, '知迹发布计划'); });
  const rows = [
    { id: 'a', type: 'window', title: '方案评审.pdf - Adobe Acrobat', app: 'Acrobat', started_at: H('2026-10-21T15:10:00+08:00'), meta: '{"layer":"focus","obj":"o1"}' },
    { id: 'b', type: 'download', title: '方案评审.pdf', path: 'E:\\下载\\方案评审.pdf', started_at: H('2026-10-21T15:05:00+08:00'), meta: '{"layer":"artifact","obj":"o2"}' },
    { id: 'c', type: 'download', title: '旧合同.pdf', path: 'E:\\下载\\旧合同.pdf', started_at: H('2026-10-19T09:00:00+08:00'), meta: '{"layer":"artifact","obj":"o3"}' },
    { id: 'd', type: 'browser', title: 'DeepSeek 定价', url: 'https://api-docs.deepseek.com/pricing', started_at: H('2026-10-14T11:00:00+08:00'), meta: '{"layer":"artifact","obj":"o4"}' },
    { id: 'e', type: 'browser', title: 'DeepSeek 定价', url: 'https://api-docs.deepseek.com/pricing', started_at: H('2026-10-15T11:00:00+08:00'), meta: '{"layer":"artifact","obj":"o4"}' },
    { id: 'f', type: 'uia', title: '张伟', app: '微信', content: '张伟：评审时间定在周五下午三点', started_at: H('2026-10-21T11:00:00+08:00'), meta: '{"layer":"communication","obj":"o5"}' }
  ];
  const fake = { searchFts: (q) => rows.filter(r => q.split(' ').some(w => `${r.title}${r.content || ''}${r.url || ''}`.toLowerCase().includes(w.toLowerCase()))), all: (sql, p) => {
    if (/WHERE id IN/.test(sql)) return rows.filter(r => p.includes(r.id)).map(r => ({ id: r.id, meta: r.meta }));
    let out = rows.filter(r => !/started_at>=\?/.test(sql) || (r.started_at >= p[0] && r.started_at < p[1]));
    if (/file_path LIKE/.test(sql)) out = out.filter(r => /\.pdf/i.test(`${r.path || ''}${r.url || ''}${r.title}`));
    return out.map(r => ({ ...r, path: r.path || null, url: r.url || null }));
  } };
  await t('召回：昨天下午那个 PDF → 第一条是可打开的下载原件', () => { const r = R.recall(fake, '昨天下午那个PDF', { now: NOW }); assert.strictEqual(r.results[0].path, 'E:\\下载\\方案评审.pdf'); assert.ok(!r.results.some(x => x.title === '旧合同.pdf' && r.results.indexOf(x) === 0)); });
  await t('召回：同一网页两次访问按对象聚合为一条（hits=2）', () => { const r = R.recall(fake, '上周看的 DeepSeek 定价文章', { now: NOW }); assert.strictEqual(r.results[0].url, 'https://api-docs.deepseek.com/pricing'); assert.strictEqual(r.results[0].hits, 2); assert.strictEqual(r.results.filter(x => x.url).length, 1); });
  await t('召回：会话类问题优先沟通层，并带片段', () => { const r = R.recall(fake, '张伟在微信里说的评审时间', { now: NOW }); assert.strictEqual(r.results[0].kind, 'conversation'); assert.match(r.results[0].snippet, /周五下午三点/); });
  const I = require('../src/mcp/install');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-mcp-')); const appdata = path.join(home, 'AppData', 'Roaming');
  const O = { home, appdata, platform: 'win32', url: 'http://127.0.0.1:17322/mcp', token: 'tok123' };
  await t('MCP：Cursor 新建配置', () => { const r = I.install('cursor', O); const j = JSON.parse(fs.readFileSync(r.file, 'utf8')); assert.strictEqual(j.mcpServers.mindtrace.url, O.url); assert.strictEqual(j.mcpServers.mindtrace.headers.Authorization, 'Bearer tok123'); assert.strictEqual(r.backup, null); });
  await t('MCP：Claude 合并已有服务器并备份原文件', () => {
    const f = I.targets(O).claude.file; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '\uFEFF' + JSON.stringify({ mcpServers: { github: { command: 'gh' } }, theme: 'dark' }));
    const r = I.install('claude', O); const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.ok(j.mcpServers.github && j.theme === 'dark'); assert.deepStrictEqual(j.mcpServers.mindtrace.args.slice(0, 3), ['-y', 'mcp-remote', O.url]); assert.ok(r.backup && fs.existsSync(r.backup)); assert.deepStrictEqual(r.others, ['github']);
  });
  await t('MCP：配置文件损坏时拒绝覆盖', () => { const f = I.targets(O).cursor.file; fs.writeFileSync(f, '{ bad json'); assert.throws(() => I.install('cursor', O), /不是合法 JSON/); assert.strictEqual(fs.readFileSync(f, 'utf8'), '{ bad json'); fs.unlinkSync(f); });
  await t('MCP：状态检测（已接入 / 令牌变化）', () => { I.install('cursor', O); let s = I.status(O); assert.ok(s.cursor.current && s.claude.current); s = I.status({ ...O, token: 'new' }); assert.ok(s.cursor.installed && !s.cursor.current); });
  await t('MCP：卸载只删除知迹条目', () => { I.uninstall('claude', O); const j = JSON.parse(fs.readFileSync(I.targets(O).claude.file, 'utf8')); assert.ok(!j.mcpServers.mindtrace && j.mcpServers.github); });
  console.log(`r3: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
