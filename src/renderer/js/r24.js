// 知迹 2.4 渲染层：出网账本 / 本地 OCR 状态（R1）
(function () {
  const mt = window.mindtrace; if (!mt || !mt.r24) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PURPOSE = { 'llm:chat': 'AI 问答', 'llm:extract': 'AI 抽取', 'llm:vision': '云端识图', 'llm:test': '测试连接', 'llm:models': '模型列表', favicon: '网站图标' };
  const pname = (p) => PURPOSE[p] || (p.startsWith('llm:') ? 'AI · ' + p.slice(4) : p);
  async function refreshNet() {
    let s; try { s = await mt.r24('net-stats'); } catch (_) { return; }
    const pill = $('net-pill'), txt = $('net-pill-text');
    if (pill) {
      pill.classList.toggle('local', s.external === 0);
      pill.classList.toggle('blocked', s.blocked > 0);
      txt.innerHTML = s.localOnly ? `仅本地 · 外发 <b>${s.external}</b> · 拦截 <b>${s.blocked}</b>` : `本日外发 <b>${s.external}</b> 次${s.blocked ? ` · 拦截 <b>${s.blocked}</b>` : ''}`;
    }
    const led = $('net-ledger');
    if (led) {
      const rows = (s.last || []).map(r => `<div class="nl-row"><span>${new Date(r.t).toTimeString().slice(0, 5)}</span><span>${esc(r.host)}</span><span>${esc(pname(r.purpose))}</span><span class="${r.ok ? 'ok' : 'no'}">${r.ok ? (r.local ? '本机' : '已发送') : '已拦截'}</span></div>`).join('');
      led.innerHTML = `<div class="nl-head"><span><b>${s.external}</b>次外发</span><span><b>${s.blocked}</b>次拦截</span><span><b>${s.local}</b>次本机</span><span style="margin-left:auto">出网账本 · 今日</span></div>${rows || '<div class="nl-empty">今天没有任何出网请求。所有采集、OCR 与检索均在本机完成。</div>'}`;
    }
  }
  async function refreshOcr() {
    const host = $('pr-localonly')?.closest('.card') || $('net-ledger')?.parentElement; if (!host || $('ocr-status')) return;
    const el = document.createElement('div'); el.className = 'ocr-status'; el.id = 'ocr-status'; host.appendChild(el);
    let r; try { r = await mt.r24('ocr-status'); } catch (_) { r = { ok: false }; }
    el.innerHTML = `<span>截图文字识别</span><span class="chip ${r.ok ? 'on' : ''}">${r.ok ? 'Windows 本地 OCR · ' + esc(r.lang) : '本地 OCR 不可用'}</span><span class="tiny">${r.ok ? '截图文字在本机识别，不上传' : esc(r.error || '')}</span>`;
  }
  const LC = { focus: '#3B82F6', content: '#8B5CF6', authoring: '#10B981', artifact: '#F59E0B', communication: '#EC4899', context: '#64748B' };
  const CN = { window: '窗口', browser: '浏览器', uia: '界面文字', documents: '文档', screenshots: '截图 OCR', notes: '笔记', ide: 'IDE/Git', clipboard: '剪贴板', files: '最近文件', downloads: '下载' };
  const OT = { web: '网页', file: '文件', window: '窗口', conversation: '会话' };
  const AD = { window: '窗口', browser: '历史', uia: 'UIA', screenshot: 'OCR', document: '文档', clipboard: '复制', note: '笔记', ide: 'IDE', file: '文件', download: '下载' };
  async function refreshSignal() {
    const g = $('sig-grid'); if (!g) return;
    let r; try { r = await mt.r24('signal-overview'); } catch (_) { return; }
    const COMM_HINT = { communication: '来自微信/飞书等应用的内容层信号自动归入', context: '空闲 / 电源 / 网络 · 只打标签不上时间轴' };
    const CN2 = { ...CN, context: '上下文' };
    g.innerHTML = r.layers.map(l => `<div class="sig-tile ${l.enabled || l.today ? '' : 'off'}" style="--lc:${LC[l.key]}"><div class="sn"><i></i>${esc(l.name)}</div><div class="sv">${l.today}<small>条 · 今日</small></div><div class="sd">${esc(l.desc)}</div><div class="sc">${l.collectors.length ? l.collectors.map(c => `<span class="${(r.collectorsOn || {})[c] ? 'on' : ''}">${CN2[c] || CN[c] || c}</span>`).join('') : `<span>${esc(COMM_HINT[l.key] || '')}</span>`}</div></div>`).join('');
    const d = r.dedup || { seen: 0, dropped: 0 };
    $('sig-objects').innerHTML = `<div class="sig-kpis"><div><b>${r.objects.total}</b>今日触达对象</div><div><b>${r.objects.multi}</b>多来源归并的对象</div><div><b>${d.dropped}</b>跨来源重复已去除（本次运行 ${d.seen} 条中）</div></div>
      <div class="sig-objlist"><div class="oh">今日高频对象 · 同一网页/文件无论来自历史、界面文字还是 OCR 都只算一个</div>${(r.objects.top || []).map(o => `<div class="orow"><span class="otype">${OT[o.type] || o.type}</span><span class="ot">${esc(o.title || o.uri)}<small>${esc(o.uri)}</small></span><span class="oa">${String(o.adapters || '').split(',').filter(Boolean).map(a => `<span>${AD[a] || a}</span>`).join('')}</span><span class="on">${o.touches} 次</span></div>`).join('') || '<div class="nl-empty">开启采集后，这里会列出今天反复触达的网页、文件和会话。</div>'}</div>`;
  }
  window.r24 = { refreshNet, refreshOcr, refreshSignal };
  document.addEventListener('DOMContentLoaded', () => {
    refreshNet(); setInterval(refreshNet, 15000);
    $('net-pill')?.addEventListener('click', () => { document.querySelector('[data-view=ai]')?.click(); setTimeout(() => { document.querySelector('[data-stab=usage]')?.click(); refreshNet(); refreshOcr(); $('net-ledger')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 300); });
    document.querySelector('[data-view=collect]')?.addEventListener('click', () => setTimeout(refreshSignal, 150));
    document.querySelector('[data-view=ai]')?.addEventListener('click', () => setTimeout(() => { refreshNet(); refreshOcr(); }, 200));
  });
})();
// ── R3：回忆框入口 / 首日见效 / MCP 一键接入 ──
(function () {
  const mt = window.mindtrace; if (!mt || !mt.r24) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toastF = (m) => (window.toast ? window.toast(m) : console.log(m));
  const SRC = [['browser', '浏览历史'], ['downloads', '下载文件夹'], ['files', '最近打开的文件'], ['git', 'Git 提交']];
  function consent(progress = {}) {
    $('ftv-card').innerHTML = `<div class="ftv-consent"><div><h3>10 分钟看到价值：回填过去 7 天</h3><p>知迹可以读取这台电脑上<b>本来就有</b>的记录，立即生成一份「过去 7 天回顾」。全部在本机处理，不调用 AI、不上传。</p>
      <div class="ftv-src">${SRC.map(([k, n]) => `<span class="${progress[k]?.state || ''}">${progress[k]?.state === 'done' ? '✓ ' : ''}${n}${progress[k]?.added != null ? ` · ${progress[k].added}` : ''}</span>`).join('')}</div>
      <div class="ftv-note">不会读取：聊天数据库、密码、浏览器 Cookie 与表单。可随时在「采集中心 → 数据清除」按时间段删除。</div></div>
      <div class="row-btns"><button class="btn ghost" id="ftv-skip">以后再说</button><button class="btn primary" id="ftv-go">同意并回填</button></div></div>`;
    $('ftv-skip').onclick = () => { localStorage.setItem('ftv-skip', '1'); $('ftv-card').innerHTML = ''; };
    $('ftv-go').onclick = async () => {
      $('ftv-go').disabled = true; $('ftv-go').textContent = '正在回填…';
      const r = await mt.r24('backfill', { days: 7 });
      if (!r.ok) { toastF('回填失败：' + r.error); $('ftv-go').disabled = false; $('ftv-go').textContent = '同意并回填'; return; }
      toastF(`已回填 ${r.total} 条本机记录`); renderReview(await mt.r24('review7'));
    };
  }
  const prog = {};
  mt.onR24 && mt.onR24('backfill-progress', (p) => { prog[p.key] = p; if ($('ftv-go')) consent(prog), ($('ftv-go').disabled = true), ($('ftv-go').textContent = '正在回填…'); });
  function renderReview(v) {
    const max = Math.max(1, ...v.byDay.map(d => d.c));
    const list = (rows, f) => rows.length ? rows.map(f).join('') : '<div class="ftv-row"><span class="nm tiny" style="color:var(--text-3)">暂无</span></div>';
    const siteMax = Math.max(1, ...v.topSites.map(s => s.visits));
    $('ftv-card').innerHTML = `<div class="ftv-head"><h3>过去 7 天回顾</h3><span class="tiny">${v.backfillDoneAt ? '含回填数据 · ' : ''}纯本地规则统计，无需 AI</span><div class="row-btns"><button class="btn sm" id="ftv-recall">打开回忆框</button></div></div>
      <div class="ftv-grid"><div class="ftv-kpi"><div><b>${v.daysActive}</b>活跃天数</div><div><b>${v.total.toLocaleString()}</b>条记录</div><div><b>${v.commits}</b>次代码提交</div><div>每日记录<div class="ftv-days">${v.byDay.map(d => `<i title="${d.d} · ${d.c}" style="height:${Math.round(d.c / max * 100)}%"></i>`).join('')}</div></div></div>
      <div class="ftv-col"><h4>常去的网站</h4>${list(v.topSites, s => `<div class="ftv-row"><span class="nm" title="${esc(s.sample || '')}">${esc(s.host)}</span><span class="bar" style="width:${Math.round(s.visits / siteMax * 60)}px"></span><span class="ct">${s.visits}</span></div>`)}</div>
      <div class="ftv-col"><h4>反复打开的文件</h4>${list(v.files, f => `<div class="ftv-row"><span class="nm" title="${esc(f.path)}">${esc(f.name)}</span><span class="ct">${f.n} 次</span></div>`)}</div>
      <div class="ftv-col"><h4>项目与提交</h4>${list(v.repos, r => `<div class="ftv-row"><span class="nm">${esc(r.name)}</span><span class="ct">${r.commits} 次提交</span></div>`)}${v.apps.length ? `<h4 style="margin-top:12px">最常用应用</h4>${v.apps.slice(0, 3).map(a => `<div class="ftv-row"><span class="nm">${esc(a.a)}</span><span class="ct">${Math.round(a.ms / 3600000 * 10) / 10} 小时</span></div>`).join('')}` : ''}</div></div>`;
    $('ftv-recall').onclick = () => mt.r24('recall-toggle');
  }
  async function loadFtv() {
    if (!$('ftv-card')) return;
    let v; try { v = await mt.r24('review7'); } catch (_) { return; }
    if (v.backfillDoneAt || v.total > 50) renderReview(v);
    else if (!localStorage.getItem('ftv-skip')) consent();
  }
  const LG = { cursor: ['C', '#111827'], claude: ['A', '#D97757'] };
  async function loadMcp1() {
    const el = $('mcp1'); if (!el) return;
    let s; try { s = await mt.r24('mcp-status'); } catch (_) { return; }
    el.innerHTML = Object.entries(s.targets).map(([k, t]) => `<div class="mcp1-t"><div class="lg" style="background:${LG[k][1]}">${LG[k][0]}</div><div class="mt"><b>${esc(t.name)}</b><span class="${t.current ? 'ok' : ''}">${t.error ? esc(t.error) : t.current ? '已接入 · 重启该应用后生效' : t.installed ? '已接入（令牌已变化，建议更新）' : t.detected ? '已检测到，未接入' : '未检测到安装'}</span></div><button class="btn sm ${t.current ? '' : 'primary'}" data-mcp1="${k}">${t.current ? '重新写入' : '一键接入'}</button></div>`).join('');
    el.querySelectorAll('[data-mcp1]').forEach(b => b.onclick = async () => {
      b.disabled = true; const r = await mt.r24('mcp-install', { key: b.dataset.mcp1 });
      toastF(r.ok ? `已写入 ${r.name} 配置${r.backup ? '（原文件已备份）' : ''}，重启 ${r.name} 即可使用` : '接入失败：' + r.error);
      loadMcp1(); window.MTPro?.loadSettingsPro?.();
    });
  }
  window.r24 = Object.assign(window.r24 || {}, { loadFtv, loadMcp1, renderReview, consent });
  document.addEventListener('DOMContentLoaded', () => {
    $('recall-btn')?.addEventListener('click', () => mt.r24('recall-toggle'));
    loadFtv();
    document.querySelector('[data-view=dashboard]')?.addEventListener('click', () => setTimeout(loadFtv, 100));
    document.querySelector('[data-view=ai]')?.addEventListener('click', () => setTimeout(loadMcp1, 250));
    document.addEventListener('click', (e) => { if (e.target?.dataset?.stab === 'integration') setTimeout(loadMcp1, 50); });
    mt.onR24 && mt.onR24('goto', (d) => { document.querySelector(`[data-view=${d.view || 'timeline'}]`)?.click(); });
  });
})();
  // R6：日报/周报入口（采集中心信号卡下方）
  async function mountReports() {
    const host = $('sig-objects'); if (!host || $('r6-reports')) return;
    const box = document.createElement('div'); box.id = 'r6-reports'; box.className = 'r6-reports';
    box.innerHTML = `<div class="oh">主动产出</div>
      <div class="r6-actions">
        <button class="btn ghost" data-r="daily">生成今日日报</button>
        <button class="btn ghost" data-r="weekly">生成本周周报</button>
        <button class="btn ghost" data-r="commit">扫描聊天承诺</button>
      </div>
      <pre class="r6-out muted tiny" id="r6-out"></pre>`;
    host.appendChild(box);
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-r]'); if (!b) return;
      const out = $('r6-out'); out.textContent = '生成中…';
      try {
        let r;
        if (b.dataset.r === 'daily') r = await mt.r24('report-daily', {});
        else if (b.dataset.r === 'weekly') r = await mt.r24('report-weekly', {});
        else r = await mt.r24('commitments-scan', {});
        if (r.markdown) out.textContent = r.markdown.slice(0, 1200);
        else out.textContent = JSON.stringify(r, null, 2).slice(0, 800);
        if (window.toast) window.toast(r.ok === false ? (r.error || '失败') : (b.dataset.r === 'commit' ? `承诺 ${r.created?.length || 0} 条` : '已写入日记'));
      } catch (err) { out.textContent = String(err.message || err); }
    });
  }
  const _rs = refreshSignal;
  refreshSignal = async () => { await _rs(); mountReports(); };
