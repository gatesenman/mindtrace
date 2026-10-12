/* 知迹 2.3.2 时间线活动流：会话块 + 按小时分组 + 详情面板 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtDur = (ms) => { if (!ms || ms < 1000) return ''; if (ms < 60000) return Math.round(ms / 1000) + 's'; const m = Math.round(ms / 60000); return m < 60 ? m + 'm' : `${Math.floor(m / 60)}h ${m % 60}m`; };
  const meta = (m) => { if (!m) return {}; if (typeof m === 'object') return m; try { return JSON.parse(m); } catch (_) { return {}; } };
  const isDemo = (a) => { const m = meta(a.meta); return !!(m.isDemo || m.demo); };
  const GAP = 5 * 60000;
  const CHAT = /微信|wechat|weixin|qq|飞书|lark|钉钉|dingtalk|teams|slack|telegram|企业微信|wxwork/i;
  const IDE = /code|cursor|idea|pycharm|webstorm|visual studio|sublime|vim|zed|android studio/i;
  const BROWSER = /edge|chrome|firefox|safari|opera|brave|浏览器|arc/i;
  const GENERIC = /^(微信|wechat|图片和视频|聊天文件|搜索|新标签页|new tab|飞书|钉钉|qq|主页|home)$/i;
  const TYPE = {
    window: ['应用', 'M3 5h18v14H3zM3 9h18'], browser: ['网页', 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18'],
    document: ['文档', 'M6 3h9l4 4v14H6zM14 3v5h5'], clipboard: ['复制', 'M8 4h8v3H8zM6 6h12v15H6z'], screenshot: ['截屏', 'M4 7h4l2-2h4l2 2h4v12H4zM12 10a3 3 0 100 6 3 3 0 000-6z'],
    ide: ['代码', 'M9 8l-4 4 4 4M15 8l4 4-4 4'], note: ['笔记', 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5'], uia: ['界面文本', 'M4 6h16M4 12h10M4 18h7'], download: ['下载', 'M12 4v11M7 10l5 5 5-5M5 20h14'], file: ['文件', 'M6 3h9l4 4v14H6z']
  };
  const svg = (d, s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const chip = (t, n) => { const [l, d] = TYPE[t] || [t, TYPE.window[1]]; return `<span class="tlf-chip t-${esc(t)}">${svg(d, 12)}${l}${n > 1 ? ` <b>${n}</b>` : ''}</span>`; };
  const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch (_) { return ''; } };
  const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p;
  let iconCache = {}; let aiCache = {}; let state = { blocks: [], sel: null };
  const pref = () => localStorage.getItem('tl-density') || 'comfortable';

  /* ── 分块：连续同应用（窗口/网页/界面文本/文档）合并 ── */
  function toBlocks(items) {
    const flat = [];
    for (const it of items) { if (it.type === 'session' && it.items) flat.push(...it.items); else flat.push(it); }
    flat.sort((a, b) => a.started_at - b.started_at);
    const blocks = []; let cur = null;
    const mergeable = (t) => ['window', 'browser', 'uia', 'document'].includes(t);
    for (const a of flat) {
      const m = meta(a.meta);
      const app = (a.app_name || m.sourceApp || '').trim() || ({ clipboard: '剪贴板', note: '笔记', ide: 'IDE' }[a.type] || '其他');
      const end = Number(a.ended_at || 0) || (a.started_at + Number(a.duration_ms || 0));
      if (cur && mergeable(a.type) && cur.mergeable && cur.app === app && a.started_at - cur.end <= GAP) { cur.items.push(a); cur.end = Math.max(cur.end, end); continue; }
      cur = { id: 'b-' + a.id, app, process: a.process_name || m.process || '', exe: m.exe || '', start: a.started_at, end: Math.max(end, a.started_at), items: [a], mergeable: mergeable(a.type) };
      blocks.push(cur);
    }
    for (const b of blocks) {
      b.types = {}; b.items.forEach(i => b.types[i.type] = (b.types[i.type] || 0) + 1);
      b.titles = [...new Set(b.items.map(i => (i.window_title || '').trim()).filter(t => t && t !== b.app))];
      b.urls = [...new Set(b.items.map(i => i.url).filter(Boolean))];
      b.paths = [...new Set(b.items.map(i => i.file_path).filter(Boolean))];
      const win = b.items.filter(i => i.type === 'window').reduce((s, i) => s + Number(i.duration_ms || 0), 0);
      b.dur = win || (b.end - b.start);
      b.kind = b.types.clipboard && b.items.length === 1 ? 'clip' : b.types.ide && b.items.length === 1 ? 'ide' : (BROWSER.test(b.app) || b.urls.length) ? 'web' : CHAT.test(b.app) ? 'chat' : IDE.test(b.app) ? 'code' : 'app';
      b.demo = b.items.some(isDemo);
      b.low = b.items.every(i => i._low);
      b.summary = summarize(b);
    }
    return blocks;
  }

  /* ── 规则摘要（AI 可覆盖） ── */
  function summarize(b) {
    const a = b.items[0]; const m = meta(a.meta);
    if (b.kind === 'clip') { const c = String(a.content || '').replace(/\s+/g, ' '); return `${m.sourceApp || a.app_name ? '从 ' + (m.sourceApp || a.app_name) + ' ' : ''}复制了 ${c.length} 字：${c.slice(0, 36)}${c.length > 36 ? '…' : ''}`; }
    if (b.kind === 'ide') { const ws = (m.workspaces || []).length, cm = m.commitCount || 0; return `IDE 会话：${ws} 个工作区${cm ? `，今日 ${cm} 次提交` : ''}`; }
    if (b.kind === 'chat') {
      const people = b.titles.filter(t => !GENERIC.test(t));
      return people.length ? `在${b.app}与 ${people.length} 位联系人/群聊天（${people.slice(0, 3).join('、')}${people.length > 3 ? '…' : ''}）` : `在${b.app}处理消息`;
    }
    if (b.kind === 'web') {
      const hosts = [...new Set(b.urls.map(host).filter(Boolean))];
      const titles = b.titles.slice(0, 2).map(t => t.replace(/\s*[-|–—]\s*(Microsoft Edge|Google Chrome|Firefox).*$/i, ''));
      return `浏览 ${Math.max(b.urls.length, b.titles.length, 1)} 个页面${hosts.length ? '（' + hosts.slice(0, 2).join('、') + '）' : ''}${titles.length ? '：' + titles.join('、') : ''}`;
    }
    if (b.kind === 'code') {
      const files = b.titles.map(t => t.split(/\s+[—–-]\s+/)[0]).filter(Boolean); const proj = (b.titles[0] || '').split(/\s+[—–-]\s+/)[1];
      return `在 ${b.app} 编辑 ${[...new Set(files)].slice(0, 3).join('、') || '代码'}${proj ? `（${proj}）` : ''}`;
    }
    if (b.types.document) return `打开文档 ${base(b.paths[0] || b.titles[0])}`;
    if (b.types.uia) return `阅读 ${b.app}「${b.titles[0] || ''}」`;
    if (b.types.note) return `记录笔记：${(a.window_title || a.content || '').slice(0, 30)}`;
    if (b.types.screenshot) return `截屏 · ${a.window_title || ''}`;
    return b.titles.length > 1 ? `在 ${b.app} 中切换 ${b.titles.length} 个窗口` : `使用 ${b.app}${b.titles[0] ? ' · ' + b.titles[0] : ''}`;
  }

  /* ── 图标 ── */
  const iconKey = (b) => b.kind === 'web' && b.urls[0] ? 'u:' + host(b.urls[0]) : 'a:' + (b.exe || b.process || b.app).toLowerCase();
  function iconHtml(b) {
    const k = iconKey(b); const src = iconCache[k];
    const letter = esc((b.app || '?').replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 1).toUpperCase() || '?');
    return `<div class="tlf-ico" data-ik="${esc(k)}" style="--h:${hue(b.app)}">${src ? `<img src="${src}" alt="" />` : (b.kind === 'clip' || b.kind === 'ide' ? svg((TYPE[b.kind === 'clip' ? 'clipboard' : 'ide'])[1], 18) : `<span>${letter}</span>`)}</div>`;
  }
  async function loadIcons(blocks) {
    const want = []; const seen = new Set();
    for (const b of blocks) { const k = iconKey(b); if (k in iconCache || seen.has(k)) continue; seen.add(k); want.push(b.kind === 'web' && b.urls[0] ? { k, url: b.urls[0] } : { k, exe: b.exe, process: b.process }); }
    if (!want.length || !window.mindtrace.tl) return;
    try { const r = await window.mindtrace.tl('icons', want); Object.assign(iconCache, r); } catch (_) { want.forEach(w => iconCache[w.k] = ''); }
    document.querySelectorAll('.tlf-ico[data-ik]').forEach(el => { const s = iconCache[el.dataset.ik]; if (s && !el.querySelector('img')) el.innerHTML = `<img src="${s}" alt="" />`; });
  }

  /* ── 渲染 ── */
  function rawRow(i) {
    const link = i.url ? `<a class="tlf-link" data-url="${esc(i.url)}" title="在浏览器打开">${esc(host(i.url) || i.url)}</a>` : i.file_path ? `<a class="tlf-link" data-path="${esc(i.file_path)}" title="在资源管理器中显示">${esc(base(i.file_path))}</a>` : '';
    return `<div class="tlf-raw-row"><span class="t">${hm(i.started_at)}</span>${chip(i.type)}<span class="x">${esc(i.window_title || String(i.content || '').slice(0, 80))}</span>${link}<span class="d">${fmtDur(i.duration_ms)}</span>${i._low ? `<span class="tlf-low">${esc(i._low)}</span>` : ''}</div>`;
  }
  function blockHtml(b, maxDur) {
    const range = b.end - b.start >= 60000 ? `${hm(b.start)}–${hm(b.end)}` : hm(b.start);
    const pct = Math.max(2, Math.round(Math.sqrt(b.dur / maxDur) * 100));
    const links = [...b.urls.slice(0, 2).map(u => `<a class="tlf-link" data-url="${esc(u)}" title="${esc(u)}">${svg(TYPE.browser[1], 12)}${esc(host(u))}</a>`), ...b.paths.slice(0, 2).map(p => `<a class="tlf-link" data-path="${esc(p)}" title="${esc(p)}">${svg(TYPE.document[1], 12)}${esc(base(p))}</a>`)].join('');
    const ide = b.kind === 'ide' ? ideHtml(b.items[0]) : '';
    const sum = aiCache[b.id] || b.summary;
    return `<article class="tlf-block k-${b.kind}${b.low ? ' low' : ''}${state.sel === b.id ? ' sel' : ''}" data-bid="${esc(b.id)}" id="act-${esc(b.items[0].id)}" tabindex="0" aria-label="${esc(b.app + ' ' + sum)}">
      <div class="tlf-time"><b>${range}</b>${b.dur >= 60000 ? `<span>${fmtDur(b.dur)}</span>` : ''}</div>
      ${iconHtml(b)}
      <div class="tlf-main">
        <div class="tlf-l1"><span class="tlf-app">${esc(b.app)}</span>${b.demo ? '<span class="demo-tag">示例</span>' : ''}<span class="tlf-sum${aiCache[b.id] ? ' ai' : ''}" title="${aiCache[b.id] ? 'AI 摘要' : '规则摘要'}">${esc(sum)}</span></div>
        <div class="tlf-l2">${Object.entries(b.types).map(([t, n]) => chip(t, n)).join('')}${links}</div>
        ${b.dur >= 60000 ? `<div class="tlf-bar" title="时长 ${fmtDur(b.dur)}"><i style="width:${pct}%"></i></div>` : ''}
        ${ide}
        ${b.items.length > 1 ? `<div class="tlf-more"><div class="tlf-more-in">${b.items.map(rawRow).join('')}</div></div>` : ''}
      </div>
      <div class="tlf-actions" role="toolbar" aria-label="操作">
        ${b.items.length > 1 ? `<button class="tlf-act" data-act="expand" title="展开原始事件" aria-expanded="false">${svg('M6 9l6 6 6-6')}<span>${b.items.length}</span></button>` : ''}
        <button class="tlf-act" data-act="kb" title="加入知识库">${svg('M12 5v14M5 12h14')}</button>
        <button class="tlf-act" data-act="copy" title="复制">${svg('M9 9h11v11H9zM5 15V4h11')}</button>
        <button class="tlf-act" data-act="ignore" title="忽略此来源">${svg('M4 4l16 16M10.6 5.1A9 9 0 0121 12a9.6 9.6 0 01-2.2 3.2M6.6 6.6A9.6 9.6 0 003 12a9 9 0 0012.4 5.4')}</button>
      </div>
    </article>`;
  }
  function ideHtml(a) {
    const m = meta(a.meta);
    const ws = (m.recent || (m.workspaces || []).map(p => ({ path: p }))).slice(0, 5);
    const cm = (m.commits || []).slice(0, 4);
    if (!ws.length && !cm.length) {
      const lines = String(a.content || '').split('\n').filter(l => /^-\s/.test(l)).slice(0, 6);
      return lines.length ? `<ul class="tlf-list">${lines.map(l => `<li>${esc(l.slice(2))}</li>`).join('')}</ul>` : '';
    }
    return `<div class="tlf-ide"><div><div class="cap">工作区</div><ul class="tlf-list">${ws.map(w => `<li><a class="tlf-link" data-path="${esc(w.path)}">${esc(base(w.path))}</a><span class="muted">${esc(w.source || '')}</span></li>`).join('')}</ul></div>
      ${cm.length ? `<div><div class="cap">今日提交 · ${m.commitCount || cm.length}</div><ul class="tlf-list">${cm.map(c => `<li><code>${esc(String(c.hash || '').slice(0, 7))}</code>${esc(c.subject || '')}</li>`).join('')}</ul></div>` : ''}</div>`;
  }
  function hourSummary(bs) {
    const by = {}; let act = 0;
    for (const b of bs) { by[b.app] = (by[b.app] || 0) + b.dur; act += b.items.some(i => i.type === 'window') ? b.dur : 0; }
    const top = Object.entries(by).filter(([, v]) => v >= 60000).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${esc(k)} ${fmtDur(v)}`);
    return `${bs.length} 段${act >= 60000 ? ` · 专注 ${fmtDur(Math.min(act, 3600000))}` : ''}${top.length ? ' · ' + top.join('、') : ''}`;
  }

  function ensureLayout() {
    const list = $('timeline-list');
    if (!list.parentElement.classList.contains('tlf-wrap')) {
      const wrap = document.createElement('div'); wrap.className = 'tlf-wrap';
      list.parentElement.insertBefore(wrap, list); wrap.appendChild(list);
      const aside = document.createElement('aside'); aside.id = 'tl-detail'; aside.className = 'tlf-detail card hidden'; aside.setAttribute('aria-label', '活动详情');
      wrap.appendChild(aside);
    }
    if (!$('tl-density')) {
      const anchor = $('tl-hide-low')?.closest('label');
      if (anchor) anchor.insertAdjacentHTML('afterend', `<div class="seg-toggle" id="tl-density" role="group" aria-label="显示密度"><button data-d="comfortable" title="舒适">舒适</button><button data-d="compact" title="紧凑">紧凑</button></div>`);
      $('tl-density')?.addEventListener('click', (e) => { const d = e.target.closest('button')?.dataset.d; if (!d) return; localStorage.setItem('tl-density', d); applyDensity(); });
    }
    applyDensity();
  }
  function applyDensity() { const d = pref(); $('timeline-list').classList.toggle('compact', d === 'compact'); document.querySelectorAll('#tl-density button').forEach(b => b.classList.toggle('on', b.dataset.d === d)); }

  function render(items, opts = {}) {
    ensureLayout();
    const list = $('timeline-list'); list.classList.add('tlf');
    const blocks = toBlocks(items);
    state.blocks = blocks;
    if (!blocks.length) { list.innerHTML = window.emptyState ? window.emptyState('没有匹配的时间线记录', '调整筛选条件，或关闭「隐藏低价值事件」查看全部。') : '<div class="empty">没有记录</div>'; return; }
    const maxDur = Math.max(60000, ...blocks.map(b => b.dur));
    const hours = new Map();
    for (const b of [...blocks].reverse()) { const d = new Date(b.start); const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`; if (!hours.has(k)) hours.set(k, { h: d.getHours(), day: d, bs: [] }); hours.get(k).bs.push(b); }
    const today = new Date().toDateString(); let lastDay = '';
    list.innerHTML = [...hours.values()].map(g => {
      const ds = g.day.toDateString(); const dayHead = ds !== lastDay && ds !== today ? `<div class="tlf-day">${g.day.getMonth() + 1} 月 ${g.day.getDate()} 日</div>` : ''; lastDay = ds;
      return `${dayHead}<section class="tlf-hour" id="tlh-${g.h}" data-h="${g.h}"><header class="tlf-hh"><b>${pad(g.h)}:00</b><span>${hourSummary(g.bs)}</span></header>${g.bs.map(b => blockHtml(b, maxDur)).join('')}</section>`;
    }).join('');
    loadIcons(blocks);
    aiSummaries(blocks);
    if (opts.focusId) { const el = document.getElementById('act-' + opts.focusId) || [...list.querySelectorAll('.tlf-block')].find(x => state.blocks.find(b => b.id === x.dataset.bid)?.items.some(i => i.id === opts.focusId)); if (el) { el.classList.add('highlight'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }
  }
  async function aiSummaries(blocks) {
    if (!window.mindtrace.tl) return;
    const cand = blocks.filter(b => b.items.length > 1 && !aiCache[b.id]).slice(0, 20).map(b => ({ id: b.id, app: b.app, type: b.kind, minutes: Math.round(b.dur / 60000), titles: b.titles }));
    if (!cand.length) return;
    try { const r = await window.mindtrace.tl('ai-summary', cand); Object.assign(aiCache, r || {}); for (const [id, s] of Object.entries(r || {})) { const el = document.querySelector(`.tlf-block[data-bid="${CSS.escape(id)}"] .tlf-sum`); if (el) { el.textContent = s; el.classList.add('ai'); el.title = 'AI 摘要'; } } } catch (_) {}
  }

  /* ── 详情面板 ── */
  async function openDetail(b) {
    state.sel = b.id;
    document.querySelectorAll('.tlf-block').forEach(x => x.classList.toggle('sel', x.dataset.bid === b.id));
    const aside = $('tl-detail'); aside.classList.remove('hidden'); $('timeline-list').parentElement.classList.add('open');
    aside.innerHTML = `<div class="tlf-d-head">${iconHtml(b)}<div><div class="tlf-app">${esc(b.app)}</div><div class="tiny muted">${hm(b.start)}–${hm(b.end)} · ${fmtDur(b.dur) || '瞬时'} · ${b.items.length} 条事件</div></div><button class="tlf-act" data-act="close" title="关闭 (Esc)">${svg('M6 6l12 12M18 6L6 18')}</button></div>
      <div class="tlf-d-sum">${esc(aiCache[b.id] || b.summary)}</div><div class="tlf-d-body"><div class="muted tiny">加载中…</div></div>`;
    let d = { acts: b.items, shots: [], entities: [] };
    try { d = await window.mindtrace.tl('detail', { ids: b.items.map(i => i.id).filter(id => !String(id).startsWith('sess-')), from: b.start, to: b.end }); } catch (_) {}
    if (state.sel !== b.id) return;
    const acts = d.acts && d.acts.length ? d.acts : b.items;
    aside.querySelector('.tlf-d-body').innerHTML = `
      <h4>原始事件</h4><div class="tlf-d-raw">${acts.map(i => rawRow(i) + (i.content && i.type !== 'window' ? `<pre class="tlf-pre">${esc(String(i.content).slice(0, 1200))}</pre>` : '')).join('')}</div>
      <h4>截屏与识别文本</h4>${d.shots.length ? d.shots.map(s => `<div class="tlf-shot"><div class="tiny muted">${hm(s.taken_at)} · ${esc(s.window_title || '')}</div>${s.description ? `<div>${esc(s.description)}</div>` : ''}${s.ocr_text ? `<pre class="tlf-pre">${esc(String(s.ocr_text).slice(0, 800))}</pre>` : ''}</div>`).join('') : '<div class="tiny muted">此时段没有截屏（截屏采集默认关闭）。</div>'}
      <h4>相关知识实体</h4>${d.entities.length ? `<div class="tlf-ents">${d.entities.map(e => `<button class="tlf-ent" data-eid="${esc(e.id)}">${esc(e.name)}<span>${esc(e.type || '')}</span></button>`).join('')}</div>` : '<div class="tiny muted">暂无匹配的知识库实体。</div>'}`;
  }
  function closeDetail() { state.sel = null; $('tl-detail')?.classList.add('hidden'); $('timeline-list')?.parentElement.classList.remove('open'); document.querySelectorAll('.tlf-block.sel').forEach(x => x.classList.remove('sel')); }

  /* ── 交互 ── */
  document.addEventListener('click', async (e) => {
    const link = e.target.closest('.tlf-link');
    if (link) { e.preventDefault(); e.stopPropagation(); const r = await window.mindtrace.tl('open', link.dataset.url ? { url: link.dataset.url } : { path: link.dataset.path }); if (r && r.error && window.toast) window.toast(r.error); return; }
    const ent = e.target.closest('.tlf-ent');
    if (ent) { if (window.MTV23 && window.MTV23.KB) window.MTV23.KB.sel = ent.dataset.eid; window.showView && window.showView('kb'); return; }
    const act = e.target.closest('.tlf-act');
    const blockEl = e.target.closest('.tlf-block');
    if (act && act.dataset.act === 'close') { closeDetail(); return; }
    if (!blockEl || !blockEl.closest('#timeline-list')) return;
    const b = state.blocks.find(x => x.id === blockEl.dataset.bid); if (!b) return;
    if (act) {
      e.stopPropagation();
      const text = `${hm(b.start)}–${hm(b.end)} ${b.app}：${aiCache[b.id] || b.summary}\n` + b.items.map(i => `- ${hm(i.started_at)} ${i.window_title || ''} ${i.url || i.file_path || ''} ${i.type === 'clipboard' || i.type === 'uia' ? String(i.content || '').slice(0, 300) : ''}`.trim()).join('\n');
      if (act.dataset.act === 'expand') { const open = blockEl.classList.toggle('open'); act.setAttribute('aria-expanded', String(open)); }
      if (act.dataset.act === 'copy') { await navigator.clipboard.writeText(text).catch(() => {}); window.toast && window.toast('已复制到剪贴板'); }
      if (act.dataset.act === 'kb') { const r = await window.mindtrace.tl('add-kb', { title: `${b.app} · ${aiCache[b.id] || b.summary}`.slice(0, 80), text }); window.toast && window.toast(r.ok ? '已加入知识库（作为我的笔记）' : '加入失败'); }
      if (act.dataset.act === 'ignore') {
        if (!confirm(`以后不再记录「${b.app}」？\n可在 设置 → 隐私 → 应用黑名单 中恢复。`)) return;
        const r = await window.mindtrace.tl('ignore-source', { app: b.app });
        if (r.ok) { window.toast && window.toast(`已忽略「${b.app}」，之后不再采集`); }
      }
      return;
    }
    openDetail(b);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.sel) closeDetail();
    if (e.key === 'Enter' && document.activeElement?.classList.contains('tlf-block')) document.activeElement.click();
  });

  function jumpToHour(h) {
    const secs = [...document.querySelectorAll('.tlf-hour')];
    const el = secs.find(s => Number(s.dataset.h) === h) || secs.filter(s => Number(s.dataset.h) <= h).sort((a, b) => b.dataset.h - a.dataset.h)[0] || secs[secs.length - 1];
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); }
  }
  window.TLFeed = { render, toBlocks, summarize, jumpToHour, closeDetail };
})();
