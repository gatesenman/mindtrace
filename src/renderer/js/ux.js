/* UX 审计落地：IA、页头上下文操作、快捷键、采集器单表+自动保存、设置分区、引导预设、
   时间轴刻度尺+悬停预览、Wiki 双链悬停卡片、设置进度清单、引用溯源侧滑面板 */
(function () {
  const mt = window.mindtrace;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(s == null ? '' : String(s));
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  titles.memory = ['记忆', '事实 · 偏好 · 决策 · 待办，含待审核队列'];
  titles.knowledge = ['报告', '日报 · 主题 · 知识卡片'];
  titles.wiki = ['Wiki', '人物 · 项目 · 主题 · 时间卷，含双链与反向链接'];

  /* ── 视图切换：页头操作按页面配置 + 记忆页 ── */
  const _show = window.showView;
  window.showView = function (name) {
    _show(name);
    document.querySelectorAll('.top-actions [data-scope]').forEach(b => b.classList.toggle('hidden', !b.dataset.scope.split(',').includes(name)));
    if (name === 'memory') window.MTPro?.renderMemories();
    if (name === 'collect') renderCollectors();
    if (name === 'ai') settingsTab(currentTab);
    if (name === 'dashboard') renderChecklist();
    refreshMemBadge();
  };
  async function refreshMemBadge() {
    const c = await mt.proMemoryCounts();
    const b = $('nav-mem-badge'); if (!b) return;
    b.textContent = c.pending; b.classList.toggle('hidden', !c.pending);
  }

  /* ── 快捷键：Ctrl+1…7 切换页面 ── */
  const ORDER = ['dashboard', 'timeline', 'wiki', 'memory', 'knowledge', 'chat', 'insights'];
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[1-7]$/.test(e.key)) {
      e.preventDefault(); showView(ORDER[Number(e.key) - 1]);
    }
  });

  /* ── 页头新增操作 ── */
  $('btn-h-wiki-day').onclick = async (e) => {
    const b = e.currentTarget; busy(b, true);
    const r = await mt.buildRollup({ level: 'day' });
    busy(b, false);
    toast(r.ok ? '已生成今日日卷' : '生成失败：' + r.error, { type: r.ok ? 'success' : 'error' });
    if (r.ok) loadWiki();
  };
  $('btn-h-new-chat').onclick = async () => {
    await mt.clearChat(); loadChat(); toast('已开始新对话', { type: 'success' });
  };
  $('btn-h-weekly').onclick = async () => {
    const w = await mt.proWeekly();
    const f = (m) => `${Math.floor(m / 60)}h ${m % 60}m`;
    const md = `## 本周回顾\n\n- 活跃：${f(w.totalMinutes)}\n- 深度工作：${f(w.deepWorkMinutes)}（专注分 ${w.deepWorkScore}）\n- 上下文切换：${w.contextSwitches} 次\n- 主要应用：${w.apps.slice(0, 5).map(a => a.name).join('、')}\n\n| 日期 | 活跃 | 深度 | 专注分 |\n|---|---|---|---|\n` + w.days.map(d => `| ${d.day} | ${f(d.minutes)} | ${f(d.deep)} | ${d.minutes ? d.score : '—'} |`).join('\n');
    await navigator.clipboard.writeText(md); toast('周回顾已复制为 Markdown', { type: 'success' });
  };
  function busy(btn, on) {
    if (!btn) return;
    btn.disabled = on; btn.classList.toggle('loading', on);
    if (on) { btn.dataset.label = btn.textContent; btn.innerHTML = '<span class="spinner"></span>' + esc(btn.dataset.label); }
    else if (btn.dataset.label) btn.textContent = btn.dataset.label;
  }
  window.MTUX = { busy };
  ['btn-summarize'].forEach(id => {
    const b = $(id); if (!b) return;
    const orig = b.onclick;
    if (orig) b.onclick = async (e) => { busy(b, true); try { await orig.call(b, e); } finally { busy(b, false); } };
  });

  /* ── 主题按钮：图标 ── */
  const syncThemeIcon = () => { $('btn-theme').title = document.body.getAttribute('data-theme') === 'dark' ? '切换到浅色' : '切换到深色'; };
  $('btn-theme').addEventListener('click', syncThemeIcon); syncThemeIcon();

  /* ── 暂停：带撤销 ── */
  const pause = $('btn-pause');
  if (pause) {
    const orig = pause.onclick;
    pause.onclick = async (e) => {
      if (pause.dataset.mode === 'setup') { showView('collect'); return; }
      const wasPaused = !!state?.config?.privacy?.paused;
      await orig.call(pause, e);
      if (!wasPaused) toast('已暂停采集', { type: 'info', action: { label: '撤销', run: async () => { await mt.setPaused(false); await refreshState(); toast('已恢复采集', { type: 'success' }); } } });
    };
  }

  /* ── 采集中心：单表 + 行内开关 + 自动保存 ── */
  const COLLECTORS = [
    ['window', '窗口与应用时间线', '前台应用、窗口标题、停留时长与 AFK'],
    ['browser', '浏览器历史', 'Chrome / Edge 多配置档（只读副本）'],
    ['documents', '文档与笔记', '关注文件夹中新建或修改的文档'],
    ['clipboard', '剪贴板文本', '文本与链接，自动脱敏'],
    ['notes', '笔记目录与速记', 'Obsidian / Markdown 笔记目录'],
    ['ide', 'IDE 会话', 'VS Code / Cursor 工作区与当日 Git 提交'],
    ['downloads', '下载文件夹', '新下载文件的文本摘录'],
    ['files', '最近打开的文件', '系统最近文档列表'],
    ['uia', '前台窗口可读文本（UIA）', 'UI Automation 读取可见文字，建议慎开'],
    ['screenshots', '定时截屏 + 识图', '用于微信等不便读库的软件；需视觉模型']
  ];
  const ST = { ok: ['运行中', 'ok'], error: ['异常', 'err'], off: ['已关闭', 'flat'], idle: ['待机', 'flat'] };
  // 把间隔/空闲两个字段移进采集器卡，隐藏重复的复选框分组
  (function relocate() {
    const iv = $('shot-interval')?.closest('.field'), id = $('idle-threshold')?.closest('.field');
    if (iv) $('slot-interval').replaceWith(iv); if (id) $('slot-idle').replaceWith(id);
    const grp = $('c-window')?.closest('.settings-group'); if (grp) grp.classList.add('hidden');
    const priv = $('bl-apps')?.closest('.settings-group');
    if (priv && grp) { grp.parentElement.classList.remove('two'); }
    $('btn-save-collect')?.classList.add('hidden');
    $('btn-capture2').onclick = () => $('btn-capture')?.click();
  })();
  async function renderCollectors() {
    const rows = await mt.getCollectorStatus();
    const byId = Object.fromEntries(rows.map(r => [r.id, r]));
    const cfg = state?.config?.collectors || {};
    $('collector-table').innerHTML = COLLECTORS.map(([id, name, desc]) => {
      const on = !!cfg[id]; const r = byId[id];
      const [txt, cls] = on ? (ST[r?.status] || ['已开启', 'info']) : ['已关闭', 'flat'];
      return `<tr><td><b>${esc(name)}</b><div class="tiny muted">${esc(desc)}</div>${on && r?.lastError ? `<div class="tiny err-text">${esc(r.lastError)}</div>` : ''}</td>
        <td class="nowrap"><span class="status-dot ${cls}"></span>${txt}${on && r?.lastOkAt ? `<div class="tiny muted">最近 ${hm(r.lastOkAt)}</div>` : ''}</td>
        <td class="num">${on && r ? (r.todayCount || 0) : '—'}</td>
        <td><label class="toggle" title="${on ? '关闭' : '开启'}${esc(name)}"><input type="checkbox" data-col="${id}" ${on ? 'checked' : ''} aria-label="${esc(name)}"><span></span></label></td></tr>`;
    }).join('');
    $('collector-table').querySelectorAll('[data-col]').forEach(cb => cb.onchange = () => {
      const box = $('c-' + cb.dataset.col); if (box) box.checked = cb.checked;
      const name = COLLECTORS.find(c => c[0] === cb.dataset.col)[1];
      autosave(`已${cb.checked ? '开启' : '关闭'}${name}`);
    });
  }
  let saveT = null;
  async function autosave(msg) {
    clearTimeout(saveT);
    const realToast = window.toast;
    window.toast = () => {};
    try { await $('btn-save-collect').onclick(); } finally { window.toast = realToast; }
    $('collect-saved').textContent = '已保存 · 刚刚';
    if (msg) toast(msg, { type: 'success' });
    renderCollectors();
  }
  ['shot-interval', 'idle-threshold', 'bl-apps', 'bl-sites', 'bl-keys', 'start-boot', 'demo-mode'].forEach(id => {
    const el = $(id); if (el) el.addEventListener('change', () => { clearTimeout(saveT); saveT = setTimeout(() => autosave('设置已自动保存'), 300); });
  });

  /* ── 设置：分区页签 ── */
  const TABS = [['model', 'AI 模型'], ['usage', '用量与任务'], ['integration', 'API 与 MCP'], ['data', '数据与备份'], ['about', '关于']];
  let currentTab = 'model';
  (function buildTabs() {
    const view = $('view-ai'); if (!view) return;
    const bar = document.createElement('div');
    bar.className = 'subnav'; bar.setAttribute('role', 'tablist');
    bar.innerHTML = TABS.map(([k, l]) => `<button type="button" role="tab" class="subnav-item" data-stab="${k}">${l}</button>`).join('');
    view.prepend(bar);
    const tag = (el, k) => { if (el) el.dataset.stabPane = k; };
    view.querySelectorAll(':scope > .card, :scope > .grid > .card').forEach(card => {
      const h = (card.querySelector('h3, .group-title')?.textContent || '');
      if (/用量|任务队列/.test(h)) tag(card, 'usage');
      else if (/备份/.test(h)) tag(card, 'data');
      else if (/MCP|集成/.test(h)) tag(card, 'integration');
      else if (/关于/.test(h)) tag(card, 'about');
      else tag(card, 'model');
    });
    // 将「体验示例数据」开关复制到关于页
    const about = view.querySelector('[data-stab-pane="about"]');
    if (about) {
      const row = document.createElement('div'); row.className = 'row-btns'; row.style.marginTop = '12px';
      row.innerHTML = '<button class="btn" id="btn-seed-about">体验 / 关闭示例数据</button><button class="btn ghost" id="btn-diag-about">导出诊断包</button>';
      about.appendChild(row);
      $('btn-seed-about').onclick = () => $('btn-seed').click();
      $('btn-diag-about').onclick = () => $('btn-diag').click();
    }
    bar.querySelectorAll('[data-stab]').forEach(b => b.onclick = () => settingsTab(b.dataset.stab));
  })();
  function settingsTab(k) {
    currentTab = k;
    const view = $('view-ai');
    view.querySelectorAll('.subnav-item').forEach(b => { const on = b.dataset.stab === k; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
    view.querySelectorAll('[data-stab-pane]').forEach(c => c.classList.toggle('hidden', c.dataset.stabPane !== k));
    view.querySelectorAll(':scope > .grid').forEach(g => { const vis = [...g.children].filter(c => !c.classList.contains('hidden')).length; g.classList.toggle('hidden', !vis); g.classList.toggle('single', vis === 1); });
  }
  window.MTUX.settingsTab = settingsTab;

  /* ── 引导：预设 + Key 为空时禁用测试连接 ── */
  const PRESETS = { light: ['window', 'browser'], recommended: ['window', 'browser', 'documents', 'ide', 'downloads'], full: ['window', 'browser', 'documents', 'ide', 'downloads', 'clipboard', 'screenshots'] };
  document.querySelectorAll('[data-preset]').forEach(card => card.onclick = () => {
    document.querySelectorAll('[data-preset]').forEach(c => c.classList.toggle('active', c === card));
    const on = PRESETS[card.dataset.preset];
    ['window', 'browser', 'documents', 'clipboard', 'ide', 'downloads', 'screenshots'].forEach(k => { const el = $('ob-c-' + k); if (el) el.checked = on.includes(k); });
  });
  const syncTest = () => { const has = !!$('ob-ai-key').value.trim(); $('ob-test').disabled = !has; $('ob-test').title = has ? '' : '请先填写 API Key'; };
  $('ob-ai-key')?.addEventListener('input', syncTest); syncTest();

  /* ── 时间轴刻度尺 + 悬停预览 + 框选 ── */
  let scrubData = null, sel = null;
  const _loadTimeline = window.loadTimeline;
  window.loadTimeline = async function (opts = {}) {
    await _loadTimeline(opts);
    $('timeline-list').classList.toggle('rollups', timelineZoom !== 'day' && !opts.forceDay);
    const sc = $('tl-scrubber');
    if (timelineZoom !== 'day' && !opts.forceDay) { sc.classList.add('hidden'); return; }
    if (!opts._fromScrub) { sel = null; await renderScrubber(opts.day); }
  };
  async function renderScrubber(day) {
    const sc = $('tl-scrubber');
    const d0 = day ? new Date(day + 'T00:00:00') : new Date(); d0.setHours(0, 0, 0, 0);
    const from = d0.getTime(), to = from + 86400000;
    const items = await mt.getTimeline({ from, to, limit: 3000, group: false, hideLow: true });
    const bins = Array.from({ length: 96 }, () => ({ n: 0, apps: {} }));
    items.forEach(a => { const i = Math.floor((a.started_at - from) / 900000); if (i >= 0 && i < 96) { bins[i].n++; const k = a.app_name || a.type; bins[i].apps[k] = (bins[i].apps[k] || 0) + 1; } });
    scrubData = { from, bins, items };
    const max = Math.max(1, ...bins.map(b => b.n));
    sc.classList.remove('hidden');
    sc.innerHTML = `<div class="scrub-head"><b>今日活动密度</b><span class="tiny muted" id="scrub-hint">悬停查看时段摘要 · 拖动框选时段</span><span class="scrub-legend">每格 15 分钟 · 平方根刻度 · 峰值 ${max} 条 · 已隐藏低价值事件</span><span class="scrub-actions hidden" id="scrub-actions"><span class="tiny" id="scrub-range"></span><button class="btn sm" id="scrub-ask">问这段时间</button><button class="btn sm ghost" id="scrub-clear">清除选择</button></span></div>
      <div class="scrub-wrap"><div class="scrub-y"><span style="top:0">${max}</span><span style="top:50%">${Math.max(1, Math.round(Math.sqrt(max) ** 2 / 4))}</span><span style="top:100%">0</span></div>
      <div class="scrub-track tall" id="scrub-track">${bins.map((b, i) => `<i style="--h:${b.n ? Math.max(8, Math.round(Math.sqrt(b.n / max) * 100)) : 0}%" data-i="${i}" class="${b.n ? '' : 'z'}" title="${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)} · ${b.n} 条"></i>`).join('')}<div class="scrub-sel hidden" id="scrub-sel"></div></div></div>
      <div class="scrub-axis pad">${[0, 3, 6, 9, 12, 15, 18, 21, 24].map(h => `<span style="left:${h / 24 * 100}%">${pad(h)}:00</span>`).join('')}</div>
      <div class="scrub-tip hidden" id="scrub-tip" role="tooltip"></div>`;
    const track = $('scrub-track'), tip = $('scrub-tip');
    const idxAt = (x) => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(95, Math.floor((x - r.left) / r.width * 96))); };
    let dragA = null;
    track.onmousemove = (e) => {
      const i = idxAt(e.clientX), b = bins[i];
      if (dragA != null) { drawSel(Math.min(dragA, i), Math.max(dragA, i)); }
      const top = Object.entries(b.apps).sort((x, y) => y[1] - x[1]).slice(0, 3);
      const t0 = from + i * 900000;
      tip.innerHTML = `<div class="tip-time">${hm(t0)} – ${hm(t0 + 900000)}</div>` + (b.n ? `<div class="tiny muted">${b.n} 条活动</div>${top.map(([k, n]) => `<div class="tip-row"><span>${esc(k)}</span><span class="num">${n}</span></div>`).join('')}` : '<div class="tiny muted">无活动 / 离开</div>');
      const r = track.getBoundingClientRect();
      tip.style.left = Math.min(r.width - 180, Math.max(0, e.clientX - r.left - 90)) + 'px';
      tip.classList.remove('hidden');
    };
    track.onmouseleave = () => tip.classList.add('hidden');
    track.onmousedown = (e) => { dragA = idxAt(e.clientX); drawSel(dragA, dragA); e.preventDefault(); };
    window.addEventListener('mouseup', function up(e) {
      if (dragA == null) return;
      const b = idxAt(e.clientX); const a = Math.min(dragA, b), z = Math.max(dragA, b); dragA = null;
      applySel(a, z);
    });
    $('scrub-clear').onclick = () => { sel = null; $('scrub-sel').classList.add('hidden'); $('scrub-actions').classList.add('hidden'); $('scrub-hint').classList.remove('hidden'); window.loadTimeline({ _fromScrub: true, day }); };
    $('scrub-ask').onclick = () => { if (!sel) return; showView('chat'); $('chat-input').value = `我在 ${hm(sel.from)}–${hm(sel.to)} 这段时间做了什么？有哪些产出和待办？`; $('btn-ask').click(); };
  }
  function drawSel(a, z) { const s = $('scrub-sel'); s.style.left = (a / 96 * 100) + '%'; s.style.width = ((z - a + 1) / 96 * 100) + '%'; s.classList.remove('hidden'); }
  function applySel(a, z) {
    drawSel(a, z);
    sel = { from: scrubData.from + a * 900000, to: scrubData.from + (z + 1) * 900000 };
    $('scrub-range').textContent = `${hm(sel.from)} – ${hm(sel.to)} · ${scrubData.items.filter(x => x.started_at >= sel.from && x.started_at < sel.to).length} 条`;
    $('scrub-actions').classList.remove('hidden'); $('scrub-hint').classList.add('hidden');
    window.loadTimeline({ _fromScrub: true, from: sel.from, to: sel.to, limit: 500 });
  }

  /* ── Wiki 双链悬停卡片 ── */
  let wikiPages = [];
  const _loadWiki = window.loadWiki;
  window.loadWiki = async function () { await _loadWiki(); wikiPages = await mt.getWiki(); };
  const norm = (s) => String(s || '').replace(/^【示例】/, '').trim();
  function openWiki(slug) { const el = document.querySelector(`#wiki-list [data-slug="${CSS.escape(slug)}"]`); if (el) el.click(); }
  window.MTUX.openWiki = openWiki;
  // 正文渲染后把 [[X]] 变为可悬停链接
  new MutationObserver(() => {
    const body = $('wiki-body'); if (!body || body.dataset.linked === body.innerHTML.length + '') return;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) if (/\[\[[^\]]+\]\]/.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
    nodes.forEach(n => {
      const span = document.createElement('span');
      span.innerHTML = esc(n.nodeValue).replace(/\[\[([^\]]+)\]\]/g, (_, x) => `<a class="wikilink" data-t="${x}" tabindex="0">${x}</a>`);
      n.replaceWith(span);
    });
    body.dataset.linked = body.innerHTML.length + '';
  }).observe(document.getElementById('wiki-body') || document.body, { childList: true, subtree: true });
  const card = document.createElement('div'); card.className = 'hovercard hidden'; card.setAttribute('role', 'tooltip'); document.body.appendChild(card);
  let hoverT = null;
  document.addEventListener('mouseover', (e) => {
    const a = e.target.closest?.('.wikilink'); if (!a) return;
    clearTimeout(hoverT);
    hoverT = setTimeout(() => showCard(a), 300);
  });
  document.addEventListener('mouseout', (e) => { if (e.target.closest?.('.wikilink') && !card.matches(':hover')) { clearTimeout(hoverT); setTimeout(() => { if (!card.matches(':hover')) card.classList.add('hidden'); }, 150); } });
  card.addEventListener('mouseleave', () => card.classList.add('hidden'));
  document.addEventListener('click', (e) => { const a = e.target.closest?.('.wikilink'); if (!a) return; const p = wikiPages.find(x => norm(x.title) === a.dataset.t); if (p) openWiki(p.slug); else toast('还没有「' + a.dataset.t + '」页面', { type: 'info' }); });
  function showCard(a) {
    const t = a.dataset.t;
    const p = wikiPages.find(x => norm(x.title) === t);
    const mentions = wikiPages.filter(x => (x.body_md || '').includes(`[[${t}]]`));
    const KIND = { person: '人物', project: '项目', topic: '主题', time: '时间卷' };
    const snippet = p ? (p.body_md || '').replace(/^##.*\n+/, '').replace(/\n+-\s*/g, ' · ').replace(/^-\s*/, '').replace(/[#*>`\[\]]/g, '').slice(0, 120) : '尚未建立页面，生成日卷后可能自动创建。';
    card.innerHTML = `<div class="hc-head"><b>${esc(t)}</b>${p ? `<span class="tag-pill">${KIND[p.kind] || p.kind}</span>` : '<span class="tag-pill">未创建</span>'}${p && /^【示例】/.test(p.title) ? '<span class="demo-tag">示例</span>' : ''}</div>
      <div class="hc-body">${esc(snippet)}</div>
      <div class="hc-meta tiny muted">被 ${mentions.length} 个页面提及${p ? ` · 更新于 ${new Date(p.updated_at).toLocaleDateString('zh-CN')}` : ''}</div>
      ${mentions.length ? `<div class="hc-links">${mentions.slice(0, 4).map(m => `<span class="backlink" data-slug="${esc(m.slug)}">${esc(norm(m.title))}</span>`).join('')}</div>` : ''}
      <div class="row-btns"><button class="btn sm primary" data-open="${p ? esc(p.slug) : ''}" ${p ? '' : 'disabled'}>打开</button><button class="btn sm ghost" data-ask="${esc(t)}">问 AI</button></div>`;
    const r = a.getBoundingClientRect();
    card.style.left = Math.min(window.innerWidth - 300, r.left) + 'px';
    card.style.top = (r.bottom + 6) + 'px';
    card.classList.remove('hidden');
    card.querySelector('[data-open]').onclick = (e) => { card.classList.add('hidden'); openWiki(e.currentTarget.dataset.open); };
    card.querySelector('[data-ask]').onclick = () => { card.classList.add('hidden'); showView('chat'); $('chat-input').value = `关于「${t}」我最近有哪些记录？`; $('btn-ask').click(); };
    card.querySelectorAll('.backlink').forEach(b => b.onclick = () => { card.classList.add('hidden'); openWiki(b.dataset.slug); });
  }

  /* ── 设置进度清单（总览顶部） ── */
  async function renderChecklist() {
    if (localStorage.getItem('mt.checklist.hidden') === '1') { $('ob-checklist')?.remove(); return; }
    const c = state?.config || {};
    const [journals, mc] = await Promise.all([mt.getJournals(), mt.proMemoryCounts()]);
    const items = [
      ['授权采集', !!c.authorized, null],
      ['开启至少一个采集项', Object.values(c.collectors || {}).some(Boolean), () => showView('collect')],
      ['配置 AI 模型', !!state?.configRawKeySet, () => { showView('ai'); settingsTab('model'); }],
      ['接入 Cursor / Claude（MCP）', !!c.api?.enabled, () => { showView('ai'); settingsTab('integration'); }],
      ['生成第一份日报', journals.length > 0, () => $('btn-summarize')?.click()],
      ['审核待定记忆', mc.pending === 0, () => showView('memory')]
    ];
    const done = items.filter(i => i[1]).length;
    let el = $('ob-checklist');
    if (!el) { el = document.createElement('div'); el.id = 'ob-checklist'; el.className = 'card checklist'; $('view-dashboard').prepend(el); }
    if (done === items.length) { el.remove(); return; }
    el.innerHTML = `<div class="card-head"><h3>设置进度 <span class="num">${done}/${items.length}</span></h3><div class="row-btns"><div class="progress"><span style="width:${done / items.length * 100}%"></span></div><button class="btn sm ghost" id="cl-hide">收起</button></div></div>
      <div class="cl-items">${items.map(([l, ok], i) => `<button type="button" class="cl-item${ok ? ' done' : ''}" data-cl="${i}" ${ok ? 'disabled' : ''}><span class="cl-check">${ok ? '✓' : ''}</span>${esc(l)}</button>`).join('')}</div>`;
    el.querySelectorAll('[data-cl]').forEach(b => b.onclick = () => items[+b.dataset.cl][2]?.());
    $('cl-hide').onclick = () => { localStorage.setItem('mt.checklist.hidden', '1'); el.remove(); };
  }

  /* ── 引用溯源侧滑面板 ── */
  const panel = document.createElement('aside');
  panel.className = 'side-panel'; panel.setAttribute('aria-label', '引用溯源'); panel.innerHTML = '<div class="sp-head"><b>引用溯源</b><button class="icon-btn" id="sp-close" aria-label="关闭">×</button></div><div class="sp-body" id="sp-body"></div>';
  document.body.appendChild(panel);
  $('sp-close').onclick = () => panel.classList.remove('open');
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.classList.remove('open'); });
  document.addEventListener('click', async (e) => {
    const c = e.target.closest?.('#view-chat .cite, #view-chat [data-cite-id], #view-chat .citation');
    if (!c) return;
    const id = c.dataset.id || c.dataset.citeId; const kind = c.dataset.citeKind || c.dataset.kind || 'activity';
    if (!id || !['activity', 'event'].includes(kind)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const r = await mt.getById('activity', id);
    if (!r.ok || !r.item) return;
    const a = r.item;
    const ctx = await mt.getTimeline({ from: a.started_at - 5 * 60000, to: a.started_at + 5 * 60000, limit: 30 });
    $('sp-body').innerHTML = `<div class="sp-src"><div class="tiny muted">${new Date(a.started_at).toLocaleString('zh-CN')} · ${esc(typeLabel(a.type))}</div><h4>${esc(a.app_name || '')} ${esc(a.window_title || '')}</h4>${a.url ? `<div class="tiny">${esc(a.url)}</div>` : ''}${a.content ? `<div class="sp-content">${esc(String(a.content).slice(0, 600))}</div>` : ''}</div>
      <div class="sp-sec">前后 5 分钟</div>${ctx.map(x => `<div class="sp-ctx${x.id === a.id ? ' cur' : ''}"><span class="num tiny">${hm(x.started_at)}</span><span>${esc(x.app_name || '')} · ${esc((x.window_title || '').slice(0, 40))}</span></div>`).join('')}
      <div class="row-btns" style="margin-top:12px"><button class="btn sm" id="sp-goto">在时间线中查看</button><button class="btn sm ghost" id="sp-block">不再采集此来源</button></div>`;
    panel.classList.add('open');
    $('sp-goto').onclick = () => { panel.classList.remove('open'); showView('timeline'); loadTimeline({ focusId: a.id }); };
    $('sp-block').onclick = async () => {
      const r0 = await mt.proGetRules();
      const host = (() => { try { return a.url ? new URL(a.url).host : null; } catch { return null; } })();
      const rule = host ? { match: host, scope: 'site', mode: 'none' } : { match: a.app_name || '', scope: 'app', mode: 'none' };
      if (!rule.match) return;
      await mt.proSetRules({ rules: [...r0.rules, rule] });
      toast(`已添加规则：不再采集「${rule.match}」`, { type: 'success', action: { label: '撤销', run: () => mt.proSetRules({ rules: r0.rules }) } });
    };
  }, true);

  // 首屏：按当前视图初始化页头
  setTimeout(() => { const v = document.querySelector('#nav .nav-item.active')?.dataset.view || 'dashboard'; document.querySelectorAll('.top-actions [data-scope]').forEach(b => b.classList.toggle('hidden', !b.dataset.scope.split(',').includes(v))); renderChecklist(); refreshMemBadge(); }, 300);
})();
