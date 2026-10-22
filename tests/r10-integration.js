// 2.4.8 集成（electron）：模拟 Windows 前台宿主 → windowTracker 入库 → 异步补文档/路径/正文 → 日报含文档段
const { app } = require('electron'); const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
const UD = '/tmp/mt-r10-int';
let pass = 0, fail = 0; const t = (n, ok, i = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (i ? ' — ' + i : '')); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true }); app.setPath('userData', UD);
  const store = require('../src/main/store'); await store.initStore({ dbPath: path.join(UD, 'mt.db') });
  const cfg = { authorized: true, collectors: { window: true, documents: true }, privacy: { minDwellSec: 0, idleThresholdSec: 180 } };
  require('../src/pro').init({ getConfig: () => cfg }); require('../src/core/schema').migrate();
  const doc = path.join(UD, '2.4.8 发布计划.md'); fs.writeFileSync(doc, '# 发布计划\n- 修复中文窗口标题乱码\n- 时间线显示文档名与正文');
  // 假前台宿主：按顺序返回 3 个窗口（stdin 一行 → stdout 一行 JSON）
  const seq = [
    { title: `${doc} - 记事本`, process: 'notepad', app: '记事本', pid: 11, idle: 1, cmd: `"C:\\Windows\\notepad.exe" "${doc}"` },
    { title: '产品研发群', process: 'WeChat', app: 'WeChat', pid: 12, idle: 1, cmd: '' },
    { title: 'DeepSeek API 文档 - 个人 - Microsoft Edge', process: 'msedge', app: 'Microsoft Edge', pid: 13, idle: 1, cmd: '' }
  ];
  const script = `let i=0;const s=${JSON.stringify(seq)};require('readline').createInterface({input:process.stdin}).on('line',()=>{const r=s[Math.min(i,s.length-1)];process.stdout.write(JSON.stringify({ok:true,...r})+'\\n');});process.stdin.on('end',()=>process.exit(0));`;
  const wt = require('../src/collectors/windowTracker');
  let step = 0;
  wt._injectHost(() => spawn(process.execPath, ['-e', script.replace('s[Math.min(i,s.length-1)]', 's[Math.min(Number(process.env.MT_STEP||0),2)]')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'ignore'] }));
  // 用 3 个独立宿主轮换模拟窗口切换
  for (step = 0; step < 3; step++) {
    const s = step;
    wt._injectHost(() => spawn(process.execPath, ['-e', script.replace('s[Math.min(i,s.length-1)]', `s[${s}]`)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'ignore'] }));
    wt.start({ getConfig: () => cfg, intervalMs: 100000 });
    await wait(1500);
  }
  wt.stop();
  await wait(800);
  const rows = store.all(`SELECT * FROM activities WHERE type='window' ORDER BY started_at`);
  t('三个窗口入库', rows.length === 3, rows.map(r => r.window_title).join(' | '));
  const n = rows.find(r => r.process_name === 'notepad');
  const m = JSON.parse(n.meta || '{}');
  t('记事本：文档名', m.doc && m.doc.name === '2.4.8 发布计划.md', JSON.stringify(m.doc));
  t('记事本：完整路径', n.file_path === doc, n.file_path);
  t('记事本：正文片段', /时间线显示文档名/.test(n.content || ''), (n.content || '').slice(0, 40));
  const w = rows.find(r => r.process_name === 'WeChat');
  t('微信：会话名', JSON.parse(w.meta).doc.name === '产品研发群');
  const e = rows.find(r => r.process_name === 'msedge');
  t('Edge：页面名', JSON.parse(e.meta).doc.page === 'DeepSeek API 文档');
  const rep = require('../src/core/reports').summarizeDay(store);
  t('日报含「处理的文档与页面」', /## 处理的文档与页面/.test(rep.markdown) && /2\.4\.8 发布计划\.md/.test(rep.markdown), rep.markdown.split('\n').slice(0, 14).join(' / '));
  const S = require('../src/ai/summarizer');
  const sec = S.docSection(store.all(`SELECT * FROM activities`));
  t('AI 日记提示词含文档清单与内容', /今日处理的文档/.test(sec) && /内容：/.test(sec), sec.slice(0, 120));
  const h = require('../src/core/health').contentStatus(cfg);
  t('健康：内容采集逐层计数', h.counts.windows >= 3 && h.counts.docNamed >= 2 && h.counts.pathResolved >= 1 && h.counts.snippet >= 1, h.short0 + ' / ' + h.detail.split('\n')[0]);
  console.log(`r10-integration: ${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
