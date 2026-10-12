/**
 * v2.3 验收测试（KB-01..16 / MEM-01..12 / CAL T13..T20 + 集成）
 * 运行：./node_modules/.bin/electron tests/v23-acceptance.js --no-sandbox
 * 可选：先启动 mock：node scripts/mock-openai-server.js 3921（KB-14 使用）
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const UD = '/tmp/mt-v23-acc';
const D = (s) => new Date(s + '+08:00').getTime();
const ANCHOR = D('2026-10-12T22:30:00');
const results = [];
const pass = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(ok ? 'PASS' : 'FAIL', name, typeof detail === 'string' ? detail : JSON.stringify(detail)); };
const get = (url) => new Promise((res) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d })); }).on('error', e => res({ status: 0, body: e.message })));

app.whenReady().then(async () => {
  fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
  app.setPath('userData', UD);
  const store = require('../src/main/store');
  await store.initStore({ dbPath: path.join(UD, 'mt.db') });
  let CUR = {}; require('../src/pro').init({ getConfig: () => CUR });
  require('../src/core/schema').migrate();
  const kb = require('../src/kb');
  const memory = require('../src/memory');
  const calendar = require('../src/calendar');
  const pipeline = require('../src/core/pipeline');
  const inbox = require('../src/core/inbox');
  const forget = require('../src/core/forget');
  const search = require('../src/core/search');
  const U = require('../src/common/util');
  const cfgRules = { ai: {} };
  const act = (o) => store.insertActivity({ type: o.type || 'document', started_at: o.ts, duration_ms: o.dur || 60000, app_name: o.app || 'Notepad', window_title: o.title || '笔记', url: o.url, file_path: o.file, content: o.text, meta: o.meta });
  const run = (cfg = cfgRules) => pipeline.run({ cfg });
  console.log('engine', store.ftsStatus());

  try {
    /* ───── KB ───── */
    act({ type: 'browser', ts: ANCHOR - 9e6, app: 'Chrome', title: 'Electron 文档', url: 'https://www.electronjs.org/docs/latest?utm_source=x&utm_medium=y', text: 'Electron 文档：主进程与渲染进程的通信方式，ipcMain 与 ipcRenderer 的用法说明。' });
    act({ type: 'browser', ts: ANCHOR - 8e6, app: 'Chrome', title: 'Electron 文档', url: 'https://electronjs.org/docs/latest#ipc', text: 'Electron 文档：主进程与渲染进程的通信方式，ipcMain 与 ipcRenderer 的用法说明。' });
    await run();
    pass('KB-01 utm/hash URL 去重为同一文档', store.get(`SELECT COUNT(*) c FROM documents WHERE doc_key LIKE 'url:%electronjs%'`).c === 1);

    const base = Array.from({ length: 10 }, (_, i) => `第${i + 1}行：季度规划会议纪要，讨论知迹 MindTrace 的采集与知识库路线图细节。`).join('\n');
    for (let i = 0; i < 100; i++) act({ type: 'screenshot', ts: ANCHOR - 7e6 + i * 5000, app: 'WPS', title: '季度规划.docx - WPS', text: base + (i % 25 === 0 ? `\n补充${i / 25}：本页 OCR 新增内容` : '') });
    await run();
    const doc2 = store.get(`SELECT id FROM documents WHERE title LIKE '季度规划%'`);
    const nCh = store.get(`SELECT COUNT(*) c FROM chunks WHERE doc_id=?`, [doc2.id]).c;
    pass('KB-02 100 帧 OCR → ≤3 块', nCh >= 1 && nCh <= 3, `chunks=${nCh}`);

    act({ ts: D('2026-10-10T10:00:00'), app: '微信', title: '张三', text: '和张三讨论了下周的版本规划，他觉得排期偏紧，需要再评估一下工作量。' });
    act({ ts: D('2026-10-11T10:00:00'), app: 'Outlook', title: 'Re: 版本规划', text: 'Zhang San 说他会在周三前给出完整的排期表，并同步给测试团队。' });
    act({ ts: D('2026-10-12T10:00:00'), app: '飞书', title: '产品群', text: '，张三(产品)：评审材料已经上传到共享盘，请大家提前阅读并准备问题。' });
    await run();
    const zs = store.all(`SELECT * FROM entities WHERE type='person' AND (norm_name='张三' OR pinyin='zhangsan') AND merged_into IS NULL`);
    pass('KB-03 张三 / Zhang San / 张三(产品) → 同一实体', zs.length === 1 && store.all(`SELECT * FROM entity_aliases WHERE entity_id=?`, [zs[0]?.id]).length >= 2, `entities=${zs.length}`);

    act({ ts: ANCHOR - 5e6, app: '微信', title: '王五', text: '和王五确认了一下合同的签署流程，后续由法务继续跟进处理。' });
    await run();
    const w5 = store.get(`SELECT * FROM entities WHERE norm_name='王五'`);
    pass('KB-04 单次目击保持 candidate、不建页', w5 && w5.status === 'candidate' && !store.get(`SELECT 1 FROM wiki_pages WHERE entity_id=?`, [w5.id]), w5?.status);

    act({ ts: D('2026-10-08T15:00:00'), app: 'Notion', title: '知迹 发布计划', text: '知迹的发布日期是10月15日，市场团队准备发布会材料与官网更新。' });
    act({ ts: D('2026-10-09T15:00:00'), app: 'Notion', title: '知迹 周报', text: '「知迹」本周完成了采集模块的重构工作，性能提升明显。' });
    act({ ts: D('2026-10-10T15:00:00'), app: 'Notion', title: '知迹 复盘', text: '「知迹」的用户访谈记录整理完成，共访谈 12 位目标用户。' });
    await run();
    const zj = kb.entityDetail('知迹');
    const day1 = zj && zj.claims.find(c => c.object === '2026-10-15' && c.status === 'active');
    pass('KB-05 三天提及后第 1 天的事实仍在页面', !!day1 && /2026-10-15/.test(zj.page?.body_md || ''), zj?.entity?.status);

    const pages = store.all(`SELECT body_md FROM wiki_pages WHERE entity_id IS NOT NULL`);
    let facts = 0, cited = 0, dangling = 0;
    for (const p of pages) {
      const sec = (p.body_md.split('## 关键事实')[1] || '').split('\n## ')[0];
      for (const l of sec.split('\n').filter(l => l.startsWith('- **'))) { facts++; const m = l.match(/\[\^(\d+)\]/g); if (m) { cited++; for (const r of m) if (!p.body_md.includes(r + ':')) dangling++; } }
    }
    pass('KB-06 事实 100% 带引用且脚注存在', facts > 0 && cited === facts && dangling === 0, `facts=${facts} cited=${cited} dangling=${dangling}`);

    const pg = zj.page;
    const NOTES = '我的判断：发布日期可能要看渠道审核。\n- [ ] 联系应用商店\n**不要改我**';
    kb.setUserNotes(pg.id, NOTES);
    act({ ts: D('2026-10-12T16:00:00'), app: 'Notion', title: '知迹 每日站会', text: '「知迹」站会：采集稳定性问题已修复，准备进入灰度阶段。' });
    await run(); kb.compilePage(zj.entity.id, { trigger: 'test' });
    const body7 = store.get(`SELECT body_md, user_notes FROM wiki_pages WHERE id=?`, [pg.id]);
    pass('KB-07 重编译后「我的笔记」逐字保留', body7.user_notes === NOTES && body7.body_md.includes(NOTES) && kb.revisions(pg.id).length >= 2);

    act({ ts: D('2026-10-12T17:00:00'), app: '微信', title: '市场群', text: '知迹的发布日期是10月20日，渠道审核需要额外时间。' });
    await run();
    const conf = store.all(`SELECT object FROM claims WHERE entity_id=? AND predicate='发布日期' AND status='conflict'`, [zj.entity.id]).map(r => r.object).sort();
    const inb = inbox.list().find(i => i.type === 'conflict');
    pass('KB-08 10-15 vs 10-20 冲突进入待处理', conf.join(',') === '2026-10-15,2026-10-20' && !!inb && /冲突与待确认/.test(kb.entityDetail('知迹').page.body_md), conf.join(','));
    const keep = store.get(`SELECT id FROM claims WHERE entity_id=? AND object='2026-10-20'`, [zj.entity.id]).id;
    inbox.act('conflict', inb.id, 'accept', { keep });
    pass('KB-08b 确认后保留 10-20 并锁定', store.get(`SELECT status, locked FROM claims WHERE id=?`, [keep]).locked === 1 && store.get(`SELECT COUNT(*) c FROM claims WHERE entity_id=? AND predicate='发布日期' AND status='active'`, [zj.entity.id]).c === 1);

    kb.refreshStaleness(D('2026-10-12T17:00:00') + 46 * 86400000);
    pass('KB-09 项目 45 天未出现 → stale', /stale: true/.test(store.get(`SELECT body_md FROM wiki_pages WHERE id=?`, [pg.id]).body_md));
    kb.refreshStaleness(Date.now());
    kb.compilePage(zj.entity.id, { now: D('2026-10-12T18:00:00') });

    const vdir = path.join(UD, 'vault');
    const n10 = require('../src/kb/vault').exportKb(vdir);
    const vfile = path.join(vdir, '知识库', '项目', '知迹.md');
    pass('KB-10 Obsidian 写出（页面 + log.md；回读为 P1）', n10 > 0 && fs.existsSync(vfile) && fs.readFileSync(vfile, 'utf8').includes(NOTES) && fs.existsSync(path.join(vdir, '知识库', 'log.md')));

    const lA = kb.resolveEntity('李雷雷', 'person'); const lB = kb.resolveEntity('李磊磊', 'person');
    const ms = store.get(`SELECT * FROM merge_suggestions WHERE (a=? AND b=?) OR (a=? AND b=?)`, [lA.id, lB.id, lB.id, lA.id]);
    const ch0 = store.get(`SELECT * FROM chunks LIMIT 1`);
    kb.addMention(lB, ch0, ANCHOR);
    const op = kb.mergeEntities(lA.id, lB.id);
    const merged = store.get(`SELECT merged_into FROM entities WHERE id=?`, [lB.id]).merged_into === lA.id;
    kb.undoMerge(op);
    const undone = !store.get(`SELECT merged_into FROM entities WHERE id=?`, [lB.id]).merged_into && store.get(`SELECT COUNT(*) c FROM mentions WHERE entity_id=?`, [lB.id]).c === 1;
    if (process.env.DBG) console.log('KB11', lA.name, lB.name, lA.id===lB.id, !!ms, merged, undone);
    pass('KB-11 合并建议 + 合并 + 撤销', !!ms && merged && undone);

    const s1 = kb.searchChunks('路线图'); const s2 = kb.searchChunks('排期');
    pass('KB-12 中文 bigram 检索（块）', s1.length > 0 && s2.length > 0, `路线图=${s1.length} 排期=${s2.length} engine=${store.ftsStatus().mode}`);
    const us = search.search('张三');
    pass('KB-13 关闭向量（无 embedding）统一检索可用', us.entities.length > 0 && us.chunks.length > 0 && us.activities.length > 0, `ms=${us.ms}`);

    const mockUp = (await get('http://127.0.0.1:3921/health')).status !== 0 || (await get('http://127.0.0.1:3921/v1/models')).status !== 0;
    if (mockUp) {
      const cfgLLM = { ai: { baseUrl: 'http://127.0.0.1:3921/v1', model: 'mock', dailyTokenBudget: 10000 } };
      for (let i = 0; i < 40; i++) act({ ts: ANCHOR - 3e6 + i * 1000, app: 'Notepad', title: `预算测试 ${i}`, text: `预算测试资料 ${i}：` + '这是一段用于测试每日抽取预算是否生效的较长中文文本。'.repeat(12) });
      CUR = cfgLLM; const r14 = await pipeline.run({ cfg: cfgLLM }); CUR = {};
      const used = require('../src/core/budget').used('extract');
      pass('KB-14 预算 10k：抽取 ≤60%，超出回退规则', used <= 6000 + 1500 && (r14.modes['rules-fallback'] || 0) > 0 && (r14.modes.llm || 0) > 0, `${JSON.stringify(r14.modes)} used=${used}`);
    } else pass('KB-14 预算（需 mock :3921）', false, 'mock 未启动');

    const t15 = Date.now();
    const evs = Array.from({ length: 10000 }, (_, i) => ({ type: i % 3 ? 'window' : 'browser', ts_start: ANCHOR - 86400000 + i * 8000, app: ['Code', 'Chrome', '微信', 'WPS'][i % 4], title: `窗口 ${i % 300}`, url: i % 3 ? null : `https://example.com/p/${i % 500}?utm_source=t`, content: i % 5 === 0 ? `页面正文 ${i % 500}：一些用于分块的较长内容，包含知识库相关描述。` : null }));
    store.insertActivityBatch(evs);
    const tIns = Date.now() - t15;
    const t15b = Date.now(); const ing = kb.ingestNew(); const tNorm = Date.now() - t15b;
    pass('KB-15 1 万事件 归一+分块 <5s', tNorm < 5000, `insert=${tIns}ms normalize+chunk=${tNorm}ms docs=${ing.docs} chunks=${ing.chunks.length}`);
    await run();

    act({ type: 'window', ts: ANCHOR - 1e6, app: 'Chrome', title: '明天下午3点和赵六开会 - 私人', text: null });
    await run();
    const d16 = store.get(`SELECT * FROM documents WHERE title LIKE '明天下午3点和赵六%'`);
    pass('KB-16 仅标题不入块/不进日历/不进记忆', d16 && d16.privacy_level === 'title' && !store.get(`SELECT 1 FROM chunks WHERE doc_id=?`, [d16.id]) && !store.get(`SELECT 1 FROM calendar_events WHERE title LIKE '%赵六%'`));

    /* ───── MEMORY ───── */
    const ch = store.get(`SELECT * FROM chunks ORDER BY observed_at DESC LIMIT 1`);
    const valid = new Set([ch.id]);
    const r1a = memory.ingest({ type: 'preference', predicate: '偏好', object: '深色主题', text: '我偏好深色主题' }, { chunkId: null, source: 'auto', validChunks: valid });
    const r1b = memory.ingest({ type: 'preference', predicate: '偏好', object: '深色主题', text: '我偏好深色主题' }, { chunkId: 'bogus-id', source: 'auto', validChunks: valid });
    pass('MEM-01 无证据/无效证据 id 的候选被丢弃', r1a.op === 'SKIP' && r1b.op === 'SKIP');

    act({ ts: D('2026-10-11T09:00:00'), app: 'Notepad', title: '工作习惯', text: '我习惯先写测试再写实现，这样重构更安心。' });
    await run();
    act({ ts: D('2026-10-12T09:00:00'), app: 'Notepad', title: '周记', text: '我习惯先写测试再写实现，这样重构更安心。周记补充。' });
    await run();
    const m2 = store.all(`SELECT * FROM memories WHERE text LIKE '我习惯先写测试%' AND status IN ('active','pending')`);
    const ev2 = m2[0] ? store.get(`SELECT COUNT(*) c FROM evidence WHERE owner_type='memory' AND owner_id=?`, [m2[0].id]).c : 0;
    pass('MEM-02 同 SPO → 1 条记忆、置信上升、2 条证据', m2.length === 1 && m2[0].confidence > 0.75 && ev2 >= 2, `n=${m2.length} conf=${m2[0]?.confidence?.toFixed(2)} ev=${ev2}`);

    act({ ts: D('2026-09-01T09:00:00'), app: 'Notepad', title: '自我介绍', text: '我的主力语言是 Python，平时写数据处理脚本。' });
    await run();
    const py = store.get(`SELECT * FROM memories WHERE predicate='主力语言' AND object='Python'`); memory.approve(py.id);
    act({ ts: D('2026-10-12T11:00:00'), app: 'Notepad', title: '技术选型', text: '最近我改用 TypeScript 作为主力语言，类型系统很有帮助。' });
    await run();
    const ts3 = store.get(`SELECT * FROM memories WHERE predicate='主力语言' AND object='TypeScript'`);
    const py3 = store.get(`SELECT * FROM memories WHERE id=?`, [py.id]);
    const hist = memory.recall('主力语言', { includeHistory: true, scope: 'app' });
    pass('MEM-03 Python → TypeScript 取代，历史可召回', ts3 && ts3.status === 'active' && py3.status === 'superseded' && py3.superseded_by === ts3.id && hist.memories.some(m => m.status === 'superseded'), `${ts3?.status}/${py3.status}`);

    memory.edit(ts3.id, { text: '我的主力语言是 TypeScript（前端与工具链）' });
    const r4 = memory.ingest({ type: 'fact_self', subject: 'user', predicate: '主力语言', object: 'Go', text: '我的主力语言是 Go', confidence: 0.9 }, { chunkId: ch.id, validChunks: valid });
    pass('MEM-04 用户编辑锁定，AI 不覆盖（转冲突待审）', store.get(`SELECT * FROM memories WHERE id=?`, [ts3.id]).status === 'active' && store.get(`SELECT locked FROM memories WHERE id=?`, [ts3.id]).locked === 1 && r4.op === 'CONFLICT' && r4.status === 'pending');

    const c5 = { type: 'preference', predicate: '偏好', object: '番茄钟', text: '我喜欢用番茄钟', confidence: 0.5 };
    const r5 = memory.ingest(c5, { chunkId: ch.id, validChunks: valid });
    memory.reject(r5.id, { never: true });
    const r5b = memory.ingest(c5, { chunkId: ch.id, validChunks: valid });
    pass('MEM-05 拒绝且「不再提示」→ 墓碑', r5b.op === 'SKIP' && r5b.reason === 'tombstone');

    const auditBefore = store.get(`SELECT COUNT(*) c FROM audit_log WHERE action='blocked-sensitive'`).c;
    const memBefore = store.get(`SELECT COUNT(*) c FROM memories`).c;
    const r6 = memory.ingest({ type: 'habit', predicate: '习惯', object: 'x', text: '我习惯把银行卡密码设为 abc12345', quote: '我习惯把银行卡密码设为 abc12345' }, { chunkId: ch.id, validChunks: valid });
    pass('MEM-06 敏感 → 0 记忆、审计 +1', r6.reason === 'sensitive' && store.get(`SELECT COUNT(*) c FROM memories`).c === memBefore && store.get(`SELECT COUNT(*) c FROM audit_log WHERE action='blocked-sensitive'`).c === auditBefore + 1);

    const r7a = memory.ingest({ type: 'habit', predicate: '习惯', object: '晚上跑步', text: '我习惯晚上跑步', confidence: 0.8 }, { chunkId: ch.id, validChunks: valid, ts: D('2026-01-01T00:00:00') });
    const r7b = memory.ingest({ type: 'habit', predicate: '习惯', object: '周末爬山', text: '我习惯周末爬山', confidence: 0.8 }, { chunkId: ch.id, validChunks: valid, ts: D('2026-01-01T00:00:00') });
    memory.pin(r7b.id);
    const arch = memory.runDecay(ANCHOR);
    pass('MEM-07 衰减归档；置顶不受影响', store.get(`SELECT status FROM memories WHERE id=?`, [r7a.id]).status === 'archived' && store.get(`SELECT status FROM memories WHERE id=?`, [r7b.id]).status === 'active', `archived=${arch}`);

    for (let i = 0; i < 60; i++) memory.ingest({ type: 'preference', predicate: '偏好', object: '工具' + i, text: `我偏好使用工具${i}来处理日常的文本整理工作`, confidence: 0.9 }, { chunkId: ch.id, validChunks: valid });
    const r8 = memory.recall('工具', { budget: 300 });
    const profT = Object.values(r8.profile).flat().reduce((s, t) => s + U.estTokens(t), 0);
    pass('MEM-08 recall 遵守 token 预算；档案 ≤40%', r8.tokens <= 300 && profT <= 120 && r8.memories.length > 0, `tokens=${r8.tokens} profile=${profT}`);

    const r9 = memory.remember('我喜欢在周五下午做代码评审');
    const r9p = memory.ingest({ type: 'preference', predicate: '偏好', object: '私密', text: '我偏好私密的事情X', confidence: 0.95, private: true }, { chunkId: ch.id, validChunks: valid, source: 'user' });
    const recall9 = memory.recall('私密', { scope: 'mcp' });
    pass('MEM-09 MCP remember → 待审核；MCP 范围排除私密', store.get(`SELECT status FROM memories WHERE id=?`, [r9.id]).status === 'pending' && !recall9.memories.some(m => m.id === r9p.id));

    const fromT = D('2026-10-11T08:00:00'), toT = D('2026-10-11T09:30:00');
    act({ ts: D('2026-10-11T08:30:00'), app: 'Notepad', title: '晨间', text: '我偏好在早上处理邮件，下午留给深度工作。' });
    await run();
    const m10 = store.get(`SELECT id FROM memories WHERE text LIKE '我偏好在早上处理邮件%'`);
    store.run(`DELETE FROM activities WHERE started_at>=? AND started_at<?`, [fromT, toT]);
    const c10 = forget.cascadeRange(fromT, toT);
    pass('MEM-10 时间段删除级联删除派生记忆', !!m10 && !store.get(`SELECT 1 FROM memories WHERE id=?`, [m10.id]), JSON.stringify(c10));

    const exp = memory.exportJson();
    const before11 = exp.memories.length;
    store.run(`DELETE FROM memories`); try { store.run(`DELETE FROM memories_fts`); } catch (_) {}
    const imp = memory.importJson(JSON.parse(JSON.stringify(exp)));
    pass('MEM-11 导出/导入 JSON 往返', imp === before11 && store.get(`SELECT COUNT(*) c FROM memories WHERE status<>'rejected'`).c === before11, `${imp}/${before11}`);

    store.transaction(() => { for (let i = 0; i < 10000; i++) memory.ingest({ type: 'preference', predicate: '偏好', object: 'p' + i, text: `我偏好第${i}号方案用于${['编码', '写作', '设计', '会议'][i % 4]}场景的处理`, confidence: 0.9 }, { chunkId: ch.id, validChunks: valid, source: 'user' }); });
    const t12 = Date.now(); if (process.env.DBG) { let a=Date.now(); memory.getProfile({budget:600}); console.log('prof', Date.now()-a); a=Date.now(); memory.searchIds('写作',60); console.log('search', Date.now()-a); a=Date.now(); require('../src/calendar').openCommitments({limit:8}); console.log('commit', Date.now()-a);} const r12 = memory.recall('写作', { budget: 1500 }); const ms12 = Date.now() - t12;
    pass('MEM-12 1 万条记忆 recall <50ms', ms12 < 50 && r12.memories.length > 0, `${ms12}ms`);

    /* ───── CALENDAR ───── */
    act({ ts: ANCHOR - 600000, app: '微信', title: '李四', text: '明天下午3点和李四开评审会，讨论 2.3 的发布范围。' });
    act({ ts: ANCHOR - 500000, app: 'Outlook', title: '会议邀请：评审会', text: '邀请：明天下午3点和李四开评审会（2.3 发布范围）。' });
    await run();
    if (process.env.DBG) console.log(store.all(`SELECT id,doc_key,privacy_level,length(text) n,status FROM documents WHERE app='微信' AND title='李四'`), store.all(`SELECT id, content FROM activities WHERE content LIKE '%李四开评审%'`), store.all(`SELECT c.text, d.app, c.extracted_at, c.privacy_level FROM chunks c JOIN documents d ON d.id=c.doc_id WHERE c.text LIKE '%评审会%'`), store.all(`SELECT title, source_app, status FROM calendar_events WHERE title LIKE '%评审%'`));
    const t13 = store.all(`SELECT * FROM calendar_events WHERE title LIKE '%评审会%' AND change_of IS NULL AND status<>'dismissed'`);
    pass('CAL-T13 跨来源合并为 1 条', t13.length === 1 && (t13[0].source_app || '').split(',').length >= 2, `n=${t13.length} src=${t13[0]?.source_app}`);
    pass('CAL-T15 AI 抽取默认 proposed', t13[0]?.status === 'proposed');
    calendar.accept(t13[0].id);
    act({ ts: ANCHOR - 100000, app: '微信', title: '李四', text: '和李四的评审会改到周四下午3点。' });
    await run();
    const t14 = store.get(`SELECT * FROM calendar_events WHERE change_of=?`, [t13[0].id]);
    pass('CAL-T14 「改到周四」→ 改期建议（不直接改原事件）', t14 && t14.status === 'proposed' && U.fmtTs(t14.start_at) === '2026-10-15 15:00' && store.get(`SELECT start_at FROM calendar_events WHERE id=?`, [t13[0].id]).start_at === t13[0].start_at, t14 && U.fmtTs(t14.start_at));
    calendar.accept(t14.id);
    pass('CAL-T14b 采纳后原事件改到周四', U.fmtTs(store.get(`SELECT start_at FROM calendar_events WHERE id=?`, [t13[0].id]).start_at) === '2026-10-15 15:00');

    const M0 = D('2026-10-05T10:00:00');
    for (let i = 0; i < 8; i++) act({ type: 'window', ts: M0 + i * 4 * 60000, dur: 4 * 60000, app: '腾讯会议', title: '腾讯会议 - 周会' });
    act({ type: 'window', ts: M0 + 14 * 60000, dur: 60000, app: '微信', title: '微信' });
    const blks = calendar.blocks.computeBlocks(M0 - 3600000, M0 + 3600000).filter(b => b.kind === 'meeting');
    pass('CAL-T16 会议块 32 分钟（抖动吸收）', blks.length === 1 && blks[0].minutes === 32, blks.map(b => b.minutes).join(','));

    store.transaction(() => { for (let i = 0; i < 3000; i++) calendar.create({ kind: 'todo', title: `任务 ${i}`, start_at: D('2026-10-01T09:00:00') + i * 900000, status: 'confirmed' }); });
    const t17 = Date.now(); const month = calendar.listRange(D('2026-10-01T00:00:00'), D('2026-11-01T00:00:00')); const ms17 = Date.now() - t17;
    pass('CAL-T17 月视图 3000 条 <300ms', ms17 < 300 && month.plan.length >= 2900, `${ms17}ms plan=${month.plan.length} actual=${month.actual.length}`);

    const apiPort = 17399;
    require('../src/api/server').start({ getConfig: () => ({ api: { enabled: true, port: apiPort, token: 'apitok' }, calendar: { feedToken: 'feed-ok' } }) });
    await new Promise(r => setTimeout(r, 300));
    const bad = await get(`http://127.0.0.1:${apiPort}/calendar/feed.ics?token=nope`);
    const good = await get(`http://127.0.0.1:${apiPort}/calendar/feed.ics?token=feed-ok`);
    pass('CAL-T18 feed.ics 错误 token → 401；正确 → VCALENDAR', bad.status === 401 && good.status === 200 && good.body.startsWith('BEGIN:VCALENDAR') && good.body.includes('BEGIN:VEVENT'), `${bad.status}/${good.status}`);

    act({ ts: ANCHOR - 50000, app: '微信', title: '私聊', text: '明天上午10点去医院复查，验证码是 884512。', meta: { sensitive: true } });
    await run();
    pass('CAL-T19 敏感/排除内容不产生日程', !store.get(`SELECT 1 FROM calendar_events WHERE title LIKE '%医院%'`));

    const rid = calendar.create({ kind: 'meeting', title: '提醒测试会', start_at: ANCHOR + 5 * 60000, end_at: ANCHOR + 35 * 60000, reminders: [10] });
    const notes = []; calendar.setNotifier((n) => notes.push(n));
    const f1 = calendar.tick(ANCHOR);
    calendar.snooze(rid, 10, ANCHOR);
    const f2 = calendar.tick(ANCHOR + 5 * 60000);
    const f3 = calendar.tick(ANCHOR + 10 * 60000 + 1000);
    pass('CAL-T20 提醒 + 稍后 10 分钟', f1.includes(rid) && !f2.includes(rid) && f3.includes(rid) && notes.length >= 2);

    /* ───── 集成 ───── */
    const cnt = inbox.counts();
    pass('INBOX 统一待处理（记忆/日程/合并/冲突）', cnt.memory > 0 && cnt.total >= cnt.memory, JSON.stringify(cnt));
    const prof = memory.getProfile({});
    pass('MCP get_profile 含开放承诺', prof.commitments.length > 0 && Object.keys(prof.profile).length > 0);
    const pro = require('../src/pro');
    const bk = path.join(UD, 'v23.mtbak'); pro.backup(bk, 'pw-123');
    const nb = { e: store.get(`SELECT COUNT(*) c FROM entities`).c, c: store.get(`SELECT COUNT(*) c FROM calendar_events`).c };
    store.run(`DELETE FROM entities`); store.run(`DELETE FROM calendar_events`); store.run(`DELETE FROM chunks`); try { store.run(`DELETE FROM chunks_fts`); } catch (_) {}
    pro.restore(bk, 'pw-123');
    pass('BACKUP 2.3 表加密备份/恢复 + FTS 重建', store.get(`SELECT COUNT(*) c FROM entities`).c === nb.e && store.get(`SELECT COUNT(*) c FROM calendar_events`).c === nb.c && kb.searchChunks('路线图').length > 0);
    const f = forget.forgetSubject('张三');
    const leftover = store.get(`SELECT COUNT(*) c FROM entities WHERE norm_name='张三' OR pinyin='zhangsan'`).c + store.get(`SELECT COUNT(*) c FROM chunks WHERE text LIKE '%张三%' OR text LIKE '%Zhang San%'`).c;
    act({ ts: ANCHOR, app: '微信', title: '张三', text: '和张三讨论了新的需求，张三说下周给反馈。' }); await run();
    pass('FORGET 跨三域遗忘 + 墓碑阻止复活', leftover === 0 && !store.get(`SELECT 1 FROM entities WHERE norm_name='张三'`), JSON.stringify(f));
    const mcp = require('../src/mcp/server');
    const tools = (mcp.TOOLS || []).map(t => t.name);
    const J = (r) => JSON.parse(r.content[0].text);
    const rp = J(await mcp.callTool('get_profile', {}));
    const rr = J(await mcp.callTool('recall', { query: 'TypeScript', budget: 800 }));
    const rm = J(await mcp.callTool('remember', { text: '我喜欢用机械键盘写代码' }));
    const ra = J(await mcp.callTool('add_calendar_item', { title: '和王五对合同', time: '后天上午10点', kind: 'meeting' }));
    const rg = J(await mcp.callTool('get_calendar', { from: '2026-10-12', days: 7, include_proposed: true }));
    calendar.blocks.buildEpisodes(D('2026-10-05T00:00:00'), D('2026-10-06T00:00:00'));
    const re = J(await mcp.callTool('get_episodes', { day: '2026-10-05' }));
    pass('MCP 工具调用（profile/recall/remember/日历/情景）', rp.profile && rr.tokens <= 800 && rm.status === 'pending' && ra.status === 'proposed' && Array.isArray(rg.plan) && re.length >= 1, `recall=${rr.memories.length} episodes=${re.length}`);
    pass('MCP 新工具注册', ['get_profile', 'recall', 'get_episodes', 'remember', 'get_calendar', 'add_calendar_item', 'forget_subject'].every(n => tools.includes(n)), tools.join(','));
  } catch (e) { console.error(e); pass('未捕获异常', false, e.stack); }
  const ok = results.filter(r => r.ok).length;
  console.log(`\nv2.3 acceptance: ${ok}/${results.length} passed (engine=${store.ftsStatus().mode})`);
  app.exit(ok === results.length ? 0 : 1);
});
