const titles = {
  dashboard: ['今日总览', '把今天的忙碌，沉淀为可复用的企业知识资产'],
  timeline: ['时间线', '按时 / 天 / 周 / 月回看桌面足迹'],
  wiki: ['Wiki', '时间卷 · 实体页 · 记忆与反链'],
  knowledge: ['知识库', '日刊 · 主题 · 人物 · 项目 · 所学 · 待办'],
  chat: ['智能问答', '用自然语言检索你的数字资产'],
  collect: ['采集中心', '分项开关、状态与隐私黑名单'],
  ai: ['设置', 'AI 模型 · 导出 · 本机 API · 关于']
};

let state = null;
let timelineZoom = 'day';
let wikiKind = '';
let currentKind = '';
let knowledgeTab = 'journals';
let presets = {};
let obStep = 1;
let highlightId = null;
let obCollectors = { window: false, browser: false, documents: false, clipboard: false, screenshots: false };

function $(id) { return document.getElementById(id); }
function emptyState(title, desc) {
  const illu = (window.MTIcons && MTIcons.empty) ? MTIcons.empty() : '';
  return `<div class="empty">${illu}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(desc || '')}</p></div>`;
}
/** toast(msg, {type:'success'|'error'|'info', action:{label, run}, sticky}) */
function toast(msg, opts = {}) {
  const el = $('toast');
  const type = opts.type || (/失败|错误|无法/.test(msg) ? 'error' : /已|成功|完成/.test(msg) ? 'success' : 'info');
  el.className = 'toast ' + type;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const icon = { success: '✓', error: '!', info: 'i' }[type];
  el.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-msg">${escapeHtml(msg)}</span>` +
    (opts.action ? `<button type="button" class="toast-action">${escapeHtml(opts.action.label)}</button>` : '') +
    (type === 'error' || opts.action ? '<button type="button" class="toast-close" aria-label="关闭">×</button>' : '');
  const hide = () => el.classList.add('hidden');
  el.querySelector('.toast-action')?.addEventListener('click', () => { hide(); opts.action.run(); });
  el.querySelector('.toast-close')?.addEventListener('click', hide);
  clearTimeout(toast._t);
  if (!(type === 'error' || opts.sticky)) toast._t = setTimeout(hide, opts.action ? 6000 : 2600);
}

function fmtMin(ms) {
  if (ms > 0 && ms < 60000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const m = Math.max(0, Math.round((ms || 0) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function typeLabel(t) {
  return ({ window: '窗口', browser: '浏览', document: '文档', clipboard: '剪贴板', screenshot: '截屏', note: '笔记', ide: 'IDE', download: '下载', file: '文件', uia: '界面文本' })[t] || t;
}
function escTitle(s, badge = true) {
  const raw = String(s || '');
  const demo = /^【示例(数据)?】/.test(raw);
  return escapeHtml(raw.replace(/^【示例(数据)?】\s*/, '')) + (demo && badge ? '<span class="demo-tag">示例</span>' : '');
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
/** Lightweight markdown → HTML (headings, lists, bold/italic, paragraphs). */
function renderMarkdown(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inUl = false, inOl = false;
  const closeLists = () => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };
  const inline = (s) => escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeLists(); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      closeLists();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    const ul = /^[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    closeLists();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeLists();
  return out.join('\n');
}
function setDelta(el, delta) {
  if (!el) return;
  const d = delta || { label: '较昨日 —', dir: 'flat' };
  el.textContent = d.label || '较昨日 —';
  el.className = 'delta ' + (d.dir === 'up' ? 'up' : d.dir === 'down' ? 'down' : 'flat');
}
function lines(id) { return $(id).value.split(/\n+/).map(s => s.trim()).filter(Boolean); }

function greet() {
  const h = new Date().getHours();
  const hi = h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好';
  const d = new Date();
  $('greeting').textContent = `${hi}，今天是 ${d.getMonth()+1} 月 ${d.getDate()} 日`;
}

function showObStep(n) {
  obStep = n;
  [1,2,3,4].forEach(i => {
    $(`ob-step${i}`).classList.toggle('hidden', i !== n);
  });
  [...$('ob-steps').children].forEach((el, idx) => el.classList.toggle('on', idx < n));
}


/* ── AI 表单：模型 ID 下拉、测试连接（2.3.1） ── */
function aiForm(pfx) {
  const g = (id) => ($(pfx + id) ? $(pfx + id).value : '');
  return { provider: g('preset'), baseUrl: g('base').trim(), model: g('model').trim(), visionModel: g('vision').trim(), apiKey: g('key').trim() };
}
function fillModelList(pfx, models) {
  const dl = $(pfx + 'model-list'); if (!dl) return;
  const p = presets[$(pfx + 'preset')?.value] || {};
  const ids = models && models.length ? models.map(m => typeof m === 'string' ? { id: m } : m) : (p.models || (p.model ? [p.model] : [])).map(id => ({ id }));
  dl.innerHTML = ids.map(m => `<option value="${escapeHtml(m.id)}">${m.name && m.name !== m.id ? escapeHtml(m.name) : ''}</option>`).join('');
}
function applyAiPreset(pfx) {
  const p = presets[$(pfx + 'preset').value];
  if (p?.baseUrl) $(pfx + 'base').value = p.baseUrl;
  if (p?.model) $(pfx + 'model').value = p.model;
  if ($(pfx + 'vision')) { $(pfx + 'vision').value = ''; $(pfx + 'vision').placeholder = p?.visionHint ? '留空（该服务对话模型默认不用于识图）' : 'gpt-4o / qwen-vl-plus / llava（可留空）'; }
  fillModelList(pfx, null);
}
async function runAiTest(pfx, box) {
  const form = aiForm(pfx);
  box.className = 'inline-status busy'; box.textContent = '正在连接…';
  const r = await window.mindtrace.testAi(form);
  if (r.models) fillModelList(pfx, r.models);
  if (r.mapped && r.model) $(pfx + 'model').value = r.model;
  const lines = [];
  if (r.ok) lines.push(`✓ 连接成功 · ${r.latency}ms · 模型 ${r.model}` + (r.mapped ? `（已将「${r.inputModel}」更正为模型 ID）` : ''));
  else lines.push(`✗ 连接失败：${r.error}`);
  if (r.ok && r.vision) lines.push((r.vision.status === 'ok' ? '✓ ' : r.vision.status === 'warn' ? '⚠ ' : '· ') + r.vision.message);
  box.className = 'inline-status ' + (!r.ok ? 'err' : (r.vision && r.vision.status === 'warn' ? 'warn' : 'ok'));
  box.textContent = lines.join('\n'); box.style.whiteSpace = 'pre-line';
  return r;
}

async function refreshState() {
  state = await window.mindtrace.getState();
  presets = await window.mindtrace.getPresets();
  applyConfigToForm();
  fillPresetSelect($('ai-preset'), state.config.ai.provider);
  fillPresetSelect($('ob-ai-preset'), state.config.ai.provider);
  fillModelList('ai-', null); fillModelList('ob-ai-', null);
  updateStatus();
  if (!state.config.onboardingCompleted) {
    $('onboarding').classList.remove('hidden');
    showObStep(1);
  } else {
    $('onboarding').classList.add('hidden');
  }
}

function fillPresetSelect(sel, current) {
  if (!sel) return;
  sel.innerHTML = '';
  for (const [k, v] of Object.entries(presets)) {
    const o = document.createElement('option');
    o.value = k; o.textContent = v.label || k;
    if (k === current) o.selected = true;
    sel.appendChild(o);
  }
}

function updateStatus() {
  const pill = $('status-pill');
  const paused = state.config.privacy.paused;
  const auth = state.config.authorized;
  const anyOn = Object.values(state.config.collectors || {}).some(Boolean);
  if (!auth || !state.config.onboardingCompleted) {
    pill.className = 'status-pill off'; $('status-text').textContent = '未就绪';
  } else if (paused || !anyOn) {
    pill.className = 'status-pill pause'; $('status-text').textContent = paused ? '已暂停' : '未开启采集项';
  } else {
    pill.className = 'status-pill on'; $('status-text').textContent = '采集中';
  }
  $('btn-pause').textContent = paused ? '恢复采集' : (anyOn ? '暂停采集' : '去开启采集项');
  $('btn-pause').dataset.mode = (!paused && !anyOn) ? 'setup' : '';
  $('api-hint').textContent = `http://127.0.0.1:${state.apiPort}`;
}

function applyConfigToForm() {
  const c = state.config;
  $('c-window').checked = !!c.collectors.window;
  $('c-browser').checked = !!c.collectors.browser;
  $('c-documents').checked = !!c.collectors.documents;
  $('c-clipboard').checked = !!c.collectors.clipboard;
  $('c-screenshots').checked = !!c.collectors.screenshots;
  if ($('c-notes')) $('c-notes').checked = !!c.collectors.notes;
  if ($('c-ide')) $('c-ide').checked = !!c.collectors.ide;
  if ($('c-downloads')) $('c-downloads').checked = !!c.collectors.downloads;
  if ($('c-files')) $('c-files').checked = !!c.collectors.files;
  if ($('c-uia')) $('c-uia').checked = !!c.collectors.uia;
  $('shot-interval').value = c.privacy.screenshotIntervalSec;
  $('idle-threshold').value = c.privacy.idleThresholdSec;
  $('bl-apps').value = (c.privacy.blacklistApps || []).join('\n');
  $('bl-sites').value = (c.privacy.blacklistSites || []).join('\n');
  $('bl-keys').value = (c.privacy.blacklistKeywords || []).join('\n');
  $('start-boot').checked = !!c.startOnBoot;
  if ($('demo-mode')) $('demo-mode').checked = !!c.demoMode;
  $('demo-banner')?.classList.toggle('hidden', !c.demoMode);
  if ($('btn-seed')) $('btn-seed').textContent = c.demoMode ? '关闭示例数据' : '体验示例数据';
  $('ai-base').value = c.ai.baseUrl || '';
  $('ai-model').value = c.ai.model || '';
  $('ai-key').value = '';
  $('ai-key').placeholder = state.configRawKeySet ? '已保存（输入新值可覆盖）' : 'sk-…';
  $('ai-vision') && ($('ai-vision').value = c.ai.visionModel || '');
  $('ai-auto').checked = !!c.ai.autoSummarize;
  $('ai-interval').value = c.ai.summarizeIntervalMin || 60;
  $('api-enabled').checked = !!c.api.enabled;
  $('api-port').value = c.api.port;
  $('api-token').value = c.api.token || '';
  $('ob-ai-base').value = c.ai.baseUrl || '';
  $('ob-ai-model').value = c.ai.model || '';
  if ($('ob-ai-vision')) $('ob-ai-vision').value = c.ai.visionModel || '';
}

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $(`view-${name}`).classList.remove('hidden');
  document.querySelectorAll('#nav .nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  const [tt, s] = titles[name];
  $('view-title').textContent = tt;
  $('view-sub').textContent = s;
  if ($('crumb-current')) $('crumb-current').textContent = tt;
  greet();
  if (name === 'dashboard') loadDashboard();
  if (name === 'timeline') loadTimeline();
  if (name === 'knowledge') loadKnowledge();
  if (name === 'chat') loadChat();
  if (name === 'collect') loadCollectorStatus();
  if (name === 'wiki') loadWiki();
}

async function loadDashboard() {
  const stats = await window.mindtrace.getTodayStats();
  $('stat-time').textContent = fmtMin(stats.totalMs);
  $('stat-acts').textContent = stats.activityCount;
  $('stat-browse').textContent = stats.browserCount || 0;
  $('stat-cards').textContent = stats.cardsToday;

  setDelta($('stat-time-delta'), stats.deltas?.time);
  setDelta($('stat-acts-delta'), stats.deltas?.acts);
  setDelta($('stat-browse-delta'), stats.deltas?.browse);
  setDelta($('stat-cards-delta'), stats.deltas?.cards);

  try {
    if (window.MTCharts) {
      MTCharts.appsRank($('chart-apps'), stats.appBreakdown || []);
      if ($('app-bars')) $('app-bars').innerHTML = '';
      MTCharts.heatmap($('chart-hourly'), stats.hourly || new Array(24).fill(0));
      const week = (stats.weekTrend && stats.weekTrend.length) ? stats.weekTrend : [0, 0, 0, 0, 0, 0, stats.activityCount || 0];
      MTCharts.weekTrend($('chart-week'), week);
      const sparkBase = week.map(v => Math.max(0, Number(v) || 0));
      const brand = getComputedStyle(document.body).getPropertyValue('--brand').trim();
      MTCharts.sparkline($('spark-time'), sparkBase, brand);
      MTCharts.sparkline($('spark-acts'), sparkBase, brand);
      MTCharts.sparkline($('spark-browse'), sparkBase.map((v, i) => Math.max(0, Math.round(v * 0.45))), brand);
      MTCharts.sparkline($('spark-cards'), sparkBase.map((v, i) => Math.max(0, Math.round(v * 0.25) + (i === 6 ? (stats.cardsToday || 0) : 0))), brand);
    }
  } catch (e) { console.warn('charts', e); }

  const journals = await window.mindtrace.getJournals();
  const today = new Date().toISOString().slice(0, 10);
  const j = journals.find(x => x.period_key === today) || journals[0];
  if (j) {
    let highlights = [];
    try { highlights = JSON.parse(j.highlights || '[]'); } catch {}
    const demo = /示例/.test(j.title || '') || false;
    const md = [
      j.title ? `## ${j.title}` : '',
      j.content || '',
      highlights.length ? `### 要点\n\n${highlights.map(h => `- ${h}`).join('\n')}` : ''
    ].filter(Boolean).join('\n\n');
    $('journal-box').className = 'journal-box md';
    $('journal-box').innerHTML = (demo ? '<span class="demo-tag">示例</span>' : '') + renderMarkdown(md);
  } else {
    $('journal-box').className = 'journal-box muted';
    $('journal-box').textContent = '还没有摘要。开启采集一段时间后，点击上方按钮生成。';
  }

  const recent = await window.mindtrace.getTimeline({ from: Date.now() - 86400000, limit: 14 });
  $('recent-list').innerHTML = recent.map(a => {
    const demo = isDemoMeta(a.meta);
    return `<div class="recent-row">
      <div class="t">${fmtTime(a.started_at)}</div>
      <div class="cat-dot" data-type="${escapeHtml(a.type || '')}"></div>
      <div class="cat-label">${typeLabel(a.type)}</div>
      <div class="recent-title"><b>${escapeHtml(a.app_name || '')}</b> ${escapeHtml(a.window_title || a.url || a.file_path || '')}${demo ? '<span class="demo-tag">示例</span>' : ''}</div>
    </div>`;
  }).join('') || emptyState('暂无最近活动', '完成引导并开启采集，或打开体验示例数据。');
}

function isDemoMeta(meta) {
  try { const m = typeof meta === 'string' ? JSON.parse(meta) : meta; return !!(m && m.isDemo); } catch { return false; }
}


/* ── 时间线：会话块 + 结构化卡片（2.3.2） ── */
function parseMeta(m) { if (!m) return {}; if (typeof m === 'object') return m; try { return JSON.parse(m); } catch (_) { return {}; } }
function actBodyHtml(a) {
  const m = parseMeta(a.meta);
  if (a.type === 'ide' && (m.workspaces || m.recent)) {
    const ws = (m.recent || (m.workspaces || []).map(p => ({ path: p }))).slice(0, 6);
    const cm = (m.commits || []).slice(0, 5);
    return `<div><b>${escapeHtml(a.app_name || 'IDE')}</b> IDE 会话快照</div>
      <div class="tl-kv"><span class="pill">${(m.workspaces || ws).length} 个工作区</span><span class="pill">${m.commitCount || 0} 次提交</span></div>
      <ul class="tl-list">${ws.map(w => `<li><span class="muted">${escapeHtml(w.source || '')}</span> ${escapeHtml(String(w.path || '').split(/[\\/]/).filter(Boolean).pop() || w.path)} <span class="tiny muted">${escapeHtml(w.path || '')}</span></li>`).join('')}</ul>
      ${cm.length ? `<ul class="tl-list">${cm.map(c => `<li><code>${escapeHtml(String(c.hash || '').slice(0, 7))}</code> ${escapeHtml(c.subject || '')} <span class="tiny muted">${escapeHtml(c.workspace || '')}</span></li>`).join('')}</ul>` : ''}`;
  }
  let content = a.content ? String(a.content) : '';
  if (a.type === 'ide' && /^##/m.test(content)) {
    const lines = content.split('\n');
    return `<div><b>${escapeHtml(a.app_name || '')}</b> ${escapeHtml(a.window_title || '')}</div>` + lines.map(l => /^##\s*/.test(l) ? `<div class="tl-sub">${escapeHtml(l.replace(/^##\s*/, ''))}</div>` : /^-\s/.test(l) ? `<div class="tl-li">${escapeHtml(l.slice(2))}</div>` : '').join('');
  }
  const src = a.type === 'clipboard' ? (m.sourceApp ? `来自 ${escapeHtml(m.sourceApp)}` : '') : '';
  const app = a.app_name || (a.type === 'clipboard' ? (m.sourceApp || '剪贴板') : '');
  return `<div><b>${escapeHtml(app)}</b> ${escapeHtml(a.window_title || '')}${a._low ? ` <span class="pill low-pill">${escapeHtml(a._low)}</span>` : ''}</div>
    <div class="meta">${escapeHtml(a.url || a.file_path || '')} ${content ? '· ' + escapeHtml(content.slice(0, 140)) : ''} ${a.duration_ms ? '· ' + fmtMin(a.duration_ms) : ''} ${src ? '· ' + src : ''}</div>`;
}
function sessionHtml(s) {
  const dur = s.total_ms || (s.ended_at - s.started_at);
  const titles = (s.titles || []).slice(0, 4).map(escapeHtml).join(' · ');
  return `<div class="tl-item session" data-type="window" data-id="${escapeHtml(s.id)}">
    <div class="time">${fmtTime(s.started_at)}<div class="tag" style="margin-top:6px">会话</div></div>
    <div class="tl-card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div><b>${escapeHtml(s.app_name || '')}</b> · ${s.windowCount} 个窗口 · ${fmtMin(dur)}</div>
        <button class="btn sm ghost tl-expand" type="button" aria-expanded="false">展开 ${s.items.length} 条</button></div>
      <div class="meta">${fmtTime(s.started_at)}–${fmtTime(s.ended_at)} · ${titles}${(s.titles || []).length > 4 ? ' …' : ''}</div>
      <div class="tl-raw hidden">${s.items.map(i => `<div class="tl-raw-row"><span class="tiny muted">${fmtTime(i.started_at)}</span> ${escapeHtml(i.window_title || '')} <span class="tiny muted">${fmtMin(i.duration_ms || 0)}</span></div>`).join('')}</div>
    </div></div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('.tl-expand'); if (!b) return;
  e.stopPropagation();
  const raw = b.closest('.tl-card').querySelector('.tl-raw'); const open = raw.classList.toggle('hidden') === false;
  b.setAttribute('aria-expanded', String(open)); b.textContent = open ? '收起' : b.textContent.replace('收起', '展开');
  if (!open) b.textContent = `展开 ${raw.children.length} 条`;
}, true);

async function loadTimeline(opts = {}) {
  if (timelineZoom !== 'day' && !opts.forceDay) {
    const level = timelineZoom;
    const levelZh = { hour: '小时', week: '周', month: '月' }[level] || level;
    const rolls = await window.mindtrace.getRollups({ level });
    if (!rolls.length) {
      $('timeline-list').innerHTML = emptyState(`暂无按${levelZh}汇总的记录`, '汇总在采集满一个周期后自动生成；也可在 Wiki 页手动「生成今日日卷 / 上一小时卷」。');
      return;
    }
    $('timeline-list').innerHTML = rolls.map(r => `
      <div class="rollup-card" data-level="${escapeHtml(r.level)}" data-key="${escapeHtml(r.period_key)}">
        <h4>${escTitle(r.title || r.period_key)}</h4>
        <div class="preview">${escapeHtml((r.summary_md || '').replace(/[#>*`]/g,'').slice(0, 180))}</div>
      </div>`).join('');
    document.querySelectorAll('.rollup-card').forEach(card => {
      card.onclick = () => {
        if (card.dataset.level === 'month') { timelineZoom = 'week'; }
        else if (card.dataset.level === 'week') { timelineZoom = 'day'; }
        else if (card.dataset.level === 'day') {
          timelineZoom = 'day';
          document.querySelectorAll('#tl-zoom .chip').forEach(c => c.classList.toggle('active', c.dataset.zoom === 'day'));
          loadTimeline({ forceDay: true, day: card.dataset.key });
          return;
        } else if (card.dataset.level === 'hour') {
          timelineZoom = 'day';
          document.querySelectorAll('#tl-zoom .chip').forEach(c => c.classList.toggle('active', c.dataset.zoom === 'day'));
          const day = card.dataset.key.slice(0, 10);
          loadTimeline({ forceDay: true, day });
          return;
        }
        document.querySelectorAll('#tl-zoom .chip').forEach(c => c.classList.toggle('active', c.dataset.zoom === timelineZoom));
        loadTimeline();
      };
    });
    return;
  }
  const q = opts.q != null ? opts.q : $('tl-q').value.trim();
  const type = $('tl-type').value;
  let from = opts.from || (Date.now() - 7 * 86400000);
  let to = opts.to || Date.now();
  if (opts.day) {
    // Civil day in Asia/Shanghai, not the host timezone (naive ISO parse would use the OS TZ).
    const fromSh = Date.parse(opts.day + 'T00:00:00+08:00');
    const toSh = Date.parse(opts.day + 'T23:59:59.999+08:00');
    if (Number.isFinite(fromSh) && Number.isFinite(toSh)) { from = fromSh; to = toSh; }
    else {
      from = new Date(opts.day + 'T00:00:00').getTime();
      to = new Date(opts.day + 'T23:59:59').getTime();
    }
  }
  const hideLow = $('tl-hide-low') ? $('tl-hide-low').checked : true;
  const items = await window.mindtrace.getTimeline({ q, type, from, to, limit: opts.limit || 200, hideLow });
  if (opts.focusId && !items.find(x => x.id === opts.focusId)) {
    const r = await window.mindtrace.getById('activity', opts.focusId);
    if (r && r.ok && r.item) items.unshift(r.item);
    else if (typeof toast === 'function') toast('这条活动已删除或不在当前时间范围，无法跳转');
  }
  if (window.TLFeed) { window.TLFeed.render(items, opts); highlightId = null; return; }
  $('timeline-list').innerHTML = items.map(a => {
    if (a.type === 'session') return sessionHtml(a);
    const demo = isDemoMeta(a.meta);
    const hl = (opts.focusId && a.id === opts.focusId) || (highlightId === a.id);
    return `<div class="tl-item${hl ? ' highlight' : ''}${a._low ? ' low' : ''}" data-type="${escapeHtml(a.type || '')}" data-id="${escapeHtml(a.id)}" id="act-${escapeHtml(a.id)}">
      <div class="time">${fmtTime(a.started_at)}<div class="tag" style="margin-top:6px">${typeLabel(a.type)}</div>${demo ? '<span class="demo-tag">示例</span>' : ''}</div>
      <div class="tl-card">${actBodyHtml(a)}</div>
    </div>`;
  }).join('') || emptyState('没有匹配的时间线记录', '调整筛选条件，或切换到其他时间粒度。');
  if (opts.focusId) {
    const el = document.getElementById('act-' + opts.focusId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightId = opts.focusId;
    setTimeout(() => { highlightId = null; }, 4000);
  }
}

async function loadKnowledge() {
  showKnowledgeTab(knowledgeTab);
  if (knowledgeTab === 'journals') await loadJournalsTab();
  else if (knowledgeTab === 'topics') await loadTopicsTab();
  else await loadCardsTab();
}

window.MTApp = Object.assign(window.MTApp || {}, {
  openJournal: async (id) => {
    showView('knowledge');
    showKnowledgeTab('journals');
    await loadJournalsTab(id);
  }
});

function showKnowledgeTab(tab) {
  knowledgeTab = tab;
  document.querySelectorAll('#knowledge-tabs .chip').forEach(c => c.classList.toggle('active', c.dataset.ktab === tab));
  ['journals','topics','cards'].forEach(k => {
    const el = $(`ktab-${k}`);
    if (el) el.classList.toggle('hidden', k !== tab);
  });
}

async function loadJournalsTab(focusId) {
  const journals = await window.mindtrace.getJournals();
  $('journals-list').innerHTML = journals.map(j => {
    const demo = /示例/.test(j.title || '') || false;
    const hl = focusId && j.id === focusId;
    return `<div class="list-item${hl ? ' highlight' : ''}" style="grid-template-columns: 100px 1fr" data-id="${escapeHtml(j.id)}" id="journal-${escapeHtml(j.id)}" data-open-journal="${escapeHtml(j.id)}">
      <div>${j.period_key}${demo ? '<span class="demo-tag">示例</span>' : ''}</div>
      <div><b>${escapeHtml(j.title || '')}</b><div class="tiny">${escapeHtml((j.content || '').slice(0, 140))}</div></div>
    </div>`;
  }).join('') || emptyState('暂无日刊', '配置 AI 后可生成本日摘要，或开启体验示例数据。');
  document.querySelectorAll('[data-open-journal]').forEach(el => {
    el.onclick = async () => {
      const id = el.getAttribute('data-open-journal');
      const r = await window.mindtrace.getById('journal', id);
      if (r.ok && r.item) openDetail('日刊', r.item.title || r.item.period_key, r.item.content || '', r.item.period_key);
    };
  });
  if (focusId) {
    const el = document.getElementById('journal-' + focusId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

async function loadTopicsTab(focusId) {
  const topics = await window.mindtrace.getTopics();
  $('topics-grid').innerHTML = topics.map(tp => {
    const demo = /【示例】/.test(tp.name || '');
    return `<div class="kcard" data-kind="project" data-id="${escapeHtml(tp.id)}" id="topic-${escapeHtml(tp.id)}">
      <div class="kind">主题${demo ? '<span class="demo-tag">示例</span>' : ''}</div>
      <h4>${escTitle(tp.name, false)}</h4>
      <p>${escapeHtml(tp.summary || '')}</p>
      <div class="tiny">关联卡片 ${(() => { try { return JSON.parse(tp.card_ids||'[]').length; } catch { return 0; } })()} · 活动 ${tp.activity_count || 0}</div>
    </div>`;
  }).join('') || emptyState('暂无主题', '开启体验示例数据，或等待 AI 聚类。');
  document.querySelectorAll('#topics-grid .kcard').forEach(card => {
    card.onclick = () => {
      const id = card.dataset.id;
      const title = card.querySelector('h4')?.textContent || '主题';
      const body = card.querySelector('p')?.textContent || '';
      openDetail('主题', title, body, '');
    };
  });
  if (focusId) document.getElementById('topic-' + focusId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function loadCardsTab(focusId) {
  const q = ($('card-q')?.value || '').trim().toLowerCase();
  let cards = await window.mindtrace.getCards({ kind: currentKind || undefined });
  if (q) cards = cards.filter(c => `${c.title} ${c.summary} ${c.content}`.toLowerCase().includes(q));
  $('cards-grid').innerHTML = cards.map(c => {
    const demo = (c.tags || '').includes('示例') || /【示例】/.test(c.title || '');
    const hl = focusId && c.id === focusId;
    return `<div class="kcard${hl ? ' highlight' : ''}" data-kind="${escapeHtml(c.kind)}" data-id="${escapeHtml(c.id)}" id="card-${escapeHtml(c.id)}">
      <div class="kind">${escapeHtml(c.kind)}${demo ? '<span class="demo-tag">示例</span>' : ''}</div>
      <h4>${escTitle(c.title, false)}</h4>
      <p>${escapeHtml(c.summary || '')}</p>
    </div>`;
  }).join('') || emptyState('暂无知识卡片', '采集一段时间后由 AI 提炼，或开启体验示例数据。');
  document.querySelectorAll('#cards-grid .kcard').forEach(card => {
    card.onclick = async () => {
      const id = card.dataset.id;
      const r = await window.mindtrace.getById('card', id);
      if (r.ok && r.item) {
        openDetail('卡片 · ' + r.item.kind, r.item.title, `${r.item.summary || ''}\n\n${r.item.content || ''}`, (r.item.tags || ''));
      }
    };
  });
  if (focusId) {
    const el = document.getElementById('card-' + focusId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function openDetail(kindLabel, title, body, meta) {
  $('detail-title').textContent = title || kindLabel;
  $('detail-meta').textContent = `${kindLabel}${meta ? ' · ' + meta : ''}`;
  $('detail-body').textContent = body || '';
  $('detail-drawer').classList.remove('hidden');
}

function renderCitations(cites) {
  if (!cites || !cites.length) return '';
  return `<div class="cite-list">${cites.map(c => {
    const label = escapeHtml((c.label || c.key || '').slice(0, 64));
    const key = escapeHtml(c.key || '');
    const id = escapeHtml(c.id || '');
    const started = c.started_at || '';
    const kind = escapeHtml(c.kind === 'card' ? 'card' : c.kind === 'journal' ? 'journal' : 'activity');
    const kindZh = kind === 'card' ? '知识卡片' : kind === 'journal' ? '日刊' : '活动';
    return `<button type="button" class="cite-card" data-cite-id="${id}" data-cite-kind="${kind}" data-started="${started}" title="${label}"><span class="k">${key} · ${kindZh}</span><span class="cite-label">${label}</span></button>`;
  }).join('')}</div>`;
}

function parseMsgCitations(m) {
  if (!m.citations) return [];
  if (Array.isArray(m.citations)) return m.citations;
  try { return JSON.parse(m.citations); } catch { return []; }
}


async function loadWiki() {
  const pages = await window.mindtrace.getWiki(wikiKind || undefined);
  const mems = await window.mindtrace.getMemories();
  $('wiki-list').innerHTML = pages.map(p => `
    <div class="list-item" style="grid-template-columns: 72px 1fr; cursor:pointer" data-slug="${escapeHtml(p.slug)}">
      <div class="tag">${escapeHtml(p.kind)}</div>
      <div><b>${escTitle(p.title)}</b><div class="muted tiny">${escapeHtml((p.body_md||'').replace(/^#+.*$/m,'').replace(/[#*>`\[\]-]/g,'').trim().slice(0,60))}</div></div>
    </div>`).join('') || emptyState('暂无 Wiki 页', '生成日卷后将出现时间卷与实体。');
  $('memory-list').innerHTML = mems.map(m => `
    <div class="list-item" style="grid-template-columns: 72px 1fr">
      <div class="tag">${escapeHtml(m.kind)}</div>
      <div>${escapeHtml(m.text)} <span class="tiny muted">· ${(m.confidence*100|0)}%</span></div>
    </div>`).join('') || emptyState('暂无记忆条目', '生成日卷或摘要后将抽取记忆。');
  document.querySelectorAll('#wiki-list .list-item').forEach(el => {
    el.onclick = () => {
      const page = pages.find(x => x.slug === el.dataset.slug);
      if (!page) return;
      $('wiki-body').classList.remove('muted');
      $('wiki-body').innerHTML = renderMarkdown(page.body_md || ''); $('wiki-body').classList.add('md');
      if ($('wiki-tags')) {
        const tags = [page.kind, page.period_key].filter(Boolean);
        $('wiki-tags').innerHTML = tags.map(tg => `<span class="tag-pill">${escapeHtml(tg)}</span>`).join('') || '';
      }
      if ($('wiki-backlinks')) {
        const related = pages.filter(x => x.slug !== page.slug && (x.kind === page.kind || (page.body_md||'').includes(x.title))).slice(0, 6);
        $('wiki-backlinks').innerHTML = related.length
          ? related.map(r => `<div class="backlink" data-slug="${escapeHtml(r.slug)}">${escTitle(r.title)}</div>`).join('')
          : '<div class="tiny">暂无反向链接</div>';
        $('wiki-backlinks').querySelectorAll('.backlink').forEach(b => {
          b.onclick = () => {
            const tgt = pages.find(x => x.slug === b.dataset.slug);
            if (!tgt) return;
            $('wiki-body').innerHTML = renderMarkdown(tgt.body_md || '');
            if ($('wiki-tags')) $('wiki-tags').innerHTML = `<span class="tag-pill">${escapeHtml(tgt.kind||'')}</span>`;
          };
        });
      }
    };
  });
  const budget = await window.mindtrace.getBudget();
  if (budget && $('collector-status-list')) {
    /* optional */
  }
}

async function loadChat() {
  const msgs = await window.mindtrace.getChat();
  const log = $('chat-log');
  const sug = $('chat-suggestions');
  if (!msgs.length) {
    log.innerHTML = `<div class="chat-empty">${(window.MTIcons&&MTIcons.empty)?MTIcons.empty():''}
      <h3>智能问答</h3>
      <p>用自然语言检索日刊、卡片与时间线。开启「体验示例数据」可先看带引用的样例；配置 AI 后即可真实提问。</p>
    </div>`;
    sug?.classList.remove('hidden');
  } else {
    log.innerHTML = msgs.map(m => {
      const cites = m.role === 'assistant' ? parseMsgCitations(m) : [];
      return `<div class="bubble ${m.role}">${escapeHtml(m.content).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>")}${renderCitations(cites)}</div>`;
    }).join('');
    sug?.classList.add('hidden');
  }
  log.scrollTop = log.scrollHeight;
  bindCiteClicks(log);
}

function bindCiteClicks(root) {
  root.querySelectorAll('.cite-card, .cite-chip').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.citeId;
      const kind = btn.dataset.citeKind || 'activity';
      if (!id) return;
      if (kind === 'card') {
        showView('knowledge');
        showKnowledgeTab('cards');
        await loadCardsTab(id);
        toast('已定位到知识卡片');
        return;
      }
      if (kind === 'journal') {
        showView('knowledge');
        showKnowledgeTab('journals');
        await loadJournalsTab(id);
        toast('已定位到日刊');
        return;
      }
      showView('timeline');
      $('tl-q').value = '';
      await loadTimeline({ focusId: id, from: 0, limit: 500 });
      toast('已定位到时间线事件');
    };
  });
}

function readObCollectors() {
  const downloads = !!$('ob-c-downloads')?.checked;
  const filesEl = $('ob-c-files');
  return {
    window: $('ob-c-window').checked,
    browser: $('ob-c-browser').checked,
    documents: $('ob-c-documents').checked,
    clipboard: $('ob-c-clipboard').checked,
    screenshots: $('ob-c-screenshots').checked,
    ide: !!$('ob-c-ide')?.checked,
    downloads,
    files: filesEl ? !!filesEl.checked : downloads,
    uia: !!$('ob-c-uia')?.checked
  };
}

async function loadCollectorStatus() {
  const rows = await window.mindtrace.getCollectorStatus();
  $('collector-status-list').innerHTML = rows.map(r => {
    const st = r.status || 'idle';
    return `<div class="collector-row">
      <div><span class="status-dot ${escapeHtml(st)}"></span><b>${escapeHtml(r.name)}</b>
        <div class="tiny">${escapeHtml(r.message || '')}${r.lastError ? ' · ' + escapeHtml(r.lastError) : ''}</div>
      </div>
      <div class="tiny">${st === 'ok' ? '运行中' : st === 'error' ? '异常' : st === 'off' ? '已关' : '空闲'}</div>
    </div>`;
  }).join('') || '<div class="empty">暂无状态</div>';
}

function bind() {
  document.querySelectorAll('#nav .nav-item').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

  $('ob-next1').onclick = () => showObStep(2);
  $('ob-back2').onclick = () => showObStep(1);
  $('ob-skip2').onclick = () => { obCollectors = { window:false,browser:false,documents:false,clipboard:false,screenshots:false }; showObStep(3); };
  $('ob-next2').onclick = () => { obCollectors = readObCollectors(); showObStep(3); };
  $('ob-back3').onclick = () => showObStep(2);
  $('ob-skip3').onclick = () => showObStep(4);
  $('ob-next3').onclick = async () => {
    const key = $('ob-ai-key').value.trim();
    const patch = { ai: {
      provider: $('ob-ai-preset').value,
      baseUrl: $('ob-ai-base').value.trim(),
      model: $('ob-ai-model').value.trim(),
      visionModel: ($('ob-ai-vision') && $('ob-ai-vision').value.trim()) || ''
    } };
    if (key) patch.ai.apiKey = key;
    await window.mindtrace.setConfig(patch);
    showObStep(4);
  };
  $('ob-back4').onclick = () => showObStep(3);
  $('ob-ai-preset').onchange = () => applyAiPreset('ob-ai-');
  $('ob-test').onclick = async () => {
    const r = await runAiTest('ob-ai-', $('ob-ai-result'));
    if (r.ok) { const f = aiForm('ob-ai-'); const patch = { ai: { provider: f.provider, baseUrl: f.baseUrl, model: r.model, visionModel: f.visionModel } }; if (f.apiKey) patch.ai.apiKey = f.apiKey; await window.mindtrace.setConfig(patch); }
  };
  $('ob-finish').onclick = async () => {
    await window.mindtrace.setConfig({
      collectors: obCollectors,
      startOnBoot: $('ob-boot').checked,
      startCollectingOnLaunch: $('ob-start').checked
    });
    await window.mindtrace.authorize(true);
    await refreshState();
    toast('欢迎使用知迹');
    showView('dashboard');
  };

  $('btn-pause').onclick = async () => {
    if ($('btn-pause').dataset.mode === 'setup') { showView('collect'); return; }
    const next = !state.config.privacy.paused;
    await window.mindtrace.setPaused(next);
    await refreshState();
    toast(next ? '已暂停采集' : '已恢复采集');
  };
  $('btn-theme').onclick = () => {
    const dark = document.body.getAttribute('data-theme') !== 'dark';
    document.body.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.body.classList.toggle('theme-dark', dark);
    window.mindtrace.setConfig({ theme: dark ? 'dark' : 'light' });
    if (!$('view-dashboard').classList.contains('hidden')) loadDashboard();
  };
  $('btn-seed').onclick = async () => {
    const next = !state.config.demoMode;
    await window.mindtrace.setDemoMode(next);
    await refreshState();
    toast(next ? '已开启体验示例数据' : '已关闭并清除示例数据');
    showView(document.querySelector('.nav-item.active')?.dataset.view || 'dashboard');
  };
  $('btn-export').onclick = $('btn-export2').onclick = async () => {
    const r = await window.mindtrace.exportVault();
    toast(r.ok ? `已导出到 ${r.vaultPath}` : (r.error || '导出失败'));
  };
  $('btn-summarize').onclick = async () => {
    toast('正在整理今日轨迹…');
    const r = await window.mindtrace.summarizeToday();
    toast(r.ok ? '日刊已生成' : (r.error || '生成失败（请检查 AI 设置）'));
    if (r.ok) loadDashboard();
  };
  $('btn-refresh-journal').onclick = loadDashboard;
  $('btn-tl-search').onclick = loadTimeline;
  $('tl-q').onkeydown = e => { if (e.key === 'Enter') loadTimeline(); };
  $('tl-type').onchange = () => loadTimeline();
  if ($('tl-hide-low')) $('tl-hide-low').onchange = () => loadTimeline();
  document.querySelectorAll('#kind-chips .chip').forEach(ch => {
    ch.onclick = () => {
      document.querySelectorAll('#kind-chips .chip').forEach(x => x.classList.remove('active'));
      ch.classList.add('active');
      currentKind = ch.dataset.kind;
      loadCardsTab();
    };
  });
  document.querySelectorAll('#knowledge-tabs .chip').forEach(ch => {
    ch.onclick = () => { showKnowledgeTab(ch.dataset.ktab); loadKnowledge(); };
  });
  $('detail-close')?.addEventListener('click', () => $('detail-drawer').classList.add('hidden'));
  $('detail-drawer')?.addEventListener('click', (e) => { if (e.target.id === 'detail-drawer') e.target.classList.add('hidden'); });
  $('card-q')?.addEventListener('keydown', e => { if (e.key === 'Enter') loadCardsTab(); });
  $('btn-refresh-status')?.addEventListener('click', loadCollectorStatus);
  $('btn-open-log')?.addEventListener('click', async () => { await window.mindtrace.openLog(); });
  $('btn-extract').onclick = async () => {
    toast('正在提炼知识卡片…');
    const r = await window.mindtrace.extractCards();
    toast(r.ok ? `已更新 ${r.ids?.length || 0} 张卡片` : (r.error || '提炼失败'));
    if (r.ok) loadKnowledge();
  };
  $('btn-ask').onclick = ask;
  document.querySelectorAll('.suggest-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const q = chip.dataset.q || chip.textContent;
      $('chat-input').value = q;
      // If demo mode and sample already exists, just ensure chat shows; else ask
      ask();
    });
  });
  $('chat-input').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); ask(); } };

  $('btn-save-collect').onclick = async () => {
    const demoOn = !!$('demo-mode')?.checked;
    if (demoOn !== !!state.config.demoMode) await window.mindtrace.setDemoMode(demoOn);
    await window.mindtrace.setConfig({
      startOnBoot: $('start-boot').checked,
      collectors: {
        window: $('c-window').checked,
        browser: $('c-browser').checked,
        documents: $('c-documents').checked,
        clipboard: $('c-clipboard').checked,
        screenshots: $('c-screenshots').checked,
        notes: !!$('c-notes')?.checked,
        ide: !!$('c-ide')?.checked,
        downloads: !!$('c-downloads')?.checked,
        files: !!$('c-files')?.checked,
        uia: !!$('c-uia')?.checked
      },
      privacy: {
        screenshotIntervalSec: Number($('shot-interval').value) || 300,
        idleThresholdSec: Number($('idle-threshold').value) || 180,
        blacklistApps: lines('bl-apps'),
        blacklistSites: lines('bl-sites'),
        blacklistKeywords: lines('bl-keys')
      }
    });
    await refreshState();
    toast('采集设置已保存');
  };
  $('btn-capture').onclick = async () => {
    const r = await window.mindtrace.captureNow();
    toast(r.ok ? '截屏已保存' : '截屏失败（当前环境可能受限）');
  };
  $('ai-preset').onchange = () => applyAiPreset('ai-');
  $('btn-save-ai').onclick = async () => {
    const key = $('ai-key').value.trim();
    const patch = {
      ai: {
        provider: $('ai-preset').value,
        baseUrl: $('ai-base').value.trim(),
        model: $('ai-model').value.trim(),
        visionModel: ($('ai-vision') && $('ai-vision').value.trim()) || '',
        autoSummarize: $('ai-auto').checked,
        summarizeIntervalMin: Number($('ai-interval').value) || 60
      }
    };
    if (key && !key.startsWith('••••')) patch.ai.apiKey = key;
    await window.mindtrace.setConfig(patch);
    await refreshState();
    toast('AI 设置已保存');
  };
  $('btn-test-ai').onclick = () => runAiTest('ai-', $('ai-test-result'));
  $('btn-save-api').onclick = async () => {
    await window.mindtrace.setConfig({ api: { enabled: $('api-enabled').checked, port: Number($('api-port').value) || 17321 } });
    await refreshState();
    toast('API 设置已保存');
  };
  
  document.querySelectorAll('#tl-zoom .chip').forEach(ch => {
    ch.addEventListener('click', () => {
      document.querySelectorAll('#tl-zoom .chip').forEach(x => x.classList.remove('active'));
      ch.classList.add('active');
      timelineZoom = ch.dataset.zoom;
      loadTimeline();
    });
  });
  document.querySelectorAll('#wiki-kind-chips .chip').forEach(ch => {
    ch.addEventListener('click', () => {
      document.querySelectorAll('#wiki-kind-chips .chip').forEach(x => x.classList.remove('active'));
      ch.classList.add('active');
      wikiKind = ch.dataset.wkind || '';
      loadWiki();
    });
  });
  $('btn-build-day')?.addEventListener('click', async () => {
    toast('正在生成日卷…');
    const r = await window.mindtrace.buildRollup({ level: 'day' });
    toast(r.ok ? '日卷已生成' : (r.error || '失败'));
    loadWiki();
  });
  $('btn-build-hour')?.addEventListener('click', async () => {
    toast('正在生成小时卷…');
    const r = await window.mindtrace.buildRollup({ level: 'hour' });
    toast(r.ok ? '小时卷已生成' : (r.error || '失败'));
    loadWiki();
  });
  const openQn = () => { $('quick-note-modal')?.classList.remove('hidden'); $('qn-body')?.focus(); };
  const closeQn = () => $('quick-note-modal')?.classList.add('hidden');
  $('qn-cancel')?.addEventListener('click', closeQn);
  $('qn-save')?.addEventListener('click', async () => {
    await window.mindtrace.addQuickNote({ title: $('qn-title').value.trim(), content: $('qn-body').value.trim() });
    $('qn-title').value = ''; $('qn-body').value = '';
    closeQn(); toast('速记已保存');
  });
  window.mindtrace.onQuickNote?.(() => { showView('dashboard'); openQn(); });


  // Enterprise chrome: sidebar, command palette, window controls
  $('btn-sidebar-toggle')?.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-collapsed');
  });
  $('win-min')?.addEventListener('click', () => window.mindtrace.windowMinimize?.());
  $('win-max')?.addEventListener('click', () => window.mindtrace.windowMaximize?.());
  $('win-close')?.addEventListener('click', () => window.mindtrace.windowClose?.());

  const SEARCH_KINDS = [['', '全部'], ['file', '文档'], ['page', '网页'], ['chat', '会话'], ['code', '代码']];
  const jumpToHit = (h) => {
    const id = h.jump?.activityId || h.id;
    const ts = h.jump?.started_at || h.started_at;
    const day = ts ? new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }) : '';
    showView('timeline');
    timelineZoom = 'day';
    document.querySelectorAll('#tl-zoom .chip').forEach(c => c.classList.toggle('active', c.dataset.zoom === 'day'));
    if ($('tl-q')) $('tl-q').value = '';
    loadTimeline({ forceDay: true, day: day || undefined, focusId: id, q: '', from: day ? undefined : (ts ? ts - 86400000 : 0), to: day ? undefined : (ts ? ts + 86400000 : undefined), limit: 400 });
  };
  const renderSearchHits = (res, q, kind) => {
    const acts = Array.isArray(res) ? res : (res.activities || []);
    const chips = SEARCH_KINDS.map(([k, l]) => `<button type="button" class="chip${k === (kind || '') ? ' active' : ''}" data-skind="${k}">${l}</button>`).join('');
    const rows = acts.map(h => {
      const when = h.started_at ? new Date(h.started_at).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }) : '';
      const ex = h.excerpt || (h.content || '').replace(/\s+/g, ' ').slice(0, 140);
      const path = h.path || h.file_path || h.url || '';
      return `<button type="button" class="tl-item sr-hit" data-type="${escapeHtml(h.type || '')}" data-id="${escapeHtml(h.id || '')}">
        <div class="time"><div class="tag">${escapeHtml(h.kindLabel || typeLabel(h.type) || '')}</div><div class="tiny muted">${escapeHtml(when)}</div></div>
        <div class="tl-card"><div><b>${escapeHtml(h.app || '')}</b> ${escapeHtml(h.title || '')}</div>
        ${ex ? `<div class="sr-excerpt">${escapeHtml(ex)}</div>` : ''}
        ${path ? `<div class="meta">${escapeHtml(path)}</div>` : ''}</div>
      </button>`;
    }).join('');
    $('timeline-list').innerHTML = `<div class="sr-bar"><span class="sr-q">「${escapeHtml(q)}」 ${acts.length} 条</span><div class="chips">${chips}</div></div>` +
      (rows || emptyState('无全文结果', '换个关键词或筛选试试'));
    $('timeline-list').querySelectorAll('.sr-hit').forEach((el, i) => { el.onclick = () => jumpToHit(acts[i]); });
    $('timeline-list').querySelectorAll('[data-skind]').forEach(ch => {
      ch.onclick = (e) => { e.preventDefault(); runFts(q, { kind: ch.dataset.skind || undefined }); };
    });
  };
  const runFts = async (q, opts = {}) => {
    const res = await window.mindtrace.searchFts(q, opts);
    showView('timeline');
    timelineZoom = 'day';
    document.querySelectorAll('#tl-zoom .chip').forEach(c => c.classList.toggle('active', c.dataset.zoom === 'day'));
    if ($('tl-q')) $('tl-q').value = q;
    renderSearchHits(res, q, opts.kind || '');
  };
  let cmdState = { items: [], active: 0 };
  let wikiCache = null, topicCache = null;
  const PAGES = [
    ['dashboard', '今日总览', 'Ctrl+1'], ['timeline', '时间线', 'Ctrl+2'], ['wiki', 'Wiki', 'Ctrl+3'], ['memory', '记忆', 'Ctrl+4'],
    ['knowledge', '报告', 'Ctrl+5'], ['chat', '智能问答', 'Ctrl+6'], ['insights', '洞察', 'Ctrl+7'], ['collect', '采集中心', ''], ['ai', '设置', '']
  ];
  const COMMANDS = [
    { label: '生成本日摘要', kbd: '', run: () => $('btn-summarize')?.click() },
    { label: '生成今日日卷', run: () => window.mindtrace.buildRollup({ level: 'day' }).then(r => toast(r.ok ? '已生成今日日卷' : '生成失败：' + r.error)) },
    { label: '生成本周周报', run: () => window.mindtrace.buildRollup({ level: 'week' }).then(r => toast(r.ok ? '已生成本周周报' : '生成失败：' + r.error)) },
    { label: '暂停采集 30 分钟', run: async () => { await window.mindtrace.setPaused(true); await refreshState(); toast('已暂停采集 30 分钟', { action: { label: '撤销', run: async () => { await window.mindtrace.setPaused(false); refreshState(); } } }); setTimeout(async () => { await window.mindtrace.setPaused(false); refreshState(); }, 30 * 60000); } },
    { label: '暂停 / 恢复采集', kbd: 'Ctrl+Shift+M', run: () => $('btn-pause')?.click() },
    { label: '导出知识库（Markdown）', run: () => $('btn-export')?.click() },
    { label: '打开速记', run: () => { $('quick-note-modal')?.classList.remove('hidden'); $('qn-body')?.focus(); } },
    { label: '切换深色 / 浅色主题', run: () => $('btn-theme')?.click() },
    { label: '清除最近 15 分钟数据', run: () => { showView('collect'); setTimeout(() => document.querySelector('[data-wipe="15"]')?.click(), 200); } },
    { label: '导出加密备份', run: () => { showView('ai'); setTimeout(() => window.MTUX?.settingsTab('data'), 50); } }
  ];
  async function cmdItems(raw) {
    const q = (raw || '').trim();
    const pre = q[0];
    const body = ['>', '@', '#', '?', '？'].includes(pre) ? q.slice(1).trim() : q;
    const ql = body.toLowerCase();
    const m = (s) => !ql || String(s).toLowerCase().includes(ql);
    if (pre === '>') return [{ group: '操作', list: COMMANDS.filter(c => m(c.label)) }];
    if (pre === '?' || pre === '？') return [{ group: '问 AI', list: [{ label: body ? `问：「${body}」` : '输入问题后回车', hint: '智能问答', run: () => { if (!body) return; showView('chat'); $('chat-input').value = body; $('btn-ask').click(); } }] }];
    if (pre === '@') {
      wikiCache = wikiCache || await window.mindtrace.getWiki();
      const list = wikiCache.filter(p => (p.kind === 'person' || p.kind === 'project') && m(p.title)).slice(0, 12)
        .map(p => ({ label: p.title.replace(/^【示例】/, ''), hint: p.kind === 'person' ? '人物' : '项目', run: () => { showView('wiki'); setTimeout(() => window.MTUX?.openWiki(p.slug), 150); } }));
      return [{ group: '人物与项目', list }];
    }
    if (pre === '#') {
      topicCache = topicCache || await window.mindtrace.getTopics();
      wikiCache = wikiCache || await window.mindtrace.getWiki();
      const list = [...topicCache.map(tp => ({ label: tp.name.replace(/^【示例】/, ''), hint: '主题', run: () => { showView('knowledge'); setTimeout(() => document.querySelector('[data-ktab=topics]')?.click(), 100); } })),
        ...wikiCache.filter(p => p.kind === 'topic').map(p => ({ label: p.title.replace(/^【示例】/, ''), hint: 'Wiki 主题', run: () => { showView('wiki'); setTimeout(() => window.MTUX?.openWiki(p.slug), 150); } }))].filter(x => m(x.label)).slice(0, 12);
      return [{ group: '主题与标签', list }];
    }
    const groups = [];
    if (q) groups.push({ group: '搜索', list: [{ label: `全文搜索「${q}」`, hint: 'Enter', run: () => runFts(q) }, { label: `问 AI「${q}」`, hint: '?', run: () => { showView('chat'); $('chat-input').value = q; $('btn-ask').click(); } }] });
    groups.push({ group: '页面', list: PAGES.filter(p => m(p[1])).map(([v, l, k]) => ({ label: l, kbd: k, run: () => showView(v) })) });
    groups.push({ group: '操作', list: COMMANDS.filter(c => m(c.label)).slice(0, q ? 6 : 5) });
    return groups.filter(g => g.list.length);
  }
  async function renderCmd(q) {
    const groups = await cmdItems(q);
    const flat = [];
    $('cmd-results').innerHTML = groups.map(g => `<div class="cmd-group">${escapeHtml(g.group)}</div>` + g.list.map(it => {
      const i = flat.push(it) - 1;
      return `<button type="button" class="cmd-item" data-idx="${i}" role="option"><span>${escapeHtml(it.label)}</span><span class="hint">${it.kbd ? `<kbd>${escapeHtml(it.kbd)}</kbd>` : escapeHtml(it.hint || '')}</span></button>`;
    }).join('')).join('') || '<div class="empty" style="padding:20px;border:0">无匹配结果</div>';
    cmdState = { items: flat, active: 0 };
    setCmdActive(0);
    $('cmd-results').querySelectorAll('.cmd-item').forEach(btn => {
      btn.onclick = () => { const it = flat[Number(btn.dataset.idx)]; closeCmd(); it?.run?.(); };
      btn.onmousemove = () => setCmdActive(Number(btn.dataset.idx));
    });
  }
  function setCmdActive(i) {
    const n = cmdState.items.length; if (!n) return;
    cmdState.active = (i + n) % n;
    $('cmd-results').querySelectorAll('.cmd-item').forEach(b => b.classList.toggle('active', Number(b.dataset.idx) === cmdState.active));
    $('cmd-results').querySelector('.cmd-item.active')?.scrollIntoView({ block: 'nearest' });
  }
  function openCmd() {
    $('cmd-overlay')?.classList.remove('hidden');
    $('cmd-input').value = '';
    wikiCache = null; topicCache = null;
    renderCmd('');
    setTimeout(() => $('cmd-input')?.focus(), 30);
  }
  function closeCmd() { $('cmd-overlay')?.classList.add('hidden'); }
  $('btn-cmd-open')?.addEventListener('click', openCmd);
  $('cmd-overlay')?.addEventListener('click', (e) => { if (e.target.id === 'cmd-overlay') closeCmd(); });
  $('cmd-input')?.addEventListener('input', () => renderCmd($('cmd-input').value));
  $('cmd-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCmd();
    if (e.key === 'ArrowDown') { e.preventDefault(); setCmdActive(cmdState.active + 1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCmdActive(cmdState.active - 1); }
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      const it = cmdState.items[cmdState.active];
      if (it) { closeCmd(); it.run(); }
    }
  });
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if ($('cmd-overlay')?.classList.contains('hidden')) openCmd(); else closeCmd();
    }
    if (e.key === 'Escape') closeCmd();
  });

  window.mindtrace.onStatus(async (data) => {
    await refreshState();
    if (data?.toast) toast(data.toast);
  });
}

async function ask() {
  const q = $('chat-input').value.trim();
  if (!q) return;
  $('chat-input').value = '';
  $('chat-suggestions')?.classList.add('hidden');
  const log = $('chat-log');
  log.insertAdjacentHTML('beforeend', `<div class="bubble user">${escapeHtml(q)}</div>`);
  log.insertAdjacentHTML('beforeend', `<div class="bubble assistant muted" id="thinking">正在检索你的历史…</div>`);
  log.scrollTop = log.scrollHeight;
  const r = await window.mindtrace.ask(q);
  $('thinking')?.remove();
  if (!r.ok) {
    const needKey = /key|配置/i.test(r.error || '');
    log.insertAdjacentHTML('beforeend', `<div class="bubble assistant error">${needKey ? '还没有配置 AI 模型，暂时无法生成回答。' : '回答生成失败：' + escapeHtml(r.error)}<br><button class="btn sm" onclick="document.querySelector('[data-view=ai]').click()">${needKey ? '去设置 AI 模型' : '打开设置检查'}</button></div>`);
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'bubble assistant';
    wrap.innerHTML = `${escapeHtml(r.answer).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}${renderCitations(r.citations || [])}`;
    log.appendChild(wrap);
    bindCiteClicks(wrap);
  }
  log.scrollTop = log.scrollHeight;
}

(async function init() {
  bind();
  await refreshState();
  if (state.config.theme === 'dark') {
    document.body.setAttribute('data-theme', 'dark');
    document.body.classList.add('theme-dark');
  }
  try {
    const ver = await window.mindtrace.getAppVersion?.();
    if (ver && $('app-version-label')) $('app-version-label').textContent = `v${ver} · Ctrl+Shift+M`;
  } catch (_) {}
  showView('dashboard');
  window.addEventListener('resize', () => {
    if (document.querySelector('#view-dashboard:not(.hidden)') && window.MTCharts) {
      // soft redraw on next dash load; skip heavy work
    }
  });
})();
