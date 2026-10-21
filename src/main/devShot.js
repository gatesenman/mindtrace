// 开发用：--dev --shot-timeline=<png> 载入真实噪声样本并截取时间线（不进入正式流程）
const path = require('path');
function arg() { const a = process.argv.find(x => x.startsWith('--shot-timeline=')); return a && process.argv.includes('--dev') ? a.split('=')[1] : null; }
function prepareConfig(config) { if (!arg()) return; Object.assign(config, { onboardingCompleted: true, authorized: true, theme: process.argv.includes('--dark') ? 'dark' : 'light' }); for (const k of Object.keys(config.collectors || {})) config.collectors[k] = false; }
function seed(store) {
  if (!arg()) return;
  store.run(`DELETE FROM activities`);
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const rows = require(path.join(__dirname, '../../tests/fixtures/' + ((process.argv.find(x => x.startsWith('--fixture=')) || '=noisy-day').split('=')[1]) + '.js'))(d0.getTime());
  if (process.argv.includes('--seed-insert')) { for (const r of rows) { const { id, ...rest } = r; rest.meta = r.meta ? JSON.parse(r.meta) : undefined; store.insertActivity(rest); } try { store.persist(true); } catch (_) {} return; }
  for (const r of rows) store.run(`INSERT INTO activities (id,type,started_at,ended_at,duration_ms,app_name,process_name,window_title,url,file_path,content,meta,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [r.id, r.type, r.started_at, r.ended_at, r.duration_ms || 0, r.app_name || null, r.process_name || null, r.window_title || null, r.url || null, r.file_path || null, r.content || null, r.meta || null, Date.now()]);
  try { store.persist(true); } catch (_) {}
}
async function shoot(win) {
  const out = arg(); if (!out) return;
  const fs = require('fs'); const { app } = require('electron');
  win.setSize(1280, Number((process.argv.find(x => x.startsWith('--shot-h=')) || '=900').split('=')[1]));
  const d0 = new Date(); const day = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
  await new Promise(r => setTimeout(r, 2500));
  await win.webContents.executeJavaScript(`(async()=>{ ${process.argv.includes('--dark') ? "document.body.setAttribute('data-theme','dark');document.body.classList.add('theme-dark');" : ''} document.getElementById('onboarding')?.classList.add('hidden'); showView('timeline'); await loadTimeline({ forceDay:true, day:'${day}' }); ${process.argv.includes('--select') ? "setTimeout(()=>{ const b=[...document.querySelectorAll('.tlf-block')].find(x=>x.textContent.includes('微信')&&x.textContent.includes('张伟')); if(b){ b.click(); b.scrollIntoView({block:'center'}); } }, 600);" : ''} ${process.argv.includes('--compact') ? "localStorage.setItem('tl-density','compact'); document.getElementById('timeline-list').classList.add('compact');" : "localStorage.setItem('tl-density','comfortable'); document.getElementById('timeline-list').classList.remove('compact');"} })()`).catch(e => console.error(e));
  const ev = process.argv.find(x => x.startsWith('--shot-eval='));
  if (ev) { await win.webContents.executeJavaScript(fs.readFileSync(ev.split('=')[1], 'utf8')).catch(e => console.error('shot-eval', e)); }
  await new Promise(r => setTimeout(r, 2500));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG()); console.log('SHOT', out);
  app.exit(0);
}
module.exports = { arg, prepareConfig, seed, shoot };
